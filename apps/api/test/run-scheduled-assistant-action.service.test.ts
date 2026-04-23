import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import type { RuntimeTurnToolInvocation } from "@persai/runtime-contract";
import { RunScheduledAssistantActionService } from "../src/modules/workspace-management/application/run-scheduled-assistant-action.service";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";

type ReceiptRow = {
  idempotencyKey: string;
  status: "accepted" | "completed" | "interrupted" | "failed";
  createdAt: Date;
};

class FakeSendNativeWebChatTurnService {
  calls: Array<Record<string, unknown>> = [];
  result: {
    assistantMessage: string;
    respondedAt: string;
    media: [];
    toolInvocations?: RuntimeTurnToolInvocation[];
  } = {
    assistantMessage: "Condition did not fire.",
    respondedAt: "2026-04-23T23:04:00.000Z",
    media: []
  };

  async execute(input: Record<string, unknown>) {
    this.calls.push(input);
    return this.result;
  }
}

function createService(input?: {
  receipts?: ReceiptRow[];
  runtimeResult?: {
    assistantMessage: string;
    respondedAt: string;
    media: [];
    toolInvocations?: RuntimeTurnToolInvocation[];
  };
}) {
  const sendService = new FakeSendNativeWebChatTurnService();
  if (input?.runtimeResult !== undefined) {
    sendService.result = input.runtimeResult;
  }
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
      findMany: async () => input?.receipts ?? []
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
  test("renders an executor-style brief that forbids list and nested assistant checks", async () => {
    const { service, sendService } = createService();

    await service.execute(INPUT);

    assert.equal(sendService.calls.length, 1);
    assert.equal(sendService.calls[0]?.userMessageId, BASE_USER_MESSAGE_ID);
    assert.equal(sendService.calls[0]?.surfaceThreadKey, SURFACE_THREAD_KEY);
    assert.equal(sendService.calls[0]?.modelRoleOverride, "system_tool");
    const userMessage = sendService.calls[0]?.userMessage;
    assert.equal(typeof userMessage, "string");
    assert.match(userMessage as string, /MUST NOT use scheduled_action\(action="list"\)/);
    assert.match(
      userMessage as string,
      /YES → call scheduled_action\(action="create", kind="user_reminder"/
    );
    assert.match(
      userMessage as string,
      /MUST NOT create kind="assistant_check" during this hidden run/
    );
    assert.match(userMessage as string, /NO {2}→ do NOT call scheduled_action\./);
  });

  test("rejects malformed assistant rows that have no actionPayload", async () => {
    const { service, sendService } = createService();

    await assert.rejects(
      () =>
        service.execute({
          ...INPUT,
          actionPayload: null,
          payloadText: "(malformed legacy row)"
        }),
      (error) =>
        error instanceof ServiceUnavailableException &&
        error.message === "Assistant scheduled actions require a non-empty actionPayload."
    );
    assert.equal(sendService.calls.length, 0);
  });

  test("skips re-sending when the latest scheduled-action receipt already completed", async () => {
    const { service, sendService } = createService({
      receipts: [
        {
          idempotencyKey: BASE_USER_MESSAGE_ID,
          status: "completed",
          createdAt: new Date()
        }
      ]
    });

    await service.execute(INPUT);

    assert.equal(sendService.calls.length, 0);
  });

  test("forks a new retry idempotency key after a failed receipt", async () => {
    const { service, sendService } = createService({
      receipts: [
        {
          idempotencyKey: BASE_USER_MESSAGE_ID,
          status: "failed",
          createdAt: new Date()
        }
      ]
    });

    await service.execute(INPUT);

    assert.equal(sendService.calls.length, 1);
    assert.equal(sendService.calls[0]?.userMessageId, `${BASE_USER_MESSAGE_ID}:retry:2`);
  });

  test("keeps incrementing retry keys after multiple failed attempts", async () => {
    const { service, sendService } = createService({
      receipts: [
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
      ]
    });

    await service.execute(INPUT);

    assert.equal(sendService.calls.length, 1);
    assert.equal(sendService.calls[0]?.userMessageId, `${BASE_USER_MESSAGE_ID}:retry:3`);
  });

  test("backs off when the latest scheduled-action receipt is still accepted", async () => {
    const { service, sendService } = createService({
      receipts: [
        {
          idempotencyKey: BASE_USER_MESSAGE_ID,
          status: "accepted",
          createdAt: new Date()
        }
      ]
    });

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
    const { service, sendService } = createService({
      receipts: [
        {
          idempotencyKey: BASE_USER_MESSAGE_ID,
          status: "accepted",
          createdAt: new Date("1970-01-01T00:00:00.000Z")
        }
      ]
    });

    await service.execute(INPUT);

    assert.equal(sendService.calls.length, 1);
    assert.equal(sendService.calls[0]?.userMessageId, `${BASE_USER_MESSAGE_ID}:retry:2`);
  });

  test("accepts a terminal hidden-run outcome when it created a reminder", async () => {
    const { service } = createService({
      runtimeResult: {
        assistantMessage: "",
        respondedAt: "2026-04-23T23:04:00.000Z",
        media: [],
        toolInvocations: [{ name: "scheduled_action", iteration: 1, ok: true }]
      }
    });

    await service.execute(INPUT);
  });

  test("rejects hidden runs that end without a reminder or explicit no-op acknowledgement", async () => {
    const { service } = createService({
      runtimeResult: {
        assistantMessage: "",
        respondedAt: "2026-04-23T23:04:00.000Z",
        media: [],
        toolInvocations: [{ name: "web_search", iteration: 0, ok: true }]
      }
    });

    await assert.rejects(
      () => service.execute(INPUT),
      (error) =>
        error instanceof ServiceUnavailableException &&
        error.message ===
          "Scheduled assistant action finished without creating a user reminder or returning an explicit internal acknowledgement."
    );
  });
});
