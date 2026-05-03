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
          isTrialPlan: false,
          trialDurationDays: null,
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
            isTrialPlan: false,
            trialDurationDays: null,
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
              usageAvailable: true,
              status: "ok"
            },
            {
              bucketCode: "active_web_chats",
              displayName: "Active web chats",
              unit: "count",
              used: 2,
              limit: 5,
              percent: 40,
              usageAvailable: true,
              status: "ok"
            },
            {
              bucketCode: "media_storage_bytes",
              displayName: "Media storage",
              unit: "bytes",
              used: 2048,
              limit: 8192,
              percent: 25,
              usageAvailable: true,
              status: "ok"
            },
            {
              bucketCode: "knowledge_storage_bytes",
              displayName: "Knowledge storage",
              unit: "bytes",
              used: 1024,
              limit: 4096,
              percent: 25,
              usageAvailable: true,
              status: "ok"
            }
          ]
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
              usageAvailable: true,
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
              usageAvailable: true,
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
              usageAvailable: true,
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
          limit: params.dailyCallLimit
        };
      }
    } as never,
    {
      async assertCanReadAdminSurface(userId: string) {
        adminAuthCalls += 1;
        assert.equal(userId, "user-1");
      }
    } as never
  );

  const visibility = await service.getUserVisibility("user-1");

  assert.equal(visibility.effectivePlan.code, "pro");
  assert.equal(visibility.effectivePlan.displayName, "Pro");
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
    usageAvailable: true,
    status: "ok"
  });
  assert.equal(visibility.limits.toolDailyLimits.length, 1);
  assert.equal(visibility.limits.monthlyMediaQuotas.tools[0]?.toolCode, "image_generate");
  assert.deepEqual(visibility.limits.toolDailyLimits[0], {
    toolCode: "memory_search",
    displayName: "Memory Search",
    dailyCallLimit: 25,
    dailyCallsUsed: 3,
    active: true
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
