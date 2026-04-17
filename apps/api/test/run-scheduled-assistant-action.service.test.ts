import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { RunScheduledAssistantActionService } from "../src/modules/workspace-management/application/run-scheduled-assistant-action.service";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";

type ReceiptRow = {
  idempotencyKey: string;
  status: "accepted" | "completed" | "interrupted" | "failed";
  createdAt: Date;
};

class FakeSendNativeWebChatTurnService {
  calls: Array<Record<string, unknown>> = [];

  async execute(input: Record<string, unknown>): Promise<void> {
    this.calls.push(input);
  }
}

function createService(receipts: ReceiptRow[] = []) {
  const sendService = new FakeSendNativeWebChatTurnService();
  const assistantRepository = {
    findById: async () =>
      ({
        id: "assistant-1",
        userId: "user-1",
        workspaceId: "workspace-1",
        applyAppliedVersionId: "version-1"
      }) as never
  } as AssistantRepository;
  const resolveAssistantRuntimeTierService = {
    resolveByAssistantId: async () => "paid_shared_restricted"
  };
  const prisma = {
    runtimeTurnReceipt: {
      findMany: async () => receipts
    }
  };
  const service = new RunScheduledAssistantActionService(
    assistantRepository,
    resolveAssistantRuntimeTierService as never,
    sendService as never,
    prisma as never
  );
  return { service, sendService };
}

const INPUT = {
  assistantId: "assistant-1",
  externalRef: "scheduled-action-1",
  title: "Project follow-up",
  actionType: "follow_up",
  actionPayload: { topic: "project" },
  payloadText: "Check whether a project follow-up would be useful.",
  runAtMs: 1_776_093_904_980
};

const BASE_USER_MESSAGE_ID = `scheduled-action:${INPUT.externalRef}:${String(INPUT.runAtMs)}`;
const SURFACE_THREAD_KEY = `system:scheduled-action:${INPUT.externalRef}`;

describe("RunScheduledAssistantActionService", () => {
  test("uses the base idempotency key and includes explicit conditional follow-up guidance", async () => {
    const { service, sendService } = createService();

    await service.execute(INPUT);

    assert.equal(sendService.calls.length, 1);
    assert.equal(sendService.calls[0]?.userMessageId, BASE_USER_MESSAGE_ID);
    assert.equal(sendService.calls[0]?.surfaceThreadKey, SURFACE_THREAD_KEY);
    assert.equal(sendService.calls[0]?.modelRoleOverride, "system_tool");
    const userMessage = sendService.calls[0]?.userMessage;
    assert.equal(typeof userMessage, "string");
    assert.match(
      userMessage as string,
      /Background assistant actions MUST NOT directly message the user\./
    );
    assert.match(
      userMessage as string,
      /you MUST create a separate scheduled_action with audience="user" and an immediate schedule such as delayMs=1/
    );
    assert.match(userMessage as string, /USD\/RUB check:/);
    assert.match(userMessage as string, /News digest:/);
  });

  test("skips re-sending when the latest scheduled-action receipt already completed", async () => {
    const { service, sendService } = createService([
      {
        idempotencyKey: BASE_USER_MESSAGE_ID,
        status: "completed",
        createdAt: new Date()
      }
    ]);

    await service.execute(INPUT);

    assert.equal(sendService.calls.length, 0);
  });

  test("forks a new retry idempotency key after a failed receipt", async () => {
    const { service, sendService } = createService([
      {
        idempotencyKey: BASE_USER_MESSAGE_ID,
        status: "failed",
        createdAt: new Date()
      }
    ]);

    await service.execute(INPUT);

    assert.equal(sendService.calls.length, 1);
    assert.equal(sendService.calls[0]?.userMessageId, `${BASE_USER_MESSAGE_ID}:retry:2`);
  });

  test("keeps incrementing retry keys after multiple failed attempts", async () => {
    const { service, sendService } = createService([
      {
        idempotencyKey: BASE_USER_MESSAGE_ID,
        status: "failed",
        createdAt: new Date()
      },
      {
        idempotencyKey: `${BASE_USER_MESSAGE_ID}:retry:2`,
        status: "interrupted",
        createdAt: new Date()
      }
    ]);

    await service.execute(INPUT);

    assert.equal(sendService.calls.length, 1);
    assert.equal(sendService.calls[0]?.userMessageId, `${BASE_USER_MESSAGE_ID}:retry:3`);
  });

  test("backs off when the latest scheduled-action receipt is still accepted", async () => {
    const { service, sendService } = createService([
      {
        idempotencyKey: BASE_USER_MESSAGE_ID,
        status: "accepted",
        createdAt: new Date()
      }
    ]);

    await assert.rejects(
      () => service.execute(INPUT),
      (error) =>
        error instanceof ServiceUnavailableException &&
        error.message ===
          `Scheduled assistant action turn "${BASE_USER_MESSAGE_ID}" is still processing.`
    );
    assert.equal(sendService.calls.length, 0);
  });

  test("retries when accepted receipt became stale", async () => {
    const { service, sendService } = createService([
      {
        idempotencyKey: BASE_USER_MESSAGE_ID,
        status: "accepted",
        createdAt: new Date("1970-01-01T00:00:00.000Z")
      }
    ]);

    await service.execute(INPUT);

    assert.equal(sendService.calls.length, 1);
    assert.equal(sendService.calls[0]?.userMessageId, `${BASE_USER_MESSAGE_ID}:retry:2`);
  });
});
