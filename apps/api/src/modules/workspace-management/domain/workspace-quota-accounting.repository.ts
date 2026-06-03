import type { Prisma } from "@prisma/client";
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
  knowledgeStorageBytesLimit: bigint | null;
  workspaceStorageBytesLimit: bigint | null;
};

export type WorkspaceMonthlyToolQuotaToolCode =
  | "image_generate"
  | "image_edit"
  | "video_generate"
  | "document";

export type WorkspaceMonthlyToolQuotaCounter = {
  workspaceId: string;
  toolCode: WorkspaceMonthlyToolQuotaToolCode;
  periodStartedAt: Date;
  periodEndsAt: Date;
  reservedUnits: number;
  settledUnits: number;
  releasedUnits: number;
  reconciliationRequiredUnits: number;
  limitUnits: number | null;
  lastComputedAt: Date;
};

export type WorkspaceTokenBudgetPeriodCounter = {
  workspaceId: string;
  periodStartedAt: Date;
  periodEndsAt: Date;
  usedCredits: bigint;
  limitCredits: bigint | null;
  lastComputedAt: Date;
};

export type FindTokenBudgetPeriodCounterInput = {
  workspaceId: string;
  periodStartedAt: Date;
  periodEndsAt: Date;
};

export type FindMonthlyMediaQuotaCounterInput = {
  workspaceId: string;
  toolCode: WorkspaceMonthlyToolQuotaToolCode;
  periodStartedAt: Date;
  periodEndsAt: Date;
};

export type MonthlyMediaQuotaMutationInput = {
  workspaceId: string;
  toolCode: WorkspaceMonthlyToolQuotaToolCode;
  periodStartedAt: Date;
  periodEndsAt: Date;
  units: number;
  limitUnits: number | null;
};

export type ReserveMonthlyMediaQuotaResult = {
  allowed: boolean;
  currentUsedUnits: number;
  limitUnits: number | null;
  counter: WorkspaceMonthlyToolQuotaCounter;
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
  periodStartedAt: Date;
  periodEndsAt: Date;
  delta: bigint;
  source: string;
  metadata: Record<string, unknown> | null;
  limits: WorkspaceQuotaLimitsInput;
};

export type ApplyTokenBudgetUsageResult = {
  state: WorkspaceQuotaAccountingState;
  counter: WorkspaceTokenBudgetPeriodCounter;
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

export type ApplyKnowledgeStorageUsageInput = {
  workspaceId: string;
  assistantId: string | null;
  userId: string | null;
  delta: bigint;
  source: string;
  metadata: Record<string, unknown> | null;
  limits: WorkspaceQuotaLimitsInput;
};

export type ApplyKnowledgeStorageUsageResult = {
  state: WorkspaceQuotaAccountingState;
  appliedDelta: bigint;
  capped: boolean;
};

export type ReleaseMediaStorageUsageInput = {
  workspaceId: string;
  assistantId: string | null;
  userId: string | null;
  delta: bigint;
  source: string;
  metadata: Record<string, unknown> | null;
  limits: WorkspaceQuotaLimitsInput;
};

export type ReleaseMediaStorageUsageResult = {
  state: WorkspaceQuotaAccountingState;
  releasedDelta: bigint;
};

export type ReleaseKnowledgeStorageUsageInput = {
  workspaceId: string;
  assistantId: string | null;
  userId: string | null;
  delta: bigint;
  source: string;
  metadata: Record<string, unknown> | null;
  limits: WorkspaceQuotaLimitsInput;
};

export type ReleaseKnowledgeStorageUsageResult = {
  state: WorkspaceQuotaAccountingState;
  releasedDelta: bigint;
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
  findTokenBudgetPeriodCounter(
    input: FindTokenBudgetPeriodCounterInput
  ): Promise<WorkspaceTokenBudgetPeriodCounter | null>;
  findMonthlyMediaQuotaCounter(
    input: FindMonthlyMediaQuotaCounterInput
  ): Promise<WorkspaceMonthlyToolQuotaCounter | null>;
  reserveMonthlyMediaQuota(
    input: MonthlyMediaQuotaMutationInput
  ): Promise<ReserveMonthlyMediaQuotaResult>;
  /**
   * ADR-108 Slice 2 — settle the monthly unit counter for a media job.
   *
   * `tx` is optional. When provided, the settle runs inside the caller's
   * transaction (used by the video-only success-delivery path so the
   * unit-counter settle and the `workspace_vcoin_balances` debit commit
   * or roll back together — ADR-108 cross-slice invariant 4). When
   * omitted, the implementation opens its own serializable transaction,
   * preserving byte-identical behavior for the image / image-edit / TTS /
   * STT call sites that do not need transactional composition.
   */
  settleMonthlyMediaQuota(
    input: MonthlyMediaQuotaMutationInput,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceMonthlyToolQuotaCounter>;
  consumeMonthlyToolQuotaSuccessOnly(
    input: MonthlyMediaQuotaMutationInput
  ): Promise<WorkspaceMonthlyToolQuotaCounter>;
  releaseMonthlyMediaQuota(
    input: MonthlyMediaQuotaMutationInput
  ): Promise<WorkspaceMonthlyToolQuotaCounter>;
  markMonthlyMediaQuotaReconciliationRequired(
    input: MonthlyMediaQuotaMutationInput
  ): Promise<WorkspaceMonthlyToolQuotaCounter>;
  incrementUsage(input: IncrementWorkspaceQuotaUsageInput): Promise<WorkspaceQuotaAccountingState>;
  applyTokenBudgetUsage(input: ApplyTokenBudgetUsageInput): Promise<ApplyTokenBudgetUsageResult>;
  applyMediaStorageUsage(input: ApplyMediaStorageUsageInput): Promise<ApplyMediaStorageUsageResult>;
  applyKnowledgeStorageUsage(
    input: ApplyKnowledgeStorageUsageInput
  ): Promise<ApplyKnowledgeStorageUsageResult>;
  releaseMediaStorageUsage(
    input: ReleaseMediaStorageUsageInput
  ): Promise<ReleaseMediaStorageUsageResult>;
  releaseKnowledgeStorageUsage(
    input: ReleaseKnowledgeStorageUsageInput
  ): Promise<ReleaseKnowledgeStorageUsageResult>;
  refreshActiveWebChatsUsage(
    input: RefreshActiveWebChatsQuotaInput
  ): Promise<WorkspaceQuotaAccountingState>;
}
