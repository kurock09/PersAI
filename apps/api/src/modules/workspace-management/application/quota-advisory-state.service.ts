import { Injectable } from "@nestjs/common";
import type {
  AssistantMonthlyMediaQuotaSnapshot,
  AssistantQuotaBucketSnapshot
} from "./track-workspace-quota-usage.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export const QUOTA_ADVISORY_THRESHOLD_CODE = "warning_90_percent";

export type QuotaAdvisoryThreadContext = {
  channel: "web" | "telegram" | "max_ru";
  externalThreadKey: string;
};

export type QuotaAdvisoryDeliveryState = "eligible" | "already_sent" | "thread_context_required";

export type QuotaAdvisoryToolDailyLimitSnapshot = {
  toolCode: string;
  displayName: string;
  dailyCallLimit: number | null;
  dailyCallsUsed: number;
  percent: number | null;
  finiteLimit: boolean;
  warningThresholdPercent: number | null;
  warningThresholdReached: boolean;
  periodStartedAt: string | null;
  periodEndsAt: string | null;
  periodSource: "utc_day" | null;
  active: boolean;
};

export type QuotaAdvisoryCandidateState = {
  dedupeKey: string | null;
  limitCode: string;
  displayName: string;
  thresholdCode: typeof QUOTA_ADVISORY_THRESHOLD_CODE;
  warningThresholdPercent: number;
  currentPercent: number;
  finiteLimit: boolean;
  periodStartedAt: string | null;
  periodEndsAt: string | null;
  periodSource: "subscription_period" | "calendar_month_fallback" | "utc_day" | null;
  deliveryState: QuotaAdvisoryDeliveryState;
  deliveredAt: string | null;
};

type AdvisoryCandidateDraft = Omit<
  QuotaAdvisoryCandidateState,
  "dedupeKey" | "deliveryState" | "deliveredAt"
>;

@Injectable()
export class QuotaAdvisoryStateService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async resolveCandidates(input: {
    assistantId: string;
    workspaceId: string;
    threadContext: QuotaAdvisoryThreadContext | null;
    quotaBuckets: AssistantQuotaBucketSnapshot[];
    tokenBudgetPeriod: {
      periodStartedAt: string | null;
      periodEndsAt: string | null;
      periodSource: "subscription_period" | "calendar_month_fallback" | null;
    };
    monthlyMediaQuotas: AssistantMonthlyMediaQuotaSnapshot;
    toolDailyLimits: QuotaAdvisoryToolDailyLimitSnapshot[];
  }): Promise<QuotaAdvisoryCandidateState[]> {
    const drafts: AdvisoryCandidateDraft[] = [];

    for (const bucket of input.quotaBuckets) {
      if (
        !bucket.finiteLimit ||
        !bucket.warningThresholdReached ||
        bucket.warningThresholdPercent === null ||
        bucket.percent === null
      ) {
        continue;
      }
      drafts.push({
        limitCode: `quota_bucket:${bucket.bucketCode}`,
        displayName: bucket.displayName,
        thresholdCode: QUOTA_ADVISORY_THRESHOLD_CODE,
        warningThresholdPercent: bucket.warningThresholdPercent,
        currentPercent: bucket.percent,
        finiteLimit: true,
        periodStartedAt:
          bucket.bucketCode === "token_budget" ? input.tokenBudgetPeriod.periodStartedAt : null,
        periodEndsAt:
          bucket.bucketCode === "token_budget" ? input.tokenBudgetPeriod.periodEndsAt : null,
        periodSource:
          bucket.bucketCode === "token_budget" ? input.tokenBudgetPeriod.periodSource : null
      });
    }

    for (const tool of input.monthlyMediaQuotas.tools) {
      if (
        !tool.finiteLimit ||
        !tool.warningThresholdReached ||
        tool.warningThresholdPercent === null ||
        tool.percent === null
      ) {
        continue;
      }
      drafts.push({
        limitCode: `monthly_media:${tool.toolCode}`,
        displayName: tool.displayName,
        thresholdCode: QUOTA_ADVISORY_THRESHOLD_CODE,
        warningThresholdPercent: tool.warningThresholdPercent,
        currentPercent: tool.percent,
        finiteLimit: true,
        periodStartedAt: input.monthlyMediaQuotas.periodStartedAt,
        periodEndsAt: input.monthlyMediaQuotas.periodEndsAt,
        periodSource: input.monthlyMediaQuotas.periodSource
      });
    }

    for (const tool of input.toolDailyLimits) {
      if (
        !tool.active ||
        !tool.finiteLimit ||
        !tool.warningThresholdReached ||
        tool.warningThresholdPercent === null ||
        tool.percent === null
      ) {
        continue;
      }
      drafts.push({
        limitCode: `tool_daily:${tool.toolCode}`,
        displayName: tool.displayName,
        thresholdCode: QUOTA_ADVISORY_THRESHOLD_CODE,
        warningThresholdPercent: tool.warningThresholdPercent,
        currentPercent: tool.percent,
        finiteLimit: true,
        periodStartedAt: tool.periodStartedAt,
        periodEndsAt: tool.periodEndsAt,
        periodSource: tool.periodSource
      });
    }

    if (drafts.length === 0) {
      return [];
    }
    if (input.threadContext === null) {
      return drafts.map((draft) => ({
        ...draft,
        dedupeKey: null,
        deliveryState: "thread_context_required",
        deliveredAt: null
      }));
    }

    const threadContext = input.threadContext;
    const existingStates = await this.prisma.assistantQuotaAdvisoryState.findMany({
      where: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        channel: threadContext.channel,
        externalThreadKey: threadContext.externalThreadKey
      },
      select: {
        dedupeKey: true,
        deliveredAt: true
      }
    });
    const deliveredByKey = new Map(existingStates.map((row) => [row.dedupeKey, row.deliveredAt]));

    return drafts.map((draft) => {
      const dedupeKey = this.buildDedupeKey({
        assistantId: input.assistantId,
        channel: threadContext.channel,
        externalThreadKey: threadContext.externalThreadKey,
        limitCode: draft.limitCode,
        thresholdCode: draft.thresholdCode,
        periodStartedAt: draft.periodStartedAt,
        periodEndsAt: draft.periodEndsAt
      });
      const deliveredAt = deliveredByKey.get(dedupeKey) ?? null;
      return {
        ...draft,
        dedupeKey,
        deliveryState: deliveredAt === null ? "eligible" : "already_sent",
        deliveredAt: deliveredAt?.toISOString() ?? null
      };
    });
  }

  async recordDeliveredCandidates(input: {
    assistantId: string;
    workspaceId: string;
    threadContext: QuotaAdvisoryThreadContext;
    candidates: QuotaAdvisoryCandidateState[];
  }): Promise<void> {
    const deliverableCandidates = input.candidates.filter(
      (candidate) =>
        candidate.deliveryState !== "thread_context_required" && candidate.dedupeKey !== null
    );
    if (deliverableCandidates.length === 0) {
      return;
    }
    const deliveredAt = new Date();
    await Promise.all(
      deliverableCandidates.map((candidate) =>
        this.prisma.assistantQuotaAdvisoryState.upsert({
          where: { dedupeKey: candidate.dedupeKey! },
          update: {
            deliveredAt,
            currentPercent: candidate.currentPercent,
            warningThresholdPercent: candidate.warningThresholdPercent
          },
          create: {
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            channel: input.threadContext.channel,
            externalThreadKey: input.threadContext.externalThreadKey,
            dedupeKey: candidate.dedupeKey!,
            limitCode: candidate.limitCode,
            displayName: candidate.displayName,
            thresholdCode: candidate.thresholdCode,
            warningThresholdPercent: candidate.warningThresholdPercent,
            currentPercent: candidate.currentPercent,
            periodStartedAt: candidate.periodStartedAt ? new Date(candidate.periodStartedAt) : null,
            periodEndsAt: candidate.periodEndsAt ? new Date(candidate.periodEndsAt) : null,
            periodSource: candidate.periodSource,
            deliveredAt
          }
        })
      )
    );
  }

  private buildDedupeKey(input: {
    assistantId: string;
    channel: QuotaAdvisoryThreadContext["channel"];
    externalThreadKey: string;
    limitCode: string;
    thresholdCode: string;
    periodStartedAt: string | null;
    periodEndsAt: string | null;
  }): string {
    return [
      "quota_advisory",
      input.assistantId,
      input.channel,
      input.externalThreadKey,
      input.limitCode,
      input.thresholdCode,
      input.periodStartedAt ?? "none",
      input.periodEndsAt ?? "none"
    ].join(":");
  }
}
