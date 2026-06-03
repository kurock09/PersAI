import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { PrismaWorkspaceVcoinBalanceRepository } from "../src/modules/workspace-management/infrastructure/persistence/prisma-workspace-vcoin-balance.repository";

/**
 * ADR-108 Slice 1 — `WorkspaceVcoinBalance` get-or-create tests.
 *
 * The repository is read-only-with-create: first read for a workspace
 * lazily creates a row with `balanceVc = 0`, subsequent reads return that
 * row idempotently. No mutation methods exist on this port — debit /
 * credit / grant land in Slices 2 / 3 / 4 against their own dedicated
 * mutating paths.
 */
async function runGetOrCreateCreatesOnFirstRead(): Promise<void> {
  let findUniqueCalls = 0;
  let createCalls = 0;
  const repo = new PrismaWorkspaceVcoinBalanceRepository({
    workspaceVcoinBalance: {
      findUnique: async ({ where }: { where: { workspaceId: string } }) => {
        findUniqueCalls += 1;
        assert.equal(where.workspaceId, "ws-new");
        return null;
      },
      create: async ({ data }: { data: { workspaceId: string } }) => {
        createCalls += 1;
        assert.equal(data.workspaceId, "ws-new");
        return {
          workspaceId: "ws-new",
          balanceVc: 0,
          updatedAt: new Date("2026-06-03T19:00:00.000Z"),
          createdAt: new Date("2026-06-03T19:00:00.000Z")
        };
      }
    }
  } as never);

  const record = await repo.getOrCreate("ws-new");
  assert.equal(findUniqueCalls, 1);
  assert.equal(createCalls, 1);
  assert.equal(record.workspaceId, "ws-new");
  assert.equal(record.balanceVc, 0);
  assert.ok(record.updatedAt instanceof Date);
}

async function runGetOrCreateReturnsExistingRow(): Promise<void> {
  let findUniqueCalls = 0;
  let createCalls = 0;
  const repo = new PrismaWorkspaceVcoinBalanceRepository({
    workspaceVcoinBalance: {
      findUnique: async () => {
        findUniqueCalls += 1;
        return {
          workspaceId: "ws-existing",
          balanceVc: 42,
          updatedAt: new Date("2026-06-01T10:00:00.000Z"),
          createdAt: new Date("2026-05-15T10:00:00.000Z")
        };
      },
      create: async () => {
        createCalls += 1;
        throw new Error("create must not be called when the row already exists");
      }
    }
  } as never);

  const record = await repo.getOrCreate("ws-existing");
  assert.equal(findUniqueCalls, 1);
  assert.equal(createCalls, 0);
  assert.equal(record.balanceVc, 42);
  assert.equal(record.updatedAt.toISOString(), "2026-06-01T10:00:00.000Z");
}

async function runGetOrCreateIsIdempotent(): Promise<void> {
  let currentRow: {
    workspaceId: string;
    balanceVc: number;
    updatedAt: Date;
    createdAt: Date;
  } | null = null;
  const repo = new PrismaWorkspaceVcoinBalanceRepository({
    workspaceVcoinBalance: {
      findUnique: async () => currentRow,
      create: async ({ data }: { data: { workspaceId: string } }) => {
        currentRow = {
          workspaceId: data.workspaceId,
          balanceVc: 0,
          updatedAt: new Date("2026-06-03T19:00:00.000Z"),
          createdAt: new Date("2026-06-03T19:00:00.000Z")
        };
        return currentRow;
      }
    }
  } as never);

  const first = await repo.getOrCreate("ws-idempotent");
  const second = await repo.getOrCreate("ws-idempotent");
  const third = await repo.getOrCreate("ws-idempotent");

  assert.equal(first.balanceVc, 0);
  assert.equal(second.balanceVc, 0);
  assert.equal(third.balanceVc, 0);
  // After the first call the row exists; subsequent calls must not reset
  // the balance even if the stored value is intentionally non-zero (Slice
  // 3 grants land in this row).
  assert.equal(second.workspaceId, "ws-idempotent");
  assert.equal(third.workspaceId, "ws-idempotent");
}

async function runGetOrCreateHandlesP2002Race(): Promise<void> {
  let findUniqueCalls = 0;
  let createCalls = 0;
  const repo = new PrismaWorkspaceVcoinBalanceRepository({
    workspaceVcoinBalance: {
      findUnique: async () => {
        findUniqueCalls += 1;
        if (findUniqueCalls === 1) {
          return null;
        }
        return {
          workspaceId: "ws-race",
          balanceVc: 0,
          updatedAt: new Date("2026-06-03T19:00:01.000Z"),
          createdAt: new Date("2026-06-03T19:00:01.000Z")
        };
      },
      create: async () => {
        createCalls += 1;
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
          code: "P2002",
          clientVersion: "test"
        });
      }
    }
  } as never);

  const record = await repo.getOrCreate("ws-race");
  assert.equal(findUniqueCalls, 2);
  assert.equal(createCalls, 1);
  assert.equal(record.workspaceId, "ws-race");
  assert.equal(record.balanceVc, 0);
}

async function run(): Promise<void> {
  await runGetOrCreateCreatesOnFirstRead();
  await runGetOrCreateReturnsExistingRow();
  await runGetOrCreateIsIdempotent();
  await runGetOrCreateHandlesP2002Race();
  console.log("workspace-vcoin-balance.repository: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
