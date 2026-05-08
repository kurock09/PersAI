import assert from "node:assert/strict";
import {
  QUOTA_ADVISORY_THRESHOLD_CODE,
  QuotaAdvisoryStateService
} from "../src/modules/workspace-management/application/quota-advisory-state.service";

async function run(): Promise<void> {
  const persisted = new Map<string, { dedupeKey: string; deliveredAt: Date }>();
  const service = new QuotaAdvisoryStateService({
    assistantQuotaAdvisoryState: {
      findMany: async () => [...persisted.values()],
      upsert: async ({
        where,
        create
      }: {
        where: { dedupeKey: string };
        create: {
          dedupeKey: string;
          deliveredAt: Date;
        };
      }) => {
        persisted.set(where.dedupeKey, {
          dedupeKey: create.dedupeKey,
          deliveredAt: create.deliveredAt
        });
        return null;
      }
    }
  } as never);

  const threadRequired = await service.resolveCandidates({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    threadContext: null,
    tokenBudgetPeriod: {
      periodStartedAt: "2026-05-01T00:00:00.000Z",
      periodEndsAt: "2026-06-01T00:00:00.000Z",
      periodSource: "subscription_period"
    },
    quotaBuckets: [
      {
        bucketCode: "token_budget",
        displayName: "Token budget",
        unit: "tokens",
        used: 95,
        limit: 100,
        percent: 95,
        finiteLimit: true,
        usageAvailable: true,
        warningThresholdPercent: 90,
        warningThresholdReached: true,
        status: "ok"
      }
    ],
    monthlyMediaQuotas: {
      planCode: "pro",
      periodStartedAt: "2026-05-01T00:00:00.000Z",
      periodEndsAt: "2026-06-01T00:00:00.000Z",
      periodSource: "subscription_period",
      tools: []
    },
    toolDailyLimits: []
  });
  assert.equal(threadRequired[0]?.deliveryState, "thread_context_required");
  assert.equal(threadRequired[0]?.thresholdCode, QUOTA_ADVISORY_THRESHOLD_CODE);

  const eligible = await service.resolveCandidates({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    threadContext: {
      channel: "web",
      externalThreadKey: "chat-thread-1"
    },
    tokenBudgetPeriod: {
      periodStartedAt: "2026-05-01T00:00:00.000Z",
      periodEndsAt: "2026-06-01T00:00:00.000Z",
      periodSource: "subscription_period"
    },
    quotaBuckets: [
      {
        bucketCode: "token_budget",
        displayName: "Token budget",
        unit: "tokens",
        used: 95,
        limit: 100,
        percent: 95,
        finiteLimit: true,
        usageAvailable: true,
        warningThresholdPercent: 90,
        warningThresholdReached: true,
        status: "ok"
      }
    ],
    monthlyMediaQuotas: {
      planCode: "pro",
      periodStartedAt: "2026-05-01T00:00:00.000Z",
      periodEndsAt: "2026-06-01T00:00:00.000Z",
      periodSource: "subscription_period",
      tools: []
    },
    toolDailyLimits: [
      {
        toolCode: "web_search",
        displayName: "Web Search",
        dailyCallLimit: 10,
        dailyCallsUsed: 9,
        percent: 90,
        finiteLimit: true,
        warningThresholdPercent: 90,
        warningThresholdReached: true,
        periodStartedAt: "2026-05-08T00:00:00.000Z",
        periodEndsAt: "2026-05-09T00:00:00.000Z",
        periodSource: "utc_day",
        active: true
      }
    ]
  });
  assert.equal(eligible.length, 2);
  assert.equal(
    eligible.every((candidate) => candidate.deliveryState === "eligible"),
    true
  );

  await service.recordDeliveredCandidates({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    threadContext: {
      channel: "web",
      externalThreadKey: "chat-thread-1"
    },
    candidates: eligible
  });

  const deduped = await service.resolveCandidates({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    threadContext: {
      channel: "web",
      externalThreadKey: "chat-thread-1"
    },
    tokenBudgetPeriod: {
      periodStartedAt: "2026-05-01T00:00:00.000Z",
      periodEndsAt: "2026-06-01T00:00:00.000Z",
      periodSource: "subscription_period"
    },
    quotaBuckets: [
      {
        bucketCode: "token_budget",
        displayName: "Token budget",
        unit: "tokens",
        used: 95,
        limit: 100,
        percent: 95,
        finiteLimit: true,
        usageAvailable: true,
        warningThresholdPercent: 90,
        warningThresholdReached: true,
        status: "ok"
      }
    ],
    monthlyMediaQuotas: {
      planCode: "pro",
      periodStartedAt: "2026-05-01T00:00:00.000Z",
      periodEndsAt: "2026-06-01T00:00:00.000Z",
      periodSource: "subscription_period",
      tools: []
    },
    toolDailyLimits: []
  });
  assert.equal(deduped[0]?.deliveryState, "already_sent");
  assert.equal(typeof deduped[0]?.deliveredAt, "string");
}

void run();
