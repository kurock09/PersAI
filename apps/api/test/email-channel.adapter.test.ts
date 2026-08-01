/**
 * ADR-168 audit-fix closeout — real `EmailChannelAdapter` coverage.
 *
 * The previous version of this file imported only `node:assert/strict` and
 * re-implemented adapter-like logic inline (a "TestEmailAdapter" mirror). It
 * never constructed or exercised the actual `EmailChannelAdapter` class, so
 * the ADR-168 refactor of the shared Postmark transport landed with no
 * genuine automated coverage of this live ADR-088 billing/notification email
 * path. This file replaces that mirror: it imports the real adapter, stubs
 * its two real collaborators (the secret store and `global.fetch`), and
 * pins its ACTUAL current behavior — raw send, templated-override send,
 * From-address resolution, missing-token fail-closed, and Postmark
 * 4xx/5xx/network-error mapping.
 */
import assert from "node:assert/strict";
import { EmailChannelAdapter } from "../src/modules/workspace-management/infrastructure/notifications/channel-adapters/email-channel.adapter";
import { PostmarkEmailSendClientService } from "../src/modules/workspace-management/application/postmark-email-send.client";
import type { PlatformRuntimeProviderSecretStoreService } from "../src/modules/workspace-management/application/platform-runtime-provider-secret-store.service";
import {
  NotificationChannelHealth,
  NotificationChannelType,
  NotificationClass,
  NotificationLifecycleStatus,
  NotificationPriority,
  NotificationRenderStrategy,
  NotificationSource,
  type ChannelRegistryRow,
  type NotificationIntentRecord,
  type RenderedPayload
} from "../src/modules/workspace-management/application/notifications/notification-platform.types";

const POSTMARK_SEND_URL = "https://api.postmarkapp.com/email";
const POSTMARK_TEMPLATE_URL = "https://api.postmarkapp.com/email/withTemplate";

function createSecretStoreStub(token: string | null): PlatformRuntimeProviderSecretStoreService {
  return {
    async resolveSecretValueById(secretId: string) {
      if (token === null) {
        throw new Error(`PersAI-managed runtime secret "${secretId}" is not configured.`);
      }
      return token;
    }
  } as unknown as PlatformRuntimeProviderSecretStoreService;
}

function createAdapter(token: string | null): EmailChannelAdapter {
  return new EmailChannelAdapter(
    createSecretStoreStub(token),
    new PostmarkEmailSendClientService()
  );
}

function createIntent(overrides: Partial<NotificationIntentRecord> = {}): NotificationIntentRecord {
  return {
    id: "intent-1",
    workspaceId: "ws-1",
    assistantId: null,
    userId: null,
    source: NotificationSource.billing_lifecycle,
    class: NotificationClass.transactional,
    priority: NotificationPriority.scheduled,
    lifecycleStatus: NotificationLifecycleStatus.pending,
    renderStrategy: NotificationRenderStrategy.template,
    renderInstructionRef: null,
    templateId: null,
    factPayload: { recipientEmail: "user@example.com" },
    policySnapshot: {},
    allowedChannels: ["email"],
    escalationAfterMinutes: null,
    escalationChannel: null,
    dedupeKey: null,
    scheduledAt: null,
    respectQuietHours: false,
    surface: null,
    surfaceThreadKey: null,
    chatId: null,
    traceId: "trace-abc",
    failureReason: null,
    createdAt: new Date("2026-07-31T00:00:00.000Z"),
    claimedAt: null,
    deliveredAt: null,
    deadLetteredAt: null,
    ...overrides
  } as unknown as NotificationIntentRecord;
}

function createChannelConfig(config: Record<string, unknown> = {}): ChannelRegistryRow {
  return {
    id: "channel-1",
    channelType: NotificationChannelType.email,
    enabled: true,
    config,
    healthStatus: NotificationChannelHealth.healthy,
    consecutiveFailures: 0,
    lastDeliveryAt: null,
    lastFailureAt: null,
    createdAt: new Date("2026-07-31T00:00:00.000Z"),
    updatedAt: new Date("2026-07-31T00:00:00.000Z")
  } as unknown as ChannelRegistryRow;
}

const renderedPayload: RenderedPayload = {
  subject: "Your plan expires soon",
  body: "Trial ending soon",
  html: "<p>Trial ending soon</p>",
  plainText: "Trial ending soon (plain)"
};

function stubFetchOnce(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const originalFetch = global.fetch;
  let callCount = 0;
  let capturedUrl: string | null = null;
  let capturedInit: RequestInit | null = null;
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    callCount += 1;
    capturedUrl = String(url);
    capturedInit = init ?? null;
    return handler(capturedUrl, capturedInit ?? {});
  }) as typeof fetch;
  return {
    restore: () => {
      global.fetch = originalFetch;
    },
    calls: () => callCount,
    url: () => capturedUrl,
    init: () => capturedInit
  };
}

async function testRawSendExactRequestShapeAndDeliveredResult(): Promise<void> {
  const stub = stubFetchOnce(
    () =>
      new Response(JSON.stringify({ MessageID: "pm-msg-raw-1", ErrorCode: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
  );

  const adapter = createAdapter("server-token-123");
  let result;
  try {
    result = await adapter.deliver(createIntent(), renderedPayload, createChannelConfig({}));
  } finally {
    stub.restore();
  }

  assert.equal(stub.calls(), 1);
  assert.equal(stub.url(), POSTMARK_SEND_URL);

  const init = stub.init();
  assert.ok(init !== null);
  const headers = init!.headers as Record<string, string>;
  assert.equal(headers["X-Postmark-Server-Token"], "server-token-123");
  assert.equal(headers["Content-Type"], "application/json");

  const payload = JSON.parse(init!.body as string) as Record<string, unknown>;
  assert.equal(payload["From"], "notifications@notifications.persai.dev");
  assert.equal(payload["To"], "user@example.com");
  assert.equal(payload["Subject"], "Your plan expires soon");
  assert.equal(payload["HtmlBody"], "<p>Trial ending soon</p>");
  assert.equal(payload["TextBody"], "Trial ending soon (plain)");
  assert.equal(payload["MessageStream"], "outbound");

  const listUnsubscribe = payload["Headers"] as Array<{ Name: string; Value: string }>;
  assert.deepEqual(listUnsubscribe, [
    { Name: "List-Unsubscribe", Value: "<mailto:unsubscribe@notifications.persai.dev>" },
    { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" }
  ]);

  assert.deepEqual(payload["Metadata"], {
    intentId: "intent-1",
    workspaceId: "ws-1",
    source: NotificationSource.billing_lifecycle,
    traceId: "trace-abc"
  });

  assert.deepEqual(result, { status: "delivered", providerRef: "pm-msg-raw-1" });
  console.log("✓ raw send: exact Postmark /email request shape and delivered result");
}

async function testTemplatedSendUsesWithTemplateUrlAndRawFactPayload(): Promise<void> {
  const stub = stubFetchOnce(
    () =>
      new Response(JSON.stringify({ MessageID: "pm-msg-tmpl-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
  );

  const adapter = createAdapter("server-token-123");
  const intent = createIntent({
    factPayload: {
      recipientEmail: "billing-user@example.com",
      planDisplayName: "Pro",
      periodEndsAt: "2026-08-15"
    }
  });
  let result;
  try {
    result = await adapter.deliver(
      intent,
      renderedPayload,
      createChannelConfig({ postmarkTemplateId: 998877 })
    );
  } finally {
    stub.restore();
  }

  assert.equal(stub.url(), POSTMARK_TEMPLATE_URL);
  const payload = JSON.parse(stub.init()!.body as string) as Record<string, unknown>;
  assert.equal(payload["TemplateId"], 998877);
  assert.equal(payload["To"], "billing-user@example.com");
  assert.deepEqual(payload["TemplateModel"], {
    recipientEmail: "billing-user@example.com",
    planDisplayName: "Pro",
    periodEndsAt: "2026-08-15"
  });

  // PersAI-rendered content must NOT be sent on the templated override path.
  assert.equal("Subject" in payload, false, "no PersAI-rendered Subject on templated path");
  assert.equal("HtmlBody" in payload, false, "no PersAI-rendered HtmlBody on templated path");
  assert.equal("TextBody" in payload, false, "no PersAI-rendered TextBody on templated path");
  assert.equal(payload["MessageStream"], "outbound");

  assert.deepEqual(result, { status: "delivered", providerRef: "pm-msg-tmpl-1" });
  console.log("✓ templated send: /email/withTemplate, raw factPayload, no PersAI-rendered content");
}

async function testTemplatedSendAcceptsNumericStringTemplateId(): Promise<void> {
  const stub = stubFetchOnce(
    () => new Response(JSON.stringify({ MessageID: "pm-msg-tmpl-2" }), { status: 200 })
  );

  const adapter = createAdapter("server-token-123");
  try {
    await adapter.deliver(
      createIntent(),
      renderedPayload,
      createChannelConfig({
        postmarkTemplateId: "554433"
      })
    );
  } finally {
    stub.restore();
  }

  assert.equal(stub.url(), POSTMARK_TEMPLATE_URL);
  const payload = JSON.parse(stub.init()!.body as string) as Record<string, unknown>;
  assert.equal(payload["TemplateId"], 554433);
  console.log("✓ templated send: numeric-string postmarkTemplateId is coerced and honored");
}

async function testFromAddressOverrideHonoredVerbatim(): Promise<void> {
  const stub = stubFetchOnce(
    () => new Response(JSON.stringify({ MessageID: "pm-msg-2" }), { status: 200 })
  );

  const adapter = createAdapter("server-token-123");
  try {
    await adapter.deliver(
      createIntent(),
      renderedPayload,
      createChannelConfig({ fromAddress: "support@persai.com" })
    );
  } finally {
    stub.restore();
  }

  const payload = JSON.parse(stub.init()!.body as string) as Record<string, unknown>;
  assert.equal(payload["From"], "support@persai.com");
  console.log("✓ explicit fromAddress override is sent verbatim");
}

async function testFromAddressFallsBackToNotificationsAtSendingDomain(): Promise<void> {
  const stub = stubFetchOnce(
    () => new Response(JSON.stringify({ MessageID: "pm-msg-3" }), { status: 200 })
  );

  const adapter = createAdapter("server-token-123");
  try {
    await adapter.deliver(
      createIntent(),
      renderedPayload,
      createChannelConfig({ sendingDomain: "billing.customdomain.com" })
    );
  } finally {
    stub.restore();
  }

  const payload = JSON.parse(stub.init()!.body as string) as Record<string, unknown>;
  assert.equal(payload["From"], "notifications@billing.customdomain.com");
  const headers = payload["Headers"] as Array<{ Name: string; Value: string }>;
  const unsub = headers.find((h) => h.Name === "List-Unsubscribe");
  assert.equal(unsub?.Value, "<mailto:unsubscribe@billing.customdomain.com>");
  console.log(
    "✓ no fromAddress -> notifications@<sendingDomain> fallback, unsub header follows it"
  );
}

async function testMissingServerTokenFailsClosedWithNoFetchCall(): Promise<void> {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("fetch must not be called when the Server Token is unavailable");
  }) as typeof fetch;

  const adapter = createAdapter(null);
  let result;
  try {
    result = await adapter.deliver(createIntent(), renderedPayload, createChannelConfig({}));
  } finally {
    global.fetch = originalFetch;
  }

  assert.deepEqual(result, { status: "failed", error: { reason: "postmark_token_unavailable" } });
  assert.equal(fetchCalls, 0, "no Postmark HTTP call was made without a Server Token");
  console.log("✓ missing Server Token -> failed/postmark_token_unavailable, zero fetch calls");
}

async function testMissingToAddressFailsWithoutFetchCall(): Promise<void> {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("fetch must not be called when there is no resolvable recipient");
  }) as typeof fetch;

  const adapter = createAdapter("server-token-123");
  const intent = createIntent({ factPayload: {} });
  let result;
  try {
    result = await adapter.deliver(intent, renderedPayload, createChannelConfig({}));
  } finally {
    global.fetch = originalFetch;
  }

  assert.deepEqual(result, {
    status: "failed",
    error: { reason: "email_to_address_not_configured" }
  });
  assert.equal(fetchCalls, 0, "no Postmark HTTP call was made without a resolvable recipient");
  console.log("✓ no recipientEmail/toAddress -> failed/email_to_address_not_configured");
}

async function testPostmark4xxMapsToPostmarkErrorFailure(): Promise<void> {
  const stub = stubFetchOnce(
    () =>
      new Response(JSON.stringify({ ErrorCode: 300, Message: "Invalid email request" }), {
        status: 422,
        headers: { "Content-Type": "application/json" }
      })
  );

  const adapter = createAdapter("server-token-123");
  let result;
  try {
    result = await adapter.deliver(createIntent(), renderedPayload, createChannelConfig({}));
  } finally {
    stub.restore();
  }

  assert.deepEqual(result, {
    status: "failed",
    error: {
      reason: "postmark_error",
      httpStatus: 422,
      errorCode: 300,
      message: "Invalid email request"
    }
  });
  console.log("✓ Postmark 4xx -> failed/postmark_error carrying ErrorCode + Message");
}

async function testPostmark5xxWithoutErrorCodeFallsBackToHttpStatus(): Promise<void> {
  const stub = stubFetchOnce(
    () =>
      new Response(JSON.stringify({ Message: "Service unavailable" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      })
  );

  const adapter = createAdapter("server-token-123");
  let result;
  try {
    result = await adapter.deliver(createIntent(), renderedPayload, createChannelConfig({}));
  } finally {
    stub.restore();
  }

  assert.deepEqual(result, {
    status: "failed",
    error: {
      reason: "postmark_error",
      httpStatus: 500,
      errorCode: 500,
      message: "Service unavailable"
    }
  });
  console.log("✓ Postmark 5xx without ErrorCode -> errorCode falls back to httpStatus");
}

async function testNetworkOrAbortErrorMapsToEmailSendError(): Promise<void> {
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    throw new Error("The operation was aborted.");
  }) as typeof fetch;

  const adapter = createAdapter("server-token-123");
  let result;
  try {
    result = await adapter.deliver(createIntent(), renderedPayload, createChannelConfig({}));
  } finally {
    global.fetch = originalFetch;
  }

  assert.deepEqual(result, {
    status: "failed",
    error: { reason: "email_send_error", message: "The operation was aborted." }
  });
  console.log("✓ network/abort error -> failed/email_send_error carrying the thrown message");
}

async function run(): Promise<void> {
  await testRawSendExactRequestShapeAndDeliveredResult();
  await testTemplatedSendUsesWithTemplateUrlAndRawFactPayload();
  await testTemplatedSendAcceptsNumericStringTemplateId();
  await testFromAddressOverrideHonoredVerbatim();
  await testFromAddressFallsBackToNotificationsAtSendingDomain();
  await testMissingServerTokenFailsClosedWithNoFetchCall();
  await testMissingToAddressFailsWithoutFetchCall();
  await testPostmark4xxMapsToPostmarkErrorFailure();
  await testPostmark5xxWithoutErrorCodeFallsBackToHttpStatus();
  await testNetworkOrAbortErrorMapsToEmailSendError();
  console.log("\n✅ All email-channel.adapter tests passed");
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
