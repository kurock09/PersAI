/**
 * ADR-169 S2 — HandleMailboxOAuthCallbackService focused tests.
 * Covers: unknown/expired/already-consumed state are all rejected the same
 * way (no distinguishing signal for an attacker); a successful exchange
 * upserts the identity row and stores the secret under the workspace-scoped
 * `mailbox_oauth:${workspaceId}` providerKey — never the per-assistant
 * `persai.secretRefs.v1` envelope.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

process.env.PERSAI_PUBLIC_API_BASE_URL = "https://api.persai.test";
process.env.PERSAI_WEB_BASE_URL = "https://persai.test";

import { HandleMailboxOAuthCallbackService } from "../src/modules/workspace-management/application/handle-mailbox-oauth-callback.service";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";
import type { PlatformRuntimeProviderSecretStoreService } from "../src/modules/workspace-management/application/platform-runtime-provider-secret-store.service";
import type { MailboxOAuthTokenExchangeClientService } from "../src/modules/workspace-management/application/mailbox-oauth-token-exchange.client";
import type { AppendAssistantAuditEventService } from "../src/modules/workspace-management/application/append-assistant-audit-event.service";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";

type FakeStateRow = {
  stateHash: string;
  workspaceId: string;
  provider: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

function hashState(rawState: string): string {
  return createHash("sha256").update(rawState).digest("hex");
}

function createFakePrisma(stateRows: Map<string, FakeStateRow>) {
  const upsertCalls: Array<{ where: { workspaceId: string }; create: unknown; update: unknown }> =
    [];
  const prisma = {
    workspaceEmailOAuthState: {
      async findUnique({ where }: { where: { stateHash: string } }) {
        return stateRows.get(where.stateHash) ?? null;
      },
      async updateMany({
        where,
        data
      }: {
        where: { stateHash: string; consumedAt: null; expiresAt: { gt: Date } };
        data: { consumedAt: Date };
      }) {
        const row = stateRows.get(where.stateHash);
        if (
          row === undefined ||
          row.consumedAt !== null ||
          row.expiresAt.getTime() <= where.expiresAt.gt.getTime()
        ) {
          return { count: 0 };
        }
        row.consumedAt = data.consumedAt;
        return { count: 1 };
      }
    },
    workspaceEmailSenderIdentity: {
      async upsert({
        where,
        create,
        update
      }: {
        where: { workspaceId: string };
        create: unknown;
        update: unknown;
      }) {
        upsertCalls.push({ where, create, update });
        return { workspaceId: where.workspaceId, ...(create as Record<string, unknown>) };
      }
    }
  };
  return { prisma: prisma as unknown as WorkspaceManagementPrismaService, upsertCalls };
}

function createSecretStoreMock() {
  const upsertCalls: Array<{
    providerKey: string;
    rawKey: string;
    updatedByUserId: string | null;
  }> = [];
  const store = {
    async resolveSecretValueById(secretId: string) {
      return `resolved:${secretId}`;
    },
    async upsertProviderKey(providerKey: string, rawKey: string, updatedByUserId: string | null) {
      upsertCalls.push({ providerKey, rawKey, updatedByUserId });
    }
  };
  return { store: store as unknown as PlatformRuntimeProviderSecretStoreService, upsertCalls };
}

function createTokenExchangeClientMock() {
  const client = {
    async exchangeCode() {
      return {
        kind: "success" as const,
        httpStatus: 200,
        body: { access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 }
      };
    },
    async fetchUserInfo() {
      return {
        kind: "success" as const,
        httpStatus: 200,
        body: { email: "owner@customer.example" }
      };
    }
  };
  return client as unknown as MailboxOAuthTokenExchangeClientService;
}

function createAuditMock() {
  const calls: unknown[] = [];
  const service = {
    async execute(input: unknown) {
      calls.push(input);
    }
  };
  return { service: service as unknown as AppendAssistantAuditEventService, calls };
}

async function assertStateInvalid(
  service: HandleMailboxOAuthCallbackService,
  params: { code: string; state: string }
): Promise<void> {
  await assert.rejects(
    () => service.handle(params),
    (error: unknown) => {
      assert.ok(error instanceof ApiErrorHttpException);
      assert.equal(error.errorObject.code, "mailbox_oauth_state_invalid");
      assert.equal(error.getStatus(), 400);
      return true;
    }
  );
}

function createSmtpClientMock(): { verify: () => Promise<{ kind: "ready" }> } {
  return { verify: async () => ({ kind: "ready" }) };
}

async function testUnknownStateRejected(): Promise<void> {
  const { prisma } = createFakePrisma(new Map());
  const { store } = createSecretStoreMock();
  const { service: audit } = createAuditMock();
  const service = new HandleMailboxOAuthCallbackService(
    prisma,
    store,
    createTokenExchangeClientMock(),
    audit,
    createSmtpClientMock() as never
  );

  await assertStateInvalid(service, { code: "code-1", state: "never-issued-state" });
  console.log("✓ an unknown state is rejected");
}

async function testExpiredStateRejected(): Promise<void> {
  const rawState = "expired-state";
  const rows = new Map<string, FakeStateRow>();
  rows.set(hashState(rawState), {
    stateHash: hashState(rawState),
    workspaceId: "workspace-1",
    provider: "mailru",
    expiresAt: new Date(Date.now() - 60_000),
    consumedAt: null
  });
  const { prisma } = createFakePrisma(rows);
  const { store } = createSecretStoreMock();
  const { service: audit } = createAuditMock();
  const service = new HandleMailboxOAuthCallbackService(
    prisma,
    store,
    createTokenExchangeClientMock(),
    audit,
    createSmtpClientMock() as never
  );

  await assertStateInvalid(service, { code: "code-1", state: rawState });
  console.log("✓ an expired state is rejected");
}

async function testAlreadyConsumedStateRejected(): Promise<void> {
  const rawState = "used-state";
  const rows = new Map<string, FakeStateRow>();
  rows.set(hashState(rawState), {
    stateHash: hashState(rawState),
    workspaceId: "workspace-1",
    provider: "mailru",
    expiresAt: new Date(Date.now() + 600_000),
    consumedAt: new Date()
  });
  const { prisma } = createFakePrisma(rows);
  const { store } = createSecretStoreMock();
  const { service: audit } = createAuditMock();
  const service = new HandleMailboxOAuthCallbackService(
    prisma,
    store,
    createTokenExchangeClientMock(),
    audit,
    createSmtpClientMock() as never
  );

  await assertStateInvalid(service, { code: "code-1", state: rawState });
  console.log("✓ an already-consumed state is rejected (replay)");
}

async function testSuccessfulExchangeUpsertsIdentityAndStoresSecret(): Promise<void> {
  const rawState = "fresh-state";
  const rows = new Map<string, FakeStateRow>();
  rows.set(hashState(rawState), {
    stateHash: hashState(rawState),
    workspaceId: "workspace-9",
    provider: "mailru",
    expiresAt: new Date(Date.now() + 600_000),
    consumedAt: null
  });
  const { prisma, upsertCalls } = createFakePrisma(rows);
  const { store, upsertCalls: secretUpsertCalls } = createSecretStoreMock();
  const { service: audit, calls: auditCalls } = createAuditMock();
  const service = new HandleMailboxOAuthCallbackService(
    prisma,
    store,
    createTokenExchangeClientMock(),
    audit,
    createSmtpClientMock() as never
  );

  const { redirectUrl } = await service.handle({ code: "auth-code", state: rawState });

  assert.equal(secretUpsertCalls.length, 1);
  assert.equal(secretUpsertCalls[0]?.providerKey, "mailbox_oauth:workspace-9");
  const storedSecret = JSON.parse(secretUpsertCalls[0]?.rawKey ?? "{}") as {
    accessToken: string;
    refreshToken: string;
  };
  assert.equal(storedSecret.accessToken, "access-1");
  assert.equal(storedSecret.refreshToken, "refresh-1");

  assert.equal(upsertCalls.length, 1);
  const created = upsertCalls[0]?.create as Record<string, unknown>;
  assert.equal(created.workspaceId, "workspace-9");
  assert.equal(created.email, "owner@customer.example");
  assert.equal(created.provider, "mailru");
  assert.equal(created.mailboxStatus, "connected");

  assert.equal(auditCalls.length, 1);
  assert.ok(redirectUrl.includes("mailboxConnect=success"));
  console.log(
    "✓ a successful exchange upserts the identity and stores the secret under the workspace-scoped providerKey"
  );
}

async function testExchangeWithoutRefreshTokenStillConnects(): Promise<void> {
  const rawState = "no-refresh-state";
  const rows = new Map<string, FakeStateRow>();
  rows.set(hashState(rawState), {
    stateHash: hashState(rawState),
    workspaceId: "workspace-10",
    provider: "mailru",
    expiresAt: new Date(Date.now() + 600_000),
    consumedAt: null
  });
  const { prisma, upsertCalls } = createFakePrisma(rows);
  const { store, upsertCalls: secretUpsertCalls } = createSecretStoreMock();
  const { service: audit } = createAuditMock();
  const exchangeClient = {
    async exchangeCode() {
      return {
        kind: "success" as const,
        httpStatus: 200,
        body: { access_token: "access-2", expires_in: 3600 }
      };
    },
    async fetchUserInfo() {
      return {
        kind: "success" as const,
        httpStatus: 200,
        body: { email: "owner@customer.example" }
      };
    }
  } as unknown as MailboxOAuthTokenExchangeClientService;
  const service = new HandleMailboxOAuthCallbackService(
    prisma,
    store,
    exchangeClient,
    audit,
    createSmtpClientMock() as never
  );

  const { redirectUrl } = await service.handle({ code: "auth-code", state: rawState });

  const storedSecret = JSON.parse(secretUpsertCalls[0]?.rawKey ?? "{}") as {
    accessToken: string;
    refreshToken: string | null;
  };
  assert.equal(storedSecret.accessToken, "access-2");
  assert.equal(storedSecret.refreshToken, null);
  assert.equal((upsertCalls[0]?.create as Record<string, unknown>).mailboxStatus, "connected");
  assert.ok(redirectUrl.includes("mailboxConnect=success"));
  console.log("✓ a token response without refresh_token still connects the mailbox");
}

async function run(): Promise<void> {
  await testUnknownStateRejected();
  await testExpiredStateRejected();
  await testAlreadyConsumedStateRejected();
  await testSuccessfulExchangeUpsertsIdentityAndStoresSecret();
  await testExchangeWithoutRefreshTokenStillConnects();
  console.log("\n✅ All handle-mailbox-oauth-callback.service tests passed");
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
