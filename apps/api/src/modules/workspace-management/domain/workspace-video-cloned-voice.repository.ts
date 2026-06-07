import type { Prisma, WorkspaceVideoClonedVoiceStatus } from "@prisma/client";

/**
 * ADR-111 Slice 3 — domain port for the workspace-scoped cloned voice registry.
 *
 * One row = one reusable HeyGen cloned voice resource inside a workspace.
 * Cloned voices are workspace-scoped only; assistant-scoped storage is
 * forbidden by ADR-111 cross-slice invariants.
 */
export const WORKSPACE_VIDEO_CLONED_VOICE_REPOSITORY = Symbol(
  "WorkspaceVideoClonedVoiceRepository"
);

export type WorkspaceVideoClonedVoiceRecord = {
  id: string;
  workspaceId: string;
  displayName: string;
  displayNameLower: string;
  heygenVoiceCloneId: string | null;
  languageHint: string | null;
  status: WorkspaceVideoClonedVoiceStatus;
  isDefault: boolean;
  previewAudioUrl: string | null;
  sourceMetadata: Prisma.JsonValue;
  archived: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkspaceVideoClonedVoiceCreateInput = {
  id: string;
  workspaceId: string;
  displayName: string;
  displayNameLower: string;
  heygenVoiceCloneId?: string | null;
  languageHint?: string | null;
  status?: WorkspaceVideoClonedVoiceStatus;
  isDefault?: boolean;
  previewAudioUrl?: string | null;
  sourceMetadata?: Prisma.InputJsonValue;
};

export type WorkspaceVideoClonedVoiceUpdateInput = {
  workspaceId: string;
  clonedVoiceId: string;
  heygenVoiceCloneId?: string | null;
  languageHint?: string | null;
  status?: WorkspaceVideoClonedVoiceStatus;
  isDefault?: boolean;
  previewAudioUrl?: string | null;
  sourceMetadata?: Prisma.InputJsonValue;
};

export interface WorkspaceVideoClonedVoiceRepository {
  countActiveForWorkspace(workspaceId: string, tx?: Prisma.TransactionClient): Promise<number>;

  findActiveByLowerName(
    workspaceId: string,
    displayNameLower: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceVideoClonedVoiceRecord | null>;

  findById(
    workspaceId: string,
    clonedVoiceId: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceVideoClonedVoiceRecord | null>;

  listActive(
    workspaceId: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceVideoClonedVoiceRecord[]>;

  create(
    input: WorkspaceVideoClonedVoiceCreateInput,
    tx: Prisma.TransactionClient
  ): Promise<WorkspaceVideoClonedVoiceRecord>;

  update(
    input: WorkspaceVideoClonedVoiceUpdateInput,
    tx: Prisma.TransactionClient
  ): Promise<WorkspaceVideoClonedVoiceRecord | null>;

  setDefault(
    workspaceId: string,
    clonedVoiceId: string,
    tx: Prisma.TransactionClient
  ): Promise<WorkspaceVideoClonedVoiceRecord | null>;

  archive(
    workspaceId: string,
    clonedVoiceId: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceVideoClonedVoiceRecord | null>;
}
