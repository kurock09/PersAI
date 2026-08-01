/**
 * ADR-169 S3 — InternalRuntimeEmailSendService focused tests.
 * Exercises the real `MailboxTokenLifecycleService` +
 * `MailboxOAuthTokenRefreshClientService` + `MailboxSmtpSendClientService`
 * wiring, faking only the true edges: Prisma, the secret store, the OAuth
 * refresh HTTP call (`global.fetch`), and the nodemailer transport factory.
 * No network, no database.
 *
 * Covers: non-expired token sends without refreshing; expired token
 * refreshes exactly once then sends; a revoked refresh token flips
 * `mailboxStatus` to `token_invalid` and fails closed with zero SMTP calls;
 * no connected mailbox skips with zero SMTP calls; an SMTP network failure
 * maps to `failed`, never a silent success; a provider quota rejection maps
 * to an honest `skipped`, never a silent success.
 */
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { WorkspaceEmailMailboxStatus } from "@prisma/client";
import { InternalRuntimeEmailSendService } from "../src/modules/workspace-management/application/internal-runtime-email-send.service";
import { MailboxTokenLifecycleService } from "../src/modules/workspace-management/application/mailbox-token-lifecycle.service";
import { MailboxOAuthTokenRefreshClientService } from "../src/modules/workspace-management/application/mailbox-oauth-token-refresh.client";
import { MailboxSmtpSendClientService } from "../src/modules/workspace-management/application/mailbox-smtp-send.client";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";
import type { PlatformRuntimeProviderSecretStoreService } from "../src/modules/workspace-management/application/platform-runtime-provider-secret-store.service";
import type { AppendAssistantAuditEventService } from "../src/modules/workspace-management/application/append-assistant-audit-event.service";
import type { NodemailerMailboxSmtpTransportFactory } from "../src/modules/workspace-management/application/mailbox-smtp-send.client";

const WORKSPACE_ID = "workspace-1";

type IdentityRow = {
  workspaceId: string;
  email: string;
  displayName: string | null;
  provider: "mailru" | "yandex" | null;
  mailboxStatus: WorkspaceEmailMailboxStatus | null;
  tokenExpiresAt: Date | null;
};

function createFakePrisma(initialRow: IdentityRow | null) {
  let row = initialRow;
  const updateCalls: Array<Record<string, unknown>> = [];
  const prisma = {
    workspaceEmailSenderIdentity: {
      async findUnique() {
        return row;
      },
      async update(args: { data: Record<string, unknown> }) {
        if (row === null) {
          throw new Error("no row to update");
        }
        updateCalls.push(args.data);
        row = { ...row, ...args.data } as IdentityRow;
        return row;
      }
    }
  } as unknown as WorkspaceManagementPrismaService;
  return { prisma, updateCalls, getRow: () => row };
}

function createFakeSecretStore(
  initialBundle: { accessToken: string; refreshToken: string | null } | null
) {
  let bundle = initialBundle;
  const upsertCalls: Array<{ providerKey: string; rawKey: string }> = [];
  const secretStore = {
    async resolveSecretValueByProviderKey() {
      return bundle === null ? null : JSON.stringify(bundle);
    },
    async resolveSecretValueById() {
      return "provider-credential";
    },
    async upsertProviderKey(providerKey: string, rawKey: string) {
      upsertCalls.push({ providerKey, rawKey });
      bundle = JSON.parse(rawKey) as { accessToken: string; refreshToken: string | null };
    }
  } as unknown as PlatformRuntimeProviderSecretStoreService;
  return { secretStore, upsertCalls, getBundle: () => bundle };
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

type FakeSendMailResult = { messageId?: string };

function createFakeTransportFactory(sendMail: (message: unknown) => Promise<FakeSendMailResult>) {
  const createTransportCalls: Array<Record<string, unknown>> = [];
  let closeCalls = 0;
  const factory = {
    createTransport(options: Record<string, unknown>) {
      createTransportCalls.push(options);
      return {
        sendMail,
        close() {
          closeCalls += 1;
        }
      };
    }
  } as unknown as NodemailerMailboxSmtpTransportFactory;
  return { factory, createTransportCalls, getCloseCalls: () => closeCalls };
}

function buildService(params: {
  row: IdentityRow | null;
  bundle: { accessToken: string; refreshToken: string | null } | null;
  sendMail: (message: unknown) => Promise<FakeSendMailResult>;
}) {
  const prismaFake = createFakePrisma(params.row);
  const secretStoreFake = createFakeSecretStore(params.bundle);
  const auditMock = createAuditMock();
  const tokenRefreshClient = new MailboxOAuthTokenRefreshClientService();
  const tokenLifecycle = new MailboxTokenLifecycleService(
    prismaFake.prisma,
    secretStoreFake.secretStore,
    tokenRefreshClient
  );
  const transportFake = createFakeTransportFactory(params.sendMail);
  const smtpClient = new MailboxSmtpSendClientService(transportFake.factory);
  const service = new InternalRuntimeEmailSendService(
    prismaFake.prisma,
    auditMock.audit,
    tokenLifecycle,
    smtpClient
  );
  return { service, prismaFake, secretStoreFake, auditMock, transportFake };
}

const baseInput = {
  workspaceId: WORKSPACE_ID,
  assistantId: "assistant-1",
  chatId: "chat-1",
  requestId: "req-1",
  to: "recipient@example.com",
  subject: "Hello",
  body: "Plain text body"
};

function connectedRow(overrides: Partial<IdentityRow> = {}): IdentityRow {
  return {
    workspaceId: WORKSPACE_ID,
    email: "sales@customer.ru",
    displayName: "Customer Sales",
    provider: "mailru",
    mailboxStatus: WorkspaceEmailMailboxStatus.connected,
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides
  };
}

async function withFetch<T>(handler: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = global.fetch;
  global.fetch = handler;
  try {
    return await run();
  } finally {
    global.fetch = original;
  }
}

async function testNonExpiredTokenSendsWithoutRefreshing(): Promise<void> {
  let fetchCalls = 0;
  const { service, transportFake, secretStoreFake } = buildService({
    row: connectedRow(),
    bundle: { accessToken: "AT1", refreshToken: "RT1" },
    sendMail: async () => ({ messageId: "smtp-msg-1" })
  });

  const result = await withFetch(
    (async () => {
      fetchCalls += 1;
      throw new Error("must not refresh when the token is not expiring soon");
    }) as typeof fetch,
    () => service.execute(baseInput)
  );

  assert.deepEqual(result, { status: "sent", messageId: "smtp-msg-1" });
  assert.equal(fetchCalls, 0, "no OAuth refresh call for a non-expired token");
  assert.equal(transportFake.createTransportCalls.length, 1);
  assert.equal(transportFake.createTransportCalls[0]?.["accessToken"], "AT1");
  assert.equal(
    secretStoreFake.upsertCalls.length,
    0,
    "no token bundle rewrite when nothing refreshed"
  );
  console.log("✓ non-expired token sends without refreshing");
}

async function testExpiredTokenRefreshesOnceThenSends(): Promise<void> {
  let fetchCalls = 0;
  const { service, transportFake, secretStoreFake, prismaFake } = buildService({
    row: connectedRow({ tokenExpiresAt: new Date(Date.now() - 1000) }),
    bundle: { accessToken: "AT-OLD", refreshToken: "RT-OLD" },
    sendMail: async () => ({ messageId: "smtp-msg-2" })
  });

  const result = await withFetch(
    (async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({ access_token: "AT-NEW", refresh_token: "RT-NEW", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch,
    () => service.execute(baseInput)
  );

  assert.deepEqual(result, { status: "sent", messageId: "smtp-msg-2" });
  assert.equal(fetchCalls, 1, "exactly one refresh call for an expired token");
  assert.equal(transportFake.createTransportCalls[0]?.["accessToken"], "AT-NEW");
  assert.deepEqual(secretStoreFake.getBundle(), { accessToken: "AT-NEW", refreshToken: "RT-NEW" });
  assert.ok(prismaFake.getRow()?.tokenExpiresAt instanceof Date);
  console.log("✓ expired token refreshes exactly once, then sends with the new token");
}

async function testRevokedRefreshTokenFlipsInvalidAndSkipsClosed(): Promise<void> {
  let fetchCalls = 0;
  const { service, transportFake, prismaFake } = buildService({
    row: connectedRow({ tokenExpiresAt: new Date(Date.now() - 1000) }),
    bundle: { accessToken: "AT-OLD", refreshToken: "RT-REVOKED" },
    sendMail: async () => {
      throw new Error("must not reach SMTP once the refresh grant is revoked");
    }
  });

  const result = await withFetch(
    (async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch,
    () => service.execute(baseInput)
  );

  assert.deepEqual(result, { status: "skipped", reason: "mailbox_token_invalid" });
  assert.equal(fetchCalls, 1, "no retry loop on a revoked grant");
  assert.equal(transportFake.createTransportCalls.length, 0, "no SMTP call on a revoked grant");
  assert.equal(prismaFake.getRow()?.mailboxStatus, WorkspaceEmailMailboxStatus.token_invalid);
  console.log("✓ revoked refresh token flips mailboxStatus to token_invalid and fails closed");
}

async function testNoConnectedMailboxSkipsWithNoSmtpCall(): Promise<void> {
  const { service, transportFake, auditMock } = buildService({
    row: null,
    bundle: null,
    sendMail: async () => {
      throw new Error("must not reach SMTP with no connected mailbox");
    }
  });

  const result = await service.execute(baseInput);

  assert.deepEqual(result, { status: "skipped", reason: "mailbox_not_connected" });
  assert.equal(transportFake.createTransportCalls.length, 0);
  assert.equal(auditMock.events[0]?.eventCode, "assistant.email.skipped");
  console.log("✓ no connected mailbox -> skipped, zero SMTP calls");
}

async function testSmtpNetworkFailureMapsToFailedNotSuccess(): Promise<void> {
  const { service } = buildService({
    row: connectedRow(),
    bundle: { accessToken: "AT1", refreshToken: "RT1" },
    sendMail: async () => {
      const err = new Error("connect ETIMEDOUT") as Error & { code: string };
      err.code = "ETIMEDOUT";
      throw err;
    }
  });

  const result = await service.execute(baseInput);

  assert.equal(result.status, "failed");
  assert.equal((result as { reason: string }).reason, "email_send_error");
  console.log("✓ SMTP network failure maps to failed, not a silent success");
}

async function testProviderQuotaRejectionIsReportedHonestly(): Promise<void> {
  const { service } = buildService({
    row: connectedRow(),
    bundle: { accessToken: "AT1", refreshToken: "RT1" },
    sendMail: async () => {
      const err = new Error("452 4.5.3 Too many messages per day") as Error & {
        responseCode: number;
      };
      err.responseCode = 452;
      throw err;
    }
  });

  const result = await service.execute(baseInput);

  assert.equal(result.status, "skipped");
  assert.equal((result as { reason: string }).reason, "provider_daily_limit_reached");
  assert.notEqual(result.status, "sent");
  console.log("✓ provider quota rejection reported honestly as skipped, never a silent success");
}

const REJECTED_BODY_KEYS = ["cc", "bcc", "attachments", "html", "htmlBody"] as const;

async function testParseInputRejectsUnsupportedBodyKeys(): Promise<void> {
  const { service, transportFake } = buildService({
    row: connectedRow(),
    bundle: { accessToken: "AT1", refreshToken: "RT1" },
    sendMail: async () => {
      throw new Error("must not be called for a rejected payload");
    }
  });

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

  assert.equal(transportFake.createTransportCalls.length, 0);
  console.log("✓ parseInput rejects cc/bcc/attachments/html/htmlBody, zero SMTP calls");
}

async function run(): Promise<void> {
  await testNonExpiredTokenSendsWithoutRefreshing();
  await testExpiredTokenRefreshesOnceThenSends();
  await testRevokedRefreshTokenFlipsInvalidAndSkipsClosed();
  await testNoConnectedMailboxSkipsWithNoSmtpCall();
  await testSmtpNetworkFailureMapsToFailedNotSuccess();
  await testProviderQuotaRejectionIsReportedHonestly();
  await testParseInputRejectsUnsupportedBodyKeys();
  console.log("\n✅ All internal-runtime-email-send.service tests passed");
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
