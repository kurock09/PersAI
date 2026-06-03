/**
 * ADR-108 Slice 1 — domain port for the workspace-scoped Vcoin (VC) wallet.
 *
 * Slice 1 is contract-carrying only: this port exposes a single
 * `getOrCreate` access path so the wallet row exists when later slices
 * settle (Slice 2), grant (Slice 3), or purchase (Slice 4) VC.
 *
 * **The interface is intentionally read-only-with-create.** There are NO
 * debit, credit, or mutation methods here. Slices 2 / 3 / 4 will introduce
 * dedicated mutating ports (or atomic SQL paths) so the wallet's invariants
 * (integer-only VC, at most one settle-only negative balance, idempotent
 * grants) live in one place per concern.
 *
 * Image / image-edit / TTS / STT / document quotas remain per-unit and are
 * NOT routed through this port.
 */
export const WORKSPACE_VCOIN_BALANCE_REPOSITORY = Symbol("WorkspaceVcoinBalanceRepository");

/**
 * Domain shape returned by the repository. `balanceVc` is the canonical
 * non-negative integer balance for the workspace. `updatedAt` is the wall
 * clock the underlying row was last touched (matches the prisma
 * `@updatedAt` column on `WorkspaceVcoinBalance`).
 */
export type WorkspaceVcoinBalanceRecord = {
  workspaceId: string;
  balanceVc: number;
  updatedAt: Date;
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
}
