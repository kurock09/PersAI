/**
 * ADR-168 S1 — AssistantEmailSenderIdentityService focused tests.
 * Covers: signature create -> pending row; recheck flips pending->verified;
 * missing Account token surfaces postmark_account_token_unavailable without
 * stranding the row silently; replace deletes the prior signature first.
 */
import assert from "node:assert/strict";
import { AssistantEmailSenderIdentityService } from "../src/modules/workspace-management/application/assistant-email-sender-identity.service";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";
import type { PlatformRuntimeProviderSecretStoreService } from "../src/modules/workspace-management/application/platform-runtime-provider-secret-store.service";
import type { PostmarkAccountSendersClientService } from "../src/modules/workspace-management/application/postmark-account-senders.client";

type FakeRow = {
  id: string;
  workspaceId: string;
  email: string;
  displayName: string | null;
  status: "pending" | "verified" | "failed";
  postmarkSignatureId: string | null;
  lastErrorReason: string | null;
  requestedAt: Date;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function createFakePrisma() {
  const rows = new Map<string, FakeRow>();
  let nextId = 1;
  const prisma = {
    workspaceEmailSenderIdentity: {
      async findUnique({ where }: { where: { workspaceId: string } }) {
        return rows.get(where.workspaceId) ?? null;
      },
      async update({ where, data }: { where: { workspaceId: string }; data: Partial<FakeRow> }) {
        const existing = rows.get(where.workspaceId);
        if (existing === undefined) {
          throw new Error("Row not found for update.");
        }
        const updated = { ...existing, ...data, updatedAt: new Date() };
        rows.set(where.workspaceId, updated);
        return updated;
      },
      async upsert({
        where,
        create,
        update
      }: {
        where: { workspaceId: string };
        create: Omit<FakeRow, "id" | "createdAt" | "updatedAt">;
        update: Partial<FakeRow>;
      }) {
        const existing = rows.get(where.workspaceId);
        const row: FakeRow = existing
          ? { ...existing, ...update, updatedAt: new Date() }
          : {
              id: `row-${String(nextId++)}`,
              createdAt: new Date(),
              updatedAt: new Date(),
              ...create
            };
        rows.set(where.workspaceId, row);
        return row;
      },
      async delete({ where }: { where: { workspaceId: string } }) {
        rows.delete(where.workspaceId);
      }
    }
  };
  return { prisma: prisma as unknown as WorkspaceManagementPrismaService, rows };
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

type PostmarkCall = { method: string; args: unknown[] };

function createPostmarkClientMock(overrides: {
  createSignature?: (...args: unknown[]) => unknown;
  getSignature?: (...args: unknown[]) => unknown;
  resendConfirmation?: (...args: unknown[]) => unknown;
  deleteSignature?: (...args: unknown[]) => unknown;
}) {
  const calls: PostmarkCall[] = [];
  const client = {
    async createSignature(...args: unknown[]) {
      calls.push({ method: "createSignature", args });
      return (
        overrides.createSignature?.(...args) ?? {
          ok: true,
          data: { id: 111, emailAddress: "x@example.com", name: null, confirmed: false }
        }
      );
    },
    async getSignature(...args: unknown[]) {
      calls.push({ method: "getSignature", args });
      return (
        overrides.getSignature?.(...args) ?? {
          ok: true,
          data: { id: 111, emailAddress: "x@example.com", name: null, confirmed: false }
        }
      );
    },
    async resendConfirmation(...args: unknown[]) {
      calls.push({ method: "resendConfirmation", args });
      return (
        overrides.resendConfirmation?.(...args) ?? {
          ok: true,
          data: { id: 111, emailAddress: "x@example.com", name: null, confirmed: false }
        }
      );
    },
    async deleteSignature(...args: unknown[]) {
      calls.push({ method: "deleteSignature", args });
      return overrides.deleteSignature?.(...args) ?? { ok: true, data: { deleted: true } };
    }
  };
  return { client: client as unknown as PostmarkAccountSendersClientService, calls };
}

async function testSignatureCreateMapsToPendingRow(): Promise<void> {
  const { prisma } = createFakePrisma();
  const { client } = createPostmarkClientMock({
    createSignature: () => ({
      ok: true,
      data: {
        id: 42,
        emailAddress: "sales@customer.com",
        name: "PersAI Assistant",
        confirmed: false
      }
    })
  });
  const service = new AssistantEmailSenderIdentityService(
    prisma,
    createSecretStoreMock("acct-token"),
    client
  );

  const view = await service.requestIdentity("workspace-1", {
    email: "sales@customer.com",
    displayName: null
  });

  assert.equal(view.status, "pending");
  assert.equal(view.email, "sales@customer.com");
  assert.equal(view.lastErrorReason, null);
  console.log("✓ signature create maps to a pending row");
}

async function testRecheckFlipsPendingToVerified(): Promise<void> {
  const { prisma, rows } = createFakePrisma();
  rows.set("workspace-2", {
    id: "row-2",
    workspaceId: "workspace-2",
    email: "ops@customer.com",
    displayName: null,
    status: "pending",
    postmarkSignatureId: "77",
    lastErrorReason: null,
    requestedAt: new Date(),
    verifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const { client } = createPostmarkClientMock({
    getSignature: () => ({
      ok: true,
      data: { id: 77, emailAddress: "ops@customer.com", name: null, confirmed: true }
    })
  });
  const service = new AssistantEmailSenderIdentityService(
    prisma,
    createSecretStoreMock("acct-token"),
    client
  );

  const view = await service.readIdentity("workspace-2", { recheck: true });

  assert.ok(view !== null);
  assert.equal(view.status, "verified");
  assert.ok(typeof view.verifiedAt === "string" && view.verifiedAt.length > 0);
  console.log("✓ re-check flips pending -> verified when Postmark reports Confirmed");
}

async function testMissingAccountTokenSurfacesReasonWithoutStranding(): Promise<void> {
  const { prisma, rows } = createFakePrisma();
  rows.set("workspace-3", {
    id: "row-3",
    workspaceId: "workspace-3",
    email: "billing@customer.com",
    displayName: null,
    status: "pending",
    postmarkSignatureId: "88",
    lastErrorReason: null,
    requestedAt: new Date(),
    verifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const { client } = createPostmarkClientMock({});
  const service = new AssistantEmailSenderIdentityService(
    prisma,
    createSecretStoreMock(null),
    client
  );

  const view = await service.readIdentity("workspace-3", { recheck: true });

  assert.ok(view !== null);
  assert.equal(view.status, "pending", "row is not silently flipped to a false state");
  assert.equal(view.lastErrorReason, "postmark_account_token_unavailable");
  console.log(
    "✓ missing Account token surfaces postmark_account_token_unavailable without stranding the row silently"
  );

  // requestIdentity (an explicit user action) must fail loudly instead of
  // writing a pending row that can never be explained.
  const requestService = new AssistantEmailSenderIdentityService(
    prisma,
    createSecretStoreMock(null),
    client
  );
  await assert.rejects(
    () =>
      requestService.requestIdentity("workspace-4", {
        email: "new@customer.com",
        displayName: null
      }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return message.length > 0;
    }
  );
  const strandedRow = await prisma.workspaceEmailSenderIdentity.findUnique({
    where: { workspaceId: "workspace-4" }
  });
  assert.equal(strandedRow, null, "no pending row is created when the Account token is missing");
  console.log("✓ requestIdentity fails loudly (no row) when the Account token is missing");
}

async function testReplaceDeletesPriorSignatureBeforeCreating(): Promise<void> {
  const { prisma, rows } = createFakePrisma();
  rows.set("workspace-5", {
    id: "row-5",
    workspaceId: "workspace-5",
    email: "old@customer.com",
    displayName: null,
    status: "pending",
    postmarkSignatureId: "500",
    lastErrorReason: null,
    requestedAt: new Date(),
    verifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const { client, calls } = createPostmarkClientMock({
    createSignature: () => ({
      ok: true,
      data: { id: 501, emailAddress: "new@customer.com", name: null, confirmed: false }
    })
  });
  const service = new AssistantEmailSenderIdentityService(
    prisma,
    createSecretStoreMock("acct-token"),
    client
  );

  await service.requestIdentity("workspace-5", { email: "new@customer.com", displayName: null });

  assert.equal(calls.length, 2, "exactly delete then create");
  assert.equal(calls[0]?.method, "deleteSignature");
  assert.equal(calls[0]?.args[1], "500", "deletes the previous signature id");
  assert.equal(calls[1]?.method, "createSignature");
  const updated = await prisma.workspaceEmailSenderIdentity.findUnique({
    where: { workspaceId: "workspace-5" }
  });
  assert.equal(updated?.postmarkSignatureId, "501");
  console.log("✓ replace deletes the prior signature before creating the new one");
}

async function run(): Promise<void> {
  await testSignatureCreateMapsToPendingRow();
  await testRecheckFlipsPendingToVerified();
  await testMissingAccountTokenSurfacesReasonWithoutStranding();
  await testReplaceDeletesPriorSignatureBeforeCreating();
  console.log("\n✅ All assistant-email-sender-identity.service tests passed");
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
