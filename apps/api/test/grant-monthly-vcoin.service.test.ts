import assert from "node:assert/strict";
import { GrantMonthlyVcoinService } from "../src/modules/workspace-management/application/vcoin/grant-monthly-vcoin.service";

/**
 * ADR-108 Slice 3 — `GrantMonthlyVcoinService.creditPeriod` unit tests.
 *
 * All five spec-required cases plus the plan-not-found error and the tx
 * propagation sentinel check.
 *
 * The test uses hand-rolled in-memory stubs for the ledger event repo, the
 * wallet repo, and the Prisma tx client so it runs without a real DB and
 * without NestJS DI — matching the pattern established by the Slice 2
 * media-delivery tests.
 */

type PlanRow = {
  billingProviderHints: unknown;
} | null;

function makeTxClient(planRow: PlanRow) {
  return {
    planCatalogPlan: {
      async findUnique(_args: { where: { code: string }; select: unknown }) {
        return planRow;
      }
    }
  };
}

function makeStubs(opts: {
  planRow: PlanRow;
  initialBalanceVc?: number;
  recordEventResult?: { recorded: boolean };
  recordEventShouldThrow?: Error;
}) {
  const initialBalance = opts.initialBalanceVc ?? 0;
  let currentBalance = initialBalance;
  const recordedEvents: Array<{ kind: string; referenceKey: string; amountVc: number }> = [];

  const txClient = makeTxClient(opts.planRow) as never;

  const ledgerEventRepo = {
    async recordEvent(input: {
      workspaceId: string;
      kind: string;
      amountVc: number;
      referenceKey: string;
      planCode?: string | null;
      tx: unknown;
    }) {
      if (opts.recordEventShouldThrow) throw opts.recordEventShouldThrow;
      if (opts.recordEventResult !== undefined) return opts.recordEventResult;
      recordedEvents.push({
        kind: input.kind,
        referenceKey: input.referenceKey,
        amountVc: input.amountVc
      });
      return { recorded: true };
    }
  };

  const vcoinBalanceRepo = {
    async getOrCreate(_workspaceId: string) {
      return {
        workspaceId: "ws-test",
        balanceVc: currentBalance,
        updatedAt: new Date()
      };
    },
    async credit(input: { workspaceId: string; amountVc: number; kind: string; tx: unknown }) {
      const previous = currentBalance;
      currentBalance += input.amountVc;
      return {
        previousBalanceVc: previous,
        balanceVc: currentBalance,
        creditedAt: new Date()
      };
    },
    async debit(_input: unknown) {
      throw new Error("debit must not be called from grant service");
    }
  };

  return {
    txClient,
    ledgerEventRepo,
    vcoinBalanceRepo,
    recordedEvents,
    getBalance: () => currentBalance
  };
}

function makeService(
  ledgerEventRepo: unknown,
  vcoinBalanceRepo: unknown
): GrantMonthlyVcoinService {
  return new GrantMonthlyVcoinService(ledgerEventRepo as never, vcoinBalanceRepo as never);
}

// ── Case 1: First call credits exactly the plan grant ────────────────────────

async function runFirstCallCreditsGrant(): Promise<void> {
  const { txClient, ledgerEventRepo, vcoinBalanceRepo, recordedEvents } = makeStubs({
    planRow: { billingProviderHints: { videoVcoinMonthlyGrant: 500 } },
    initialBalanceVc: 100
  });

  const service = makeService(ledgerEventRepo, vcoinBalanceRepo);
  const result = await service.creditPeriod({
    workspaceId: "ws-a",
    planCode: "pro",
    periodStartedAt: new Date("2026-06-01T00:00:00.000Z"),
    tx: txClient
  });

  assert.equal(result.creditedVc, 500, "creditedVc must equal the plan grant");
  assert.equal(result.alreadyGranted, false, "first call must not be alreadyGranted");
  assert.equal(result.balanceVc, 600, "balance must be previous + grant");
  assert.equal(recordedEvents.length, 1, "exactly one ledger event must be recorded");
  assert.equal(recordedEvents[0]!.kind, "monthly_grant");
  assert.equal(recordedEvents[0]!.referenceKey, "2026-06-01T00:00:00.000Z");
  assert.equal(recordedEvents[0]!.amountVc, 500);
}

// ── Case 2: Second call with same (workspaceId, periodStartedAt) is a no-op ──

async function runSecondCallIsIdempotent(): Promise<void> {
  let recordCount = 0;
  let creditCount = 0;
  let balance = 300;

  const txClient = makeTxClient({
    billingProviderHints: { videoVcoinMonthlyGrant: 200 }
  }) as never;

  const ledgerEventRepo = {
    async recordEvent(_input: unknown) {
      recordCount += 1;
      // Simulate second-call P2002 — first call recorded: true
      return { recorded: recordCount === 1 };
    }
  };

  const vcoinBalanceRepo = {
    async getOrCreate(_ws: string) {
      return { workspaceId: "ws-b", balanceVc: balance, updatedAt: new Date() };
    },
    async credit(input: { amountVc: number }) {
      creditCount += 1;
      balance += input.amountVc;
      return {
        previousBalanceVc: balance - input.amountVc,
        balanceVc: balance,
        creditedAt: new Date()
      };
    }
  };

  const service = makeService(ledgerEventRepo, vcoinBalanceRepo);

  // First call
  const first = await service.creditPeriod({
    workspaceId: "ws-b",
    planCode: "pro",
    periodStartedAt: new Date("2026-06-01T00:00:00.000Z"),
    tx: txClient
  });
  assert.equal(first.creditedVc, 200);
  assert.equal(first.alreadyGranted, false);
  assert.equal(first.balanceVc, 500);
  assert.equal(creditCount, 1);

  // Second call — recordEvent returns recorded: false
  const second = await service.creditPeriod({
    workspaceId: "ws-b",
    planCode: "pro",
    periodStartedAt: new Date("2026-06-01T00:00:00.000Z"),
    tx: txClient
  });
  assert.equal(second.creditedVc, 0, "second call must not credit");
  assert.equal(second.alreadyGranted, true, "second call must report alreadyGranted");
  assert.equal(second.balanceVc, 500, "balance must not increase on second call");
  assert.equal(creditCount, 1, "credit must only be called once");
}

// ── Case 3: Plan with grant = 0 produces a no-op ─────────────────────────────

async function runZeroGrantIsNoOp(): Promise<void> {
  let recordEventCalled = false;
  let creditCalled = false;
  const balance = 100;

  const txClient = makeTxClient({
    billingProviderHints: { videoVcoinMonthlyGrant: 0 }
  }) as never;

  const ledgerEventRepo = {
    async recordEvent(_input: unknown) {
      recordEventCalled = true;
      return { recorded: true };
    }
  };

  const vcoinBalanceRepo = {
    async getOrCreate(_ws: string) {
      return { workspaceId: "ws-c", balanceVc: balance, updatedAt: new Date() };
    },
    async credit(_input: unknown) {
      creditCalled = true;
      return { previousBalanceVc: 0, balanceVc: 0, creditedAt: new Date() };
    }
  };

  const service = makeService(ledgerEventRepo, vcoinBalanceRepo);
  const result = await service.creditPeriod({
    workspaceId: "ws-c",
    planCode: "free",
    periodStartedAt: new Date("2026-06-01T00:00:00.000Z"),
    tx: txClient
  });

  assert.equal(result.creditedVc, 0, "zero-grant plan must credit 0");
  assert.equal(result.alreadyGranted, false, "zero-grant is not alreadyGranted");
  assert.equal(result.balanceVc, 100, "balance must be unchanged");
  assert.equal(recordEventCalled, false, "ledger event must NOT be recorded for grant=0");
  assert.equal(creditCalled, false, "credit must NOT be called for grant=0");
}

// ── Case 4: Plan with grant > 0 credits exactly the grant amount ──────────────

async function runPositiveGrantCreditsExactAmount(): Promise<void> {
  const { txClient, ledgerEventRepo, vcoinBalanceRepo } = makeStubs({
    planRow: { billingProviderHints: { videoVcoinMonthlyGrant: 1000 } },
    initialBalanceVc: 0
  });

  const service = makeService(ledgerEventRepo, vcoinBalanceRepo);
  const result = await service.creditPeriod({
    workspaceId: "ws-d",
    planCode: "enterprise",
    periodStartedAt: new Date("2026-06-01T00:00:00.000Z"),
    tx: txClient
  });

  assert.equal(result.creditedVc, 1000);
  assert.equal(result.balanceVc, 1000);
  assert.equal(result.alreadyGranted, false);
}

// ── Case 5: Wallet balance accumulates across two distinct periods ────────────

async function runBalanceAccumulatesAcrossPeriods(): Promise<void> {
  let balance = 0;
  let recordCount = 0;

  const txClient = makeTxClient({
    billingProviderHints: { videoVcoinMonthlyGrant: 300 }
  }) as never;

  const ledgerEventRepo = {
    async recordEvent(_input: unknown) {
      recordCount += 1;
      return { recorded: true };
    }
  };

  const vcoinBalanceRepo = {
    async getOrCreate(_ws: string) {
      return { workspaceId: "ws-e", balanceVc: balance, updatedAt: new Date() };
    },
    async credit(input: { amountVc: number }) {
      const prev = balance;
      balance += input.amountVc;
      return { previousBalanceVc: prev, balanceVc: balance, creditedAt: new Date() };
    }
  };

  const service = makeService(ledgerEventRepo, vcoinBalanceRepo);

  // Period A
  const resultA = await service.creditPeriod({
    workspaceId: "ws-e",
    planCode: "pro",
    periodStartedAt: new Date("2026-06-01T00:00:00.000Z"),
    tx: txClient
  });
  assert.equal(resultA.creditedVc, 300);
  assert.equal(resultA.balanceVc, 300);

  // Period B — accumulates on top
  const resultB = await service.creditPeriod({
    workspaceId: "ws-e",
    planCode: "pro",
    periodStartedAt: new Date("2026-07-01T00:00:00.000Z"),
    tx: txClient
  });
  assert.equal(resultB.creditedVc, 300);
  assert.equal(resultB.balanceVc, 600, "balance accumulates — no reset between periods");
  assert.equal(recordCount, 2, "ledger must have two distinct entries");
}

// ── Case 6: Plan code not found throws ───────────────────────────────────────

async function runPlanNotFoundThrows(): Promise<void> {
  const { txClient, ledgerEventRepo, vcoinBalanceRepo } = makeStubs({
    planRow: null
  });

  const service = makeService(ledgerEventRepo, vcoinBalanceRepo);

  await assert.rejects(
    () =>
      service.creditPeriod({
        workspaceId: "ws-f",
        planCode: "nonexistent",
        periodStartedAt: new Date("2026-06-01T00:00:00.000Z"),
        tx: txClient
      }),
    /PlanNotFoundForVcoinGrantError|plan "nonexistent" not found/
  );
}

// ── Case 7: tx sentinel is propagated to ledger insert and credit call ────────

async function runTxSentinelIsPropagated(): Promise<void> {
  // Use a sentinel tx object that records calls to verify both the plan
  // lookup and the ledger insert pass through the SAME tx reference.
  const capturedTxRefs: unknown[] = [];

  const sentinelTx = {
    planCatalogPlan: {
      async findUnique(_args: unknown) {
        capturedTxRefs.push(sentinelTx);
        return { billingProviderHints: { videoVcoinMonthlyGrant: 150 } };
      }
    }
  };

  const ledgerEventRepo = {
    async recordEvent(input: { tx: unknown }) {
      capturedTxRefs.push(input.tx);
      return { recorded: true };
    }
  };

  const vcoinBalanceRepo = {
    async getOrCreate(_ws: string) {
      return { workspaceId: "ws-g", balanceVc: 0, updatedAt: new Date() };
    },
    async credit(input: { tx: unknown; amountVc: number }) {
      capturedTxRefs.push(input.tx);
      return { previousBalanceVc: 0, balanceVc: input.amountVc, creditedAt: new Date() };
    }
  };

  const service = makeService(ledgerEventRepo, vcoinBalanceRepo);
  await service.creditPeriod({
    workspaceId: "ws-g",
    planCode: "pro",
    periodStartedAt: new Date("2026-06-01T00:00:00.000Z"),
    tx: sentinelTx as never
  });

  // All three operations (plan lookup, ledger insert, credit) must use the
  // same tx sentinel reference.
  assert.equal(capturedTxRefs.length, 3, "tx must be passed to plan lookup + ledger + credit");
  assert.ok(
    capturedTxRefs.every((ref) => ref === sentinelTx),
    "all three operations must share the same tx reference"
  );
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  await runFirstCallCreditsGrant();
  await runSecondCallIsIdempotent();
  await runZeroGrantIsNoOp();
  await runPositiveGrantCreditsExactAmount();
  await runBalanceAccumulatesAcrossPeriods();
  await runPlanNotFoundThrows();
  await runTxSentinelIsPropagated();
  console.log("grant-monthly-vcoin.service: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
