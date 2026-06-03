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

/**
 * ADR-108 Slice 2 — `debit` mutation tests.
 *
 * Cross-slice invariant 4 demands the debit be composable with the
 * caller's transaction; these tests prove the repository accepts both
 * the "default client" overload and the "tx" overload, and that the
 * "one-shot below-zero" lifecycle rule is enforced at the enqueue seam,
 * NOT at the repository (the repo deliberately allows the negative
 * write so the transaction commits cleanly even when the artifact's
 * computed VC cost overshoots the wallet).
 */
async function runDebitZeroIsNoOp(): Promise<void> {
  let updateCalls = 0;
  const repo = new PrismaWorkspaceVcoinBalanceRepository({
    workspaceVcoinBalance: {
      findUnique: async () => ({
        workspaceId: "ws-zero",
        balanceVc: 7,
        updatedAt: new Date("2026-06-03T19:30:00.000Z"),
        createdAt: new Date("2026-06-01T00:00:00.000Z")
      }),
      create: async () => {
        throw new Error("create must not be called when row exists");
      },
      update: async () => {
        updateCalls += 1;
        throw new Error("update must NOT be called for amountVc=0");
      }
    }
  } as never);

  const result = await repo.debit({ workspaceId: "ws-zero", amountVc: 0 });
  assert.equal(updateCalls, 0, "amountVc=0 must short-circuit before update");
  assert.equal(result.previousBalanceVc, 7);
  assert.equal(result.balanceVc, 7);
}

async function runDebitNegativeThrows(): Promise<void> {
  const repo = new PrismaWorkspaceVcoinBalanceRepository({
    workspaceVcoinBalance: {
      findUnique: async () => null,
      create: async () => {
        throw new Error("create must not be called for negative amount path");
      },
      update: async () => {
        throw new Error("update must not be called for negative amount path");
      }
    }
  } as never);

  await assert.rejects(
    () => repo.debit({ workspaceId: "ws-neg", amountVc: -1 }),
    /amountVc must be non-negative/,
    "negative debit is forbidden — credit semantics belong to Slice 3 / 4"
  );
  await assert.rejects(
    () => repo.debit({ workspaceId: "ws-neg", amountVc: 1.5 }),
    /amountVc must be an integer/
  );
}

async function runDebitPositiveDecrementsDefaultClient(): Promise<void> {
  let findUniqueCalls = 0;
  const updateCalls: Array<{ workspaceId: string; decrement: number }> = [];
  const repo = new PrismaWorkspaceVcoinBalanceRepository({
    workspaceVcoinBalance: {
      findUnique: async ({ where }: { where: { workspaceId: string } }) => {
        findUniqueCalls += 1;
        return {
          workspaceId: where.workspaceId,
          balanceVc: 12,
          updatedAt: new Date("2026-06-03T19:30:00.000Z"),
          createdAt: new Date("2026-06-01T00:00:00.000Z")
        };
      },
      create: async () => {
        throw new Error("create must not be called when row exists");
      },
      update: async ({
        where,
        data
      }: {
        where: { workspaceId: string };
        data: { balanceVc: { decrement: number } };
      }) => {
        updateCalls.push({
          workspaceId: where.workspaceId,
          decrement: data.balanceVc.decrement
        });
        return {
          workspaceId: where.workspaceId,
          balanceVc: 12 - data.balanceVc.decrement,
          updatedAt: new Date("2026-06-03T19:31:00.000Z"),
          createdAt: new Date("2026-06-01T00:00:00.000Z")
        };
      }
    }
  } as never);

  const result = await repo.debit({ workspaceId: "ws-deb", amountVc: 5 });
  assert.equal(findUniqueCalls, 1, "ensureRow must read once before update");
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]!.decrement, 5);
  assert.equal(updateCalls[0]!.workspaceId, "ws-deb");
  assert.equal(result.previousBalanceVc, 12);
  assert.equal(result.balanceVc, 7);
}

async function runDebitWithTxRoutesThroughTx(): Promise<void> {
  let defaultClientCalls = 0;
  let txFindUniqueCalls = 0;
  let txUpdateCalls = 0;
  const txClient = {
    workspaceVcoinBalance: {
      findUnique: async () => {
        txFindUniqueCalls += 1;
        return {
          workspaceId: "ws-tx",
          balanceVc: 4,
          updatedAt: new Date("2026-06-03T19:30:00.000Z"),
          createdAt: new Date("2026-06-01T00:00:00.000Z")
        };
      },
      create: async () => {
        throw new Error("create must not be called when row exists in tx");
      },
      update: async ({ data }: { data: { balanceVc: { decrement: number } } }) => {
        txUpdateCalls += 1;
        return {
          workspaceId: "ws-tx",
          balanceVc: 4 - data.balanceVc.decrement,
          updatedAt: new Date("2026-06-03T19:31:00.000Z"),
          createdAt: new Date("2026-06-01T00:00:00.000Z")
        };
      }
    }
  };
  const repo = new PrismaWorkspaceVcoinBalanceRepository({
    workspaceVcoinBalance: {
      findUnique: async () => {
        defaultClientCalls += 1;
        throw new Error("default client must NOT be touched when tx is supplied");
      },
      create: async () => {
        defaultClientCalls += 1;
        throw new Error("default client must NOT be touched when tx is supplied");
      },
      update: async () => {
        defaultClientCalls += 1;
        throw new Error("default client must NOT be touched when tx is supplied");
      }
    }
  } as never);

  const result = await repo.debit({
    workspaceId: "ws-tx",
    amountVc: 3,
    tx: txClient as never
  });
  assert.equal(defaultClientCalls, 0);
  assert.equal(txFindUniqueCalls, 1);
  assert.equal(txUpdateCalls, 1);
  assert.equal(result.previousBalanceVc, 4);
  assert.equal(result.balanceVc, 1);
}

async function runDebitAllowsBelowZero(): Promise<void> {
  // Lifecycle (ADR-108): the repository commits a debit even if it
  // drives the balance below zero exactly once. The next enqueue
  // pre-check is the layer that rejects with `vcoin_balance_exhausted`.
  const repo = new PrismaWorkspaceVcoinBalanceRepository({
    workspaceVcoinBalance: {
      findUnique: async () => ({
        workspaceId: "ws-overshoot",
        balanceVc: 2,
        updatedAt: new Date("2026-06-03T19:30:00.000Z"),
        createdAt: new Date("2026-06-01T00:00:00.000Z")
      }),
      create: async () => {
        throw new Error("create must not be called when row exists");
      },
      update: async ({ data }: { data: { balanceVc: { decrement: number } } }) => ({
        workspaceId: "ws-overshoot",
        balanceVc: 2 - data.balanceVc.decrement,
        updatedAt: new Date("2026-06-03T19:31:00.000Z"),
        createdAt: new Date("2026-06-01T00:00:00.000Z")
      })
    }
  } as never);

  const result = await repo.debit({ workspaceId: "ws-overshoot", amountVc: 5 });
  assert.equal(
    result.previousBalanceVc,
    2,
    "previousBalance reports the row state before the debit"
  );
  assert.equal(result.balanceVc, -3, "below-zero one-shot is allowed at repo level");
}

async function runDebitCreatesRowIfMissing(): Promise<void> {
  let createCalls = 0;
  let updateCalls = 0;
  const repo = new PrismaWorkspaceVcoinBalanceRepository({
    workspaceVcoinBalance: {
      findUnique: async () => null,
      create: async ({ data }: { data: { workspaceId: string } }) => {
        createCalls += 1;
        return {
          workspaceId: data.workspaceId,
          balanceVc: 0,
          updatedAt: new Date("2026-06-03T19:30:00.000Z"),
          createdAt: new Date("2026-06-03T19:30:00.000Z")
        };
      },
      update: async () => {
        updateCalls += 1;
        return {
          workspaceId: "ws-missing",
          balanceVc: -2,
          updatedAt: new Date("2026-06-03T19:31:00.000Z"),
          createdAt: new Date("2026-06-03T19:30:00.000Z")
        };
      }
    }
  } as never);

  const result = await repo.debit({ workspaceId: "ws-missing", amountVc: 2 });
  assert.equal(createCalls, 1, "missing row must be created on first debit");
  assert.equal(updateCalls, 1);
  assert.equal(result.previousBalanceVc, 0);
  assert.equal(result.balanceVc, -2, "first-debit overshoot is permitted by lifecycle");
}

async function run(): Promise<void> {
  await runGetOrCreateCreatesOnFirstRead();
  await runGetOrCreateReturnsExistingRow();
  await runGetOrCreateIsIdempotent();
  await runGetOrCreateHandlesP2002Race();
  await runDebitZeroIsNoOp();
  await runDebitNegativeThrows();
  await runDebitPositiveDecrementsDefaultClient();
  await runDebitWithTxRoutesThroughTx();
  await runDebitAllowsBelowZero();
  await runDebitCreatesRowIfMissing();
  console.log("workspace-vcoin-balance.repository: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
