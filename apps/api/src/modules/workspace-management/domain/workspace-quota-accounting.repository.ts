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
  refreshActiveWebChatsUsage(
    input: RefreshActiveWebChatsQuotaInput
  ): Promise<WorkspaceQuotaAccountingState>;
}
