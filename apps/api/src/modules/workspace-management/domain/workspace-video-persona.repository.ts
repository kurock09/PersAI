import type { Prisma } from "@prisma/client";

/**
 * ADR-109 Slice 5 — domain port for the workspace-scoped talking-avatar
 * persona registry.
 *
 * One persona row = one HeyGen avatar identity inside a workspace.
 * Personas are workspace-scoped only (cross-workspace sharing is forbidden).
 * Deletion is soft-only in Slice 5 (`archived = true`). Slice 6 will cascade
 * the HeyGen avatar DELETE and may hard-delete the row afterwards.
 *
 * Creation is REST-only (cross-slice invariant #14 — runtime MUST NOT
 * mutate this table).
 */
export const WORKSPACE_VIDEO_PERSONA_REPOSITORY = Symbol("WorkspaceVideoPersonaRepository");

/**
 * Domain record returned by all repository read paths.
 */
export type WorkspaceVideoPersonaRecord = {
  id: string;
  workspaceId: string;
  displayName: string;
  displayNameLower: string;
  portraitImageUrl: string;
  portraitImageStorageKey: string;
  heygenVoiceId: string;
  heygenVoiceLabel: string;
  /** Set at persona creation (Slice 5b E12). Sentinel "unset_legacy" may appear on rows created before the Slice 5b migration. */
  heygenAvatarId: string;
  archived: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Input for creating a new persona row. The caller is responsible for
 * computing `displayNameLower = displayName.toLowerCase()` before passing
 * it here (no regex, pure structural string operation — invariant #15).
 */
export type WorkspaceVideoPersonaCreateInput = {
  id: string;
  workspaceId: string;
  displayName: string;
  displayNameLower: string;
  portraitImageUrl: string;
  portraitImageStorageKey: string;
  heygenVoiceId: string;
  heygenVoiceLabel: string;
  /** HeyGen Photo Avatar ID created eagerly at persona POST time (Slice 5b E12). */
  heygenAvatarId: string;
};

export type WorkspaceVideoPersonaUpdateInput = {
  workspaceId: string;
  personaId: string;
  displayName: string;
  displayNameLower: string;
  heygenVoiceId: string;
  heygenVoiceLabel: string;
};

export interface WorkspaceVideoPersonaRepository {
  /**
   * Count of non-archived personas in the workspace.
   * Accepts an optional transaction client so the count can be read inside a
   * caller-owned `prisma.$transaction` block.
   */
  countActiveForWorkspace(workspaceId: string, tx?: Prisma.TransactionClient): Promise<number>;

  /**
   * Looks up a non-archived persona by its lowercased display name.
   * Used for the duplicate-name guard before insert. Pure equality check —
   * no regex, no fuzzy match (invariant #15).
   */
  findActiveByLowerName(
    workspaceId: string,
    displayNameLower: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceVideoPersonaRecord | null>;

  /**
   * Finds a persona by its PK, regardless of `archived` state. Returns null
   * when the row does not exist or does not belong to the workspace.
   */
  findById(
    workspaceId: string,
    personaId: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceVideoPersonaRecord | null>;

  /**
   * Lists all non-archived personas for the workspace, ordered by
   * `created_at ASC` (oldest first, stable for UI list).
   */
  listActive(workspaceId: string): Promise<WorkspaceVideoPersonaRecord[]>;

  /**
   * Inserts a new persona row. `tx` is REQUIRED — the insert must be part of
   * the caller-owned `prisma.$transaction` that also records the ledger event
   * and debits the wallet (ADR-109 Slice 5 transactional discipline).
   */
  create(
    input: WorkspaceVideoPersonaCreateInput,
    tx: Prisma.TransactionClient
  ): Promise<WorkspaceVideoPersonaRecord>;

  /**
   * Updates mutable persona fields without changing the stored portrait or
   * HeyGen avatar identity. Used by the user-facing edit flow where operators
   * may rename a persona or change its voice, but avatar replacement remains
   * a create-new-persona flow.
   */
  update(
    input: WorkspaceVideoPersonaUpdateInput,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceVideoPersonaRecord | null>;

  /**
   * Soft-deletes the persona by setting `archived = true` and
   * `archivedAt = now()`. Returns the updated row, or null if the row does
   * not exist or does not belong to the workspace. Does NOT call the HeyGen
   * API (Slice 6 owns the cascade delete).
   */
  archive(
    workspaceId: string,
    personaId: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceVideoPersonaRecord | null>;
}
