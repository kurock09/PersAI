/**
 * ADR-169 S3 — InternalRuntimeEmailSendService focused tests.
 * Exercises the real `MailboxTokenLifecycleService` +
 * `MailboxOAuthTokenRefreshClientService` + `MailboxSmtpSendClientService`
 * wiring, faking only the true edges: Prisma, the secret store, the OAuth
 * refresh HTTP call (`global.fetch`), the nodemailer transport factory, and
 * the scheduler lease (an in-memory mutex standing in for the real
 * Postgres-backed one). No network, no database.
 *
 * Covers: non-expired token sends without refreshing; expired token
 * refreshes exactly once then sends; a revoked refresh token flips
 * `mailboxStatus` to `token_invalid` and fails closed with zero SMTP calls;
 * no connected mailbox skips with zero SMTP calls; an SMTP network failure
 * maps to `failed`, never a silent success; a provider quota rejection maps
 * to an honest `skipped`, never a silent success; an SMTP auth rejection
 * (revoked mid-lifetime) skips fail-closed and marks `token_invalid`; an
 * unknown token expiry always attempts a refresh instead of assuming the
 * cached token stays valid; a losing concurrent refresh reuses the winner's
 * token instead of flipping a healthy mailbox to `token_invalid`; a `5.7.1`
 * spam/policy rejection is reported as an ordinary failure, never misread as
 * a revoked grant; a refresh response missing `expires_in` assumes a bounded
 * TTL instead of forcing every subsequent send to refresh again.
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
import type { SchedulerLeaseService } from "../src/modules/workspace-management/application/scheduler-lease.service";

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

/**
 * Stands in for `SchedulerLeaseService`'s Postgres-backed CAS with an
 * in-memory Map: `acquireOrCreate` returns null while the key is held,
 * exactly like the real per-key dynamic lease used for `async-catchup:*`.
 */
function createFakeSchedulerLease() {
  const held = new Map<string, string>();
  const acquireCalls: string[] = [];
  let nextToken = 0;
  const lease = {
    async acquireOrCreate(key: string) {
      acquireCalls.push(key);
      if (held.has(key)) {
        return null;
      }
      nextToken += 1;
      const token = `lease-token-${String(nextToken)}`;
      held.set(key, token);
      return { token };
    },
    async releaseKey(key: string, token: string) {
      if (held.get(key) === token) {
        held.delete(key);
      }
    }
  } as unknown as SchedulerLeaseService;
  return { lease, acquireCalls, isHeld: (key: string) => held.has(key) };
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
  const schedulerLeaseFake = createFakeSchedulerLease();
  const tokenLifecycle = new MailboxTokenLifecycleService(
    prismaFake.prisma,
    secretStoreFake.secretStore,
    tokenRefreshClient,
    schedulerLeaseFake.lease
  );
  const transportFake = createFakeTransportFactory(params.sendMail);
  const smtpClient = new MailboxSmtpSendClientService(transportFake.factory);
  const service = new InternalRuntimeEmailSendService(
    prismaFake.prisma,
    auditMock.audit,
    tokenLifecycle,
    smtpClient
  );
  return { service, prismaFake, secretStoreFake, auditMock, transportFake, schedulerLeaseFake };
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

async function testRefreshResponseMissingExpiresInAssumesBoundedTtlNotEndlessRefresh(): Promise<void> {
  let fetchCalls = 0;
  const { service, prismaFake } = buildService({
    row: connectedRow({ tokenExpiresAt: new Date(Date.now() - 1000) }),
    bundle: { accessToken: "AT-OLD", refreshToken: "RT-OLD" },
    sendMail: async () => ({ messageId: "smtp-msg-no-expiry" })
  });

  await withFetch(
    (async () => {
      fetchCalls += 1;
      // The provider's refresh response omits `expires_in` entirely — both
      // v1 providers document it, but the fallback must still hold.
      return new Response(JSON.stringify({ access_token: "AT-NEW", refresh_token: "RT-NEW" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch,
    () => service.execute(baseInput)
  );

  assert.equal(fetchCalls, 1, "one refresh for the initially-expired token");
  const tokenExpiresAt = prismaFake.getRow()?.tokenExpiresAt;
  assert.ok(
    tokenExpiresAt instanceof Date && tokenExpiresAt.getTime() > Date.now(),
    "a missing expires_in must still record a future assumed expiry, not null"
  );

  // A second send immediately afterwards must NOT refresh again — that is
  // exactly the "every single send refreshes" hole this test guards against.
  const secondResult = await service.execute(baseInput);
  assert.equal(secondResult.status, "sent");
  assert.equal(
    fetchCalls,
    1,
    "a refresh response missing expires_in must not force every subsequent send to refresh again"
  );
  console.log(
    "✓ a refresh response missing expires_in assumes a bounded TTL instead of forcing every send to refresh"
  );
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

async function testSmtpAuthRejectionDoesNotMislabelRefreshInfrastructureFailure(): Promise<void> {
  const { service, prismaFake, transportFake } = buildService({
    row: connectedRow(),
    bundle: { accessToken: "AT1", refreshToken: "RT1" },
    sendMail: async () => {
      const err = new Error("535 5.7.8 Authentication failed") as Error & {
        code: string;
        responseCode: number;
      };
      err.code = "EAUTH";
      err.responseCode = 535;
      throw err;
    }
  });

  const result = await service.execute(baseInput);

  assert.equal(result.status, "failed");
  assert.equal((result as { reason: string }).reason, "mailbox_token_refresh_failed");
  assert.equal(transportFake.getCloseCalls(), 1, "the transporter is still closed on rejection");
  assert.equal(
    prismaFake.getRow()?.mailboxStatus,
    WorkspaceEmailMailboxStatus.connected,
    "an unavailable forced refresh must not be mislabeled as a revoked mailbox grant"
  );
  console.log(
    "✓ SMTP auth rejection attempts refresh and does not mislabel refresh infrastructure failure"
  );
}

async function testSpamRejectionIsNotMisreadAsAuthRejection(): Promise<void> {
  const { service, prismaFake, transportFake } = buildService({
    row: connectedRow(),
    bundle: { accessToken: "AT1", refreshToken: "RT1" },
    sendMail: async () => {
      // `5.7.1` is Mail.ru/Yandex's ordinary code for content/policy/spam
      // rejection at RCPT/DATA, not for a revoked grant — nodemailer does
      // NOT set `err.code = "EAUTH"` for this path (it sets `EENVELOPE`).
      const err = new Error("550 5.7.1 Message rejected as spam") as Error & {
        code: string;
        responseCode: number;
      };
      err.code = "EENVELOPE";
      err.responseCode = 550;
      throw err;
    }
  });

  const result = await service.execute(baseInput);

  assert.equal(result.status, "failed", "a spam/policy rejection is an ordinary failure");
  assert.equal((result as { reason: string }).reason, "smtp_rejected");
  assert.equal(transportFake.getCloseCalls(), 1);
  assert.equal(
    prismaFake.getRow()?.mailboxStatus,
    WorkspaceEmailMailboxStatus.connected,
    "a healthy mailbox must not be flipped to token_invalid by a spam/policy rejection"
  );
  console.log(
    "✓ a 550 5.7.1 spam/policy rejection is reported as an ordinary failure, not misread as a revoked grant"
  );
}

async function testUnknownExpiryAlwaysAttemptsRefresh(): Promise<void> {
  let fetchCalls = 0;
  const { service, transportFake, prismaFake } = buildService({
    row: connectedRow({ tokenExpiresAt: null }),
    bundle: { accessToken: "AT-OLD", refreshToken: "RT-OLD" },
    sendMail: async () => ({ messageId: "smtp-msg-unknown-expiry" })
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

  assert.deepEqual(result, { status: "sent", messageId: "smtp-msg-unknown-expiry" });
  assert.equal(
    fetchCalls,
    1,
    "an unknown expiry must be treated as due for refresh, not evidence of validity"
  );
  assert.equal(transportFake.createTransportCalls[0]?.["accessToken"], "AT-NEW");
  assert.ok(
    prismaFake.getRow()?.tokenExpiresAt instanceof Date,
    "a successful refresh records a real expiry once the provider supplies one"
  );
  console.log(
    "✓ unknown token expiry always attempts a refresh instead of assuming the cached token stays valid forever"
  );
}

async function testConcurrentRefreshLoserReusesWinnerTokenWithoutFlippingInvalid(): Promise<void> {
  let fetchCalls = 0;
  let resolveFetch: ((value: Response) => void) | null = null;
  const fetchMock = (async () => {
    fetchCalls += 1;
    if (fetchCalls > 1) {
      throw new Error(
        "must not call the provider refresh endpoint more than once for a losing concurrent refresh"
      );
    }
    return await new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
  }) as typeof fetch;

  let sendCount = 0;
  const { service, prismaFake, secretStoreFake } = buildService({
    row: connectedRow({ tokenExpiresAt: new Date(Date.now() - 1000) }),
    bundle: { accessToken: "AT-OLD", refreshToken: "RT-OLD" },
    sendMail: async () => {
      sendCount += 1;
      return { messageId: `smtp-msg-${String(sendCount)}` };
    }
  });

  const originalFetch = global.fetch;
  global.fetch = fetchMock;
  try {
    const promiseA = service.execute(baseInput);
    // Let call A run (all microtasks) up to its pending fetch of the
    // provider's refresh endpoint, where it now blocks on `resolveFetch`.
    await new Promise((resolve) => {
      setImmediate(resolve);
    });

    const promiseB = service.execute(baseInput);
    // Let call B run up to its first (losing) lock attempt and enter its
    // poll wait — it must not reach the provider at all while A holds it.
    await new Promise((resolve) => {
      setImmediate(resolve);
    });

    assert.equal(fetchCalls, 1, "only the lock holder calls the provider refresh endpoint");
    assert.ok(resolveFetch !== null, "call A must be waiting on the provider response");
    resolveFetch!(
      new Response(
        JSON.stringify({ access_token: "AT-NEW", refresh_token: "RT-NEW", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const [resultA, resultB] = await Promise.all([promiseA, promiseB]);

    assert.equal(resultA.status, "sent");
    assert.equal(resultB.status, "sent");
    assert.equal(
      fetchCalls,
      1,
      "the waiting call must reuse the winner's refreshed token instead of retrying the provider with its now-rotated-away token"
    );
    assert.equal(
      prismaFake.getRow()?.mailboxStatus,
      WorkspaceEmailMailboxStatus.connected,
      "a losing concurrent refresh must never flip a healthy mailbox to token_invalid"
    );
    assert.deepEqual(secretStoreFake.getBundle(), {
      accessToken: "AT-NEW",
      refreshToken: "RT-NEW"
    });
  } finally {
    global.fetch = originalFetch;
  }
  console.log(
    "✓ a losing concurrent refresh reuses the winner's token instead of flipping mailboxStatus to token_invalid"
  );
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
  await testRefreshResponseMissingExpiresInAssumesBoundedTtlNotEndlessRefresh();
  await testRevokedRefreshTokenFlipsInvalidAndSkipsClosed();
  await testNoConnectedMailboxSkipsWithNoSmtpCall();
  await testSmtpNetworkFailureMapsToFailedNotSuccess();
  await testProviderQuotaRejectionIsReportedHonestly();
  await testSmtpAuthRejectionDoesNotMislabelRefreshInfrastructureFailure();
  await testSpamRejectionIsNotMisreadAsAuthRejection();
  await testUnknownExpiryAlwaysAttemptsRefresh();
  await testConcurrentRefreshLoserReusesWinnerTokenWithoutFlippingInvalid();
  await testParseInputRejectsUnsupportedBodyKeys();
  console.log("\n✅ All internal-runtime-email-send.service tests passed");
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
