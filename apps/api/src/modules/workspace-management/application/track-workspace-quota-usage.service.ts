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
  type ApplyMediaStorageUsageResult,
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

  return {
    tokenBudgetLimit: tokenBudgetLimit === null ? null : BigInt(tokenBudgetLimit),
    costOrTokenDrivingToolClassUnitsLimit: toolClassLimit,
    mediaStorageBytesLimit: mediaStorageLimit === null ? null : BigInt(mediaStorageLimit)
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

  async incrementToolDailyUsage(workspaceId: string, toolCode: string): Promise<number> {
    return this.toolDailyUsageRepository.incrementAndGet(workspaceId, toolCode);
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

  async consumeToolDailyLimit(params: {
    assistant: Assistant;
    toolCode: string;
    dailyCallLimit: number | null;
  }): Promise<{ allowed: boolean; currentCount: number; limit: number | null }> {
    if (params.dailyCallLimit === null || params.dailyCallLimit <= 0) {
      return {
        allowed: true,
        currentCount: 0,
        limit: null
      };
    }

    const result = await this.toolDailyUsageRepository.consumeWithinLimit(
      params.assistant.workspaceId,
      params.toolCode,
      params.dailyCallLimit
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

  private async resolveLimits(
    assistant: Assistant,
    governance: AssistantGovernance
  ): Promise<WorkspaceQuotaLimitsInput> {
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
    const planQuotaHints = parsePlanQuotaHints(
      plan?.billingProviderHints ?? null,
      plan?.entitlementModel?.limitsPermissions
    );

    return {
      tokenBudgetLimit:
        planQuotaHints.tokenBudgetLimit ?? BigInt(config.QUOTA_TOKEN_BUDGET_DEFAULT),
      costOrTokenDrivingToolClassUnitsLimit:
        planQuotaHints.costOrTokenDrivingToolClassUnitsLimit ??
        config.QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT,
      activeWebChatsLimit: config.WEB_ACTIVE_CHATS_CAP,
      mediaStorageBytesLimit:
        planQuotaHints.mediaStorageBytesLimit ?? BigInt(config.QUOTA_MEDIA_STORAGE_BYTES_DEFAULT)
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
}
