import assert from "node:assert/strict";
import type { AssistantGovernanceRepository } from "../src/modules/workspace-management/domain/assistant-governance.repository";
import type { AssistantPlanCatalogRepository } from "../src/modules/workspace-management/domain/assistant-plan-catalog.repository";
import type {
  FindMonthlyMediaQuotaCounterInput,
  FindTokenBudgetPeriodCounterInput,
  MonthlyMediaQuotaMutationInput,
  WorkspaceQuotaAccountingRepository
} from "../src/modules/workspace-management/domain/workspace-quota-accounting.repository";
import type { WorkspaceToolDailyUsageRepository } from "../src/modules/workspace-management/domain/workspace-tool-daily-usage.repository";
import type { ManageMediaPackagePurchaseService } from "../src/modules/workspace-management/application/manage-media-package-purchase.service";
import type { ResolveEffectiveSubscriptionStateService } from "../src/modules/workspace-management/application/resolve-effective-subscription-state.service";
import type { ResolvePlatformRuntimeProviderSettingsService } from "../src/modules/workspace-management/application/resolve-platform-runtime-provider-settings.service";
import { TrackWorkspaceQuotaUsageService } from "../src/modules/workspace-management/application/track-workspace-quota-usage.service";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

type GovernanceRepoStub = Pick<AssistantGovernanceRepository, "findByAssistantId">;
type PlanRepoStub = Pick<AssistantPlanCatalogRepository, "findByCode">;
type QuotaRepoStub = Pick<
  WorkspaceQuotaAccountingRepository,
  | "findByWorkspaceId"
  | "findTokenBudgetPeriodCounter"
  | "findMonthlyMediaQuotaCounter"
  | "reserveMonthlyMediaQuota"
  | "settleMonthlyMediaQuota"
  | "consumeMonthlyToolQuotaSuccessOnly"
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

  const monthlyQuotaCalls: Array<{
    operation: "consume";
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
    async findByCode() {
      return {
        id: "plan-1",
        code: "starter_trial",
        displayName: "Starter Trial",
        description: null,
        status: "active",
        billingProviderHints: {
          quotaAccounting: {
            documentMonthlyUnitsLimit: 5
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
      return null;
    },
    async findTokenBudgetPeriodCounter(_input: FindTokenBudgetPeriodCounterInput) {
      return null;
    },
    async findMonthlyMediaQuotaCounter(input: FindMonthlyMediaQuotaCounterInput) {
      return {
        workspaceId: input.workspaceId,
        toolCode: input.toolCode,
        periodStartedAt: input.periodStartedAt,
        periodEndsAt: input.periodEndsAt,
        reservedUnits: 0,
        settledUnits: 1,
        releasedUnits: 0,
        reconciliationRequiredUnits: 0,
        limitUnits: 5,
        lastComputedAt: new Date()
      };
    },
    async reserveMonthlyMediaQuota() {
      throw new Error("reserve should not be called in success-only document test");
    },
    async settleMonthlyMediaQuota() {
      throw new Error("settle should not be called in success-only document test");
    },
    async consumeMonthlyToolQuotaSuccessOnly(input) {
      monthlyQuotaCalls.push({ operation: "consume", input });
      return {
        workspaceId: input.workspaceId,
        toolCode: input.toolCode,
        periodStartedAt: input.periodStartedAt,
        periodEndsAt: input.periodEndsAt,
        reservedUnits: 0,
        settledUnits: 2,
        releasedUnits: 0,
        reconciliationRequiredUnits: 0,
        limitUnits: input.limitUnits,
        lastComputedAt: new Date()
      };
    },
    async releaseMonthlyMediaQuota() {
      throw new Error("release should not be called in success-only document test");
    },
    async markMonthlyMediaQuotaReconciliationRequired() {
      throw new Error("reconcile should not be called in success-only document test");
    },
    async applyTokenBudgetUsage() {
      throw new Error("not needed");
    },
    async applyKnowledgeStorageUsage() {
      throw new Error("not needed");
    },
    async releaseKnowledgeStorageUsage() {
      throw new Error("not needed");
    },
    async refreshActiveWebChatsUsage() {
      throw new Error("not needed");
    }
  };

  const toolDailyUsageRepo: ToolDailyUsageRepoStub = {
    async incrementAndGet() {
      return 1;
    },
    async getUsageForDate() {
      return 0;
    },
    async consumeWithinLimit() {
      return {
        allowed: true,
        currentCount: 1
      };
    }
  };
  const prisma = {
    workspaceSubscription: {
      findUnique: async () => null
    },
    workspaceSubscriptionLifecycleEvent: {
      findFirst: async () => null
    }
  };

  const service = new TrackWorkspaceQuotaUsageService(
    governanceRepo as AssistantGovernanceRepository,
    planRepo as AssistantPlanCatalogRepository,
    quotaRepo as WorkspaceQuotaAccountingRepository,
    toolDailyUsageRepo as WorkspaceToolDailyUsageRepository,
    prisma as unknown as WorkspaceManagementPrismaService,
    {
      async execute() {
        return {
          source: "assistant_plan_fallback",
          status: "unconfigured",
          planCode: "starter_trial",
          trialEndsAt: null,
          currentPeriodStartedAt: null,
          currentPeriodEndsAt: null,
          cancelAtPeriodEnd: false
        };
      }
    } as ResolveEffectiveSubscriptionStateService,
    {
      async execute() {
        return {
          schema: "persai.runtimeProviderProfile.v1",
          mode: "admin_managed",
          derivedFrom: {
            policyEnvelopeSchema: "persai.runtimeProviderProfile.v1",
            secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1"
          },
          allowedProviders: ["openai"],
          availableModelsByProvider: { openai: ["gpt-5-mini"] },
          availableModelCatalogByProvider: { openai: { models: [] } },
          primary: null,
          fallback: null,
          notes: []
        };
      }
    } as ResolvePlatformRuntimeProviderSettingsService,
    {
      resolveActiveBonus: async (_workspaceId: string, toolCode: string) => ({
        toolCode,
        bonusUnits: 0,
        latestPeriodEndsAt: null,
        grantIds: []
      }),
      resolveAllActiveBonuses: async () => ({
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
        throw new Error("not needed");
      },
      fulfillPackagePaymentIntent: async () => {}
    } as unknown as ManageMediaPackagePurchaseService
  );

  await service.consumeAssistantMonthlyToolQuotaSuccessOnly({
    assistant: {
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
    },
    toolCode: "document",
    units: 1
  });

  assert.equal(monthlyQuotaCalls.length, 1);
  assert.equal(monthlyQuotaCalls[0]?.operation, "consume");
  assert.equal(monthlyQuotaCalls[0]?.input.toolCode, "document");
  assert.equal(monthlyQuotaCalls[0]?.input.units, 1);
}

void run();
