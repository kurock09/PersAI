import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { ManageAdminPlansService } from "./manage-admin-plans.service";
import type {
  AssistantMonthlyMediaQuotaSnapshot,
  AssistantQuotaBucketSnapshot
} from "./track-workspace-quota-usage.service";
import {
  QUOTA_ADVISORY_WARNING_THRESHOLD_PERCENT,
  TrackWorkspaceQuotaUsageService
} from "./track-workspace-quota-usage.service";
import { ResolveInternalRuntimeToolDailyPolicyService } from "./resolve-internal-runtime-tool-daily-policy.service";
import type { UserPlanVisibilityState } from "./plan-visibility.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ManageMediaPackageCatalogService } from "./manage-media-package-catalog.service";
import { buildQuotaOfferState, type QuotaOfferState } from "./quota-offers";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";

export type QuotaAdvisoryCandidateState = {
  dedupeKey: string;
  limitCode: string;
  displayName: string;
  thresholdCode: "warning_90_percent";
  warningThresholdPercent: number;
  currentPercent: number | null;
  finiteLimit: boolean;
  periodStartedAt: string | null;
  periodEndsAt: string | null;
  periodSource: string | null;
  deliveryState: "eligible" | "already_sent";
  deliveredAt: string | null;
};

const MONTHLY_MEDIA_QUOTA_TOOL_CODES = new Set(["image_generate", "image_edit", "video_generate"]);

function toMajorCurrencyUnits(amountMinor: number | null): number | null {
  if (typeof amountMinor !== "number" || !Number.isFinite(amountMinor)) {
    return null;
  }
  return Number((amountMinor / 100).toFixed(amountMinor % 100 === 0 ? 0 : 2));
}

function formatPlanPriceLabel(params: {
  amountMinor: number | null;
  currency: string | null;
  billingPeriod: "month" | "year" | null;
  locale: string;
}): string | null {
  if (
    typeof params.amountMinor !== "number" ||
    !Number.isFinite(params.amountMinor) ||
    typeof params.currency !== "string" ||
    params.currency.trim().length === 0 ||
    (params.billingPeriod !== "month" && params.billingPeriod !== "year")
  ) {
    return null;
  }
  const formatted = new Intl.NumberFormat(params.locale, {
    style: "currency",
    currency: params.currency,
    maximumFractionDigits: params.amountMinor % 100 === 0 ? 0 : 2
  }).format(params.amountMinor / 100);
  const suffix =
    params.billingPeriod === "year"
      ? params.locale.startsWith("ru")
        ? " / год"
        : " / year"
      : params.locale.startsWith("ru")
        ? " / месяц"
        : " / month";
  return `${formatted}${suffix}`;
}

function resolveHighestVisiblePaidPlan(
  input: Array<{
    code: string;
    presentation: {
      price: {
        amount: number | null;
      };
    };
  }>
): { code: string; amountMinor: number } | null {
  let highest: { code: string; amountMinor: number } | null = null;
  for (const plan of input) {
    if (
      typeof plan.presentation.price.amount !== "number" ||
      !Number.isFinite(plan.presentation.price.amount)
    ) {
      continue;
    }
    const amountMinor = Math.round(plan.presentation.price.amount * 100);
    if (amountMinor <= 0) {
      continue;
    }
    if (highest === null || amountMinor > highest.amountMinor) {
      highest = {
        code: plan.code,
        amountMinor
      };
    }
  }
  return highest;
}

export type ReadInternalRuntimeQuotaStatusRequest = {
  assistantId: string;
  toolCode?: string;
  channel?: "web" | "telegram" | "max_ru";
  externalThreadKey?: string;
};

export type ToolDailyQuotaStatusRow = {
  toolCode: string;
  displayName: string;
  activationStatus: string;
  dailyCallLimit: number | null;
  currentCount: number;
  percent: number | null;
  finiteLimit: boolean;
  warningThresholdPercent: number | null;
  warningThresholdReached: boolean;
  periodStartedAt: string | null;
  periodEndsAt: string | null;
  periodSource: "utc_day" | null;
  allowed: boolean;
};

@Injectable()
export class ReadInternalRuntimeQuotaStatusService {
  constructor(
    private readonly resolveInternalRuntimeToolDailyPolicyService: ResolveInternalRuntimeToolDailyPolicyService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly manageAdminPlansService: ManageAdminPlansService,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly manageMediaPackageCatalogService: ManageMediaPackageCatalogService,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly assistantPlanCatalogRepository: AssistantPlanCatalogRepository
  ) {}

  parseInput(payload: unknown): ReadInternalRuntimeQuotaStatusRequest {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("Tool quota check payload must be an object.");
    }
    const row = payload as Record<string, unknown>;
    if (typeof row.assistantId !== "string" || row.assistantId.trim().length === 0) {
      throw new BadRequestException("assistantId must be a non-empty string.");
    }
    const out: ReadInternalRuntimeQuotaStatusRequest = {
      assistantId: row.assistantId.trim()
    };
    if (typeof row.toolCode === "string" && row.toolCode.trim().length > 0) {
      out.toolCode = row.toolCode.trim();
    }
    if (row.channel !== undefined && row.channel !== null) {
      if (row.channel !== "web" && row.channel !== "telegram" && row.channel !== "max_ru") {
        throw new BadRequestException("channel must be one of web, telegram, or max_ru.");
      }
      out.channel = row.channel;
    }
    if (row.externalThreadKey !== undefined && row.externalThreadKey !== null) {
      if (typeof row.externalThreadKey !== "string" || row.externalThreadKey.trim().length === 0) {
        throw new BadRequestException("externalThreadKey must be a non-empty string.");
      }
      out.externalThreadKey = row.externalThreadKey.trim();
    }
    if (
      (out.channel === undefined && out.externalThreadKey !== undefined) ||
      (out.channel !== undefined && out.externalThreadKey === undefined)
    ) {
      throw new BadRequestException(
        "channel and externalThreadKey must be provided together for advisory dedupe context."
      );
    }
    return out;
  }

  async execute(input: ReadInternalRuntimeQuotaStatusRequest): Promise<{
    ok: true;
    planCode: string | null;
    currentPlan: {
      code: string | null;
      displayName: string | null;
    };
    visiblePlans: Array<{
      code: string;
      displayName: string;
      description: string | null;
      highlighted: boolean;
      isCurrent: boolean;
      amountMinor: number | null;
      amountMajor: number | null;
      currency: string | null;
      billingPeriod: "month" | "year" | null;
      priceLabel: {
        ru: string | null;
        en: string | null;
      };
      enabledToolCodes: string[];
      title: {
        ru: string | null;
        en: string | null;
      };
      subtitle: {
        ru: string | null;
        en: string | null;
      };
      notes: {
        ru: string | null;
        en: string | null;
      };
      badge: {
        ru: string | null;
        en: string | null;
      };
      ctaLabel: {
        ru: string | null;
        en: string | null;
      };
      highlightItems: {
        ru: string[];
        en: string[];
      };
      limits: {
        tokenBudgetLimit: number | null;
        activeWebChatsLimit: number | null;
        messagesPerChat: number | null;
        imageGenerateMonthlyUnitsLimit: number | null;
        imageEditMonthlyUnitsLimit: number | null;
        videoGenerateMonthlyUnitsLimit: number | null;
      };
    }>;
    tools: ToolDailyQuotaStatusRow[];
    buckets: AssistantQuotaBucketSnapshot[];
    monthlyMediaQuotas: AssistantMonthlyMediaQuotaSnapshot;
    packagesAvailableByTool: Record<string, boolean>;
    packageOffers: QuotaOfferState;
    advisories: UserPlanVisibilityState["advisories"];
    advisoryCandidates: QuotaAdvisoryCandidateState[];
  }> {
    const resolved = await this.resolveInternalRuntimeToolDailyPolicyService.execute(
      input.toolCode
        ? {
            assistantId: input.assistantId,
            toolCode: input.toolCode
          }
        : {
            assistantId: input.assistantId
          }
    );

    const tools: ToolDailyQuotaStatusRow[] = [];
    const activeToolCodes = new Set<string>();
    for (const act of resolved.tools) {
      if (act.activationStatus === "active") {
        activeToolCodes.add(act.toolCode);
      }
      if (MONTHLY_MEDIA_QUOTA_TOOL_CODES.has(act.toolCode)) {
        // ADR-082: media paid-usage truth is monthly and delivery-confirmed, so
        // quota_status should expose those tools only via monthlyMediaQuotas.
        continue;
      }
      const dailyCallLimit = act.dailyCallLimit;
      const check =
        dailyCallLimit === null || dailyCallLimit <= 0
          ? {
              allowed: true,
              currentCount: 0,
              limit: null as number | null,
              periodStartedAt: null,
              periodEndsAt: null,
              periodSource: null as "utc_day" | null
            }
          : await this.trackWorkspaceQuotaUsageService.checkToolDailyLimit({
              workspaceId: resolved.assistant.workspaceId,
              toolCode: act.toolCode,
              dailyCallLimit
            });

      const activeOnPlan = act.activationStatus === "active";
      const underDailyCap =
        dailyCallLimit === null ||
        dailyCallLimit <= 0 ||
        (check.limit !== null && check.currentCount < check.limit);
      const allowed = activeOnPlan && underDailyCap;
      const finiteLimit = dailyCallLimit !== null && dailyCallLimit > 0;
      const percent =
        finiteLimit && dailyCallLimit !== null
          ? Math.max(0, Math.min(100, Math.round((check.currentCount / dailyCallLimit) * 100)))
          : null;

      tools.push({
        toolCode: act.toolCode,
        displayName: act.displayName,
        activationStatus: act.activationStatus,
        dailyCallLimit,
        currentCount: check.currentCount,
        percent,
        finiteLimit,
        warningThresholdPercent: finiteLimit ? QUOTA_ADVISORY_WARNING_THRESHOLD_PERCENT : null,
        warningThresholdReached:
          finiteLimit && percent !== null && percent >= QUOTA_ADVISORY_WARNING_THRESHOLD_PERCENT,
        periodStartedAt: check.periodStartedAt,
        periodEndsAt: check.periodEndsAt,
        periodSource: check.periodSource,
        allowed
      });
    }

    const snapshot = await this.trackWorkspaceQuotaUsageService.resolveAssistantQuotaSnapshot(
      resolved.assistant
    );
    const tokenBudget =
      await this.trackWorkspaceQuotaUsageService.resolveAssistantTokenBudgetQuotaSnapshot(
        resolved.assistant
      );
    const monthlyMediaQuotasRaw =
      await this.trackWorkspaceQuotaUsageService.resolveAssistantMonthlyMediaQuotaSnapshot(
        resolved.assistant
      );
    const monthlyMediaQuotas = {
      ...monthlyMediaQuotasRaw,
      tools: monthlyMediaQuotasRaw.tools.filter((tool) => activeToolCodes.has(tool.toolCode))
    };
    const visiblePlans = await this.manageAdminPlansService.listPublicPricingPlans();
    const currentVisiblePlan = visiblePlans.find((plan) => plan.code === resolved.planCode) ?? null;
    const currentPlanAmountMinor =
      typeof currentVisiblePlan?.presentation.price.amount === "number"
        ? Math.round(currentVisiblePlan.presentation.price.amount * 100)
        : await this.resolveCurrentPlanAmountMinor(resolved.planCode);
    const highestVisiblePaidPlan = resolveHighestVisiblePaidPlan(visiblePlans);
    const tokenBucket =
      snapshot.buckets.find((bucket) => bucket.bucketCode === "token_budget") ?? null;
    const isFreePlan = currentPlanAmountMinor === 0;
    const paidLightModeEligible =
      !isFreePlan && tokenBudget.limitCredits !== null && tokenBudget.limitCredits > BigInt(0);
    const paidLightModeActive = paidLightModeEligible && tokenBucket?.status === "limit_reached";
    const advisories: UserPlanVisibilityState["advisories"] = {
      warningThresholdPercent: QUOTA_ADVISORY_WARNING_THRESHOLD_PERCENT,
      isFreePlan,
      higherPaidPlanAvailable:
        highestVisiblePaidPlan !== null &&
        (currentPlanAmountMinor === null ||
          currentPlanAmountMinor < highestVisiblePaidPlan.amountMinor),
      highestVisiblePaidPlanCode: highestVisiblePaidPlan?.code ?? null,
      tokenBudget: {
        periodStartedAt: tokenBudget.periodStartedAt,
        periodEndsAt: tokenBudget.periodEndsAt,
        periodSource: tokenBudget.periodSource,
        paidLightModeEligible,
        paidLightModeActive,
        paidLightModeReason: paidLightModeActive ? "token_budget_limit_reached" : null
      }
    };
    const publicPackages = await this.manageMediaPackageCatalogService.listPublic();
    const packageOffers = buildQuotaOfferState({
      currentPlanCode: resolved.planCode,
      visiblePlans: visiblePlans.map((plan) => ({
        code: plan.code,
        displayName: plan.displayName,
        enabledToolCodes: plan.enabledToolCodes,
        amountMinor:
          typeof plan.presentation.price.amount === "number"
            ? Math.round(plan.presentation.price.amount * 100)
            : null,
        limits: {
          imageGenerateMonthlyUnitsLimit: plan.quotaLimits.imageGenerateMonthlyUnitsLimit,
          imageEditMonthlyUnitsLimit: plan.quotaLimits.imageEditMonthlyUnitsLimit,
          videoGenerateMonthlyUnitsLimit: plan.quotaLimits.videoGenerateMonthlyUnitsLimit
        }
      })),
      currentActiveToolCodes: activeToolCodes,
      publicPackages
    });
    const packagesAvailableByTool = Object.fromEntries(
      packageOffers.tools.map((tool) => [tool.toolCode, tool.offerableNow])
    );
    const advisoryCandidates = await this.computeAdvisoryCandidates({
      assistantId: resolved.assistant.id,
      channel: input.channel,
      externalThreadKey: input.externalThreadKey,
      quotaBuckets: snapshot.buckets,
      tokenBudgetPeriod: {
        periodStartedAt: tokenBudget.periodStartedAt,
        periodEndsAt: tokenBudget.periodEndsAt,
        periodSource: tokenBudget.periodSource
      },
      monthlyMediaQuotas
    });

    return {
      ok: true,
      planCode: resolved.planCode,
      currentPlan: {
        code: resolved.planCode,
        displayName: currentVisiblePlan?.displayName ?? null
      },
      visiblePlans: visiblePlans.map((plan) => {
        const amountMinor =
          typeof plan.presentation.price.amount === "number"
            ? Math.round(plan.presentation.price.amount * 100)
            : null;
        return {
          code: plan.code,
          displayName: plan.displayName,
          description: plan.description,
          highlighted: plan.presentation.highlighted,
          isCurrent: plan.code === resolved.planCode,
          amountMinor,
          amountMajor: toMajorCurrencyUnits(amountMinor),
          currency: plan.presentation.price.currency,
          billingPeriod: plan.presentation.price.billingPeriod,
          priceLabel: {
            ru: formatPlanPriceLabel({
              amountMinor,
              currency: plan.presentation.price.currency,
              billingPeriod: plan.presentation.price.billingPeriod,
              locale: "ru-RU"
            }),
            en: formatPlanPriceLabel({
              amountMinor,
              currency: plan.presentation.price.currency,
              billingPeriod: plan.presentation.price.billingPeriod,
              locale: "en-US"
            })
          },
          enabledToolCodes: plan.enabledToolCodes,
          title: plan.presentation.title,
          subtitle: plan.presentation.subtitle,
          notes: plan.presentation.notes,
          badge: plan.presentation.badge,
          ctaLabel: plan.presentation.ctaLabel,
          highlightItems: plan.presentation.highlightItems,
          limits: {
            tokenBudgetLimit: plan.quotaLimits.tokenBudgetLimit,
            activeWebChatsLimit: plan.quotaLimits.activeWebChatsLimit,
            messagesPerChat: plan.quotaLimits.messagesPerChat,
            imageGenerateMonthlyUnitsLimit: plan.enabledToolCodes.includes("image_generate")
              ? plan.quotaLimits.imageGenerateMonthlyUnitsLimit
              : null,
            imageEditMonthlyUnitsLimit: plan.enabledToolCodes.includes("image_edit")
              ? plan.quotaLimits.imageEditMonthlyUnitsLimit
              : null,
            videoGenerateMonthlyUnitsLimit: plan.enabledToolCodes.includes("video_generate")
              ? plan.quotaLimits.videoGenerateMonthlyUnitsLimit
              : null
          }
        };
      }),
      tools,
      buckets: snapshot.buckets,
      monthlyMediaQuotas,
      packagesAvailableByTool,
      packageOffers,
      advisories,
      advisoryCandidates
    };
  }

  private async computeAdvisoryCandidates(input: {
    assistantId: string;
    channel?: string | undefined;
    externalThreadKey?: string | undefined;
    quotaBuckets: AssistantQuotaBucketSnapshot[];
    tokenBudgetPeriod: {
      periodStartedAt: string;
      periodEndsAt: string;
      periodSource: string;
    };
    monthlyMediaQuotas: AssistantMonthlyMediaQuotaSnapshot;
  }): Promise<QuotaAdvisoryCandidateState[]> {
    const threadPrefix =
      input.channel && input.externalThreadKey
        ? `${input.assistantId}:${input.channel}:${input.externalThreadKey}`
        : input.assistantId;

    const rawCandidates: Omit<QuotaAdvisoryCandidateState, "deliveryState" | "deliveredAt">[] = [];

    for (const bucket of input.quotaBuckets) {
      if (!bucket.finiteLimit) continue;
      if (!bucket.warningThresholdReached || bucket.status === "limit_reached") continue;
      rawCandidates.push({
        dedupeKey: `quota_advisory:${threadPrefix}:quota_bucket:${bucket.bucketCode}:warning_90_percent:${input.tokenBudgetPeriod.periodStartedAt}:${input.tokenBudgetPeriod.periodEndsAt}`,
        limitCode: `quota_bucket:${bucket.bucketCode}`,
        displayName: bucket.displayName,
        thresholdCode: "warning_90_percent",
        warningThresholdPercent:
          bucket.warningThresholdPercent ?? QUOTA_ADVISORY_WARNING_THRESHOLD_PERCENT,
        currentPercent: bucket.percent,
        finiteLimit: bucket.finiteLimit,
        periodStartedAt: input.tokenBudgetPeriod.periodStartedAt,
        periodEndsAt: input.tokenBudgetPeriod.periodEndsAt,
        periodSource: input.tokenBudgetPeriod.periodSource
      });
    }

    for (const tool of input.monthlyMediaQuotas.tools) {
      if (!tool.finiteLimit) continue;
      if (!tool.warningThresholdReached || tool.status === "limit_reached") continue;
      rawCandidates.push({
        dedupeKey: `quota_advisory:${threadPrefix}:monthly_media:${tool.toolCode}:warning_90_percent:${input.monthlyMediaQuotas.periodStartedAt}:${input.monthlyMediaQuotas.periodEndsAt}`,
        limitCode: `monthly_media:${tool.toolCode}`,
        displayName: tool.displayName,
        thresholdCode: "warning_90_percent",
        warningThresholdPercent:
          tool.warningThresholdPercent ?? QUOTA_ADVISORY_WARNING_THRESHOLD_PERCENT,
        currentPercent: tool.percent,
        finiteLimit: tool.finiteLimit,
        periodStartedAt: input.monthlyMediaQuotas.periodStartedAt,
        periodEndsAt: input.monthlyMediaQuotas.periodEndsAt,
        periodSource: input.monthlyMediaQuotas.periodSource
      });
    }

    if (rawCandidates.length === 0) return [];

    const earliestRelevantCreatedAt = this.resolveEarliestRelevantCreatedAt(rawCandidates);
    const recentIntents = await this.prisma.notificationIntent.findMany({
      where: {
        assistantId: input.assistantId,
        source: "quota_advisory",
        ...(earliestRelevantCreatedAt !== null
          ? { createdAt: { gte: earliestRelevantCreatedAt } }
          : {})
      },
      select: { dedupeKey: true, createdAt: true, factPayload: true }
    });

    const recentByKey = new Map(
      recentIntents.flatMap((intent) => {
        const keys = this.extractQuotaAdvisoryCandidateKeys(intent.factPayload);
        if (intent.dedupeKey) {
          keys.push(intent.dedupeKey);
        }
        return keys.map((key) => [key, intent.createdAt.toISOString()] as const);
      })
    );

    return rawCandidates.map((c) => {
      const deliveredAt = recentByKey.get(c.dedupeKey) ?? null;
      return {
        ...c,
        deliveryState: deliveredAt !== null ? "already_sent" : "eligible",
        deliveredAt
      };
    });
  }

  private async resolveCurrentPlanAmountMinor(planCode: string | null): Promise<number | null> {
    if (typeof planCode !== "string" || planCode.length === 0) {
      return null;
    }
    const plan = await this.assistantPlanCatalogRepository.findByCode(planCode);
    const billingProviderHints =
      plan?.billingProviderHints !== null &&
      typeof plan?.billingProviderHints === "object" &&
      !Array.isArray(plan?.billingProviderHints)
        ? (plan.billingProviderHints as Record<string, unknown>)
        : null;
    const presentation =
      billingProviderHints?.presentation !== null &&
      typeof billingProviderHints?.presentation === "object" &&
      !Array.isArray(billingProviderHints?.presentation)
        ? (billingProviderHints.presentation as Record<string, unknown>)
        : null;
    const price =
      presentation?.price !== null &&
      typeof presentation?.price === "object" &&
      !Array.isArray(presentation?.price)
        ? (presentation.price as Record<string, unknown>)
        : null;
    const amount =
      typeof price?.amount === "number" && Number.isFinite(price.amount)
        ? Math.round(price.amount * 100)
        : null;
    return amount;
  }

  private resolveEarliestRelevantCreatedAt(
    candidates: Array<Pick<QuotaAdvisoryCandidateState, "periodStartedAt">>
  ): Date | null {
    const timestamps = candidates
      .map((candidate) => candidate.periodStartedAt)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map((value) => new Date(value))
      .filter((value) => !Number.isNaN(value.getTime()))
      .map((value) => value.getTime());
    if (timestamps.length === 0) {
      return null;
    }
    return new Date(Math.min(...timestamps));
  }

  private extractQuotaAdvisoryCandidateKeys(factPayload: unknown): string[] {
    if (typeof factPayload !== "object" || factPayload === null || Array.isArray(factPayload)) {
      return [];
    }
    const candidateKeys = (factPayload as { candidateDedupeKeys?: unknown }).candidateDedupeKeys;
    if (!Array.isArray(candidateKeys)) {
      return [];
    }
    return candidateKeys.filter((value): value is string => typeof value === "string");
  }
}
