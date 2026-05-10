import assert from "node:assert/strict";
import { ResolvePlanVisibilityService } from "../src/modules/workspace-management/application/resolve-plan-visibility.service";

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
  process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "sk_test_1234567890123456";
  process.env.PERSAI_INTERNAL_API_TOKEN =
    process.env.PERSAI_INTERNAL_API_TOKEN ?? "internal-token-1234567890";
  let adminAuthCalls = 0;

  const service = new ResolvePlanVisibilityService(
    {
      async findByUserId(userId: string) {
        assert.equal(userId, "user-1");
        return {
          id: "assistant-1",
          userId,
          workspaceId: "ws-1",
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
        };
      }
    } as never,
    {
      async findByAssistantId(assistantId: string) {
        assert.equal(assistantId, "assistant-1");
        return {
          id: "gov-1",
          assistantId,
          capabilityEnvelope: null,
          secretRefs: null,
          policyEnvelope: null,
          assistantPlanOverrideCode: null,
          memoryControl: null,
          tasksControl: null,
          quotaPlanCode: "pro",
          quotaHook: null,
          auditHook: null,
          platformManagedUpdatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }
    } as never,
    {
      async findByCode(code: string) {
        assert.equal(code, "pro");
        return {
          id: "plan-1",
          code: "pro",
          displayName: "Pro",
          description: null,
          status: "active",
          billingProviderHints: {
            lifecyclePolicy: {
              schema: "persai.planLifecyclePolicy.v1",
              trialFallbackPlanCode: "free"
            },
            presentation: {
              price: {
                amount: 980,
                currency: "RUB",
                billingPeriod: "month"
              }
            },
            quotaAccounting: {
              tokenBudgetLimit: 5000
            }
          },
          entitlementModel: {
            schemaVersion: 1,
            capabilities: [],
            toolClasses: [],
            channelsAndSurfaces: [],
            mediaClasses: [],
            limitsPermissions: []
          },
          toolActivations: [
            {
              toolCode: "memory_search",
              displayName: "Memory Search",
              toolClass: "utility",
              policyClass: "plan_managed",
              activationStatus: "active",
              dailyCallLimit: 25
            },
            {
              toolCode: "persai_workspace_attach",
              displayName: "Workspace Attach",
              toolClass: "utility",
              policyClass: "platform_managed",
              activationStatus: "active",
              dailyCallLimit: null
            },
            {
              toolCode: "image_generate",
              displayName: "Image Generate",
              toolClass: "cost_driving",
              policyClass: "plan_managed",
              activationStatus: "inactive",
              dailyCallLimit: 3
            }
          ],
          isDefaultFirstRegistrationPlan: false,
          isTrialPlan: true,
          trialDurationDays: 7,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      },
      async listAll() {
        return [
          {
            id: "plan-free",
            code: "free",
            displayName: "Free",
            description: null,
            status: "inactive",
            billingProviderHints: null,
            entitlementModel: null,
            toolActivations: [],
            isDefaultFirstRegistrationPlan: true,
            isTrialPlan: false,
            trialDurationDays: null,
            createdAt: new Date(),
            updatedAt: new Date()
          },
          {
            id: "plan-1",
            code: "pro",
            displayName: "Pro",
            description: null,
            status: "active",
            billingProviderHints: {
              lifecyclePolicy: {
                schema: "persai.planLifecyclePolicy.v1",
                trialFallbackPlanCode: "free"
              },
              quotaAccounting: {
                tokenBudgetLimit: 5000
              }
            },
            entitlementModel: {
              schemaVersion: 1,
              capabilities: [],
              toolClasses: [],
              channelsAndSurfaces: [],
              mediaClasses: [],
              limitsPermissions: []
            },
            toolActivations: [
              {
                toolCode: "memory_search",
                displayName: "Memory Search",
                toolClass: "utility",
                policyClass: "plan_managed",
                activationStatus: "active",
                dailyCallLimit: 25
              }
            ],
            isDefaultFirstRegistrationPlan: false,
            isTrialPlan: true,
            trialDurationDays: 7,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ];
      }
    } as never,
    {
      async execute() {
        return {
          source: "workspace_subscription",
          status: "active",
          planCode: "pro",
          trialEndsAt: null,
          currentPeriodEndsAt: null,
          cancelAtPeriodEnd: false
        };
      }
    } as never,
    {
      async execute() {
        return {
          schema: "persai.effectiveCapabilities.v1",
          derivedFrom: {
            planCode: "pro",
            planStatus: "active",
            governanceSchema: null
          },
          subscription: {
            source: "workspace_subscription",
            status: "active",
            planCode: "pro",
            trialEndsAt: null,
            currentPeriodEndsAt: null,
            cancelAtPeriodEnd: false
          },
          toolClasses: {
            costDriving: {
              allowed: true,
              quotaGoverned: true
            },
            utility: {
              allowed: true,
              quotaGoverned: true
            }
          },
          channelsAndSurfaces: {
            webChat: true,
            telegram: true,
            whatsapp: false,
            max: false
          },
          mediaClasses: {
            text: true,
            image: true,
            audio: false,
            video: false,
            file: true
          }
        };
      }
    } as never,
    {
      async resolveAssistantQuotaSnapshot(assistant: { id: string; workspaceId: string }) {
        assert.equal(assistant.id, "assistant-1");
        assert.equal(assistant.workspaceId, "ws-1");
        return {
          planCode: "pro",
          buckets: [
            {
              bucketCode: "token_budget",
              displayName: "Token budget",
              unit: "tokens",
              used: 1250,
              limit: 5000,
              percent: 25,
              finiteLimit: true,
              usageAvailable: true,
              warningThresholdPercent: 90,
              warningThresholdReached: false,
              status: "ok"
            },
            {
              bucketCode: "active_web_chats",
              displayName: "Active web chats",
              unit: "count",
              used: 2,
              limit: 5,
              percent: 40,
              finiteLimit: true,
              usageAvailable: true,
              warningThresholdPercent: 90,
              warningThresholdReached: false,
              status: "ok"
            },
            {
              bucketCode: "media_storage_bytes",
              displayName: "Media storage",
              unit: "bytes",
              used: 2048,
              limit: 8192,
              percent: 25,
              finiteLimit: true,
              usageAvailable: true,
              warningThresholdPercent: 90,
              warningThresholdReached: false,
              status: "ok"
            },
            {
              bucketCode: "knowledge_storage_bytes",
              displayName: "Knowledge storage",
              unit: "bytes",
              used: 1024,
              limit: 4096,
              percent: 25,
              finiteLimit: true,
              usageAvailable: true,
              warningThresholdPercent: 90,
              warningThresholdReached: false,
              status: "ok"
            }
          ]
        };
      },
      async resolveAssistantTokenBudgetQuotaSnapshot() {
        return {
          usedCredits: BigInt(1250),
          limitCredits: BigInt(5000),
          periodStartedAt: "2026-05-01T00:00:00.000Z",
          periodEndsAt: "2026-06-01T00:00:00.000Z",
          periodSource: "subscription_period" as const
        };
      },
      async resolveAssistantMonthlyMediaQuotaSnapshot(assistant: {
        id: string;
        workspaceId: string;
      }) {
        assert.equal(assistant.id, "assistant-1");
        assert.equal(assistant.workspaceId, "ws-1");
        return {
          planCode: "pro",
          periodStartedAt: "2026-05-01T00:00:00.000Z",
          periodEndsAt: "2026-06-01T00:00:00.000Z",
          periodSource: "subscription_period",
          tools: [
            {
              toolCode: "image_generate",
              displayName: "Image generation",
              usedUnits: 2,
              reservedUnits: 0,
              settledUnits: 2,
              releasedUnits: 0,
              reconciliationRequiredUnits: 0,
              limitUnits: 20,
              remainingUnits: 18,
              percent: 10,
              finiteLimit: true,
              usageAvailable: true,
              warningThresholdPercent: 90,
              warningThresholdReached: false,
              status: "ok"
            },
            {
              toolCode: "image_edit",
              displayName: "Image editing",
              usedUnits: 0,
              reservedUnits: 0,
              settledUnits: 0,
              releasedUnits: 0,
              reconciliationRequiredUnits: 0,
              limitUnits: null,
              remainingUnits: null,
              percent: null,
              finiteLimit: false,
              usageAvailable: true,
              warningThresholdPercent: null,
              warningThresholdReached: false,
              status: "ok"
            },
            {
              toolCode: "video_generate",
              displayName: "Video generation",
              usedUnits: 0,
              reservedUnits: 0,
              settledUnits: 0,
              releasedUnits: 0,
              reconciliationRequiredUnits: 0,
              limitUnits: null,
              remainingUnits: null,
              percent: null,
              finiteLimit: false,
              usageAvailable: true,
              warningThresholdPercent: null,
              warningThresholdReached: false,
              status: "ok"
            }
          ]
        };
      },
      async checkToolDailyLimit(params: {
        workspaceId: string;
        toolCode: string;
        dailyCallLimit: number | null;
      }) {
        return {
          allowed: true,
          currentCount: params.dailyCallLimit === null ? 0 : 3,
          limit: params.dailyCallLimit,
          periodStartedAt: "2026-05-08T00:00:00.000Z",
          periodEndsAt: "2026-05-09T00:00:00.000Z",
          periodSource: "utc_day" as const
        };
      }
    } as never,
    {
      async assertCanReadAdminSurface(userId: string) {
        adminAuthCalls += 1;
        assert.equal(userId, "user-1");
      }
    } as never,
    {
      async listPublicPricingPlans() {
        return [
          {
            code: "free",
            displayName: "Free",
            description: "Free plan",
            enabledToolCodes: [],
            presentation: {
              highlighted: false,
              title: { ru: "Бесплатно", en: "Free" },
              subtitle: { ru: null, en: null },
              notes: { ru: null, en: null },
              badge: { ru: null, en: null },
              ctaLabel: { ru: "Выбрать", en: "Choose" },
              price: {
                amount: 0,
                currency: "RUB",
                billingPeriod: "month" as const
              },
              highlightItems: { ru: [], en: [] }
            },
            quotaLimits: {
              tokenBudgetLimit: 0,
              activeWebChatsLimit: 1,
              messagesPerChat: 20,
              imageGenerateMonthlyUnitsLimit: 0,
              imageEditMonthlyUnitsLimit: 0,
              videoGenerateMonthlyUnitsLimit: 0
            }
          },
          {
            code: "pro",
            displayName: "Pro",
            description: "Pro plan",
            enabledToolCodes: ["memory_search"],
            presentation: {
              highlighted: true,
              title: { ru: "Про", en: "Pro" },
              subtitle: { ru: null, en: null },
              notes: { ru: null, en: null },
              badge: { ru: "Хит", en: "Popular" },
              ctaLabel: { ru: "Открыть", en: "Open" },
              price: {
                amount: 980,
                currency: "RUB",
                billingPeriod: "month" as const
              },
              highlightItems: { ru: ["Больше лимитов"], en: ["Higher limits"] }
            },
            quotaLimits: {
              tokenBudgetLimit: 5000,
              activeWebChatsLimit: 5,
              messagesPerChat: 100,
              imageGenerateMonthlyUnitsLimit: 0,
              imageEditMonthlyUnitsLimit: 0,
              videoGenerateMonthlyUnitsLimit: 0
            }
          },
          {
            code: "max",
            displayName: "Max",
            description: "Max plan",
            enabledToolCodes: ["memory_search", "image_generate"],
            presentation: {
              highlighted: false,
              title: { ru: "Макс", en: "Max" },
              subtitle: { ru: null, en: null },
              notes: { ru: null, en: null },
              badge: { ru: null, en: null },
              ctaLabel: { ru: "Апгрейд", en: "Upgrade" },
              price: {
                amount: 1990,
                currency: "RUB",
                billingPeriod: "month" as const
              },
              highlightItems: { ru: ["Максимум"], en: ["Maximum"] }
            },
            quotaLimits: {
              tokenBudgetLimit: 10000,
              activeWebChatsLimit: 10,
              messagesPerChat: 200,
              imageGenerateMonthlyUnitsLimit: 100,
              imageEditMonthlyUnitsLimit: 100,
              videoGenerateMonthlyUnitsLimit: 20
            }
          }
        ];
      }
    } as never,
    {
      async listPublic() {
        return [
          {
            id: "pkg-image-1",
            packageType: "image_generate",
            units: 10,
            amountMinor: 9900,
            currency: "RUB",
            isActive: true,
            displayOrder: 0,
            highlighted: true,
            title: { ru: "10 генераций", en: "10 generations" },
            subtitle: { ru: "", en: "" },
            ctaLabel: { ru: "Купить", en: "Buy" },
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-01T00:00:00.000Z"
          }
        ];
      }
    } as never
  );

  const visibility = await service.getUserVisibility("user-1");

  assert.equal(visibility.effectivePlan.code, "pro");
  assert.equal(visibility.effectivePlan.displayName, "Pro");
  assert.equal(visibility.effectivePlan.trialFallbackPlanCode, "free");
  assert.deepEqual(visibility.effectivePlan.price, {
    amount: 980,
    currency: "RUB",
    billingPeriod: "month"
  });
  assert.equal(visibility.entitlements.channelsAndSurfaces.telegram, true);
  assert.equal(visibility.entitlements.channelsAndSurfaces.whatsapp, false);
  assert.equal(visibility.limits.quotaBuckets.length, 4);
  assert.deepEqual(visibility.limits.quotaBuckets[0], {
    bucketCode: "token_budget",
    displayName: "Token budget",
    unit: "tokens",
    used: 1250,
    limit: 5000,
    percent: 25,
    finiteLimit: true,
    usageAvailable: true,
    warningThresholdPercent: 90,
    warningThresholdReached: false,
    status: "ok"
  });
  assert.equal(visibility.advisories.isFreePlan, false);
  assert.equal(visibility.advisories.higherPaidPlanAvailable, true);
  assert.equal(visibility.advisories.highestVisiblePaidPlanCode, "max");
  assert.equal(visibility.advisories.tokenBudget.periodEndsAt, "2026-06-01T00:00:00.000Z");
  assert.equal(visibility.packageOffers.packagesPurchase, null);
  assert.equal(visibility.packageOffers.tools[0]?.offerableNow, false);
  assert.equal(visibility.packageOffers.tools[0]?.preferredUpgradePlanCode, "max");
  assert.equal(visibility.packageOffers.tools[0]?.offers[0]?.id, "pkg-image-1");
  assert.equal(visibility.limits.toolDailyLimits.length, 2);
  assert.equal(visibility.limits.monthlyMediaQuotas.tools[0]?.toolCode, "image_generate");
  assert.deepEqual(visibility.limits.toolDailyLimits[0], {
    toolCode: "memory_search",
    displayName: "Memory Search",
    dailyCallLimit: 25,
    dailyCallsUsed: 3,
    percent: 12,
    finiteLimit: true,
    warningThresholdPercent: 90,
    warningThresholdReached: false,
    periodStartedAt: "2026-05-08T00:00:00.000Z",
    periodEndsAt: "2026-05-09T00:00:00.000Z",
    periodSource: "utc_day",
    active: true
  });
  assert.deepEqual(visibility.limits.toolDailyLimits[1], {
    toolCode: "image_generate",
    displayName: "Image Generate",
    dailyCallLimit: 3,
    dailyCallsUsed: 0,
    percent: 0,
    finiteLimit: true,
    warningThresholdPercent: 90,
    warningThresholdReached: false,
    periodStartedAt: null,
    periodEndsAt: null,
    periodSource: null,
    active: false
  });

  const adminVisibility = await service.getAdminVisibility("user-1");
  assert.equal(adminAuthCalls, 1);
  assert.equal(adminVisibility.planState.effectivePlanCode, "pro");
  assert.equal(adminVisibility.planState.defaultRegistrationPlanCode, "free");
  assert.equal(adminVisibility.planState.totalPlans, 2);
  assert.equal(adminVisibility.planState.activePlans, 1);
  assert.equal(adminVisibility.planState.inactivePlans, 1);
  assert.equal(adminVisibility.usagePressure.tokenBudgetPercent, 25);
  assert.equal(adminVisibility.usagePressure.activeWebChatsPercent, 40);
  assert.equal(adminVisibility.usagePressure.mediaStorageBytesPercent, 25);
  assert.equal(adminVisibility.usagePressure.knowledgeStorageBytesPercent, 25);
  assert.equal(adminVisibility.usagePressure.pressureLevel, "low");
  assert.equal(adminVisibility.quotaBuckets.length, 4);
  assert.equal(adminVisibility.effectiveEntitlements?.channelsAndSurfaces.telegram, true);
}

void run();
