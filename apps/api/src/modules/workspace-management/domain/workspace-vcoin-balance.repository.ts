import type { Prisma } from "@prisma/client";

/**
 * ADR-108 — domain port for the workspace-scoped Vcoin (VC) wallet.
 *
 * Slice 1 introduced this port as read-only-with-create (`getOrCreate`).
 * Slice 2 adds the **debit** mutation that is invoked once on successful
 * `video_generate` artifact delivery, inside the SAME database transaction
 * that settles the monthly unit counter (ADR-108 cross-slice invariant 4 —
 * settle + debit must be transactional so retries cannot double-debit).
 *
 * Slices 3 / 4 own credit-side mutations (monthly grant; package purchase)
 * and may introduce dedicated `credit` overloads later; this port stays
 * intentionally narrow until those slices land.
 *
 * Image / image-edit / TTS / STT / document quotas remain per-unit and are
 * NOT routed through this port.
 */
export const WORKSPACE_VCOIN_BALANCE_REPOSITORY = Symbol("WorkspaceVcoinBalanceRepository");

/**
 * Domain shape returned by the repository. `balanceVc` is the canonical
 * integer balance for the workspace. Per ADR-108 lifecycle rule the balance
 * is normally non-negative; a single settle-only one-shot may drive it just
 * below zero, after which the next enqueue is rejected with
 * `vcoin_balance_exhausted`.
 *
 * `updatedAt` is the wall clock the underlying row was last touched
 * (matches the Prisma `@updatedAt` column on `WorkspaceVcoinBalance`).
 */
export type WorkspaceVcoinBalanceRecord = {
  workspaceId: string;
  balanceVc: number;
  updatedAt: Date;
};

/**
 * ADR-108 Slice 2 — input for the wallet debit mutation. `amountVc` must
 * be a non-negative integer (zero is a no-op and is still permitted to
 * keep callers simple). `tx` is the Prisma transaction client owned by the
 * caller; when present, the debit reads + writes inside that transaction
 * so the wallet update commits or rolls back atomically with the caller's
 * other writes (the unit-counter settle in the video-only settle path).
 *
 * When `tx` is omitted the debit runs against the default Prisma client
 * with no enclosing transaction. Slice 2 callers always pass `tx` for
 * `video_generate`; the no-`tx` overload exists so later slices (e.g.
 * admin manual debits) can reuse the same primitive without inventing a
 * second mutation point on the wallet.
 */
export type WorkspaceVcoinBalanceDebitInput = {
  workspaceId: string;
  amountVc: number;
  tx?: Prisma.TransactionClient;
};

/**
 * ADR-108 Slice 2 — result of a wallet debit. `previousBalanceVc` and
 * `balanceVc` are returned so the caller can audit the exact delta
 * applied (especially relevant for the one-shot negative-balance lifecycle
 * rule in ADR-108: a debit MAY drive the balance below zero exactly once;
 * the next enqueue pre-check rejects with `vcoin_balance_exhausted`).
 */
export type WorkspaceVcoinBalanceDebitResult = {
  balanceVc: number;
  previousBalanceVc: number;
  debitedAt: Date;
};

export interface WorkspaceVcoinBalanceRepository {
  /**
   * Returns the wallet row for the given workspace, creating it with
   * `balanceVc = 0` if it does not yet exist. Idempotent: subsequent calls
   * return the same row without resetting the balance. The repository does
   * not authorize or scope the workspace; callers are responsible for
   * passing a workspace they already own.
   */
  getOrCreate(workspaceId: string): Promise<WorkspaceVcoinBalanceRecord>;

  /**
   * ADR-108 Slice 2 — decrements the wallet balance by `amountVc`.
   *
   * Behavior contract:
   *   - `amountVc < 0` → throws synchronously. Slice 2 deliberately keeps
   *     this primitive debit-only; credit semantics land in Slices 3 / 4.
   *   - `amountVc === 0` → no-op; returns the current row unchanged.
   *   - `amountVc > 0` → decrements the row's `balance_vc` by `amountVc`
   *     **even if the result goes below zero**. The "one-shot negative
   *     balance" lifecycle rule (ADR-108 Wallet lifecycle) is enforced at
   *     the enqueue pre-check seam, not here.
   *   - When `tx` is provided, all reads/writes use that transaction
   *     client so the debit commits or rolls back atomically with the
   *     caller's other writes (e.g. the monthly unit-counter settle in
   *     `MediaDeliveryService`).
   *   - When `tx` is omitted, the debit runs against the default Prisma
   *     client without an enclosing transaction.
   *
   * The returned `previousBalanceVc` / `balanceVc` pair captures the
   * exact delta the caller applied so the settle path can log the
   * lifecycle transition (incl. the one-shot below-zero case).
   */
  debit(input: WorkspaceVcoinBalanceDebitInput): Promise<WorkspaceVcoinBalanceDebitResult>;
}
