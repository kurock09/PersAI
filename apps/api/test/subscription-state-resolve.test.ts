import assert from "node:assert/strict";
import { ResolveEffectiveSubscriptionStateService } from "../src/modules/workspace-management/application/resolve-effective-subscription-state.service";
import type { AssistantPlanCatalogRepository } from "../src/modules/workspace-management/domain/assistant-plan-catalog.repository";
import type { WorkspaceSubscriptionRepository } from "../src/modules/workspace-management/domain/workspace-subscription.repository";

type PlanRepoStub = Pick<AssistantPlanCatalogRepository, "findDefaultRegistrationPlan">;
type SubscriptionRepoStub = Pick<WorkspaceSubscriptionRepository, "findByWorkspaceId">;

function createService(deps: {
  planRepo: PlanRepoStub;
  workspaceSubscriptionRepo: SubscriptionRepoStub;
}): ResolveEffectiveSubscriptionStateService {
  return new ResolveEffectiveSubscriptionStateService(
    deps.workspaceSubscriptionRepo as WorkspaceSubscriptionRepository,
    deps.planRepo as AssistantPlanCatalogRepository
  );
}

async function run(): Promise<void> {
  const workspaceSubscriptionRepo: SubscriptionRepoStub = {
    async findByWorkspaceId() {
      return {
        id: "sub-1",
        workspaceId: "ws-1",
        planCode: "pro",
        status: "active",
        trialStartedAt: null,
        trialEndsAt: null,
        currentPeriodStartedAt: null,
        currentPeriodEndsAt: null,
        cancelAtPeriodEnd: false,
        billingProvider: null,
        providerCustomerRef: null,
        providerSubscriptionRef: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }
  };
  const planRepo: PlanRepoStub = {
    async findDefaultRegistrationPlan() {
      return null;
    }
  };
  const service = createService({ workspaceSubscriptionRepo, planRepo });

  const fromWorkspace = await service.execute({
    userId: "user-1",
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    assistantQuotaPlanCode: "starter_trial"
  });
  assert.equal(fromWorkspace.source, "workspace_subscription");
  assert.equal(fromWorkspace.status, "active");
  assert.equal(fromWorkspace.planCode, "pro");

  const fallbackFromAssistant = await createService({
    workspaceSubscriptionRepo: {
      async findByWorkspaceId() {
        return null;
      }
    },
    planRepo: {
      async findDefaultRegistrationPlan() {
        return null;
      }
    }
  }).execute({
    userId: "user-1",
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    assistantQuotaPlanCode: "starter_trial"
  });
  assert.equal(fallbackFromAssistant.source, "assistant_plan_fallback");
  assert.equal(fallbackFromAssistant.status, "unconfigured");
  assert.equal(fallbackFromAssistant.planCode, "starter_trial");

  const fallbackFromCatalog = await createService({
    workspaceSubscriptionRepo: {
      async findByWorkspaceId() {
        return null;
      }
    },
    planRepo: {
      async findDefaultRegistrationPlan() {
        return {
          id: "plan-1",
          code: "starter_trial",
          displayName: "Starter Trial",
          description: null,
          status: "active",
          billingProviderHints: null,
          entitlementModel: null,
          isDefaultFirstRegistrationPlan: true,
          isTrialPlan: true,
          trialDurationDays: 14,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }
    }
  }).execute({
    userId: "user-1",
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    assistantQuotaPlanCode: null
  });
  assert.equal(fallbackFromCatalog.source, "catalog_default_fallback");
  assert.equal(fallbackFromCatalog.planCode, "starter_trial");

  const none = await createService({
    workspaceSubscriptionRepo: {
      async findByWorkspaceId() {
        return null;
      }
    },
    planRepo: {
      async findDefaultRegistrationPlan() {
        return null;
      }
    }
  }).execute({
    userId: "user-1",
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    assistantQuotaPlanCode: null
  });
  assert.equal(none.source, "none");
  assert.equal(none.status, "unconfigured");
  assert.equal(none.planCode, null);
}

void run();
