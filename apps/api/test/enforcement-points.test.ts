import assert from "node:assert/strict";
import { EnforceAssistantCapabilityAndQuotaService } from "../src/modules/workspace-management/application/enforce-assistant-capability-and-quota.service";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import type { ResolveEffectiveCapabilityStateService } from "../src/modules/workspace-management/application/resolve-effective-capability-state.service";
import type { ResolveEffectiveSubscriptionStateService } from "../src/modules/workspace-management/application/resolve-effective-subscription-state.service";
import type { AssistantGovernanceRepository } from "../src/modules/workspace-management/domain/assistant-governance.repository";
import type { AssistantPlanCatalogRepository } from "../src/modules/workspace-management/domain/assistant-plan-catalog.repository";
import type { WorkspaceQuotaAccountingRepository } from "../src/modules/workspace-management/domain/workspace-quota-accounting.repository";

type GovernanceRepoStub = Pick<AssistantGovernanceRepository, "findByAssistantId">;
type PlanRepoStub = Pick<AssistantPlanCatalogRepository, "findByCode">;
type QuotaRepoStub = Pick<
  WorkspaceQuotaAccountingRepository,
  "findByWorkspaceId" | "findTokenBudgetPeriodCounter"
>;
type CapabilityResolverStub = Pick<ResolveEffectiveCapabilityStateService, "execute">;
type SubscriptionResolverStub = Pick<ResolveEffectiveSubscriptionStateService, "execute">;

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-api-token";
  process.env.WEB_ACTIVE_CHATS_CAP = "20";
  process.env.QUOTA_TOKEN_BUDGET_DEFAULT = "100";
  process.env.QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT = "3";

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
          presentation: {
            price: {
              amount: 0,
              currency: "RUB",
              billingPeriod: "month"
            }
          },
          quotaAccounting: {
            tokenBudgetLimit: 100,
            costOrTokenDrivingToolClassUnitsLimit: 3
          }
        },
        entitlementModel: {
          schemaVersion: 1,
          capabilities: [],
          toolClasses: [],
          channelsAndSurfaces: [],
          limitsPermissions: []
        },
        isDefaultFirstRegistrationPlan: true,
        isTrialPlan: true,
        trialDurationDays: 14,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }
  };

  const capabilityResolver: CapabilityResolverStub = {
    async execute() {
      return {
        schema: "persai.effectiveCapabilities.v1",
        derivedFrom: { planCode: "starter_trial", planStatus: "active", governanceSchema: null },
        subscription: {
          source: "assistant_plan_fallback",
          status: "unconfigured",
          planCode: "starter_trial",
          trialEndsAt: null,
          currentPeriodEndsAt: null,
          cancelAtPeriodEnd: false
        },
        toolClasses: {
          utility: { allowed: true, quotaGoverned: true },
          costDriving: { allowed: true, quotaGoverned: true }
        },
        channelsAndSurfaces: { webChat: true, telegram: false, whatsapp: false, max: false }
      };
    }
  };

  const subscriptionResolver: SubscriptionResolverStub = {
    async execute() {
      return {
        source: "assistant_plan_fallback",
        status: "unconfigured",
        planCode: "starter_trial",
        trialEndsAt: null,
        currentPeriodEndsAt: null,
        cancelAtPeriodEnd: false
      };
    }
  };

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

  function buildQuotaRepo(currentPeriodUsed: bigint): QuotaRepoStub {
    return {
      async findByWorkspaceId() {
        return {
          id: "state-1",
          workspaceId: "workspace-1",
          tokenBudgetUsed: BigInt(999),
          tokenBudgetLimit: BigInt(100),
          costOrTokenDrivingToolClassUnitsUsed: 3,
          costOrTokenDrivingToolClassUnitsLimit: 3,
          activeWebChatsCurrent: 20,
          activeWebChatsLimit: 20,
          mediaStorageBytesUsed: BigInt(0),
          mediaStorageBytesLimit: null,
          knowledgeStorageBytesUsed: BigInt(0),
          knowledgeStorageBytesLimit: null,
          lastComputedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        };
      },
      async findTokenBudgetPeriodCounter(input) {
        return {
          workspaceId: input.workspaceId,
          periodStartedAt: input.periodStartedAt,
          periodEndsAt: input.periodEndsAt,
          usedCredits: currentPeriodUsed,
          limitCredits: BigInt(100),
          lastComputedAt: new Date()
        };
      }
    };
  }

  const serviceWithQuotaReached = new EnforceAssistantCapabilityAndQuotaService(
    governanceRepo as AssistantGovernanceRepository,
    planRepo as AssistantPlanCatalogRepository,
    buildQuotaRepo(BigInt(120)) as WorkspaceQuotaAccountingRepository,
    capabilityResolver as ResolveEffectiveCapabilityStateService,
    subscriptionResolver as ResolveEffectiveSubscriptionStateService
  );

  await assert.rejects(
    () =>
      serviceWithQuotaReached.enforceWebChatTurn({
        assistant,
        isNewThread: true,
        activeWebChatsCount: 20
      }),
    (error: unknown) =>
      error instanceof ApiErrorHttpException &&
      error.errorObject.code === "active_chat_cap_reached" &&
      error.errorObject.message.includes("Active web chats cap reached")
  );

  const serviceWithDisabledWebChat = new EnforceAssistantCapabilityAndQuotaService(
    governanceRepo as AssistantGovernanceRepository,
    planRepo as AssistantPlanCatalogRepository,
    buildQuotaRepo(BigInt(0)) as WorkspaceQuotaAccountingRepository,
    {
      async execute() {
        return {
          ...(await capabilityResolver.execute()),
          channelsAndSurfaces: { webChat: false, telegram: false, whatsapp: false, max: false }
        };
      }
    } as CapabilityResolverStub as ResolveEffectiveCapabilityStateService,
    subscriptionResolver as ResolveEffectiveSubscriptionStateService
  );

  await assert.rejects(
    () =>
      serviceWithDisabledWebChat.enforceWebChatTurn({
        assistant,
        isNewThread: false,
        activeWebChatsCount: 1
      }),
    (error: unknown) =>
      error instanceof ApiErrorHttpException &&
      error.errorObject.code === "plan_feature_unavailable" &&
      error.errorObject.message.includes('Inbound surface "web_chat" is unavailable')
  );

  const serviceWithTelegram = new EnforceAssistantCapabilityAndQuotaService(
    governanceRepo as AssistantGovernanceRepository,
    planRepo as AssistantPlanCatalogRepository,
    buildQuotaRepo(BigInt(0)) as WorkspaceQuotaAccountingRepository,
    {
      async execute() {
        return {
          ...(await capabilityResolver.execute()),
          channelsAndSurfaces: { webChat: true, telegram: true, whatsapp: false, max: false }
        };
      }
    } as CapabilityResolverStub as ResolveEffectiveCapabilityStateService,
    subscriptionResolver as ResolveEffectiveSubscriptionStateService
  );

  await assert.doesNotReject(() =>
    serviceWithTelegram.enforceInboundTurn({
      assistant,
      surface: "telegram",
      isNewThread: false,
      activeSurfaceChatsCount: 0
    })
  );

  const serviceIgnoringLegacyCostQuota = new EnforceAssistantCapabilityAndQuotaService(
    governanceRepo as AssistantGovernanceRepository,
    planRepo as AssistantPlanCatalogRepository,
    buildQuotaRepo(BigInt(20)) as WorkspaceQuotaAccountingRepository,
    capabilityResolver as ResolveEffectiveCapabilityStateService,
    subscriptionResolver as ResolveEffectiveSubscriptionStateService
  );

  await assert.doesNotReject(() =>
    serviceIgnoringLegacyCostQuota.enforceWebChatTurn({
      assistant,
      isNewThread: false,
      activeWebChatsCount: 1
    })
  );

  await assert.rejects(
    () =>
      serviceWithDisabledWebChat.enforceInboundTurn({
        assistant,
        surface: "telegram",
        isNewThread: false,
        activeSurfaceChatsCount: 0
      }),
    (error: unknown) =>
      error instanceof ApiErrorHttpException &&
      error.errorObject.code === "plan_feature_unavailable" &&
      error.errorObject.message.includes('Inbound surface "telegram" is unavailable')
  );

  const serviceIgnoringStaleCompatibilityTokenUsage = new EnforceAssistantCapabilityAndQuotaService(
    governanceRepo as AssistantGovernanceRepository,
    planRepo as AssistantPlanCatalogRepository,
    buildQuotaRepo(BigInt(0)) as WorkspaceQuotaAccountingRepository,
    capabilityResolver as ResolveEffectiveCapabilityStateService,
    subscriptionResolver as ResolveEffectiveSubscriptionStateService
  );

  await assert.deepEqual(
    await serviceIgnoringStaleCompatibilityTokenUsage.enforceWebChatTurn({
      assistant,
      isNewThread: false,
      activeWebChatsCount: 1
    }),
    { mode: "allow" }
  );

  const paidPlanRepo: PlanRepoStub = {
    async findByCode() {
      return {
        ...(await planRepo.findByCode("starter_trial")),
        billingProviderHints: {
          presentation: {
            price: {
              amount: 9.9,
              currency: "RUB",
              billingPeriod: "month"
            }
          },
          quotaAccounting: {
            tokenBudgetLimit: 100,
            costOrTokenDrivingToolClassUnitsLimit: 3
          }
        }
      };
    }
  };

  const serviceWithPaidTokenLightMode = new EnforceAssistantCapabilityAndQuotaService(
    governanceRepo as AssistantGovernanceRepository,
    paidPlanRepo as AssistantPlanCatalogRepository,
    buildQuotaRepo(BigInt(120)) as WorkspaceQuotaAccountingRepository,
    capabilityResolver as ResolveEffectiveCapabilityStateService,
    subscriptionResolver as ResolveEffectiveSubscriptionStateService
  );

  await assert.deepEqual(
    await serviceWithPaidTokenLightMode.enforceWebChatTurn({
      assistant,
      isNewThread: false,
      activeWebChatsCount: 1
    }),
    { mode: "degrade_allowed", reason: "token_budget_limit_reached" }
  );

  const serviceWithFreeTokenExhausted = new EnforceAssistantCapabilityAndQuotaService(
    governanceRepo as AssistantGovernanceRepository,
    planRepo as AssistantPlanCatalogRepository,
    buildQuotaRepo(BigInt(120)) as WorkspaceQuotaAccountingRepository,
    capabilityResolver as ResolveEffectiveCapabilityStateService,
    subscriptionResolver as ResolveEffectiveSubscriptionStateService
  );

  await assert.rejects(
    () =>
      serviceWithFreeTokenExhausted.enforceWebChatTurn({
        assistant,
        isNewThread: false,
        activeWebChatsCount: 1
      }),
    (error: unknown) =>
      error instanceof ApiErrorHttpException &&
      error.errorObject.code === "token_budget_exhausted" &&
      error.errorObject.message.includes("Monthly token budget has been exhausted")
  );
}

void run();
