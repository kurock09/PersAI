import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type { AssistantGovernance } from "../domain/assistant-governance.entity";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";
import type { Assistant } from "../domain/assistant.entity";
import {
  type ApplyKnowledgeStorageUsageResult,
  type ApplyMediaStorageUsageResult,
  type ReleaseKnowledgeStorageUsageResult,
  type ReleaseMediaStorageUsageResult,
  WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY,
  type ApplyTokenBudgetUsageResult,
  type WorkspaceQuotaAccountingRepository,
  type WorkspaceQuotaLimitsInput
} from "../domain/workspace-quota-accounting.repository";
import {
  WORKSPACE_TOOL_DAILY_USAGE_REPOSITORY,
  type WorkspaceToolDailyUsageRepository
} from "../domain/workspace-tool-daily-usage.repository";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";

type PlanQuotaHints = {
  tokenBudgetLimit: bigint | null;
  costOrTokenDrivingToolClassUnitsLimit: number | null;
  mediaStorageBytesLimit: bigint | null;
  knowledgeStorageBytesLimit: bigint | null;
  workspaceStorageBytesLimit: bigint | null;
};

export type AssistantQuotaBucketCode =
  | "token_budget"
  | "active_web_chats"
  | "media_storage_bytes"
  | "knowledge_storage_bytes";

export type AssistantQuotaBucketUnit = "tokens" | "count" | "bytes";

export type AssistantQuotaBucketStatus = "ok" | "limit_reached" | "usage_unavailable";

export type AssistantQuotaBucketSnapshot = {
  bucketCode: AssistantQuotaBucketCode;
  displayName: string;
  unit: AssistantQuotaBucketUnit;
  used: number | null;
  limit: number | null;
  percent: number | null;
  usageAvailable: boolean;
  status: AssistantQuotaBucketStatus;
};

export type AssistantQuotaSnapshot = {
  planCode: string | null;
  buckets: AssistantQuotaBucketSnapshot[];
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function asPositiveInteger(value: unknown): number | null {
  const parsed = asInteger(value);
  return parsed === null || parsed === 0 ? null : parsed;
}

function bigintToNumber(value: bigint | null): number | null {
  return value === null ? null : Number(value);
}

function toPercent(used: number, limit: number | null): number | null {
  if (limit === null || limit <= 0) {
    return null;
  }
  const raw = Math.round((used / limit) * 100);
  return Math.max(0, Math.min(100, raw));
}

function buildQuotaBucketSnapshot(input: {
  bucketCode: AssistantQuotaBucketCode;
  displayName: string;
  unit: AssistantQuotaBucketUnit;
  used: number | null;
  limit: number | null;
  usageAvailable: boolean;
}): AssistantQuotaBucketSnapshot {
  const percent =
    input.usageAvailable && input.used !== null ? toPercent(input.used, input.limit) : null;
  const limitReached =
    input.usageAvailable &&
    input.used !== null &&
    input.limit !== null &&
    input.limit > 0 &&
    input.used >= input.limit;
  return {
    bucketCode: input.bucketCode,
    displayName: input.displayName,
    unit: input.unit,
    used: input.used,
    limit: input.limit,
    percent,
    usageAvailable: input.usageAvailable,
    status: !input.usageAvailable ? "usage_unavailable" : limitReached ? "limit_reached" : "ok"
  };
}

function readQuotaHintFromLimitsPermissions(
  limitsPermissions: unknown[] | undefined,
  key: string
): number | null {
  if (!Array.isArray(limitsPermissions)) {
    return null;
  }

  for (const item of limitsPermissions) {
    const row = asObject(item);
    if (row?.key !== key) {
      continue;
    }
    return asPositiveInteger(row.limit);
  }

  return null;
}

function parsePlanQuotaHints(
  planHints: unknown,
  limitsPermissions: unknown[] | undefined
): PlanQuotaHints {
  const objectHints = asObject(planHints);
  const quotaHints = asObject(objectHints?.quotaAccounting ?? null);
  const tokenBudgetLimit =
    asPositiveInteger(quotaHints?.tokenBudgetLimit) ??
    readQuotaHintFromLimitsPermissions(limitsPermissions, "token_budget_limit");
  const toolClassLimit =
    asPositiveInteger(quotaHints?.costOrTokenDrivingToolClassUnitsLimit) ??
    readQuotaHintFromLimitsPermissions(
      limitsPermissions,
      "cost_or_token_driving_tool_class_units_limit"
    );

  const mediaStorageLimit =
    asPositiveInteger(quotaHints?.mediaStorageBytesLimit) ??
    readQuotaHintFromLimitsPermissions(limitsPermissions, "media_storage_bytes_limit");

  const knowledgeStorageLimit =
    asPositiveInteger(quotaHints?.knowledgeStorageBytesLimit) ??
    readQuotaHintFromLimitsPermissions(limitsPermissions, "knowledge_storage_bytes_limit");

  const workspaceStorageLimit =
    asPositiveInteger(quotaHints?.workspaceStorageBytesLimit) ??
    readQuotaHintFromLimitsPermissions(limitsPermissions, "workspace_storage_bytes_limit");

  return {
    tokenBudgetLimit: tokenBudgetLimit === null ? null : BigInt(tokenBudgetLimit),
    costOrTokenDrivingToolClassUnitsLimit: toolClassLimit,
    mediaStorageBytesLimit: mediaStorageLimit === null ? null : BigInt(mediaStorageLimit),
    knowledgeStorageBytesLimit:
      knowledgeStorageLimit === null ? null : BigInt(knowledgeStorageLimit),
    workspaceStorageBytesLimit:
      workspaceStorageLimit === null ? null : BigInt(workspaceStorageLimit)
  };
}

function estimateTokens(message: string): number {
  const trimmedLength = message.trim().length;
  if (trimmedLength === 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(trimmedLength / 4));
}

@Injectable()
export class TrackWorkspaceQuotaUsageService {
  constructor(
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly assistantPlanCatalogRepository: AssistantPlanCatalogRepository,
    @Inject(WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY)
    private readonly workspaceQuotaAccountingRepository: WorkspaceQuotaAccountingRepository,
    @Inject(WORKSPACE_TOOL_DAILY_USAGE_REPOSITORY)
    private readonly toolDailyUsageRepository: WorkspaceToolDailyUsageRepository,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService
  ) {}

  private static readonly TOKEN_USAGE_ESTIMATOR = "chars_div_4_ceil_v1";

  async recordInboundTurnUsage(params: {
    assistant: Assistant;
    userContent: string;
    assistantContent: string;
    source:
      | "web_chat_turn_sync"
      | "web_chat_turn_stream_completed"
      | "web_chat_turn_stream_partial"
      | "telegram_turn_sync"
      | "reminder_callback_delivery";
  }): Promise<void> {
    const governance = await this.resolveGovernance(params.assistant.id);
    const limits = await this.resolveLimits(params.assistant, governance);

    const tokenDelta = BigInt(
      estimateTokens(params.userContent) + estimateTokens(params.assistantContent)
    );
    if (tokenDelta > BigInt(0)) {
      const applied = await this.workspaceQuotaAccountingRepository.applyTokenBudgetUsage({
        workspaceId: params.assistant.workspaceId,
        assistantId: params.assistant.id,
        userId: params.assistant.userId,
        delta: tokenDelta,
        source: params.source,
        metadata: {
          estimator: TrackWorkspaceQuotaUsageService.TOKEN_USAGE_ESTIMATOR
        },
        limits
      });
      this.logTokenBudgetCapIfNeeded(params.assistant.id, params.source, tokenDelta, applied);
    }
  }

  async recordWebChatTurnUsage(params: {
    assistant: Assistant;
    userContent: string;
    assistantContent: string;
    source:
      | "web_chat_turn_sync"
      | "web_chat_turn_stream_completed"
      | "web_chat_turn_stream_partial";
  }): Promise<void> {
    await this.recordInboundTurnUsage(params);
  }

  async refreshActiveWebChatsUsage(params: {
    assistant: Assistant;
    activeWebChatsCurrent: number;
    source: "web_chat_turn_prepare" | "web_chat_archive" | "web_chat_hard_delete";
  }): Promise<void> {
    const governance = await this.resolveGovernance(params.assistant.id);
    const limits = await this.resolveLimits(params.assistant, governance);

    await this.workspaceQuotaAccountingRepository.refreshActiveWebChatsUsage({
      workspaceId: params.assistant.workspaceId,
      assistantId: params.assistant.id,
      userId: params.assistant.userId,
      currentActiveWebChats: params.activeWebChatsCurrent,
      source: params.source,
      limits
    });
  }

  async checkToolDailyLimit(params: {
    workspaceId: string;
    toolCode: string;
    dailyCallLimit: number | null;
  }): Promise<{ allowed: boolean; currentCount: number; limit: number | null }> {
    if (params.dailyCallLimit === null || params.dailyCallLimit <= 0) {
      return { allowed: true, currentCount: 0, limit: null };
    }
    const today = new Date();
    const dateOnly = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    );
    const currentCount = await this.toolDailyUsageRepository.getUsageForDate(
      params.workspaceId,
      params.toolCode,
      dateOnly
    );
    return {
      allowed: currentCount < params.dailyCallLimit,
      currentCount,
      limit: params.dailyCallLimit
    };
  }

  async incrementToolDailyUsage(workspaceId: string, toolCode: string, units = 1): Promise<number> {
    return this.toolDailyUsageRepository.incrementAndGet(workspaceId, toolCode, units);
  }

  async checkMediaStorageQuota(assistant: Assistant): Promise<{
    allowed: boolean;
    usedBytes: bigint;
    limitBytes: bigint | null;
  }> {
    const governance = await this.resolveGovernance(assistant.id);
    const limits = await this.resolveLimits(assistant, governance);
    const state = await this.workspaceQuotaAccountingRepository.findByWorkspaceId(
      assistant.workspaceId
    );
    const usedBytes = state?.mediaStorageBytesUsed ?? BigInt(0);
    const limitBytes = limits.mediaStorageBytesLimit;
    if (limitBytes !== null && usedBytes >= limitBytes) {
      return { allowed: false, usedBytes, limitBytes };
    }
    return { allowed: true, usedBytes, limitBytes };
  }

  async checkKnowledgeStorageQuota(assistant: Assistant): Promise<{
    allowed: boolean;
    usedBytes: bigint;
    limitBytes: bigint | null;
  }> {
    const governance = await this.resolveGovernance(assistant.id);
    const limits = await this.resolveLimits(assistant, governance);
    const state = await this.workspaceQuotaAccountingRepository.findByWorkspaceId(
      assistant.workspaceId
    );
    const usedBytes = state?.knowledgeStorageBytesUsed ?? BigInt(0);
    const limitBytes = limits.knowledgeStorageBytesLimit;
    if (limitBytes !== null && usedBytes >= limitBytes) {
      return { allowed: false, usedBytes, limitBytes };
    }
    return { allowed: true, usedBytes, limitBytes };
  }

  async checkWorkspaceKnowledgeStorageQuota(params: {
    workspaceId: string;
    userId: string;
  }): Promise<{
    allowed: boolean;
    usedBytes: bigint;
    limitBytes: bigint | null;
  }> {
    const limits = await this.resolveWorkspaceLimits(params.workspaceId, params.userId);
    const state = await this.workspaceQuotaAccountingRepository.findByWorkspaceId(
      params.workspaceId
    );
    const usedBytes = state?.knowledgeStorageBytesUsed ?? BigInt(0);
    const limitBytes = limits.knowledgeStorageBytesLimit;
    if (limitBytes !== null && usedBytes >= limitBytes) {
      return { allowed: false, usedBytes, limitBytes };
    }
    return { allowed: true, usedBytes, limitBytes };
  }

  async recordMediaUpload(params: {
    assistant: Assistant;
    sizeBytes: bigint;
    source: string;
  }): Promise<ApplyMediaStorageUsageResult> {
    if (params.sizeBytes <= BigInt(0)) {
      return {
        appliedDelta: BigInt(0),
        capped: false,
        state: {
          id: "noop",
          workspaceId: params.assistant.workspaceId,
          tokenBudgetUsed: BigInt(0),
          tokenBudgetLimit: null,
          costOrTokenDrivingToolClassUnitsUsed: 0,
          costOrTokenDrivingToolClassUnitsLimit: null,
          activeWebChatsCurrent: 0,
          activeWebChatsLimit: null,
          mediaStorageBytesUsed: BigInt(0),
          mediaStorageBytesLimit: null,
          knowledgeStorageBytesUsed: BigInt(0),
          knowledgeStorageBytesLimit: null,
          lastComputedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        }
      };
    }
    const governance = await this.resolveGovernance(params.assistant.id);
    const limits = await this.resolveLimits(params.assistant, governance);
    const applied = await this.workspaceQuotaAccountingRepository.applyMediaStorageUsage({
      workspaceId: params.assistant.workspaceId,
      assistantId: params.assistant.id,
      userId: params.assistant.userId,
      delta: params.sizeBytes,
      source: params.source,
      metadata: null,
      limits
    });
    this.logMediaStorageCapIfNeeded(params.assistant.id, params.source, params.sizeBytes, applied);
    return applied;
  }

  async recordKnowledgeStorageUpload(params: {
    assistant: Assistant;
    sizeBytes: bigint;
    source: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<ApplyKnowledgeStorageUsageResult> {
    if (params.sizeBytes <= BigInt(0)) {
      return {
        appliedDelta: BigInt(0),
        capped: false,
        state: {
          id: "noop",
          workspaceId: params.assistant.workspaceId,
          tokenBudgetUsed: BigInt(0),
          tokenBudgetLimit: null,
          costOrTokenDrivingToolClassUnitsUsed: 0,
          costOrTokenDrivingToolClassUnitsLimit: null,
          activeWebChatsCurrent: 0,
          activeWebChatsLimit: null,
          mediaStorageBytesUsed: BigInt(0),
          mediaStorageBytesLimit: null,
          knowledgeStorageBytesUsed: BigInt(0),
          knowledgeStorageBytesLimit: null,
          lastComputedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        }
      };
    }
    const governance = await this.resolveGovernance(params.assistant.id);
    const limits = await this.resolveLimits(params.assistant, governance);
    const applied = await this.workspaceQuotaAccountingRepository.applyKnowledgeStorageUsage({
      workspaceId: params.assistant.workspaceId,
      assistantId: params.assistant.id,
      userId: params.assistant.userId,
      delta: params.sizeBytes,
      source: params.source,
      metadata: params.metadata ?? null,
      limits
    });
    this.logKnowledgeStorageCapIfNeeded(
      params.assistant.id,
      params.source,
      params.sizeBytes,
      applied
    );
    return applied;
  }

  async recordWorkspaceKnowledgeStorageUpload(params: {
    workspaceId: string;
    userId: string;
    sizeBytes: bigint;
    source: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<ApplyKnowledgeStorageUsageResult> {
    if (params.sizeBytes <= BigInt(0)) {
      return {
        appliedDelta: BigInt(0),
        capped: false,
        state: this.buildNoopQuotaState(params.workspaceId)
      };
    }
    const limits = await this.resolveWorkspaceLimits(params.workspaceId, params.userId);
    return this.workspaceQuotaAccountingRepository.applyKnowledgeStorageUsage({
      workspaceId: params.workspaceId,
      assistantId: null,
      userId: params.userId,
      delta: params.sizeBytes,
      source: params.source,
      metadata: params.metadata ?? null,
      limits
    });
  }

  async releaseMediaStorage(params: {
    assistant: Assistant;
    sizeBytes: bigint;
    source: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<ReleaseMediaStorageUsageResult> {
    if (params.sizeBytes <= BigInt(0)) {
      return {
        releasedDelta: BigInt(0),
        state: {
          id: "noop",
          workspaceId: params.assistant.workspaceId,
          tokenBudgetUsed: BigInt(0),
          tokenBudgetLimit: null,
          costOrTokenDrivingToolClassUnitsUsed: 0,
          costOrTokenDrivingToolClassUnitsLimit: null,
          activeWebChatsCurrent: 0,
          activeWebChatsLimit: null,
          mediaStorageBytesUsed: BigInt(0),
          mediaStorageBytesLimit: null,
          knowledgeStorageBytesUsed: BigInt(0),
          knowledgeStorageBytesLimit: null,
          lastComputedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        }
      };
    }

    const governance = await this.resolveGovernance(params.assistant.id);
    const limits = await this.resolveLimits(params.assistant, governance);
    return this.workspaceQuotaAccountingRepository.releaseMediaStorageUsage({
      workspaceId: params.assistant.workspaceId,
      assistantId: params.assistant.id,
      userId: params.assistant.userId,
      delta: params.sizeBytes,
      source: params.source,
      metadata: params.metadata ?? null,
      limits
    });
  }

  async releaseKnowledgeStorage(params: {
    assistant: Assistant;
    sizeBytes: bigint;
    source: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<ReleaseKnowledgeStorageUsageResult> {
    if (params.sizeBytes <= BigInt(0)) {
      return {
        releasedDelta: BigInt(0),
        state: {
          id: "noop",
          workspaceId: params.assistant.workspaceId,
          tokenBudgetUsed: BigInt(0),
          tokenBudgetLimit: null,
          costOrTokenDrivingToolClassUnitsUsed: 0,
          costOrTokenDrivingToolClassUnitsLimit: null,
          activeWebChatsCurrent: 0,
          activeWebChatsLimit: null,
          mediaStorageBytesUsed: BigInt(0),
          mediaStorageBytesLimit: null,
          knowledgeStorageBytesUsed: BigInt(0),
          knowledgeStorageBytesLimit: null,
          lastComputedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        }
      };
    }

    const governance = await this.resolveGovernance(params.assistant.id);
    const limits = await this.resolveLimits(params.assistant, governance);
    return this.workspaceQuotaAccountingRepository.releaseKnowledgeStorageUsage({
      workspaceId: params.assistant.workspaceId,
      assistantId: params.assistant.id,
      userId: params.assistant.userId,
      delta: params.sizeBytes,
      source: params.source,
      metadata: params.metadata ?? null,
      limits
    });
  }

  async releaseWorkspaceKnowledgeStorage(params: {
    workspaceId: string;
    userId: string;
    sizeBytes: bigint;
    source: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<ReleaseKnowledgeStorageUsageResult> {
    if (params.sizeBytes <= BigInt(0)) {
      return {
        releasedDelta: BigInt(0),
        state: this.buildNoopQuotaState(params.workspaceId)
      };
    }
    const limits = await this.resolveWorkspaceLimits(params.workspaceId, params.userId);
    return this.workspaceQuotaAccountingRepository.releaseKnowledgeStorageUsage({
      workspaceId: params.workspaceId,
      assistantId: null,
      userId: params.userId,
      delta: params.sizeBytes,
      source: params.source,
      metadata: params.metadata ?? null,
      limits
    });
  }

  async consumeToolDailyLimit(params: {
    assistant: Assistant;
    toolCode: string;
    dailyCallLimit: number | null;
    units?: number;
  }): Promise<{ allowed: boolean; currentCount: number; limit: number | null }> {
    const units = params.units ?? 1;
    // ADR-074 L1.1 — observability anchor. Even when no daily cap is
    // configured, we still increment `tool_daily_usage` so the founder
    // dashboard, the smoke harness, and the GKE log stream can answer
    // "how many tts/image_generate/etc. did this assistant fire today?"
    // Without this, blank-cap tools were biller-visible (provider charged
    // us) but counter-invisible — exactly the second hole called out in
    // the L1.1 audit. The increment is a single atomic upsert, no
    // serializable transaction required.
    if (params.dailyCallLimit === null || params.dailyCallLimit <= 0) {
      const currentCount = await this.toolDailyUsageRepository.incrementAndGet(
        params.assistant.workspaceId,
        params.toolCode,
        units
      );
      return {
        allowed: true,
        currentCount,
        limit: null
      };
    }

    const result = await this.toolDailyUsageRepository.consumeWithinLimit(
      params.assistant.workspaceId,
      params.toolCode,
      params.dailyCallLimit,
      units
    );
    return {
      allowed: result.allowed,
      currentCount: result.currentCount,
      limit: params.dailyCallLimit
    };
  }

  private async resolveGovernance(assistantId: string): Promise<AssistantGovernance> {
    const governance = await this.assistantGovernanceRepository.findByAssistantId(assistantId);
    if (governance === null) {
      throw new NotFoundException("Assistant governance does not exist for this assistant.");
    }
    return governance;
  }

  /**
   * Live plan-derived limits (subscription + catalog), same source as increment/refresh paths.
   * Abuse quota-pressure and UI should use this instead of snapshot columns on
   * `workspace_quota_accounting_state`, which can lag until a turn passes enforcement.
   */
  async resolveEffectiveLimitsForAssistant(
    assistant: Assistant
  ): Promise<WorkspaceQuotaLimitsInput> {
    const governance = await this.resolveGovernance(assistant.id);
    return this.resolveLimits(assistant, governance);
  }

  async resolveAssistantQuotaSnapshot(assistant: Assistant): Promise<AssistantQuotaSnapshot> {
    const governance = await this.resolveGovernance(assistant.id);
    const quotaContext = await this.resolveQuotaContext(assistant, governance);
    const quotaState = await this.workspaceQuotaAccountingRepository.findByWorkspaceId(
      assistant.workspaceId
    );
    const limits = this.buildWorkspaceQuotaLimits(quotaContext.config, quotaContext.planQuotaHints);

    return {
      planCode: quotaContext.effectiveSubscription.planCode,
      buckets: [
        buildQuotaBucketSnapshot({
          bucketCode: "token_budget",
          displayName: "Token budget",
          unit: "tokens",
          used: bigintToNumber(quotaState?.tokenBudgetUsed ?? BigInt(0)),
          limit: bigintToNumber(limits.tokenBudgetLimit),
          usageAvailable: true
        }),
        buildQuotaBucketSnapshot({
          bucketCode: "active_web_chats",
          displayName: "Active web chats",
          unit: "count",
          used: quotaState?.activeWebChatsCurrent ?? 0,
          limit: limits.activeWebChatsLimit,
          usageAvailable: true
        }),
        buildQuotaBucketSnapshot({
          bucketCode: "media_storage_bytes",
          displayName: "Media storage",
          unit: "bytes",
          used: bigintToNumber(quotaState?.mediaStorageBytesUsed ?? BigInt(0)),
          limit: bigintToNumber(limits.mediaStorageBytesLimit),
          usageAvailable: true
        }),
        buildQuotaBucketSnapshot({
          bucketCode: "knowledge_storage_bytes",
          displayName: "Knowledge storage",
          unit: "bytes",
          used: bigintToNumber(quotaState?.knowledgeStorageBytesUsed ?? BigInt(0)),
          limit: bigintToNumber(limits.knowledgeStorageBytesLimit),
          usageAvailable: true
        })
      ]
    };
  }

  async resolveWorkspaceStorageLimit(assistant: Assistant): Promise<{ limitBytes: bigint | null }> {
    const governance = await this.resolveGovernance(assistant.id);
    const { config, planQuotaHints } = await this.resolveQuotaContext(assistant, governance);
    const limitBytes =
      planQuotaHints.workspaceStorageBytesLimit ??
      BigInt(config.QUOTA_WORKSPACE_STORAGE_BYTES_DEFAULT);
    return { limitBytes };
  }

  private async resolveLimits(
    assistant: Assistant,
    governance: AssistantGovernance
  ): Promise<WorkspaceQuotaLimitsInput> {
    const { config, planQuotaHints } = await this.resolveQuotaContext(assistant, governance);
    return this.buildWorkspaceQuotaLimits(config, planQuotaHints);
  }

  private async resolveQuotaContext(
    assistant: Assistant,
    governance: AssistantGovernance
  ): Promise<{
    config: ReturnType<typeof loadApiConfig>;
    effectiveSubscription: Awaited<ReturnType<ResolveEffectiveSubscriptionStateService["execute"]>>;
    planQuotaHints: PlanQuotaHints;
  }> {
    const config = loadApiConfig(process.env);
    const effectiveSubscription = await this.resolveEffectiveSubscriptionStateService.execute({
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      assistantPlanOverrideCode: governance.assistantPlanOverrideCode,
      assistantQuotaPlanCode: governance.quotaPlanCode
    });
    const plan =
      effectiveSubscription.planCode === null
        ? null
        : await this.assistantPlanCatalogRepository.findByCode(effectiveSubscription.planCode);
    return {
      config,
      effectiveSubscription,
      planQuotaHints: parsePlanQuotaHints(
        plan?.billingProviderHints ?? null,
        plan?.entitlementModel?.limitsPermissions
      )
    };
  }

  private async resolveWorkspaceLimits(
    workspaceId: string,
    userId: string
  ): Promise<WorkspaceQuotaLimitsInput> {
    const config = loadApiConfig(process.env);
    const effectiveSubscription = await this.resolveEffectiveSubscriptionStateService.execute({
      userId,
      workspaceId,
      assistantId: "workspace-global-knowledge",
      assistantPlanOverrideCode: null,
      assistantQuotaPlanCode: null
    });
    const plan =
      effectiveSubscription.planCode === null
        ? null
        : await this.assistantPlanCatalogRepository.findByCode(effectiveSubscription.planCode);
    return this.buildWorkspaceQuotaLimits(
      config,
      parsePlanQuotaHints(
        plan?.billingProviderHints ?? null,
        plan?.entitlementModel?.limitsPermissions
      )
    );
  }

  private buildNoopQuotaState(workspaceId: string) {
    return {
      id: "noop",
      workspaceId,
      tokenBudgetUsed: BigInt(0),
      tokenBudgetLimit: null,
      costOrTokenDrivingToolClassUnitsUsed: 0,
      costOrTokenDrivingToolClassUnitsLimit: null,
      activeWebChatsCurrent: 0,
      activeWebChatsLimit: null,
      mediaStorageBytesUsed: BigInt(0),
      mediaStorageBytesLimit: null,
      knowledgeStorageBytesUsed: BigInt(0),
      knowledgeStorageBytesLimit: null,
      lastComputedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  private buildWorkspaceQuotaLimits(
    config: ReturnType<typeof loadApiConfig>,
    planQuotaHints: PlanQuotaHints
  ): WorkspaceQuotaLimitsInput {
    return {
      tokenBudgetLimit:
        planQuotaHints.tokenBudgetLimit ?? BigInt(config.QUOTA_TOKEN_BUDGET_DEFAULT),
      costOrTokenDrivingToolClassUnitsLimit:
        planQuotaHints.costOrTokenDrivingToolClassUnitsLimit ??
        config.QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT,
      activeWebChatsLimit: config.WEB_ACTIVE_CHATS_CAP,
      mediaStorageBytesLimit:
        planQuotaHints.mediaStorageBytesLimit ?? BigInt(config.QUOTA_MEDIA_STORAGE_BYTES_DEFAULT),
      knowledgeStorageBytesLimit:
        planQuotaHints.knowledgeStorageBytesLimit ??
        BigInt(config.QUOTA_KNOWLEDGE_STORAGE_BYTES_DEFAULT)
    };
  }

  private logTokenBudgetCapIfNeeded(
    assistantId: string,
    source: string,
    requestedDelta: bigint,
    applied: ApplyTokenBudgetUsageResult
  ): void {
    if (!applied.capped) {
      return;
    }

    console.warn(
      `[quota] token budget capped for assistant ${assistantId} on ${source}: requested=${requestedDelta.toString()} applied=${applied.appliedDelta.toString()}`
    );
  }

  private logMediaStorageCapIfNeeded(
    assistantId: string,
    source: string,
    requestedDelta: bigint,
    applied: ApplyMediaStorageUsageResult
  ): void {
    if (!applied.capped) {
      return;
    }

    console.warn(
      `[quota] media storage capped for assistant ${assistantId} on ${source}: requested=${requestedDelta.toString()} applied=${applied.appliedDelta.toString()}`
    );
  }

  private logKnowledgeStorageCapIfNeeded(
    assistantId: string,
    source: string,
    requestedDelta: bigint,
    applied: ApplyKnowledgeStorageUsageResult
  ): void {
    if (!applied.capped) {
      return;
    }

    console.warn(
      `[quota] knowledge storage capped for assistant ${assistantId} on ${source}: requested=${requestedDelta.toString()} applied=${applied.appliedDelta.toString()}`
    );
  }
}
