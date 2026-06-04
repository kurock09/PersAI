import assert from "node:assert/strict";
import { TrackWorkspaceQuotaUsageService } from "../src/modules/workspace-management/application/track-workspace-quota-usage.service";
import type { ManageMediaPackagePurchaseService } from "../src/modules/workspace-management/application/manage-media-package-purchase.service";
import type { ResolveEffectiveSubscriptionStateService } from "../src/modules/workspace-management/application/resolve-effective-subscription-state.service";
import type { EffectiveSubscriptionState } from "../src/modules/workspace-management/application/effective-subscription.types";
import type { ResolvePlatformRuntimeProviderSettingsService } from "../src/modules/workspace-management/application/resolve-platform-runtime-provider-settings.service";
import type { AssistantGovernanceRepository } from "../src/modules/workspace-management/domain/assistant-governance.repository";
import type { AssistantPlanCatalogRepository } from "../src/modules/workspace-management/domain/assistant-plan-catalog.repository";
import type {
  FindMonthlyMediaQuotaCounterInput,
  FindTokenBudgetPeriodCounterInput,
  MonthlyMediaQuotaMutationInput,
  WorkspaceQuotaAccountingRepository
} from "../src/modules/workspace-management/domain/workspace-quota-accounting.repository";
import type { WorkspaceToolDailyUsageRepository } from "../src/modules/workspace-management/domain/workspace-tool-daily-usage.repository";

type GovernanceRepoStub = Pick<AssistantGovernanceRepository, "findByAssistantId">;
type PlanRepoStub = Pick<AssistantPlanCatalogRepository, "findByCode">;
type QuotaRepoStub = Pick<
  WorkspaceQuotaAccountingRepository,
  | "findByWorkspaceId"
  | "findTokenBudgetPeriodCounter"
  | "findMonthlyMediaQuotaCounter"
  | "reserveMonthlyMediaQuota"
  | "settleMonthlyMediaQuota"
  | "releaseMonthlyMediaQuota"
  | "markMonthlyMediaQuotaReconciliationRequired"
  | "applyTokenBudgetUsage"
  | "applyKnowledgeStorageUsage"
  | "releaseKnowledgeStorageUsage"
  | "refreshActiveWebChatsUsage"
>;
type ToolDailyUsageRepoStub = Pick<
  WorkspaceToolDailyUsageRepository,
  "incrementAndGet" | "getUsageForDate" | "consumeWithinLimit"
>;
type SubscriptionResolverStub = Pick<ResolveEffectiveSubscriptionStateService, "execute">;
type RuntimeProviderSettingsResolverStub = Pick<
  ResolvePlatformRuntimeProviderSettingsService,
  "execute"
>;

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-api-token";
  process.env.QUOTA_TOKEN_BUDGET_DEFAULT = "200000";
  process.env.QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT = "1000";
  process.env.QUOTA_MEDIA_STORAGE_BYTES_DEFAULT = "104857600";
  process.env.QUOTA_KNOWLEDGE_STORAGE_BYTES_DEFAULT = "104857600";
  process.env.WEB_ACTIVE_CHATS_CAP = "20";

  const tokenCalls: Array<{
    delta: bigint;
    source: string;
    metadata: Record<string, unknown> | null;
    periodStartedAt: Date;
    periodEndsAt: Date;
  }> = [];
  const refreshCalls: Array<{ currentActiveWebChats: number; source: string }> = [];
  const knowledgeApplyCalls: Array<{
    delta: bigint;
    source: string;
    metadata: Record<string, unknown> | null;
    limit: bigint | null;
  }> = [];
  const knowledgeReleaseCalls: Array<{ delta: bigint; source: string }> = [];
  const monthlyMediaCalls: Array<{
    operation: "reserve" | "settle" | "release" | "reconcile";
    input: MonthlyMediaQuotaMutationInput;
  }> = [];

  const governanceRepo: GovernanceRepoStub = {
    async findByAssistantId() {
      return {
        id: "gov-1",
        assistantId: "assistant-1",
        capabilityEnvelope: null,
        secretRefs: null,
        policyEnvelope: null,
        memoryControl: null,
        tasksControl: null,
        quotaPlanCode: "starter_trial",
        quotaHook: null,
        auditHook: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }
  };

  const planRepo: PlanRepoStub = {
    async findByCode(code: string) {
      assert.equal(code, "starter_trial");
      return {
        id: "plan-1",
        code: "starter_trial",
        displayName: "Starter Trial",
        description: null,
        status: "active",
        billingProviderHints: {
          quotaAccounting: {
            tokenBudgetLimit: 120000,
            costOrTokenDrivingToolClassUnitsLimit: 600,
            imageGenerateMonthlyUnitsLimit: 12,
            imageEditMonthlyUnitsLimit: 6,
            knowledgeStorageBytesLimit: 32
          }
        },
        entitlementModel: {
          schemaVersion: 1,
          capabilities: [],
          toolClasses: [{ key: "cost_driving", allowed: true, quotaGoverned: true }],
          channelsAndSurfaces: []
        },
        isDefaultFirstRegistrationPlan: true,
        isTrialPlan: true,
        trialDurationDays: 14,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }
  };

  const quotaRepo: QuotaRepoStub = {
    async findByWorkspaceId() {
      return {
        id: "state-1",
        workspaceId: "workspace-1",
        tokenBudgetUsed: BigInt(0),
        tokenBudgetLimit: BigInt(120000),
        costOrTokenDrivingToolClassUnitsUsed: 0,
        costOrTokenDrivingToolClassUnitsLimit: 600,
        activeWebChatsCurrent: 0,
        activeWebChatsLimit: 20,
        mediaStorageBytesUsed: BigInt(0),
        mediaStorageBytesLimit: BigInt(104857600),
        knowledgeStorageBytesUsed: BigInt(10),
        knowledgeStorageBytesLimit: BigInt(32),
        lastComputedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };
    },
    async findMonthlyMediaQuotaCounter(input: FindMonthlyMediaQuotaCounterInput) {
      if (input.toolCode !== "image_generate") {
        return null;
      }
      return {
        workspaceId: input.workspaceId,
        toolCode: input.toolCode,
        periodStartedAt: input.periodStartedAt,
        periodEndsAt: input.periodEndsAt,
        reservedUnits: 1,
        settledUnits: 3,
        releasedUnits: 1,
        reconciliationRequiredUnits: 2,
        limitUnits: 12,
        lastComputedAt: new Date("2026-05-03T00:00:00.000Z")
      };
    },
    async reserveMonthlyMediaQuota(input) {
      monthlyMediaCalls.push({ operation: "reserve", input });
      return {
        allowed: input.units <= 2,
        currentUsedUnits: 4 + input.units,
        limitUnits: input.limitUnits,
        counter: {
          workspaceId: input.workspaceId,
          toolCode: input.toolCode,
          periodStartedAt: input.periodStartedAt,
          periodEndsAt: input.periodEndsAt,
          reservedUnits: input.units,
          settledUnits: 3,
          releasedUnits: 1,
          reconciliationRequiredUnits: 0,
          limitUnits: input.limitUnits,
          lastComputedAt: new Date("2026-05-03T00:00:00.000Z")
        }
      };
    },
    async settleMonthlyMediaQuota(input) {
      monthlyMediaCalls.push({ operation: "settle", input });
      return {
        workspaceId: input.workspaceId,
        toolCode: input.toolCode,
        periodStartedAt: input.periodStartedAt,
        periodEndsAt: input.periodEndsAt,
        reservedUnits: 0,
        settledUnits: input.units,
        releasedUnits: 0,
        reconciliationRequiredUnits: 0,
        limitUnits: input.limitUnits,
        lastComputedAt: new Date("2026-05-03T00:00:00.000Z")
      };
    },
    async releaseMonthlyMediaQuota(input) {
      monthlyMediaCalls.push({ operation: "release", input });
      return {
        workspaceId: input.workspaceId,
        toolCode: input.toolCode,
        periodStartedAt: input.periodStartedAt,
        periodEndsAt: input.periodEndsAt,
        reservedUnits: 0,
        settledUnits: 0,
        releasedUnits: input.units,
        reconciliationRequiredUnits: 0,
        limitUnits: input.limitUnits,
        lastComputedAt: new Date("2026-05-03T00:00:00.000Z")
      };
    },
    async markMonthlyMediaQuotaReconciliationRequired(input) {
      monthlyMediaCalls.push({ operation: "reconcile", input });
      return {
        workspaceId: input.workspaceId,
        toolCode: input.toolCode,
        periodStartedAt: input.periodStartedAt,
        periodEndsAt: input.periodEndsAt,
        reservedUnits: 0,
        settledUnits: 0,
        releasedUnits: 0,
        reconciliationRequiredUnits: input.units,
        limitUnits: input.limitUnits,
        lastComputedAt: new Date("2026-05-03T00:00:00.000Z")
      };
    },
    async findTokenBudgetPeriodCounter(input: FindTokenBudgetPeriodCounterInput) {
      return {
        workspaceId: input.workspaceId,
        periodStartedAt: input.periodStartedAt,
        periodEndsAt: input.periodEndsAt,
        usedCredits: BigInt(17),
        limitCredits: BigInt(120000),
        lastComputedAt: new Date("2026-05-03T00:00:00.000Z")
      };
    },
    async applyTokenBudgetUsage(input) {
      tokenCalls.push({
        delta: input.delta,
        source: input.source,
        metadata: input.metadata,
        periodStartedAt: input.periodStartedAt,
        periodEndsAt: input.periodEndsAt
      });
      return {
        appliedDelta: input.delta,
        capped: false,
        counter: {
          workspaceId: input.workspaceId,
          periodStartedAt: input.periodStartedAt,
          periodEndsAt: input.periodEndsAt,
          usedCredits: BigInt(17) + input.delta,
          limitCredits: input.limits.tokenBudgetLimit,
          lastComputedAt: new Date()
        },
        state: {
          id: "state-1",
          workspaceId: input.workspaceId,
          tokenBudgetUsed: input.delta,
          tokenBudgetLimit: input.limits.tokenBudgetLimit,
          costOrTokenDrivingToolClassUnitsUsed: 0,
          costOrTokenDrivingToolClassUnitsLimit: input.limits.costOrTokenDrivingToolClassUnitsLimit,
          activeWebChatsCurrent: 0,
          activeWebChatsLimit: input.limits.activeWebChatsLimit,
          mediaStorageBytesUsed: BigInt(0),
          mediaStorageBytesLimit: input.limits.mediaStorageBytesLimit,
          knowledgeStorageBytesUsed: BigInt(10),
          knowledgeStorageBytesLimit: input.limits.knowledgeStorageBytesLimit,
          lastComputedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        }
      };
    },
    async applyKnowledgeStorageUsage(input) {
      knowledgeApplyCalls.push({
        delta: input.delta,
        source: input.source,
        metadata: input.metadata,
        limit: input.limits.knowledgeStorageBytesLimit
      });
      return {
        appliedDelta: input.delta,
        capped: false,
        state: {
          id: "state-1",
          workspaceId: input.workspaceId,
          tokenBudgetUsed: BigInt(0),
          tokenBudgetLimit: input.limits.tokenBudgetLimit,
          costOrTokenDrivingToolClassUnitsUsed: 0,
          costOrTokenDrivingToolClassUnitsLimit: input.limits.costOrTokenDrivingToolClassUnitsLimit,
          activeWebChatsCurrent: 0,
          activeWebChatsLimit: input.limits.activeWebChatsLimit,
          mediaStorageBytesUsed: BigInt(0),
          mediaStorageBytesLimit: input.limits.mediaStorageBytesLimit,
          knowledgeStorageBytesUsed: BigInt(10) + input.delta,
          knowledgeStorageBytesLimit: input.limits.knowledgeStorageBytesLimit,
          lastComputedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        }
      };
    },
    async releaseKnowledgeStorageUsage(input) {
      knowledgeReleaseCalls.push({
        delta: input.delta,
        source: input.source
      });
      return {
        releasedDelta: input.delta,
        state: {
          id: "state-1",
          workspaceId: input.workspaceId,
          tokenBudgetUsed: BigInt(0),
          tokenBudgetLimit: input.limits.tokenBudgetLimit,
          costOrTokenDrivingToolClassUnitsUsed: 0,
          costOrTokenDrivingToolClassUnitsLimit: input.limits.costOrTokenDrivingToolClassUnitsLimit,
          activeWebChatsCurrent: 0,
          activeWebChatsLimit: input.limits.activeWebChatsLimit,
          mediaStorageBytesUsed: BigInt(0),
          mediaStorageBytesLimit: input.limits.mediaStorageBytesLimit,
          knowledgeStorageBytesUsed: BigInt(10),
          knowledgeStorageBytesLimit: input.limits.knowledgeStorageBytesLimit,
          lastComputedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        }
      };
    },
    async refreshActiveWebChatsUsage(input) {
      refreshCalls.push({
        currentActiveWebChats: input.currentActiveWebChats,
        source: input.source
      });
      return {
        id: "state-1",
        workspaceId: input.workspaceId,
        tokenBudgetUsed: BigInt(0),
        tokenBudgetLimit: input.limits.tokenBudgetLimit,
        costOrTokenDrivingToolClassUnitsUsed: 0,
        costOrTokenDrivingToolClassUnitsLimit: input.limits.costOrTokenDrivingToolClassUnitsLimit,
        activeWebChatsCurrent: input.currentActiveWebChats,
        activeWebChatsLimit: input.limits.activeWebChatsLimit,
        mediaStorageBytesUsed: BigInt(0),
        mediaStorageBytesLimit: input.limits.mediaStorageBytesLimit,
        knowledgeStorageBytesUsed: BigInt(10),
        knowledgeStorageBytesLimit: input.limits.knowledgeStorageBytesLimit,
        lastComputedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }
  };

  let effectiveSubscription: EffectiveSubscriptionState = {
    source: "assistant_plan_fallback",
    status: "unconfigured",
    planCode: "starter_trial",
    trialEndsAt: null,
    currentPeriodStartedAt: null,
    currentPeriodEndsAt: null,
    cancelAtPeriodEnd: false
  };

  const subscriptionResolver: SubscriptionResolverStub = {
    async execute() {
      return effectiveSubscription;
    }
  };

  const toolDailyUsageRepo: ToolDailyUsageRepoStub = {
    async incrementAndGet() {
      return 1;
    },
    async getUsageForDate() {
      return 0;
    },
    async consumeWithinLimit(_workspaceId: string, _toolCode: string, dailyCallLimit: number) {
      return {
        allowed: true,
        currentCount: dailyCallLimit
      };
    }
  };
  const runtimeProviderSettingsResolver: RuntimeProviderSettingsResolverStub = {
    async execute() {
      return {
        schema: "persai.runtimeProviderProfile.v1",
        mode: "admin_managed",
        derivedFrom: {
          policyEnvelopeSchema: "persai.runtimeProviderProfile.v1",
          secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1"
        },
        allowedProviders: ["openai", "anthropic"],
        availableModelsByProvider: {
          openai: ["gpt-5-mini"],
          anthropic: []
        },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-5-mini",
                capabilities: ["chat"],
                active: true,
                billingMode: "token_metered",
                effectiveFrom: null,
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 0.25,
                outputTokenWeight: 4,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: { inputPer1M: 0, cachedInputPer1M: 0, outputPer1M: 0 },
                  timePricing: null,
                  fixedOperationPricing: null,
                  tieredOperationPricing: null
                }
              }
            ]
          },
          anthropic: { models: [] }
        },
        primary: {
          provider: "openai",
          model: "gpt-5-mini",
          credentialRef: {
            refKey: "env:openai:OPENAI_API_KEY",
            secretRef: { source: "env", provider: "openai", id: "OPENAI_API_KEY" },
            updatedAt: null
          }
        },
        fallback: null,
        notes: []
      };
    }
  };

  const service = new TrackWorkspaceQuotaUsageService(
    governanceRepo as AssistantGovernanceRepository,
    planRepo as AssistantPlanCatalogRepository,
    quotaRepo as WorkspaceQuotaAccountingRepository,
    toolDailyUsageRepo as WorkspaceToolDailyUsageRepository,
    subscriptionResolver as ResolveEffectiveSubscriptionStateService,
    runtimeProviderSettingsResolver as ResolvePlatformRuntimeProviderSettingsService,
    {
      resolveActiveBonus: async (_workspaceId: string, toolCode: string) => ({
        toolCode,
        bonusUnits: 0,
        latestPeriodEndsAt: null,
        grantIds: []
      }),
      resolveAllActiveBonuses: async (_workspaceId: string) => ({
        image_generate: {
          toolCode: "image_generate",
          bonusUnits: 0,
          latestPeriodEndsAt: null,
          grantIds: []
        },
        image_edit: {
          toolCode: "image_edit",
          bonusUnits: 0,
          latestPeriodEndsAt: null,
          grantIds: []
        },
        video_generate: {
          toolCode: "video_generate",
          bonusUnits: 0,
          latestPeriodEndsAt: null,
          grantIds: []
        }
      }),
      createPackagePaymentIntent: async () => {
        throw new Error("not implemented in test stub");
      },
      fulfillPackagePaymentIntent: async () => {}
    } as unknown as ManageMediaPackagePurchaseService
  );

  const assistant = {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    draftDisplayName: null,
    draftInstructions: null,
    draftUpdatedAt: null,
    applyStatus: "succeeded",
    applyTargetVersionId: null,
    applyAppliedVersionId: null,
    applyRequestedAt: null,
    applyStartedAt: null,
    applyFinishedAt: null,
    applyErrorCode: null,
    applyErrorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date()
  } as const;

  await service.recordWebChatTurnUsage({
    assistant,
    userContent: "hello world",
    assistantContent: "response from assistant",
    usageAccounting: {
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 25,
      totalTokens: 125,
      entries: [
        {
          stepType: "main_turn",
          modelRole: "normal_reply",
          providerKey: "openai",
          modelKey: "gpt-5-mini",
          inputTokens: 100,
          cachedInputTokens: 40,
          outputTokens: 25,
          totalTokens: 125
        }
      ]
    },
    source: "web_chat_turn_sync"
  });

  await service.refreshActiveWebChatsUsage({
    assistant,
    activeWebChatsCurrent: 7,
    source: "web_chat_archive"
  });

  const knowledgeQuota = await service.checkKnowledgeStorageQuota(assistant);
  const knowledgeUpload = await service.recordKnowledgeStorageUpload({
    assistant,
    sizeBytes: BigInt(9),
    source: "assistant_knowledge_upload",
    metadata: { filename: "gazprom.pdf" }
  });
  const knowledgeRelease = await service.releaseKnowledgeStorage({
    assistant,
    sizeBytes: BigInt(4),
    source: "assistant_reset_knowledge_cleanup"
  });
  const toolLimit = await service.consumeToolDailyLimit({
    assistant,
    toolCode: "web_search",
    dailyCallLimit: 3
  });
  const monthlyToolQuota = await service.resolveAssistantMonthlyToolQuotaSnapshot(assistant);
  const tokenBudgetQuota = await service.resolveAssistantTokenBudgetQuotaSnapshot(assistant);
  const reservedMonthlyMediaQuota = await service.reserveAssistantMonthlyMediaQuota({
    assistant,
    toolCode: "image_generate",
    units: 2
  });
  await service.settleAssistantMonthlyMediaQuota({
    assistant,
    toolCode: "image_generate",
    units: 1
  });
  await service.releaseAssistantMonthlyMediaQuota({
    assistant,
    toolCode: "image_edit",
    units: 1
  });
  await service.markAssistantMonthlyMediaQuotaReconciliationRequired({
    assistant,
    toolCode: "video_generate",
    units: 1
  });

  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0]?.delta, BigInt(170));
  assert.equal(tokenCalls[0]?.metadata?.accounting, "runtime_usage_accounting_weighted_v1");
  assert.equal(tokenCalls[0]?.metadata?.cachedInputTokens, 40);
  assert.equal(refreshCalls.length, 1);
  assert.equal(refreshCalls[0]?.currentActiveWebChats, 7);
  assert.deepEqual(knowledgeQuota, {
    allowed: true,
    usedBytes: BigInt(10),
    limitBytes: BigInt(32)
  });
  assert.equal(knowledgeApplyCalls.length, 1);
  assert.deepEqual(knowledgeApplyCalls[0], {
    delta: BigInt(9),
    source: "assistant_knowledge_upload",
    metadata: { filename: "gazprom.pdf" },
    limit: BigInt(32)
  });
  assert.equal(knowledgeUpload.appliedDelta, BigInt(9));
  assert.equal(knowledgeRelease.releasedDelta, BigInt(4));
  assert.deepEqual(knowledgeReleaseCalls, [
    {
      delta: BigInt(4),
      source: "assistant_reset_knowledge_cleanup"
    }
  ]);
  assert.deepEqual(toolLimit, {
    allowed: true,
    currentCount: 3,
    limit: 3
  });
  assert.equal(monthlyToolQuota.periodSource, "calendar_month_fallback");
  assert.equal(tokenBudgetQuota.periodSource, "calendar_month_fallback");
  assert.equal(tokenBudgetQuota.usedCredits, BigInt(17));
  assert.equal(tokenBudgetQuota.limitCredits, BigInt(120000));
  assert.equal(
    monthlyToolQuota.tools.find((tool) => tool.toolCode === "image_generate")?.usedUnits,
    4
  );
  assert.equal(
    monthlyToolQuota.tools.find((tool) => tool.toolCode === "image_generate")
      ?.reconciliationRequiredUnits,
    2
  );
  assert.equal(
    monthlyToolQuota.tools.find((tool) => tool.toolCode === "image_generate")?.remainingUnits,
    8
  );
  assert.equal(
    monthlyToolQuota.tools.find((tool) => tool.toolCode === "image_generate")?.limitUnits,
    12
  );
  assert.equal(
    monthlyToolQuota.tools.find((tool) => tool.toolCode === "image_edit")?.limitUnits,
    6
  );
  assert.deepEqual(reservedMonthlyMediaQuota, {
    allowed: true,
    currentUsedUnits: 6,
    limitUnits: 12,
    periodStartedAt: monthlyToolQuota.periodStartedAt,
    periodEndsAt: monthlyToolQuota.periodEndsAt,
    periodSource: "calendar_month_fallback"
  });
  assert.deepEqual(
    monthlyMediaCalls.map((call) => ({
      operation: call.operation,
      toolCode: call.input.toolCode,
      units: call.input.units,
      limitUnits: call.input.limitUnits
    })),
    [
      {
        operation: "reserve",
        toolCode: "image_generate",
        units: 2,
        limitUnits: 12
      },
      {
        operation: "settle",
        toolCode: "image_generate",
        units: 1,
        limitUnits: 12
      },
      {
        operation: "release",
        toolCode: "image_edit",
        units: 1,
        limitUnits: 6
      },
      {
        // ADR-108 Slice 8 — `video_generate` has no plan-side unit
        // limit anymore; the limit threaded into the reconcile call is
        // null because the tool is VC-priced.
        operation: "reconcile",
        toolCode: "video_generate",
        units: 1,
        limitUnits: null
      }
    ]
  );

  effectiveSubscription = {
    source: "workspace_subscription",
    status: "active",
    planCode: "starter_trial",
    trialEndsAt: null,
    currentPeriodStartedAt: "2026-05-03T00:00:00.000Z",
    currentPeriodEndsAt: "2026-06-03T00:00:00.000Z",
    cancelAtPeriodEnd: false
  };
  const recoveredPeriodToolQuota =
    await service.resolveAssistantMonthlyToolQuotaSnapshot(assistant);
  const recoveredPeriodTokenBudget =
    await service.resolveAssistantTokenBudgetQuotaSnapshot(assistant);
  assert.equal(recoveredPeriodToolQuota.periodSource, "subscription_period");
  assert.equal(recoveredPeriodToolQuota.periodStartedAt, "2026-05-03T00:00:00.000Z");
  assert.equal(recoveredPeriodToolQuota.periodEndsAt, "2026-06-03T00:00:00.000Z");
  assert.equal(recoveredPeriodTokenBudget.periodSource, "subscription_period");
  assert.equal(recoveredPeriodTokenBudget.periodStartedAt, "2026-05-03T00:00:00.000Z");
  assert.equal(recoveredPeriodTokenBudget.periodEndsAt, "2026-06-03T00:00:00.000Z");
}

void run();
