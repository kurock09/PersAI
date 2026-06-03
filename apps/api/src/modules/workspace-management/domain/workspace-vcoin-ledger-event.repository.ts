import type { Prisma } from "@prisma/client";

/**
 * ADR-108 Slice 3 — domain port for the workspace VC ledger event table.
 *
 * The table `workspace_vcoin_ledger_events` serves two purposes:
 *   1. **Idempotency gate**: the UNIQUE constraint on
 *      `(workspaceId, kind, referenceKey)` ensures each logical event is
 *      recorded at most once. A P2002 unique-violation from `recordEvent`
 *      means the event was already applied; the caller should treat this as
 *      "already done" and short-circuit gracefully.
 *   2. **Audit trail**: every VC credit (and future debit) is persisted here
 *      with a `kind` discriminator so admins can audit the wallet history
 *      independently of the balance row.
 *
 * This port intentionally exposes only `recordEvent`. The balance mutation
 * (`WorkspaceVcoinBalanceRepository.credit`) is separate; callers must
 * call `recordEvent` FIRST (idempotency gate) and then `credit` (balance
 * update). The order is enforced by the `GrantMonthlyVcoinService` contract
 * and is required to satisfy ADR-108 Slice 3 forbidden patterns ("ledger-
 * first → credit-second").
 *
 * This port is independent of and parallel to `model_cost_ledger_events`
 * (the USD COGS ledger). ADR-108 cross-slice invariant 2 requires that table
 * to remain unchanged in shape and write site throughout the ADR-108 program.
 *
 * Slice 4 will reuse this port to record `package_purchase` / `package_refund`
 * events. Slice 3 only records `monthly_grant`.
 */
export const WORKSPACE_VCOIN_LEDGER_EVENT_REPOSITORY = Symbol(
  "WorkspaceVcoinLedgerEventRepository"
);

/** Supported `kind` values for VC ledger events. */
export type WorkspaceVcoinLedgerEventKind =
  | "monthly_grant"
  | "package_purchase"
  | "package_refund"
  | "manual";

/**
 * Input for recording a single VC ledger event.
 *
 * `referenceKey` semantics by kind:
 *   - `"monthly_grant"` → ISO 8601 UTC string of `periodStartedAt`
 *     (e.g. `"2026-06-01T00:00:00.000Z"`).
 *   - `"package_purchase"` / `"package_refund"` → Slice 4 will document.
 *
 * `tx` MUST be the same `Prisma.TransactionClient` that is also passed to
 * `WorkspaceVcoinBalanceRepository.credit` in the same call so the ledger
 * insert and the balance increment are committed or rolled back atomically.
 */
export type WorkspaceVcoinLedgerEventRecordInput = {
  workspaceId: string;
  kind: WorkspaceVcoinLedgerEventKind;
  /** Signed integer: positive = credit, negative = debit. */
  amountVc: number;
  referenceKey: string;
  planCode?: string | null;
  tx: Prisma.TransactionClient;
};

/**
 * Result of `recordEvent`.
 *
 * `recorded: true`  → the ledger row was inserted; the caller should now
 *                     apply the corresponding wallet mutation.
 * `recorded: false` → a row with the same `(workspaceId, kind, referenceKey)`
 *                     already exists (P2002 unique-violation caught by the
 *                     repository). The caller should treat this as idempotent
 *                     and short-circuit without applying the wallet mutation.
 */
export type WorkspaceVcoinLedgerEventRecordResult = {
  recorded: boolean;
};

export interface WorkspaceVcoinLedgerEventRepository {
  /**
   * Inserts a VC ledger event row.
   *
   * Returns `{ recorded: true }` on successful insert.
   * Returns `{ recorded: false }` when a P2002 unique-violation is caught
   * (the `(workspaceId, kind, referenceKey)` triple already exists in the
   * ledger). Any other error is re-thrown unmodified.
   *
   * **Important:** `tx` is required. The ledger insert and the wallet
   * credit must share the same transaction so neither can commit without
   * the other (ADR-108 Slice 3 transactional discipline).
   */
  recordEvent(
    input: WorkspaceVcoinLedgerEventRecordInput
  ): Promise<WorkspaceVcoinLedgerEventRecordResult>;
}
