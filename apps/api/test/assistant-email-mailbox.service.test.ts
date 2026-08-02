/**
 * ADR-169 S2 — AssistantEmailMailboxService focused tests.
 * Covers: connect state is persisted only as a SHA-256 digest (never the raw
 * state that goes into the authorization URL); missing provider credentials
 * fail connect closed; disconnect clears the mailbox columns and best-effort
 * deletes the stored OAuth secret; each connect attempt opportunistically
 * clears this workspace's own consumed/expired OAuth states first.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

process.env.PERSAI_PUBLIC_API_BASE_URL = "https://api.persai.test";

import { AssistantEmailMailboxService } from "../src/modules/workspace-management/application/assistant-email-mailbox.service";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";
import type { PlatformRuntimeProviderSecretStoreService } from "../src/modules/workspace-management/application/platform-runtime-provider-secret-store.service";
import type { AppendAssistantAuditEventService } from "../src/modules/workspace-management/application/append-assistant-audit-event.service";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";

type FakeIdentityRow = {
  workspaceId: string;
  email: string;
  displayName: string | null;
  provider: string | null;
  mailboxStatus: string | null;
  tokenExpiresAt: Date | null;
  connectedAt: Date | null;
  lastErrorReason: string | null;
  updatedAt: Date;
};

type CreatedStateCall = {
  workspaceId: string;
  provider: string;
  stateHash: string;
  expiresAt: Date;
};

function createFakePrisma(identityRows: Map<string, FakeIdentityRow>) {
  const createdStates: CreatedStateCall[] = [];
  const deleteManyCalls: Array<Record<string, unknown>> = [];
  const identityUpdates: Array<{ workspaceId: string; data: Partial<FakeIdentityRow> }> = [];
  const prisma = {
    workspaceEmailOAuthState: {
      async create({ data }: { data: CreatedStateCall }) {
        createdStates.push(data);
        return { id: "state-1", consumedAt: null, createdAt: new Date(), ...data };
      },
      async deleteMany(args: { where: Record<string, unknown> }) {
        deleteManyCalls.push(args.where);
        return { count: 0 };
      }
    },
    workspaceEmailSenderIdentity: {
      async findUnique({ where }: { where: { workspaceId: string } }) {
        return identityRows.get(where.workspaceId) ?? null;
      },
      async update({
        where,
        data
      }: {
        where: { workspaceId: string };
        data: Partial<FakeIdentityRow>;
      }) {
        identityUpdates.push({ workspaceId: where.workspaceId, data });
        const existing = identityRows.get(where.workspaceId);
        if (existing === undefined) {
          throw new Error("Row not found for update.");
        }
        const updated = { ...existing, ...data, updatedAt: new Date() };
        identityRows.set(where.workspaceId, updated);
        return updated;
      }
    }
  };
  return {
    prisma: prisma as unknown as WorkspaceManagementPrismaService,
    createdStates,
    deleteManyCalls,
    identityUpdates
  };
}

function createSecretStoreMock(params: {
  clientIdByCredentialId?: Record<string, string>;
  failResolve?: boolean;
}) {
  const deleteCalls: string[] = [];
  const store = {
    async resolveSecretValueById(secretId: string) {
      if (params.failResolve === true) {
        throw new Error(`PersAI-managed runtime secret "${secretId}" is not configured.`);
      }
      const value = params.clientIdByCredentialId?.[secretId];
      if (value === undefined) {
        throw new Error(`PersAI-managed runtime secret "${secretId}" is not configured.`);
      }
      return value;
    },
    async deleteProviderKey(providerKey: string) {
      deleteCalls.push(providerKey);
    }
  };
  return { store: store as unknown as PlatformRuntimeProviderSecretStoreService, deleteCalls };
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

async function testStateIsStoredHashedAndNeverRaw(): Promise<void> {
  const { prisma, createdStates, deleteManyCalls } = createFakePrisma(new Map());
  const { store } = createSecretStoreMock({
    clientIdByCredentialId: {
      "mailbox-oauth/mailru/client-id": "mailru-client-id",
      "mailbox-oauth/mailru/client-secret": "mailru-client-secret"
    }
  });
  const { service: audit } = createAuditMock();
  const service = new AssistantEmailMailboxService(prisma, store, audit);

  const { authorizationUrl } = await service.initiateConnect("workspace-1", { provider: "mailru" });

  const url = new URL(authorizationUrl);
  const rawState = url.searchParams.get("state");
  assert.ok(
    typeof rawState === "string" && rawState.length > 0,
    "authorization URL carries the raw state"
  );

  assert.equal(createdStates.length, 1);
  const stored = createdStates[0];
  assert.equal(stored?.workspaceId, "workspace-1");
  assert.equal(stored?.provider, "mailru");
  assert.notEqual(stored?.stateHash, rawState, "the raw state must never be persisted");
  const expectedHash = createHash("sha256")
    .update(rawState ?? "")
    .digest("hex");
  assert.equal(
    stored?.stateHash,
    expectedHash,
    "only the SHA-256 digest of the state is persisted"
  );
  assert.equal(
    deleteManyCalls.length,
    1,
    "connect opportunistically clears this workspace's old OAuth states before creating a new one"
  );
  assert.equal(deleteManyCalls[0]?.["workspaceId"], "workspace-1");
  console.log("✓ connect state is stored only as its SHA-256 digest, never the raw value");
}

async function testConnectOpportunisticallyCleansConsumedAndExpiredStates(): Promise<void> {
  const { prisma, deleteManyCalls } = createFakePrisma(new Map());
  const { store } = createSecretStoreMock({
    clientIdByCredentialId: {
      "mailbox-oauth/mailru/client-id": "mailru-client-id",
      "mailbox-oauth/mailru/client-secret": "mailru-client-secret"
    }
  });
  const { service: audit } = createAuditMock();
  const service = new AssistantEmailMailboxService(prisma, store, audit);

  await service.initiateConnect("workspace-9", { provider: "mailru" });

  assert.equal(deleteManyCalls.length, 1);
  const where = deleteManyCalls[0] as {
    workspaceId: string;
    OR: Array<Record<string, unknown>>;
  };
  assert.equal(where.workspaceId, "workspace-9");
  assert.deepEqual(where.OR[0], { consumedAt: { not: null } });
  assert.ok(
    "expiresAt" in (where.OR[1] ?? {}),
    "the cleanup also drops expired-but-unconsumed states"
  );
  console.log(
    "✓ each connect attempt opportunistically deletes this workspace's consumed/expired OAuth states, no scheduler"
  );
}

async function testYandexConnectRequestsMailboxAndIdentityScopes(): Promise<void> {
  const { prisma } = createFakePrisma(new Map());
  const { store } = createSecretStoreMock({
    clientIdByCredentialId: {
      "mailbox-oauth/yandex/client-id": "yandex-client-id",
      "mailbox-oauth/yandex/client-secret": "yandex-client-secret"
    }
  });
  const { service: audit } = createAuditMock();
  const service = new AssistantEmailMailboxService(prisma, store, audit);

  const { authorizationUrl } = await service.initiateConnect("workspace-yandex", {
    provider: "yandex"
  });

  assert.deepEqual(
    new URL(authorizationUrl).searchParams.get("scope")?.split(" ").sort(),
    ["login:email", "mail:smtp"],
    "Yandex scopes must use the vendor-required space delimiter for SMTP and default_email"
  );
  console.log("✓ Yandex connect requests SMTP and email-identity scopes");
}

async function testMissingProviderCredentialsFailClosed(): Promise<void> {
  const { prisma } = createFakePrisma(new Map());
  const { store } = createSecretStoreMock({ failResolve: true });
  const { service: audit } = createAuditMock();
  const service = new AssistantEmailMailboxService(prisma, store, audit);

  await assert.rejects(
    () => service.initiateConnect("workspace-2", { provider: "yandex" }),
    (error: unknown) => {
      assert.ok(error instanceof ApiErrorHttpException);
      assert.equal(error.errorObject.code, "mailbox_oauth_credentials_unavailable");
      assert.equal(error.errorObject.category, "infra");
      assert.equal(error.getStatus(), 503);
      return true;
    }
  );
  console.log("✓ connect fails closed with a clear error when provider credentials are missing");
}

async function testDisconnectClearsColumnsAndDeletesSecret(): Promise<void> {
  const rows = new Map<string, FakeIdentityRow>();
  rows.set("workspace-3", {
    workspaceId: "workspace-3",
    email: "owner@customer.example",
    displayName: null,
    provider: "yandex",
    mailboxStatus: "connected",
    tokenExpiresAt: new Date(Date.now() + 3_600_000),
    connectedAt: new Date(),
    lastErrorReason: null,
    updatedAt: new Date()
  });
  const { prisma, identityUpdates } = createFakePrisma(rows);
  const { store, deleteCalls } = createSecretStoreMock({});
  const { service: audit, calls: auditCalls } = createAuditMock();
  const service = new AssistantEmailMailboxService(prisma, store, audit);

  const { removed } = await service.disconnect("workspace-3", "user-1");

  assert.equal(removed, true);
  assert.deepEqual(deleteCalls, ["mailbox_oauth:workspace-3"]);
  assert.equal(identityUpdates.length, 1);
  assert.deepEqual(identityUpdates[0]?.data, {
    provider: null,
    mailboxStatus: null,
    tokenExpiresAt: null,
    connectedAt: null
  });
  assert.equal(auditCalls.length, 1);
  console.log("✓ disconnect clears the mailbox columns and deletes the stored OAuth secret");
}

async function run(): Promise<void> {
  await testStateIsStoredHashedAndNeverRaw();
  await testMissingProviderCredentialsFailClosed();
  await testDisconnectClearsColumnsAndDeletesSecret();
  await testConnectOpportunisticallyCleansConsumedAndExpiredStates();
  await testYandexConnectRequestsMailboxAndIdentityScopes();
  console.log("\n✅ All assistant-email-mailbox.service tests passed");
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
