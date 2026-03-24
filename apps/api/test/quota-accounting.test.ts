import assert from "node:assert/strict";
import { TrackWorkspaceQuotaUsageService } from "../src/modules/workspace-management/application/track-workspace-quota-usage.service";
import type { ResolveEffectiveCapabilityStateService } from "../src/modules/workspace-management/application/resolve-effective-capability-state.service";
import type { ResolveEffectiveSubscriptionStateService } from "../src/modules/workspace-management/application/resolve-effective-subscription-state.service";
import type { AssistantGovernanceRepository } from "../src/modules/workspace-management/domain/assistant-governance.repository";
import type { AssistantPlanCatalogRepository } from "../src/modules/workspace-management/domain/assistant-plan-catalog.repository";
import type { WorkspaceQuotaAccountingRepository } from "../src/modules/workspace-management/domain/workspace-quota-accounting.repository";

type GovernanceRepoStub = Pick<AssistantGovernanceRepository, "findByAssistantId">;
type PlanRepoStub = Pick<AssistantPlanCatalogRepository, "findByCode">;
type QuotaRepoStub = Pick<
  WorkspaceQuotaAccountingRepository,
  "incrementUsage" | "refreshActiveWebChatsUsage"
>;
type SubscriptionResolverStub = Pick<ResolveEffectiveSubscriptionStateService, "execute">;
type CapabilityResolverStub = Pick<ResolveEffectiveCapabilityStateService, "execute">;

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.QUOTA_TOKEN_BUDGET_DEFAULT = "200000";
  process.env.QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT = "1000";
  process.env.WEB_ACTIVE_CHATS_CAP = "20";

  const incrementCalls: Array<{ dimension: string; delta: bigint; source: string }> = [];
  const refreshCalls: Array<{ currentActiveWebChats: number; source: string }> = [];

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
            costOrTokenDrivingToolClassUnitsLimit: 600
          }
        },
        entitlementModel: {
          schemaVersion: 1,
          capabilities: [],
          toolClasses: [{ key: "cost_driving", allowed: true, quotaGoverned: true }],
          channelsAndSurfaces: [],
          limitsPermissions: [{ key: "tasks_excluded_from_commercial_quotas", value: true }]
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
    async incrementUsage(input) {
      incrementCalls.push({
        dimension: input.dimension,
        delta: input.delta,
        source: input.source
      });
      return {
        id: "state-1",
        workspaceId: input.workspaceId,
        tokenBudgetUsed: BigInt(0),
        tokenBudgetLimit: input.limits.tokenBudgetLimit,
        costOrTokenDrivingToolClassUnitsUsed: 0,
        costOrTokenDrivingToolClassUnitsLimit: input.limits.costOrTokenDrivingToolClassUnitsLimit,
        activeWebChatsCurrent: 0,
        activeWebChatsLimit: input.limits.activeWebChatsLimit,
        lastComputedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
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
        lastComputedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
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

  const capabilityResolver: CapabilityResolverStub = {
    async execute() {
      return {
        schema: "persai.effectiveCapabilities.v1",
        derivedFrom: {
          planCode: "starter_trial",
          planStatus: "active",
          governanceSchema: null
        },
        subscription: {
          source: "assistant_plan_fallback",
          status: "unconfigured",
          planCode: "starter_trial",
          trialEndsAt: null,
          currentPeriodEndsAt: null,
          cancelAtPeriodEnd: false
        },
        toolClasses: {
          costDriving: { allowed: true, quotaGoverned: true },
          utility: { allowed: true, quotaGoverned: true }
        },
        channelsAndSurfaces: {
          webChat: true,
          telegram: false,
          whatsapp: false,
          max: false
        },
        mediaClasses: {
          text: true,
          image: false,
          audio: false,
          video: false,
          file: false
        },
        governedFeatures: {
          assistantLifecycle: true,
          memoryCenter: true,
          tasksCenter: true,
          viewLimitPercentages: true,
          tasksExcludedFromCommercialQuotas: true
        }
      };
    }
  };

  const service = new TrackWorkspaceQuotaUsageService(
    governanceRepo as AssistantGovernanceRepository,
    planRepo as AssistantPlanCatalogRepository,
    quotaRepo as WorkspaceQuotaAccountingRepository,
    subscriptionResolver as ResolveEffectiveSubscriptionStateService,
    capabilityResolver as ResolveEffectiveCapabilityStateService
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
    source: "web_chat_turn_sync"
  });

  await service.refreshActiveWebChatsUsage({
    assistant,
    activeWebChatsCurrent: 7,
    source: "web_chat_archive"
  });

  assert.equal(incrementCalls.length, 2);
  assert.equal(incrementCalls[0]?.dimension, "token_budget");
  assert.ok((incrementCalls[0]?.delta ?? BigInt(0)) > BigInt(0));
  assert.equal(incrementCalls[1]?.dimension, "cost_or_token_driving_tool_class");
  assert.equal(incrementCalls[1]?.delta, BigInt(1));
  assert.equal(refreshCalls.length, 1);
  assert.equal(refreshCalls[0]?.currentActiveWebChats, 7);
}

void run();
