import assert from "node:assert/strict";
import { ResolvePlanVisibilityService } from "../src/modules/workspace-management/application/resolve-plan-visibility.service";

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
  process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "sk_test_1234567890123456";
  process.env.PERSAI_INTERNAL_API_TOKEN =
    process.env.PERSAI_INTERNAL_API_TOKEN ?? "internal-token-1234567890";

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
      }
    } as never,
    {
      async findByWorkspaceId(workspaceId: string) {
        assert.equal(workspaceId, "ws-1");
        return {
          workspaceId,
          tokenBudgetUsed: BigInt(1250),
          costOrTokenDrivingToolClassUnitsUsed: 0,
          activeWebChatsCurrent: 2,
          tokenBudgetLimit: BigInt(5000),
          createdAt: new Date(),
          updatedAt: new Date()
        };
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
      async assertCanReadAdminSurface() {
        throw new Error("admin auth should not be used for user visibility");
      }
    } as never
  );

  const visibility = await service.getUserVisibility("user-1");

  assert.equal(visibility.effectivePlan.code, "pro");
  assert.equal(visibility.effectivePlan.displayName, "Pro");
  assert.equal(visibility.entitlements.channelsAndSurfaces.telegram, true);
  assert.equal(visibility.entitlements.channelsAndSurfaces.whatsapp, false);
  assert.equal(visibility.limits.tokenBudgetUsed, 1250);
  assert.equal(visibility.limits.tokenBudgetLimit, 5000);
  assert.equal(visibility.limits.tokenBudgetPercent, 25);
  assert.equal(visibility.limits.activeWebChatsUsed, 2);
  assert.equal(typeof visibility.limits.activeWebChatsLimit, "number");
  assert.ok((visibility.limits.activeWebChatsLimit ?? 0) > 0);
  assert.equal(visibility.limits.toolDailyLimits.length, 1);
  assert.deepEqual(visibility.limits.toolDailyLimits[0], {
    toolCode: "memory_search",
    displayName: "Memory Search",
    dailyCallLimit: 25,
    dailyCallsUsed: 3,
    active: true
  });
}

void run();
