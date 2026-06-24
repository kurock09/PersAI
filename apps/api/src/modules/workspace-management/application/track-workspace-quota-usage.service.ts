import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { loadApiConfig } from "@persai/config";
import type { RuntimeUsageAccounting, RuntimeUsageAccountingEntry } from "@persai/runtime-contract";
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
  type WorkspaceQuotaLimitsInput,
  type WorkspaceMonthlyToolQuotaToolCode
} from "../domain/workspace-quota-accounting.repository";
import {
  WORKSPACE_TOOL_DAILY_USAGE_REPOSITORY,
  type WorkspaceToolDailyUsageRepository
} from "../domain/workspace-tool-daily-usage.repository";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "./resolve-platform-runtime-provider-settings.service";
import {
  DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
  findRuntimeProviderCatalogProfile,
  type ManagedRuntimeProvider,
  type RuntimeProviderModelProfile
} from "./runtime-provider-profile";
import { resolveRecurringQuotaPeriod, type RecurringQuotaPeriod } from "./recurring-quota-period";
import { ManageMediaPackagePurchaseService } from "./manage-media-package-purchase.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

/**
 * ADR-108 Slice 8 — `videoGenerateMonthlyUnitsLimit` was removed from
 * the plan-side hints once `video_generate` switched to the VC wallet
 * as its sole user-facing accounting surface. Plan rows that still
 * carry the legacy hint are tolerated by the parser (the field is
 * silently ignored); the matching cleanup migration strips it from the
 * stored `billing_provider_hints` JSON.
 */
type PlanQuotaHints = {
  tokenBudgetLimit: bigint | null;
  costOrTokenDrivingToolClassUnitsLimit: number | null;
  activeWebChatsLimit: number | null;
  messagesPerChat: number | null;
  imageGenerateMonthlyUnitsLimit: number | null;
  imageEditMonthlyUnitsLimit: number | null;
  documentMonthlyUnitsLimit: number | null;
  mediaStorageBytesLimit: bigint | null;
  knowledgeStorageBytesLimit: bigint | null;
  workspaceStorageBytesLimit: bigint | null;
  sharedStorageBytesLimit: bigint | null;
};

type TokenBudgetUsageCalculation = {
  delta: bigint;
  metadata: Record<string, unknown>;
};

type RuntimeUsageEntryAccountingMetadata = {
  stepType: string;
  modelRole: string | null;
  providerKey: string | null;
  modelKey: string | null;
  inputTokens: number;
  cacheCreationInputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  billableInputTokens: number;
  inputTokenWeight: number;
  cacheCreationInputTokenWeight: number;
  cachedInputTokenWeight: number;
  outputTokenWeight: number;
  weightedCredits: number;
  profileMatched: boolean;
};

export type AssistantQuotaBucketCode =
  | "token_budget"
  | "active_web_chats"
  | "media_storage_bytes"
  | "knowledge_storage_bytes"
  | "workspace_storage_bytes";

export type AssistantQuotaBucketUnit = "tokens" | "count" | "bytes";

export type AssistantQuotaBucketStatus = "ok" | "limit_reached" | "usage_unavailable";

export const QUOTA_ADVISORY_WARNING_THRESHOLD_PERCENT = 90;

export type AssistantQuotaBucketSnapshot = {
  bucketCode: AssistantQuotaBucketCode;
  displayName: string;
  unit: AssistantQuotaBucketUnit;
  used: number | null;
  limit: number | null;
  percent: number | null;
  finiteLimit: boolean;
  usageAvailable: boolean;
  warningThresholdPercent: number | null;
  warningThresholdReached: boolean;
  status: AssistantQuotaBucketStatus;
};

export type AssistantQuotaSnapshot = {
  planCode: string | null;
  buckets: AssistantQuotaBucketSnapshot[];
};

export type AssistantTokenBudgetQuotaSnapshot = {
  usedCredits: bigint;
  limitCredits: bigint | null;
  periodStartedAt: string;
  periodEndsAt: string;
  periodSource: RecurringQuotaPeriod["periodSource"];
};

type GraceQuotaPlanOverride = {
  currentPeriodStartedAt: string | null;
  currentPeriodEndsAt: string | null;
};

export type AssistantMonthlyToolQuotaToolSnapshot = {
  toolCode: WorkspaceMonthlyToolQuotaToolCode;
  displayName: string;
  usedUnits: number;
  reservedUnits: number;
  settledUnits: number;
  releasedUnits: number;
  reconciliationRequiredUnits: number;
  /** Base limit from the active plan (null = unlimited). */
  limitUnits: number | null;
  /** Bonus units from active package grants for this period (0 if none purchased). */
  bonusLimitUnits: number;
  /** Effective limit = base + bonus, or null when base is null (unlimited). */
  effectiveLimitUnits: number | null;
  /** Latest periodEndsAt from active grants, if any. ISO string or null. */
  bonusExpiresAt: string | null;
  remainingUnits: number | null;
  percent: number | null;
  finiteLimit: boolean;
  usageAvailable: boolean;
  warningThresholdPercent: number | null;
  warningThresholdReached: boolean;
  status: "ok" | "limit_reached" | "usage_unavailable";
};

export type AssistantMonthlyToolQuotaSnapshot = {
  planCode: string | null;
  periodStartedAt: string;
  periodEndsAt: string;
  periodSource: "subscription_period" | "calendar_month_fallback";
  tools: AssistantMonthlyToolQuotaToolSnapshot[];
};

export type ReserveAssistantMonthlyMediaQuotaResult = {
  allowed: boolean;
  currentUsedUnits: number;
  limitUnits: number | null;
  periodStartedAt: string;
  periodEndsAt: string;
  periodSource: AssistantMonthlyToolQuotaSnapshot["periodSource"];
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
  const finiteLimit = input.limit !== null && input.limit > 0;
  const limitReached =
    input.usageAvailable &&
    input.used !== null &&
    input.limit !== null &&
    input.limit > 0 &&
    input.used >= input.limit;
  const warningThresholdReached =
    input.usageAvailable &&
    finiteLimit &&
    percent !== null &&
    percent >= QUOTA_ADVISORY_WARNING_THRESHOLD_PERCENT;
  return {
    bucketCode: input.bucketCode,
    displayName: input.displayName,
    unit: input.unit,
    used: input.used,
    limit: input.limit,
    percent,
    finiteLimit,
    usageAvailable: input.usageAvailable,
    warningThresholdPercent: finiteLimit ? QUOTA_ADVISORY_WARNING_THRESHOLD_PERCENT : null,
    warningThresholdReached,
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

  const activeWebChatsLimit =
    asInteger(quotaHints?.activeWebChatsLimit) ??
    readQuotaHintFromLimitsPermissions(limitsPermissions, "active_web_chats_limit");

  const messagesPerChat = asInteger(quotaHints?.messagesPerChat);

  const imageGenerateMonthlyUnitsLimit =
    asPositiveInteger(quotaHints?.imageGenerateMonthlyUnitsLimit) ??
    readQuotaHintFromLimitsPermissions(limitsPermissions, "image_generate_monthly_units_limit");

  const imageEditMonthlyUnitsLimit =
    asPositiveInteger(quotaHints?.imageEditMonthlyUnitsLimit) ??
    readQuotaHintFromLimitsPermissions(limitsPermissions, "image_edit_monthly_units_limit");

  // ADR-108 Slice 8 — `videoGenerateMonthlyUnitsLimit` and the matching
  // `video_generate_monthly_units_limit` permission row are intentionally
  // not parsed: video_generate is VC-priced and gates on the wallet.

  const documentMonthlyUnitsLimit =
    asPositiveInteger(quotaHints?.documentMonthlyUnitsLimit) ??
    readQuotaHintFromLimitsPermissions(limitsPermissions, "document_monthly_units_limit");

  const mediaStorageLimit =
    asPositiveInteger(quotaHints?.mediaStorageBytesLimit) ??
    readQuotaHintFromLimitsPermissions(limitsPermissions, "media_storage_bytes_limit");

  const knowledgeStorageLimit =
    asPositiveInteger(quotaHints?.knowledgeStorageBytesLimit) ??
    readQuotaHintFromLimitsPermissions(limitsPermissions, "knowledge_storage_bytes_limit");

  const workspaceStorageLimit =
    asPositiveInteger(quotaHints?.workspaceStorageBytesLimit) ??
    readQuotaHintFromLimitsPermissions(limitsPermissions, "workspace_storage_bytes_limit");

  const sharedStorageLimit =
    asPositiveInteger(quotaHints?.sharedStorageBytesLimit) ??
    readQuotaHintFromLimitsPermissions(limitsPermissions, "shared_storage_bytes_limit");

  return {
    tokenBudgetLimit: tokenBudgetLimit === null ? null : BigInt(tokenBudgetLimit),
    costOrTokenDrivingToolClassUnitsLimit: toolClassLimit,
    activeWebChatsLimit,
    messagesPerChat,
    imageGenerateMonthlyUnitsLimit,
    imageEditMonthlyUnitsLimit,
    documentMonthlyUnitsLimit,
    mediaStorageBytesLimit: mediaStorageLimit === null ? null : BigInt(mediaStorageLimit),
    knowledgeStorageBytesLimit:
      knowledgeStorageLimit === null ? null : BigInt(knowledgeStorageLimit),
    workspaceStorageBytesLimit:
      workspaceStorageLimit === null ? null : BigInt(workspaceStorageLimit),
    sharedStorageBytesLimit: sharedStorageLimit === null ? null : BigInt(sharedStorageLimit)
  };
}

function estimateTokens(message: string): number {
  const trimmedLength = message.trim().length;
  if (trimmedLength === 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(trimmedLength / 4));
}

function asNonNegativeInteger(value: number | null | undefined): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 0;
}

function normalizeManagedProvider(value: string | null): ManagedRuntimeProvider | null {
  return value === "openai" || value === "anthropic" || value === "deepseek" ? value : null;
}

function defaultTokenWeights(): Pick<
  RuntimeProviderModelProfile,
  "inputTokenWeight" | "cachedInputTokenWeight" | "outputTokenWeight"
> {
  return {
    inputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
    cachedInputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
    outputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT
  };
}

function resolveCacheCreationInputTokenWeight(profile: RuntimeProviderModelProfile | null): number {
  if (profile === null || profile.billingMode !== "token_metered") {
    return DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT;
  }
  const configured = profile.providerPriceMetadata.tokenPricing.cacheCreationInputPer1M;
  return configured > 0 ? configured : profile.inputTokenWeight;
}

/**
 * ADR-108 Slice 8 — `video_generate` is VC-priced and has no plan-side
 * unit limit, so its `limitKey` is `null`. Consumers that index
 * `planQuotaHints` must guard the null case and treat it as
 * "unlimited / not unit-tracked"; the VC wallet is the actual gate.
 *
 * `packageBonusEligible` for `video_generate` stays `true` because
 * the `WorkspaceMediaPackagePurchase` lookup path is still routed
 * through this list, but the resolved bonus units are NOT consulted
 * by the VC wallet — VC packages credit `WorkspaceVcoinBalance`
 * directly via `manage-media-package-purchase.service.ts`.
 */
const MONTHLY_TOOL_QUOTA_TOOLS: Array<{
  toolCode: WorkspaceMonthlyToolQuotaToolCode;
  displayName: string;
  limitKey:
    | "imageGenerateMonthlyUnitsLimit"
    | "imageEditMonthlyUnitsLimit"
    | "documentMonthlyUnitsLimit"
    | null;
  packageBonusEligible: boolean;
}> = [
  {
    toolCode: "image_generate",
    displayName: "Image generation",
    limitKey: "imageGenerateMonthlyUnitsLimit",
    packageBonusEligible: true
  },
  {
    toolCode: "image_edit",
    displayName: "Image editing",
    limitKey: "imageEditMonthlyUnitsLimit",
    packageBonusEligible: true
  },
  {
    toolCode: "video_generate",
    displayName: "Video generation",
    limitKey: null,
    packageBonusEligible: true
  },
  {
    toolCode: "document",
    displayName: "Document generation",
    limitKey: "documentMonthlyUnitsLimit",
    packageBonusEligible: true
  }
];

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
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService,
    private readonly manageMediaPackagePurchaseService: ManageMediaPackagePurchaseService
  ) {}

  private static readonly TOKEN_USAGE_ESTIMATOR = "chars_div_4_ceil_v1";
  private static readonly RUNTIME_USAGE_ACCOUNTING = "runtime_usage_accounting_weighted_v1";

  async recordInboundTurnUsage(params: {
    assistant: Assistant;
    userContent: string;
    assistantContent: string;
    usageAccounting?: RuntimeUsageAccounting;
    source:
      | "web_chat_turn_sync"
      | "web_chat_turn_stream_completed"
      | "web_chat_turn_stream_partial"
      | "telegram_turn_sync"
      | "reminder_callback_delivery";
  }): Promise<void> {
    const governance = await this.resolveGovernance(params.assistant.id);
    const quotaContext = await this.resolveQuotaContext(params.assistant, governance);
    const limits = this.buildWorkspaceQuotaLimits(quotaContext.config, quotaContext.planQuotaHints);
    const period = resolveRecurringQuotaPeriod(quotaContext.effectiveSubscription);
    const tokenUsage = await this.resolveTokenBudgetUsage({
      userContent: params.userContent,
      assistantContent: params.assistantContent,
      ...(params.usageAccounting === undefined ? {} : { usageAccounting: params.usageAccounting })
    });

    if (tokenUsage.delta > BigInt(0)) {
      const applied = await this.workspaceQuotaAccountingRepository.applyTokenBudgetUsage({
        workspaceId: params.assistant.workspaceId,
        assistantId: params.assistant.id,
        userId: params.assistant.userId,
        periodStartedAt: period.periodStartedAt,
        periodEndsAt: period.periodEndsAt,
        delta: tokenUsage.delta,
        source: params.source,
        metadata: {
          ...tokenUsage.metadata,
          periodSource: period.periodSource
        },
        limits
      });
      this.logTokenBudgetCapIfNeeded(params.assistant.id, params.source, tokenUsage.delta, applied);
    }
  }

  async recordWebChatTurnUsage(params: {
    assistant: Assistant;
    userContent: string;
    assistantContent: string;
    usageAccounting?: RuntimeUsageAccounting;
    source:
      | "web_chat_turn_sync"
      | "web_chat_turn_stream_completed"
      | "web_chat_turn_stream_partial";
  }): Promise<void> {
    await this.recordInboundTurnUsage(params);
  }

  private async resolveTokenBudgetUsage(params: {
    userContent: string;
    assistantContent: string;
    usageAccounting?: RuntimeUsageAccounting;
  }): Promise<TokenBudgetUsageCalculation> {
    if (params.usageAccounting?.entries && params.usageAccounting.entries.length > 0) {
      return this.resolveWeightedRuntimeTokenUsage(params.usageAccounting);
    }

    const estimatedTokens =
      estimateTokens(params.userContent) + estimateTokens(params.assistantContent);
    return {
      delta: BigInt(estimatedTokens),
      metadata: {
        estimator: TrackWorkspaceQuotaUsageService.TOKEN_USAGE_ESTIMATOR,
        accounting: "estimator_fallback"
      }
    };
  }

  private async resolveWeightedRuntimeTokenUsage(
    usageAccounting: RuntimeUsageAccounting
  ): Promise<TokenBudgetUsageCalculation> {
    const runtimeProviderSettings =
      await this.resolvePlatformRuntimeProviderSettingsService.execute();
    const entryMetadata: RuntimeUsageEntryAccountingMetadata[] = [];
    let weightedCredits = 0;
    let inputTokens = 0;
    let cacheCreationInputTokens = 0;
    let cachedInputTokens = 0;
    let outputTokens = 0;
    let unmatchedProfileCount = 0;

    for (const entry of usageAccounting.entries) {
      const accounted = this.resolveWeightedRuntimeUsageEntry(entry, runtimeProviderSettings);
      weightedCredits += accounted.weightedCredits;
      inputTokens += accounted.inputTokens;
      cacheCreationInputTokens += accounted.cacheCreationInputTokens;
      cachedInputTokens += accounted.cachedInputTokens;
      outputTokens += accounted.outputTokens;
      if (!accounted.profileMatched) {
        unmatchedProfileCount += 1;
      }
      entryMetadata.push(accounted);
    }

    return {
      delta: BigInt(Math.ceil(weightedCredits)),
      metadata: {
        accounting: TrackWorkspaceQuotaUsageService.RUNTIME_USAGE_ACCOUNTING,
        inputTokens,
        cacheCreationInputTokens,
        cachedInputTokens,
        outputTokens,
        weightedCredits,
        roundedCredits: Math.ceil(weightedCredits),
        entryCount: usageAccounting.entries.length,
        unmatchedProfileCount,
        entries: entryMetadata
      }
    };
  }

  private resolveWeightedRuntimeUsageEntry(
    entry: RuntimeUsageAccountingEntry,
    runtimeProviderSettings: Awaited<
      ReturnType<ResolvePlatformRuntimeProviderSettingsService["execute"]>
    >
  ): RuntimeUsageEntryAccountingMetadata {
    const inputTokens = asNonNegativeInteger(entry.inputTokens);
    const cacheCreationInputTokens = asNonNegativeInteger(entry.cacheCreationInputTokens);
    const cachedInputTokens = asNonNegativeInteger(entry.cachedInputTokens);
    const outputTokens = asNonNegativeInteger(entry.outputTokens);
    const billableInputTokens = inputTokens;
    const provider = normalizeManagedProvider(entry.providerKey);
    const modelKey =
      typeof entry.modelKey === "string" && entry.modelKey.trim().length > 0
        ? entry.modelKey.trim()
        : null;
    const profile =
      provider === null || modelKey === null
        ? null
        : findRuntimeProviderCatalogProfile(
            runtimeProviderSettings.availableModelCatalogByProvider[provider],
            modelKey
          );
    const weights = profile ?? defaultTokenWeights();
    const cacheCreationInputTokenWeight = resolveCacheCreationInputTokenWeight(profile);
    const weightedCredits =
      billableInputTokens * weights.inputTokenWeight +
      cacheCreationInputTokens * cacheCreationInputTokenWeight +
      cachedInputTokens * weights.cachedInputTokenWeight +
      outputTokens * weights.outputTokenWeight;

    return {
      stepType: entry.stepType,
      modelRole: entry.modelRole,
      providerKey: entry.providerKey,
      modelKey: entry.modelKey,
      inputTokens,
      cacheCreationInputTokens,
      cachedInputTokens,
      outputTokens,
      billableInputTokens,
      inputTokenWeight: weights.inputTokenWeight,
      cacheCreationInputTokenWeight,
      cachedInputTokenWeight: weights.cachedInputTokenWeight,
      outputTokenWeight: weights.outputTokenWeight,
      weightedCredits,
      profileMatched: profile !== null
    };
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
  }): Promise<{
    allowed: boolean;
    currentCount: number;
    limit: number | null;
    periodStartedAt: string;
    periodEndsAt: string;
    periodSource: "utc_day";
  }> {
    const today = new Date();
    const dateOnly = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    );
    const periodEndsAt = new Date(dateOnly.getTime() + 86_400_000);
    if (params.dailyCallLimit === null || params.dailyCallLimit <= 0) {
      return {
        allowed: true,
        currentCount: 0,
        limit: null,
        periodStartedAt: dateOnly.toISOString(),
        periodEndsAt: periodEndsAt.toISOString(),
        periodSource: "utc_day"
      };
    }
    const currentCount = await this.toolDailyUsageRepository.getUsageForDate(
      params.workspaceId,
      params.toolCode,
      dateOnly
    );
    return {
      allowed: currentCount < params.dailyCallLimit,
      currentCount,
      limit: params.dailyCallLimit,
      periodStartedAt: dateOnly.toISOString(),
      periodEndsAt: periodEndsAt.toISOString(),
      periodSource: "utc_day"
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
   * Quota enforcement, advisories, and admin quota surfaces should use this instead of snapshot
   * columns on `workspace_quota_accounting_state`, which can lag until a turn passes enforcement.
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
    const tokenBudgetSnapshot = await this.resolveTokenBudgetQuotaSnapshotForContext(
      assistant.workspaceId,
      quotaContext
    );

    return {
      planCode: quotaContext.effectiveSubscription.planCode,
      buckets: [
        buildQuotaBucketSnapshot({
          bucketCode: "token_budget",
          displayName: "Token budget",
          unit: "tokens",
          used: bigintToNumber(tokenBudgetSnapshot.usedCredits),
          limit: bigintToNumber(tokenBudgetSnapshot.limitCredits),
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
        }),
        buildQuotaBucketSnapshot({
          bucketCode: "workspace_storage_bytes",
          displayName: "Workspace storage",
          unit: "bytes",
          used: bigintToNumber(
            (quotaState?.mediaStorageBytesUsed ?? BigInt(0)) +
              (quotaState?.knowledgeStorageBytesUsed ?? BigInt(0))
          ),
          limit: bigintToNumber(limits.workspaceStorageBytesLimit),
          usageAvailable: true
        })
      ]
    };
  }

  async resolveAssistantTokenBudgetQuotaSnapshot(
    assistant: Assistant
  ): Promise<AssistantTokenBudgetQuotaSnapshot> {
    const governance = await this.resolveGovernance(assistant.id);
    const quotaContext = await this.resolveQuotaContext(assistant, governance);
    return this.resolveTokenBudgetQuotaSnapshotForContext(assistant.workspaceId, quotaContext);
  }

  private async resolveTokenBudgetQuotaSnapshotForContext(
    workspaceId: string,
    quotaContext: {
      config: ReturnType<typeof loadApiConfig>;
      effectiveSubscription: Awaited<
        ReturnType<ResolveEffectiveSubscriptionStateService["execute"]>
      >;
      planQuotaHints: PlanQuotaHints;
    }
  ): Promise<AssistantTokenBudgetQuotaSnapshot> {
    const limits = this.buildWorkspaceQuotaLimits(quotaContext.config, quotaContext.planQuotaHints);
    const period = resolveRecurringQuotaPeriod(quotaContext.effectiveSubscription);
    const tokenCounter = await this.workspaceQuotaAccountingRepository.findTokenBudgetPeriodCounter(
      {
        workspaceId,
        periodStartedAt: period.periodStartedAt,
        periodEndsAt: period.periodEndsAt
      }
    );

    return {
      usedCredits: tokenCounter?.usedCredits ?? BigInt(0),
      limitCredits: limits.tokenBudgetLimit,
      periodStartedAt: period.periodStartedAt.toISOString(),
      periodEndsAt: period.periodEndsAt.toISOString(),
      periodSource: period.periodSource
    };
  }

  async resolveAssistantMonthlyToolQuotaSnapshot(
    assistant: Assistant
  ): Promise<AssistantMonthlyToolQuotaSnapshot> {
    const governance = await this.resolveGovernance(assistant.id);
    const quotaContext = await this.resolveQuotaContext(assistant, governance);
    const period = resolveRecurringQuotaPeriod(quotaContext.effectiveSubscription);
    const bonuses = await this.manageMediaPackagePurchaseService.resolveAllActiveBonuses(
      assistant.workspaceId,
      period
    );
    const tools: AssistantMonthlyToolQuotaToolSnapshot[] = [];

    for (const tool of MONTHLY_TOOL_QUOTA_TOOLS) {
      // ADR-108 Slice 8 — `limitKey === null` ⇒ VC-priced tool
      // (`video_generate` today). The raw snapshot row carries no plan
      // unit limit; the kind="vcoin" projection fills in balance + cost
      // downstream and ignores `effectiveLimitUnits`.
      const baseLimitUnits =
        tool.limitKey === null ? null : quotaContext.planQuotaHints[tool.limitKey];
      const bonus = tool.packageBonusEligible ? bonuses[tool.toolCode] : undefined;
      const bonusUnits = bonus?.bonusUnits ?? 0;
      const effectiveLimitUnits = baseLimitUnits === null ? null : baseLimitUnits + bonusUnits;
      const counter = await this.workspaceQuotaAccountingRepository.findMonthlyMediaQuotaCounter({
        workspaceId: assistant.workspaceId,
        toolCode: tool.toolCode,
        periodStartedAt: period.periodStartedAt,
        periodEndsAt: period.periodEndsAt
      });
      const reservedUnits = counter?.reservedUnits ?? 0;
      const settledUnits = counter?.settledUnits ?? 0;
      const releasedUnits = counter?.releasedUnits ?? 0;
      const reconciliationRequiredUnits = counter?.reconciliationRequiredUnits ?? 0;
      const usedUnits = Math.max(0, settledUnits + reservedUnits);
      const remainingUnits =
        effectiveLimitUnits === null ? null : Math.max(0, effectiveLimitUnits - usedUnits);
      const percent = toPercent(usedUnits, effectiveLimitUnits);
      const finiteLimit = effectiveLimitUnits !== null && effectiveLimitUnits > 0;
      const limitReached =
        effectiveLimitUnits !== null && effectiveLimitUnits > 0 && usedUnits >= effectiveLimitUnits;
      const warningThresholdReached =
        finiteLimit && percent !== null && percent >= QUOTA_ADVISORY_WARNING_THRESHOLD_PERCENT;
      tools.push({
        toolCode: tool.toolCode,
        displayName: tool.displayName,
        usedUnits,
        reservedUnits,
        settledUnits,
        releasedUnits,
        reconciliationRequiredUnits,
        limitUnits: baseLimitUnits,
        bonusLimitUnits: bonusUnits,
        effectiveLimitUnits,
        bonusExpiresAt: bonus?.latestPeriodEndsAt ?? null,
        remainingUnits,
        percent,
        finiteLimit,
        usageAvailable: true,
        warningThresholdPercent: finiteLimit ? QUOTA_ADVISORY_WARNING_THRESHOLD_PERCENT : null,
        warningThresholdReached,
        status: limitReached ? "limit_reached" : "ok"
      });
    }

    return {
      planCode: quotaContext.effectiveSubscription.planCode,
      periodStartedAt: period.periodStartedAt.toISOString(),
      periodEndsAt: period.periodEndsAt.toISOString(),
      periodSource: period.periodSource,
      tools
    };
  }

  async reserveAssistantMonthlyMediaQuota(params: {
    assistant: Assistant;
    toolCode: WorkspaceMonthlyToolQuotaToolCode;
    units: number;
  }): Promise<ReserveAssistantMonthlyMediaQuotaResult> {
    if (params.units <= 0) {
      throw new Error("Monthly media quota reservation units must be positive.");
    }
    const context = await this.resolveMonthlyMediaQuotaAccountingContext(
      params.assistant,
      params.toolCode
    );
    const result = await this.workspaceQuotaAccountingRepository.reserveMonthlyMediaQuota({
      workspaceId: params.assistant.workspaceId,
      toolCode: params.toolCode,
      periodStartedAt: context.period.periodStartedAt,
      periodEndsAt: context.period.periodEndsAt,
      units: params.units,
      limitUnits: context.limitUnits
    });
    return {
      allowed: result.allowed,
      currentUsedUnits: result.currentUsedUnits,
      limitUnits: result.limitUnits,
      periodStartedAt: context.period.periodStartedAt.toISOString(),
      periodEndsAt: context.period.periodEndsAt.toISOString(),
      periodSource: context.period.periodSource
    };
  }

  /**
   * ADR-108 Slice 2 — settle the monthly unit counter for a media tool.
   *
   * `tx` is optional. When omitted, behavior is byte-identical to before
   * Slice 2 (image / image-edit / TTS / STT call sites observe zero
   * change). When provided, the underlying repository runs the
   * settle inside the caller's transaction so the video-only
   * success-delivery path can compose the unit-counter settle with the
   * `workspace_vcoin_balances` debit and commit/rollback atomically
   * (ADR-108 cross-slice invariant 4).
   */
  async settleAssistantMonthlyMediaQuota(params: {
    assistant: Assistant;
    toolCode: WorkspaceMonthlyToolQuotaToolCode;
    units: number;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    if (params.units <= 0) {
      return;
    }
    const context = await this.resolveMonthlyMediaQuotaAccountingContext(
      params.assistant,
      params.toolCode
    );
    await this.workspaceQuotaAccountingRepository.settleMonthlyMediaQuota(
      {
        workspaceId: params.assistant.workspaceId,
        toolCode: params.toolCode,
        periodStartedAt: context.period.periodStartedAt,
        periodEndsAt: context.period.periodEndsAt,
        units: params.units,
        limitUnits: context.limitUnits
      },
      params.tx
    );
  }

  async consumeAssistantMonthlyToolQuotaSuccessOnly(params: {
    assistant: Assistant;
    toolCode: WorkspaceMonthlyToolQuotaToolCode;
    units: number;
  }): Promise<void> {
    if (params.units <= 0) {
      return;
    }
    const context = await this.resolveMonthlyMediaQuotaAccountingContext(
      params.assistant,
      params.toolCode
    );
    await this.workspaceQuotaAccountingRepository.consumeMonthlyToolQuotaSuccessOnly({
      workspaceId: params.assistant.workspaceId,
      toolCode: params.toolCode,
      periodStartedAt: context.period.periodStartedAt,
      periodEndsAt: context.period.periodEndsAt,
      units: params.units,
      limitUnits: context.limitUnits
    });
  }

  async releaseAssistantMonthlyMediaQuota(params: {
    assistant: Assistant;
    toolCode: WorkspaceMonthlyToolQuotaToolCode;
    units: number;
  }): Promise<void> {
    if (params.units <= 0) {
      return;
    }
    const context = await this.resolveMonthlyMediaQuotaAccountingContext(
      params.assistant,
      params.toolCode
    );
    await this.workspaceQuotaAccountingRepository.releaseMonthlyMediaQuota({
      workspaceId: params.assistant.workspaceId,
      toolCode: params.toolCode,
      periodStartedAt: context.period.periodStartedAt,
      periodEndsAt: context.period.periodEndsAt,
      units: params.units,
      limitUnits: context.limitUnits
    });
  }

  async markAssistantMonthlyMediaQuotaReconciliationRequired(params: {
    assistant: Assistant;
    toolCode: WorkspaceMonthlyToolQuotaToolCode;
    units: number;
  }): Promise<void> {
    if (params.units <= 0) {
      return;
    }
    const context = await this.resolveMonthlyMediaQuotaAccountingContext(
      params.assistant,
      params.toolCode
    );
    await this.workspaceQuotaAccountingRepository.markMonthlyMediaQuotaReconciliationRequired({
      workspaceId: params.assistant.workspaceId,
      toolCode: params.toolCode,
      periodStartedAt: context.period.periodStartedAt,
      periodEndsAt: context.period.periodEndsAt,
      units: params.units,
      limitUnits: context.limitUnits
    });
  }

  async resolveWorkspaceStorageLimit(assistant: Assistant): Promise<{ limitBytes: bigint | null }> {
    const governance = await this.resolveGovernance(assistant.id);
    const { config, planQuotaHints } = await this.resolveQuotaContext(assistant, governance);
    const limitBytes =
      planQuotaHints.workspaceStorageBytesLimit ??
      BigInt(config.QUOTA_WORKSPACE_STORAGE_BYTES_DEFAULT);
    return { limitBytes };
  }

  async resolveActiveWebChatsLimit(assistant: Assistant): Promise<number | null> {
    const governance = await this.resolveGovernance(assistant.id);
    const limits = await this.resolveLimits(assistant, governance);
    const defaultLimit = loadApiConfig(process.env).WEB_ACTIVE_CHATS_CAP;
    if (limits.activeWebChatsLimit === null) {
      return defaultLimit > 0 ? defaultLimit : null;
    }
    return limits.activeWebChatsLimit > 0 ? limits.activeWebChatsLimit : null;
  }

  async resolveMessagesPerChatLimit(assistant: Assistant): Promise<number | null> {
    const governance = await this.resolveGovernance(assistant.id);
    const { planQuotaHints } = await this.resolveQuotaContext(assistant, governance);
    const configuredLimit = planQuotaHints.messagesPerChat;
    if (configuredLimit === null || configuredLimit <= 0) {
      return null;
    }
    return configuredLimit;
  }

  private async resolveMonthlyMediaQuotaAccountingContext(
    assistant: Assistant,
    toolCode: WorkspaceMonthlyToolQuotaToolCode
  ): Promise<{
    period: RecurringQuotaPeriod;
    limitUnits: number | null;
  }> {
    const governance = await this.resolveGovernance(assistant.id);
    const quotaContext = await this.resolveQuotaContext(assistant, governance);
    const tool = MONTHLY_TOOL_QUOTA_TOOLS.find((entry) => entry.toolCode === toolCode);
    if (tool === undefined) {
      throw new Error(`Unsupported monthly media quota tool code "${toolCode}".`);
    }
    const period = resolveRecurringQuotaPeriod(quotaContext.effectiveSubscription);
    // ADR-108 Slice 8 — `limitKey === null` ⇒ VC-priced tool, no plan
    // unit limit. The reservation seam never calls this path for
    // `video_generate` (it is short-circuited at enqueue), but if a
    // future caller does, we report a null limit consistently.
    const baseLimitUnits =
      tool.limitKey === null ? null : quotaContext.planQuotaHints[tool.limitKey];
    if (baseLimitUnits === null) {
      return { period, limitUnits: null };
    }
    const bonus = tool.packageBonusEligible
      ? await this.manageMediaPackagePurchaseService.resolveActiveBonus(
          assistant.workspaceId,
          toolCode,
          period
        )
      : { bonusUnits: 0 };
    return {
      period,
      limitUnits: baseLimitUnits + bonus.bonusUnits
    };
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
    const graceQuotaPlanOverride = await this.resolveGraceQuotaPlanOverride(
      assistant.workspaceId,
      effectiveSubscription
    );
    const quotaPlanCode = effectiveSubscription.planCode;
    const plan =
      quotaPlanCode === null
        ? null
        : await this.assistantPlanCatalogRepository.findByCode(quotaPlanCode);
    return {
      config,
      effectiveSubscription:
        graceQuotaPlanOverride === null
          ? effectiveSubscription
          : {
              ...effectiveSubscription,
              currentPeriodStartedAt: graceQuotaPlanOverride.currentPeriodStartedAt,
              currentPeriodEndsAt: graceQuotaPlanOverride.currentPeriodEndsAt
            },
      planQuotaHints: parsePlanQuotaHints(
        plan?.billingProviderHints ?? null,
        plan?.entitlementModel?.limitsPermissions
      )
    };
  }

  private async resolveGraceQuotaPlanOverride(
    workspaceId: string,
    effectiveSubscription: Awaited<ReturnType<ResolveEffectiveSubscriptionStateService["execute"]>>
  ): Promise<GraceQuotaPlanOverride | null> {
    if (effectiveSubscription.status !== "grace_period") {
      return null;
    }

    const subscription = await this.prisma.workspaceSubscription.findUnique({
      where: { workspaceId },
      select: {
        currentPeriodStartedAt: true,
        currentPeriodEndsAt: true,
        metadata: true
      }
    });
    const metadata =
      subscription?.metadata !== null &&
      subscription?.metadata !== undefined &&
      typeof subscription.metadata === "object" &&
      !Array.isArray(subscription.metadata)
        ? (subscription.metadata as Record<string, unknown>)
        : null;
    const previousPaidPlanCode =
      typeof metadata?.previousPaidPlanCode === "string" && metadata.previousPaidPlanCode.length > 0
        ? metadata.previousPaidPlanCode
        : null;
    const pendingPlanChange =
      metadata?.pendingPlanChange !== null &&
      metadata?.pendingPlanChange !== undefined &&
      typeof metadata.pendingPlanChange === "object" &&
      !Array.isArray(metadata.pendingPlanChange)
        ? (metadata.pendingPlanChange as Record<string, unknown>)
        : null;
    const scheduledDowngradeTargetPlanCode =
      pendingPlanChange?.changeKind === "downgrade" &&
      typeof pendingPlanChange.targetPlanCode === "string" &&
      pendingPlanChange.targetPlanCode.length > 0
        ? pendingPlanChange.targetPlanCode
        : null;

    if (
      previousPaidPlanCode !== null &&
      scheduledDowngradeTargetPlanCode !== null &&
      effectiveSubscription.planCode === scheduledDowngradeTargetPlanCode
    ) {
      return {
        currentPeriodStartedAt: subscription?.currentPeriodStartedAt?.toISOString() ?? null,
        currentPeriodEndsAt: subscription?.currentPeriodEndsAt?.toISOString() ?? null
      };
    }

    if (scheduledDowngradeTargetPlanCode !== null) {
      const previousGraceTransition =
        await this.prisma.workspaceSubscriptionLifecycleEvent.findFirst({
          where: {
            workspaceId,
            eventCode: "renewal_failed",
            nextStatus: "grace_period",
            nextPlanCode: scheduledDowngradeTargetPlanCode
          },
          orderBy: { createdAt: "desc" },
          select: {
            previousPlanCode: true,
            previousPeriodStartedAt: true,
            previousPeriodEndsAt: true
          }
        });
      if (previousGraceTransition !== null && previousGraceTransition.previousPlanCode !== null) {
        return {
          currentPeriodStartedAt:
            previousGraceTransition.previousPeriodStartedAt?.toISOString() ??
            subscription?.currentPeriodStartedAt?.toISOString() ??
            null,
          currentPeriodEndsAt:
            previousGraceTransition.previousPeriodEndsAt?.toISOString() ??
            subscription?.currentPeriodEndsAt?.toISOString() ??
            null
        };
      }
    }

    return null;
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
    const quotaPlanCode = effectiveSubscription.planCode;
    const plan =
      quotaPlanCode === null
        ? null
        : await this.assistantPlanCatalogRepository.findByCode(quotaPlanCode);
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
      activeWebChatsLimit:
        planQuotaHints.activeWebChatsLimit === null
          ? config.WEB_ACTIVE_CHATS_CAP > 0
            ? config.WEB_ACTIVE_CHATS_CAP
            : null
          : planQuotaHints.activeWebChatsLimit <= 0
            ? null
            : planQuotaHints.activeWebChatsLimit,
      mediaStorageBytesLimit:
        planQuotaHints.mediaStorageBytesLimit ?? BigInt(config.QUOTA_MEDIA_STORAGE_BYTES_DEFAULT),
      knowledgeStorageBytesLimit:
        planQuotaHints.knowledgeStorageBytesLimit ??
        BigInt(config.QUOTA_KNOWLEDGE_STORAGE_BYTES_DEFAULT),
      workspaceStorageBytesLimit:
        planQuotaHints.workspaceStorageBytesLimit ??
        BigInt(config.QUOTA_WORKSPACE_STORAGE_BYTES_DEFAULT),
      sharedStorageBytesLimit:
        planQuotaHints.sharedStorageBytesLimit ?? BigInt(config.QUOTA_SHARED_STORAGE_BYTES_DEFAULT)
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
