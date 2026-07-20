import { Inject, Injectable } from "@nestjs/common";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";
import type {
  AdminBusinessPlatformState,
  PlanDistributionEntry,
  QuotaPressureDistribution,
  RuntimeTurnAverages
} from "./platform-business.types";
import { readAdminModelCostLedgerWindow } from "./model-cost-ledger-read-model";
import { readPlatformSucceededPaymentsAllTime } from "./admin-ops-period-economics";
import { resolveRecurringQuotaPeriod } from "./recurring-quota-period";

const BUSINESS_WINDOW_DAYS = 7;

function toPercent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

@Injectable()
export class ResolveAdminBusinessPlatformService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly assistantPlanCatalogRepository: AssistantPlanCatalogRepository
  ) {}

  async execute(userId: string): Promise<AdminBusinessPlatformState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - BUSINESS_WINDOW_DAYS);

    const totalUsers = await this.prisma.appUser.count();

    const allPlans = await this.assistantPlanCatalogRepository.listAll();
    const defaultPlan = allPlans.find((p) => p.isDefaultFirstRegistrationPlan) ?? null;
    const activePlans = allPlans.filter((p) => p.status === "active");

    const assistants = await this.prisma.assistant.findMany({
      select: { id: true, userId: true, workspaceId: true, applyStatus: true }
    });
    const totalAssistants = assistants.length;
    const activeAssistants = assistants.filter(
      (a) => a.applyStatus === "succeeded" || a.applyStatus === "in_progress"
    ).length;
    const usersWithAssistant = new Set(assistants.map((a) => a.userId)).size;
    const usersWithoutAssistant = totalUsers - usersWithAssistant;

    const [totalConversations, totalMessages, activeWebChats] = await Promise.all([
      this.prisma.assistantChat.count(),
      this.prisma.assistantChatMessage.count(),
      this.prisma.assistantChat.count({
        where: { surface: "web", archivedAt: null }
      })
    ]);

    const governanceRows = await this.prisma.assistantGovernance.findMany({
      where: { assistantId: { in: assistants.map((a) => a.id) } },
      select: { assistantId: true, quotaPlanCode: true, assistantPlanOverrideCode: true }
    });
    const governanceByAssistant = new Map(governanceRows.map((g) => [g.assistantId, g]));

    const subscriptions = await this.prisma.workspaceSubscription.findMany({
      where: {
        workspaceId: {
          in: Array.from(new Set(assistants.map((assistant) => assistant.workspaceId)))
        }
      },
      select: { workspaceId: true, planCode: true }
    });
    const workspacePlanCodeByWorkspaceId = new Map(
      subscriptions.map((subscription) => [subscription.workspaceId, subscription.planCode])
    );

    const planCounts = new Map<string, number>();
    for (const assistant of assistants) {
      const gov = governanceByAssistant.get(assistant.id);
      const effectivePlan =
        gov?.assistantPlanOverrideCode ??
        workspacePlanCodeByWorkspaceId.get(assistant.workspaceId) ??
        gov?.quotaPlanCode ??
        defaultPlan?.code ??
        "unknown";
      planCounts.set(effectivePlan, (planCounts.get(effectivePlan) ?? 0) + 1);
    }
    if (usersWithoutAssistant > 0) {
      const fallbackPlan = defaultPlan?.code ?? "no_assistant";
      planCounts.set(fallbackPlan, (planCounts.get(fallbackPlan) ?? 0) + usersWithoutAssistant);
    }

    const planDistribution: PlanDistributionEntry[] = Array.from(planCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => ({
        planCode: code,
        planDisplayName: allPlans.find((p) => p.code === code)?.displayName ?? null,
        userCount: count,
        percent: toPercent(count, totalUsers)
      }));

    const quotaPressureDistribution = await this.computeQuotaPressure(now);
    const [ledgerBackedModelCost, platformPaymentRevenueAllTime] = await Promise.all([
      readAdminModelCostLedgerWindow(this.prisma, {
        startedAt: new Date(0),
        windowLabel: "all_time",
        periodSource: "all_time"
      }),
      readPlatformSucceededPaymentsAllTime(this.prisma)
    ]);
    const runtimeTurnAverages = await this.computeRuntimeTurnAverages(windowStart);

    const webChats = await this.prisma.assistantChat.count({
      where: { surface: "web", archivedAt: null }
    });
    const telegramBindings = await this.prisma.assistantChannelSurfaceBinding.count({
      where: {
        providerKey: "telegram",
        surfaceType: "telegram_bot",
        bindingState: "active"
      }
    });
    const whatsappBindings = await this.prisma.assistantChannelSurfaceBinding.count({
      where: {
        providerKey: "whatsapp",
        surfaceType: "whatsapp_business",
        bindingState: "active"
      }
    });
    const maxBindings = await this.prisma.assistantChannelSurfaceBinding.count({
      where: {
        providerKey: "max",
        surfaceType: { in: ["max_bot", "max_mini_app"] },
        bindingState: "active"
      }
    });

    const applySucceeded = await this.prisma.assistantAuditEvent.count({
      where: {
        createdAt: { gte: windowStart },
        eventCode: "assistant.runtime.apply_succeeded"
      }
    });
    const applyDegraded = await this.prisma.assistantAuditEvent.count({
      where: {
        createdAt: { gte: windowStart },
        eventCode: "assistant.runtime.apply_degraded"
      }
    });
    const applyFailed = await this.prisma.assistantAuditEvent.count({
      where: {
        createdAt: { gte: windowStart },
        eventCode: "assistant.runtime.apply_failed"
      }
    });
    const applyTotal = applySucceeded + applyDegraded + applyFailed;
    const channelTotal = webChats + telegramBindings + whatsappBindings + maxBindings;

    return {
      totalUsers,
      totalAssistants,
      activeAssistants,
      totalConversations,
      totalMessages,
      activeWebChats,
      planDistribution,
      quotaPressureDistribution,
      channelAdoption: {
        webChat: webChats,
        telegram: telegramBindings,
        whatsapp: whatsappBindings,
        max: maxBindings,
        total: channelTotal
      },
      publishApplyHealth: {
        window: "last_7_days",
        applySucceeded,
        applyDegraded,
        applyFailed,
        applySuccessPercent: toPercent(applySucceeded, applyTotal)
      },
      planCatalog: {
        totalPlans: allPlans.length,
        activePlans: activePlans.length,
        inactivePlans: allPlans.length - activePlans.length,
        defaultRegistrationPlanCode: defaultPlan?.code ?? null
      },
      ledgerBackedModelCost,
      platformPaymentRevenueAllTime,
      runtimeTurnAverages,
      updatedAt: now.toISOString()
    };
  }

  private async computeQuotaPressure(now: Date): Promise<QuotaPressureDistribution> {
    const quotaStates = await this.prisma.workspaceQuotaAccountingState.findMany({
      select: {
        workspaceId: true,
        tokenBudgetLimit: true
      }
    });
    const subscriptions = await this.prisma.workspaceSubscription.findMany({
      where: { workspaceId: { in: quotaStates.map((state) => state.workspaceId) } },
      select: {
        workspaceId: true,
        currentPeriodStartedAt: true,
        currentPeriodEndsAt: true
      }
    });
    const subscriptionByWorkspaceId = new Map(
      subscriptions.map((subscription) => [subscription.workspaceId, subscription])
    );

    const distribution: QuotaPressureDistribution = { low: 0, elevated: 0, high: 0 };
    for (const quotaState of quotaStates) {
      const tokenLimit = quotaState.tokenBudgetLimit;
      const subscription = subscriptionByWorkspaceId.get(quotaState.workspaceId);
      const period = resolveRecurringQuotaPeriod(
        {
          currentPeriodStartedAt: subscription?.currentPeriodStartedAt?.toISOString() ?? null,
          currentPeriodEndsAt: subscription?.currentPeriodEndsAt?.toISOString() ?? null
        },
        now
      );
      const tokenCounter = await this.prisma.workspaceTokenBudgetPeriodCounter.findUnique({
        where: {
          workspaceId_periodStartedAt_periodEndsAt: {
            workspaceId: quotaState.workspaceId,
            periodStartedAt: period.periodStartedAt,
            periodEndsAt: period.periodEndsAt
          }
        },
        select: { usedCredits: true }
      });
      const tokenPercent =
        tokenLimit !== null && tokenLimit > BigInt(0)
          ? Number(((tokenCounter?.usedCredits ?? BigInt(0)) * BigInt(100)) / tokenLimit)
          : 0;

      if (tokenPercent >= 90) {
        distribution.high += 1;
      } else if (tokenPercent >= 60) {
        distribution.elevated += 1;
      } else {
        distribution.low += 1;
      }
    }

    return distribution;
  }

  private async computeRuntimeTurnAverages(windowStart: Date): Promise<RuntimeTurnAverages> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        completed_turns: number;
        turns_with_v2_text_usage_accounting: number;
        v2_text_usage_call_count: number;
        v2_cache_read_hit_turns: number;
        avg_total_input_tokens: number;
        avg_uncached_input_tokens: number;
        avg_cache_write_input_tokens: number;
        avg_cache_read_input_tokens: number;
        avg_output_tokens: number;
        avg_total_tokens: number;
        avg_usage_steps_per_turn: number;
        cache_read_share_percent: number | null;
        cache_write_share_percent: number | null;
        cache_read_hit_turn_share_percent: number | null;
      }>
    >`
      WITH candidate_v2_receipts AS (
        SELECT result_payload -> 'textUsageAccounting' AS usage
        FROM runtime_turn_receipts
        WHERE status = 'completed'
          AND completed_at IS NOT NULL
          AND completed_at >= ${windowStart}
          AND jsonb_typeof(result_payload -> 'textUsageAccounting') = 'object'
          AND result_payload -> 'textUsageAccounting' ->> 'schemaVersion' = '2'
      ),
      validated_v2_receipts AS (
        SELECT candidate.usage
        FROM candidate_v2_receipts AS candidate
        CROSS JOIN LATERAL (
          SELECT
            COUNT(*)::int AS entry_count,
            COALESCE(SUM(CASE WHEN entry.value ->> 'totalInputTokens' ~ '^(0|[1-9][0-9]*)$' THEN (entry.value ->> 'totalInputTokens')::numeric ELSE 0 END), 0) AS total_input_tokens,
            COALESCE(SUM(CASE WHEN entry.value ->> 'uncachedInputTokens' ~ '^(0|[1-9][0-9]*)$' THEN (entry.value ->> 'uncachedInputTokens')::numeric ELSE 0 END), 0) AS uncached_input_tokens,
            COALESCE(SUM(CASE WHEN entry.value ->> 'cacheWriteInputTokens' ~ '^(0|[1-9][0-9]*)$' THEN (entry.value ->> 'cacheWriteInputTokens')::numeric ELSE 0 END), 0) AS cache_write_input_tokens,
            COALESCE(SUM(CASE WHEN entry.value ->> 'cacheReadInputTokens' ~ '^(0|[1-9][0-9]*)$' THEN (entry.value ->> 'cacheReadInputTokens')::numeric ELSE 0 END), 0) AS cache_read_input_tokens,
            COALESCE(SUM(CASE WHEN entry.value ->> 'outputTokens' ~ '^(0|[1-9][0-9]*)$' THEN (entry.value ->> 'outputTokens')::numeric ELSE 0 END), 0) AS output_tokens,
            COALESCE(SUM(CASE WHEN entry.value ->> 'totalTokens' ~ '^(0|[1-9][0-9]*)$' THEN (entry.value ->> 'totalTokens')::numeric ELSE 0 END), 0) AS total_tokens,
            BOOL_AND(
              jsonb_typeof(entry.value) = 'object'
              AND entry.value ->> 'schemaVersion' = '2'
              AND COALESCE(entry.value ->> 'providerKey', '') IN ('openai', 'anthropic', 'deepseek')
              AND length(trim(COALESCE(entry.value ->> 'modelKey', ''))) > 0
              AND jsonb_typeof(entry.value -> 'totalInputTokens') = 'number'
              AND jsonb_typeof(entry.value -> 'uncachedInputTokens') = 'number'
              AND jsonb_typeof(entry.value -> 'cacheWriteInputTokens') = 'number'
              AND jsonb_typeof(entry.value -> 'cacheReadInputTokens') = 'number'
              AND jsonb_typeof(entry.value -> 'outputTokens') = 'number'
              AND jsonb_typeof(entry.value -> 'totalTokens') = 'number'
              AND entry.value ->> 'totalInputTokens' ~ '^(0|[1-9][0-9]*)$'
              AND entry.value ->> 'uncachedInputTokens' ~ '^(0|[1-9][0-9]*)$'
              AND entry.value ->> 'cacheWriteInputTokens' ~ '^(0|[1-9][0-9]*)$'
              AND entry.value ->> 'cacheReadInputTokens' ~ '^(0|[1-9][0-9]*)$'
              AND entry.value ->> 'outputTokens' ~ '^(0|[1-9][0-9]*)$'
              AND entry.value ->> 'totalTokens' ~ '^(0|[1-9][0-9]*)$'
              AND CASE
                WHEN entry.value ->> 'totalInputTokens' ~ '^(0|[1-9][0-9]*)$'
                  AND entry.value ->> 'uncachedInputTokens' ~ '^(0|[1-9][0-9]*)$'
                  AND entry.value ->> 'cacheWriteInputTokens' ~ '^(0|[1-9][0-9]*)$'
                  AND entry.value ->> 'cacheReadInputTokens' ~ '^(0|[1-9][0-9]*)$'
                  AND entry.value ->> 'outputTokens' ~ '^(0|[1-9][0-9]*)$'
                  AND entry.value ->> 'totalTokens' ~ '^(0|[1-9][0-9]*)$'
                THEN (entry.value ->> 'totalInputTokens')::numeric =
                  (entry.value ->> 'uncachedInputTokens')::numeric +
                  (entry.value ->> 'cacheWriteInputTokens')::numeric +
                  (entry.value ->> 'cacheReadInputTokens')::numeric
                  AND (entry.value ->> 'totalTokens')::numeric =
                    (entry.value ->> 'totalInputTokens')::numeric +
                    (entry.value ->> 'outputTokens')::numeric
                ELSE false
              END
            ) AS all_entries_valid
          FROM jsonb_array_elements(candidate.usage -> 'entries') AS entry(value)
        ) AS entries
        WHERE jsonb_typeof(candidate.usage -> 'entries') = 'array'
          AND jsonb_typeof(candidate.usage -> 'totalInputTokens') = 'number'
          AND jsonb_typeof(candidate.usage -> 'uncachedInputTokens') = 'number'
          AND jsonb_typeof(candidate.usage -> 'cacheWriteInputTokens') = 'number'
          AND jsonb_typeof(candidate.usage -> 'cacheReadInputTokens') = 'number'
          AND jsonb_typeof(candidate.usage -> 'outputTokens') = 'number'
          AND jsonb_typeof(candidate.usage -> 'totalTokens') = 'number'
          AND candidate.usage ->> 'totalInputTokens' ~ '^(0|[1-9][0-9]*)$'
          AND candidate.usage ->> 'uncachedInputTokens' ~ '^(0|[1-9][0-9]*)$'
          AND candidate.usage ->> 'cacheWriteInputTokens' ~ '^(0|[1-9][0-9]*)$'
          AND candidate.usage ->> 'cacheReadInputTokens' ~ '^(0|[1-9][0-9]*)$'
          AND candidate.usage ->> 'outputTokens' ~ '^(0|[1-9][0-9]*)$'
          AND candidate.usage ->> 'totalTokens' ~ '^(0|[1-9][0-9]*)$'
          AND entries.entry_count > 0
          AND entries.all_entries_valid
          AND (candidate.usage ->> 'totalInputTokens')::numeric = entries.total_input_tokens
          AND (candidate.usage ->> 'uncachedInputTokens')::numeric = entries.uncached_input_tokens
          AND (candidate.usage ->> 'cacheWriteInputTokens')::numeric = entries.cache_write_input_tokens
          AND (candidate.usage ->> 'cacheReadInputTokens')::numeric = entries.cache_read_input_tokens
          AND (candidate.usage ->> 'outputTokens')::numeric = entries.output_tokens
          AND (candidate.usage ->> 'totalTokens')::numeric = entries.total_tokens
      ),
      aggregates AS (
        SELECT
          COUNT(*)::int AS turns_with_v2_text_usage_accounting,
          COALESCE(SUM(jsonb_array_length(usage -> 'entries')), 0)::int AS v2_text_usage_call_count,
          COUNT(*) FILTER (
            WHERE COALESCE((usage ->> 'cacheReadInputTokens')::numeric, 0) > 0
          )::int AS v2_cache_read_hit_turns,
          COALESCE(ROUND(AVG((usage ->> 'totalInputTokens')::numeric)), 0)::int AS avg_total_input_tokens,
          COALESCE(ROUND(AVG((usage ->> 'uncachedInputTokens')::numeric)), 0)::int AS avg_uncached_input_tokens,
          COALESCE(ROUND(AVG((usage ->> 'cacheWriteInputTokens')::numeric)), 0)::int AS avg_cache_write_input_tokens,
          COALESCE(ROUND(AVG((usage ->> 'cacheReadInputTokens')::numeric)), 0)::int AS avg_cache_read_input_tokens,
          COALESCE(ROUND(AVG((usage ->> 'outputTokens')::numeric)), 0)::int AS avg_output_tokens,
          COALESCE(ROUND(AVG((usage ->> 'totalTokens')::numeric)), 0)::int AS avg_total_tokens,
          COALESCE(ROUND(AVG(jsonb_array_length(usage -> 'entries'))), 0)::int AS avg_usage_steps_per_turn,
          CASE WHEN SUM((usage ->> 'totalInputTokens')::numeric) > 0 THEN
            (SUM((usage ->> 'cacheReadInputTokens')::numeric) * 100) /
            SUM((usage ->> 'totalInputTokens')::numeric)
          ELSE NULL END AS cache_read_share_percent,
          CASE WHEN SUM((usage ->> 'totalInputTokens')::numeric) > 0 THEN
            (SUM((usage ->> 'cacheWriteInputTokens')::numeric) * 100) /
            SUM((usage ->> 'totalInputTokens')::numeric)
          ELSE NULL END AS cache_write_share_percent,
          CASE WHEN COUNT(*) > 0 THEN
            (COUNT(*) FILTER (WHERE COALESCE((usage ->> 'cacheReadInputTokens')::numeric, 0) > 0) * 100.0) /
            COUNT(*)
          ELSE NULL END AS cache_read_hit_turn_share_percent
        FROM validated_v2_receipts
      )
      SELECT
        COUNT(*)::int AS completed_turns,
        aggregates.*
      FROM runtime_turn_receipts
      CROSS JOIN aggregates
      WHERE status = 'completed'
        AND completed_at IS NOT NULL
        AND completed_at >= ${windowStart}
    `;
    const row = rows[0];
    return {
      window: "last_7_days",
      completedTurns: row?.completed_turns ?? 0,
      turnsWithV2TextUsageAccounting: row?.turns_with_v2_text_usage_accounting ?? 0,
      v2TextUsageCallCount: row?.v2_text_usage_call_count ?? 0,
      v2CacheReadHitTurns: row?.v2_cache_read_hit_turns ?? 0,
      avgTotalInputTokens: row?.avg_total_input_tokens ?? 0,
      avgUncachedInputTokens: row?.avg_uncached_input_tokens ?? 0,
      avgCacheWriteInputTokens: row?.avg_cache_write_input_tokens ?? 0,
      avgCacheReadInputTokens: row?.avg_cache_read_input_tokens ?? 0,
      avgOutputTokens: row?.avg_output_tokens ?? 0,
      avgTotalTokens: row?.avg_total_tokens ?? 0,
      avgUsageStepsPerTurn: row?.avg_usage_steps_per_turn ?? 0,
      cacheReadSharePercent: row?.cache_read_share_percent ?? null,
      cacheWriteSharePercent: row?.cache_write_share_percent ?? null,
      cacheReadHitTurnSharePercent: row?.cache_read_hit_turn_share_percent ?? null
    };
  }
}
