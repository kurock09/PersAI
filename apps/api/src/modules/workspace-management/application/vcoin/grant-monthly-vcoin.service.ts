import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  WORKSPACE_VCOIN_BALANCE_REPOSITORY,
  type WorkspaceVcoinBalanceRepository
} from "../../domain/workspace-vcoin-balance.repository";
import {
  WORKSPACE_VCOIN_LEDGER_EVENT_REPOSITORY,
  type WorkspaceVcoinLedgerEventRepository
} from "../../domain/workspace-vcoin-ledger-event.repository";
import { parseVideoVcoinMonthlyGrant } from "./parse-video-vcoin-monthly-grant";

/**
 * ADR-108 Slice 3 — result of `GrantMonthlyVcoinService.creditPeriod`.
 */
export type GrantMonthlyVcoinCreditPeriodResult = {
  /** The VC amount credited this call. 0 when grant = 0 or alreadyGranted = true. */
  creditedVc: number;
  /** True when the idempotency mark already existed — no credit was applied. */
  alreadyGranted: boolean;
  /** Current wallet balance after this call (reflects all prior credits). */
  balanceVc: number;
};

/**
 * ADR-108 Slice 3 — idempotent monthly Vcoin grant service.
 *
 * Credits `videoVcoinMonthlyGrant` VC into the workspace wallet exactly once
 * per `(workspaceId, periodStartedAt)` pair, driven by the unique constraint
 * on `workspace_vcoin_ledger_events`. The service is designed to be called
 * from inside a `prisma.$transaction` block owned by the subscription period
 * rollover so a failed grant rolls the entire rollover back and a duplicate
 * webhook delivery cannot double-credit the wallet.
 *
 * **Transactional discipline:**
 * The `tx` parameter is REQUIRED. This service must always be invoked inside
 * a caller-owned `prisma.$transaction(async (tx) => {...})` block. Calling
 * `creditPeriod` outside a transaction is a forbidden pattern (ADR-108 Slice
 * 3 forbidden patterns) because the ledger event insert and the wallet credit
 * must be atomic with the subscription upsert.
 *
 * **Idempotency:**
 * The `(workspaceId, "monthly_grant", referenceKey)` unique index on
 * `workspace_vcoin_ledger_events` is the idempotency gate. If the row already
 * exists (P2002), the service returns `{ creditedVc: 0, alreadyGranted: true }`.
 *
 * **Zero-grant plans:**
 * When `videoVcoinMonthlyGrant === 0` (the plan default), `creditPeriod`
 * returns `{ creditedVc: 0, alreadyGranted: false }` without writing the
 * idempotency mark. The rationale: if an admin later bumps the plan grant
 * from 0 to a positive value, the workspace should be eligible to receive
 * that retroactive credit on the next period; writing a zero-amount ledger
 * mark would incorrectly block that credit.
 *
 * **Plan not found:**
 * If the plan code does not resolve to a known `PlanCatalogPlan` row, this
 * service throws `PlanNotFoundForVcoinGrantError`. Callers must not silently
 * swallow this — it signals a configuration drift that should roll back the
 * entire rollover transaction.
 */
@Injectable()
export class GrantMonthlyVcoinService {
  constructor(
    @Inject(WORKSPACE_VCOIN_LEDGER_EVENT_REPOSITORY)
    private readonly ledgerEventRepository: WorkspaceVcoinLedgerEventRepository,
    @Inject(WORKSPACE_VCOIN_BALANCE_REPOSITORY)
    private readonly vcoinBalanceRepository: WorkspaceVcoinBalanceRepository
  ) {}

  async creditPeriod(input: {
    workspaceId: string;
    planCode: string;
    periodStartedAt: Date;
    tx: Prisma.TransactionClient;
  }): Promise<GrantMonthlyVcoinCreditPeriodResult> {
    const { workspaceId, planCode, periodStartedAt, tx } = input;

    // Load plan via the supplied tx client so this read is part of the same
    // transaction and cannot observe uncommitted state from another session.
    const plan = await tx.planCatalogPlan.findUnique({
      where: { code: planCode },
      select: { billingProviderHints: true }
    });
    if (plan === null) {
      throw new PlanNotFoundForVcoinGrantError(planCode);
    }

    const grant = parseVideoVcoinMonthlyGrant(
      (plan.billingProviderHints as Record<string, unknown> | null)?.videoVcoinMonthlyGrant
    );

    // Zero-grant: no-op. Do NOT write the idempotency mark — a future config
    // bump from 0 to a positive value should be able to credit retroactively
    // on the next period boundary. Writing a zero ledger mark would block that.
    if (grant === 0) {
      const walletRow = await this.vcoinBalanceRepository.getOrCreate(workspaceId);
      return { creditedVc: 0, alreadyGranted: false, balanceVc: walletRow.balanceVc };
    }

    // The ISO string of periodStartedAt is the reference key for monthly_grant.
    const referenceKey = periodStartedAt.toISOString();

    // LEDGER-FIRST: insert the idempotency mark BEFORE crediting the wallet
    // (ADR-108 Slice 3 forbidden patterns). A P2002 from recordEvent means the
    // grant was already applied; short-circuit without touching the wallet.
    const { recorded } = await this.ledgerEventRepository.recordEvent({
      workspaceId,
      kind: "monthly_grant",
      amountVc: grant,
      referenceKey,
      planCode,
      tx
    });

    if (!recorded) {
      // Already granted — quiet idempotent retry. Do not log (per spec).
      const walletRow = await this.vcoinBalanceRepository.getOrCreate(workspaceId);
      return { creditedVc: 0, alreadyGranted: true, balanceVc: walletRow.balanceVc };
    }

    // CREDIT-SECOND: wallet credit is only reached when the ledger insert
    // succeeded, guaranteeing at-most-once semantics.
    const creditResult = await this.vcoinBalanceRepository.credit({
      workspaceId,
      amountVc: grant,
      kind: "monthly_grant",
      tx
    });

    return {
      creditedVc: grant,
      alreadyGranted: false,
      balanceVc: creditResult.balanceVc
    };
  }
}

/**
 * Thrown by `GrantMonthlyVcoinService.creditPeriod` when the supplied
 * `planCode` does not resolve to a row in `plan_catalog_plans`.
 *
 * This is a configuration-drift error. The rollover transaction must roll back
 * when it is thrown so no partial state is committed.
 */
export class PlanNotFoundForVcoinGrantError extends Error {
  constructor(planCode: string) {
    super(
      `GrantMonthlyVcoinService: plan "${planCode}" not found in plan_catalog_plans. ` +
        `Cannot credit monthly Vcoin grant. Rollover transaction will be rolled back.`
    );
    this.name = "PlanNotFoundForVcoinGrantError";
  }
}
