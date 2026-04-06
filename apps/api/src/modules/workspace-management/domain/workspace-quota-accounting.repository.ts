import type {
  WorkspaceQuotaAccountingState,
  WorkspaceQuotaDimension
} from "./workspace-quota-accounting.entity";

export const WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY = Symbol(
  "WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY"
);

export type WorkspaceQuotaLimitsInput = {
  tokenBudgetLimit: bigint | null;
  costOrTokenDrivingToolClassUnitsLimit: number | null;
  activeWebChatsLimit: number | null;
  mediaStorageBytesLimit: bigint | null;
};

export type IncrementWorkspaceQuotaUsageInput = {
  workspaceId: string;
  assistantId: string | null;
  userId: string | null;
  dimension: WorkspaceQuotaDimension;
  delta: bigint;
  source: string;
  metadata: Record<string, unknown> | null;
  limits: WorkspaceQuotaLimitsInput;
};

export type ApplyTokenBudgetUsageInput = {
  workspaceId: string;
  assistantId: string | null;
  userId: string | null;
  delta: bigint;
  source: string;
  metadata: Record<string, unknown> | null;
  limits: WorkspaceQuotaLimitsInput;
};

export type ApplyTokenBudgetUsageResult = {
  state: WorkspaceQuotaAccountingState;
  appliedDelta: bigint;
  capped: boolean;
};

export type ApplyMediaStorageUsageInput = {
  workspaceId: string;
  assistantId: string | null;
  userId: string | null;
  delta: bigint;
  source: string;
  metadata: Record<string, unknown> | null;
  limits: WorkspaceQuotaLimitsInput;
};

export type ApplyMediaStorageUsageResult = {
  state: WorkspaceQuotaAccountingState;
  appliedDelta: bigint;
  capped: boolean;
};

export type RefreshActiveWebChatsQuotaInput = {
  workspaceId: string;
  assistantId: string | null;
  userId: string | null;
  currentActiveWebChats: number;
  source: string;
  limits: WorkspaceQuotaLimitsInput;
};

export interface WorkspaceQuotaAccountingRepository {
  findByWorkspaceId(workspaceId: string): Promise<WorkspaceQuotaAccountingState | null>;
  incrementUsage(input: IncrementWorkspaceQuotaUsageInput): Promise<WorkspaceQuotaAccountingState>;
  applyTokenBudgetUsage(input: ApplyTokenBudgetUsageInput): Promise<ApplyTokenBudgetUsageResult>;
  applyMediaStorageUsage(input: ApplyMediaStorageUsageInput): Promise<ApplyMediaStorageUsageResult>;
  refreshActiveWebChatsUsage(
    input: RefreshActiveWebChatsQuotaInput
  ): Promise<WorkspaceQuotaAccountingState>;
}
