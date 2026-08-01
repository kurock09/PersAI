/**
 * ADR-168 S1 — InternalRuntimeEmailSendService focused tests.
 * Covers: no verified identity -> skipped with zero Postmark HTTP calls;
 * verified send -> exact Postmark request shape + MessageID; Postmark 4xx ->
 * failed with a reason.
 */
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { InternalRuntimeEmailSendService } from "../src/modules/workspace-management/application/internal-runtime-email-send.service";
import { PostmarkEmailSendClientService } from "../src/modules/workspace-management/application/postmark-email-send.client";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";
import type { PlatformRuntimeProviderSecretStoreService } from "../src/modules/workspace-management/application/platform-runtime-provider-secret-store.service";
import type { AppendAssistantAuditEventService } from "../src/modules/workspace-management/application/append-assistant-audit-event.service";

type IdentityRow = {
  workspaceId: string;
  email: string;
  displayName: string | null;
  status: "pending" | "verified" | "failed";
};

function createFakePrisma(identity: IdentityRow | null) {
  return {
    workspaceEmailSenderIdentity: {
      async findUnique() {
        return identity;
      }
    }
  } as unknown as WorkspaceManagementPrismaService;
}

function createSecretStoreMock(token: string | null) {
  return {
    async resolveSecretValueById(secretId: string) {
      if (token === null) {
        throw new Error(`PersAI-managed runtime secret "${secretId}" is not configured.`);
      }
      return token;
    }
  } as unknown as PlatformRuntimeProviderSecretStoreService;
}

function createAuditMock() {
  const events: Array<{ eventCode: string; outcome: string | undefined; details: unknown }> = [];
  return {
    audit: {
      async execute(input: { eventCode: string; outcome?: string; details?: unknown }) {
        events.push({ eventCode: input.eventCode, outcome: input.outcome, details: input.details });
      }
    } as unknown as AppendAssistantAuditEventService,
    events
  };
}

const baseInput = {
  workspaceId: "workspace-1",
  assistantId: "assistant-1",
  chatId: "chat-1",
  requestId: "req-1",
  to: "recipient@example.com",
  subject: "Hello",
  body: "Plain text body"
};

async function testSkippedWithoutVerifiedIdentityMakesNoPostmarkCall(): Promise<void> {
  const prisma = createFakePrisma(null);
  const { audit, events } = createAuditMock();
  const service = new InternalRuntimeEmailSendService(
    prisma,
    createSecretStoreMock("server-token"),
    audit,
    new PostmarkEmailSendClientService()
  );

  let fetchCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("fetch must not be called when there is no verified identity");
  }) as typeof fetch;

  try {
    const result = await service.execute(baseInput);
    assert.deepEqual(result, { status: "skipped", reason: "sender_email_not_verified" });
    assert.equal(fetchCalls, 0, "no Postmark HTTP call was made");
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventCode, "assistant.email.skipped");
  assert.equal(events[0]?.outcome, "denied");
  console.log("✓ no verified identity -> skipped, zero Postmark HTTP calls, audited");
}

async function testVerifiedSendProducesExactPostmarkRequestShape(): Promise<void> {
  const prisma = createFakePrisma({
    workspaceId: "workspace-1",
    email: "sales@customer.com",
    displayName: "Customer Sales",
    status: "verified"
  });
  const { audit, events } = createAuditMock();
  const service = new InternalRuntimeEmailSendService(
    prisma,
    createSecretStoreMock("server-token"),
    audit,
    new PostmarkEmailSendClientService()
  );

  let capturedUrl: string | null = null;
  let capturedInit: RequestInit | null = null;
  const originalFetch = global.fetch;
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedInit = init ?? null;
    return new Response(JSON.stringify({ MessageID: "pm-msg-abc", ErrorCode: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  let result: unknown;
  try {
    result = await service.execute(baseInput);
  } finally {
    global.fetch = originalFetch;
  }

  assert.deepEqual(result, { status: "sent", messageId: "pm-msg-abc" });
  assert.equal(capturedUrl, "https://api.postmarkapp.com/email");
  assert.ok(capturedInit !== null);
  const headers = capturedInit!.headers as Record<string, string>;
  assert.equal(headers["X-Postmark-Server-Token"], "server-token");
  const payload = JSON.parse(capturedInit!.body as string) as Record<string, unknown>;
  assert.equal(payload["From"], "Customer Sales <sales@customer.com>");
  assert.equal(payload["To"], "recipient@example.com");
  assert.equal(payload["Subject"], "Hello");
  assert.equal(payload["TextBody"], "Plain text body");
  assert.equal(payload["MessageStream"], "outbound");
  assert.equal("HtmlBody" in payload, false, "no HTML body in v1");

  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventCode, "assistant.email.sent");
  assert.equal(events[0]?.outcome, "succeeded");
  console.log(
    "✓ verified send produces the exact Postmark request shape and returns the MessageID"
  );
}

async function testPostmarkRejectionMapsToFailedWithReason(): Promise<void> {
  const prisma = createFakePrisma({
    workspaceId: "workspace-1",
    email: "sales@customer.com",
    displayName: null,
    status: "verified"
  });
  const { audit, events } = createAuditMock();
  const service = new InternalRuntimeEmailSendService(
    prisma,
    createSecretStoreMock("server-token"),
    audit,
    new PostmarkEmailSendClientService()
  );

  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(JSON.stringify({ ErrorCode: 300, Message: "Invalid email request" }), {
      status: 422,
      headers: { "Content-Type": "application/json" }
    })) as typeof fetch;

  let result: unknown;
  try {
    result = await service.execute(baseInput);
  } finally {
    global.fetch = originalFetch;
  }

  assert.deepEqual(result, {
    status: "failed",
    reason: "postmark_rejected",
    message: "Invalid email request"
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventCode, "assistant.email.failed");
  assert.equal(events[0]?.outcome, "failed");
  console.log("✓ Postmark 4xx maps to failed with a reason");
}

const REJECTED_BODY_KEYS = ["cc", "bcc", "attachments", "html", "htmlBody"] as const;

async function testParseInputRejectsUnsupportedBodyKeysWithNoPostmarkCall(): Promise<void> {
  const prisma = createFakePrisma({
    workspaceId: "workspace-1",
    email: "sales@customer.com",
    displayName: null,
    status: "verified"
  });
  const { audit, events } = createAuditMock();
  const service = new InternalRuntimeEmailSendService(
    prisma,
    createSecretStoreMock("server-token"),
    audit,
    new PostmarkEmailSendClientService()
  );

  let fetchCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("fetch must not be called for a rejected payload");
  }) as typeof fetch;

  try {
    for (const rejectedKey of REJECTED_BODY_KEYS) {
      let thrown: unknown = null;
      try {
        service.parseInput({
          ...baseInput,
          [rejectedKey]: rejectedKey === "attachments" ? [] : "unsupported-value"
        });
      } catch (error) {
        thrown = error;
      }
      assert.ok(
        thrown instanceof BadRequestException,
        `${rejectedKey} must be rejected with BadRequestException`
      );
      assert.match(
        (thrown as BadRequestException).message,
        new RegExp(`^${rejectedKey} is not supported\\. Exactly one plain-text recipient`)
      );
    }
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(fetchCalls, 0, "no Postmark HTTP call was made for any rejected payload");
  assert.equal(events.length, 0, "a rejected payload never reaches the audit write either");
  console.log(
    "✓ parseInput rejects cc/bcc/attachments/html/htmlBody, each with zero Postmark HTTP calls"
  );
}

async function run(): Promise<void> {
  await testSkippedWithoutVerifiedIdentityMakesNoPostmarkCall();
  await testVerifiedSendProducesExactPostmarkRequestShape();
  await testPostmarkRejectionMapsToFailedWithReason();
  await testParseInputRejectsUnsupportedBodyKeysWithNoPostmarkCall();
  console.log("\n✅ All internal-runtime-email-send.service tests passed");
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
