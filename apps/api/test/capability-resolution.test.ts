import assert from "node:assert/strict";
import { ResolveEffectiveCapabilityStateService } from "../src/modules/workspace-management/application/resolve-effective-capability-state.service";
import type { AssistantPlanCatalogRepository } from "../src/modules/workspace-management/domain/assistant-plan-catalog.repository";
import type { ResolveEffectiveSubscriptionStateService } from "../src/modules/workspace-management/application/resolve-effective-subscription-state.service";

type SubscriptionResolverStub = Pick<ResolveEffectiveSubscriptionStateService, "execute">;
type PlanRepoStub = Pick<AssistantPlanCatalogRepository, "findByCode">;

function createService(deps: {
  subscriptionResolver: SubscriptionResolverStub;
  planRepo: PlanRepoStub;
}): ResolveEffectiveCapabilityStateService {
  return new ResolveEffectiveCapabilityStateService(
    deps.subscriptionResolver as ResolveEffectiveSubscriptionStateService,
    deps.planRepo as AssistantPlanCatalogRepository
  );
}

async function run(): Promise<void> {
  const subscriptionResolver: SubscriptionResolverStub = {
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
  };
  const planRepo: PlanRepoStub = {
    async findByCode(code: string) {
      if (code !== "pro") {
        return null;
      }
      return {
        id: "plan-1",
        code: "pro",
        displayName: "Pro",
        description: null,
        status: "active",
        billingProviderHints: null,
        entitlementModel: {
          schemaVersion: 1,
          capabilities: [
            { key: "assistant.lifecycle.publish_apply_rollback_reset", allowed: true },
            { key: "assistant.memory.center", allowed: true },
            { key: "assistant.tasks.center", allowed: true }
          ],
          toolClasses: [
            { key: "cost_driving", allowed: true, quotaGoverned: true },
            { key: "utility", allowed: true, quotaGoverned: true }
          ],
          channelsAndSurfaces: [
            { key: "web_chat", allowed: true },
            { key: "telegram", allowed: true },
            { key: "whatsapp", allowed: true },
            { key: "max", allowed: true }
          ],
          limitsPermissions: [
            { key: "view_limit_percentages", allowed: true },
            { key: "tasks_excluded_from_commercial_quotas", value: true }
          ]
        },
        isDefaultFirstRegistrationPlan: false,
        isTrialPlan: false,
        trialDurationDays: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }
  };

  const service = createService({ subscriptionResolver, planRepo });

  const resolved = await service.execute({
    assistant: {
      id: "assistant-1",
      userId: "user-1",
      workspaceId: "ws-1",
      draftDisplayName: null,
      draftInstructions: null,
      draftUpdatedAt: null,
      applyStatus: "not_requested",
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
    governance: {
      id: "gov-1",
      assistantId: "assistant-1",
      capabilityEnvelope: {
        schema: "persai.capabilityEnvelope.v1",
        deny: {
          channelsAndSurfaces: ["max"],
          mediaClasses: ["video"]
        }
      },
      secretRefs: null,
      policyEnvelope: null,
      memoryControl: null,
      tasksControl: null,
      quotaPlanCode: "pro",
      quotaHook: null,
      auditHook: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  });

  assert.equal(resolved.schema, "persai.effectiveCapabilities.v1");
  assert.equal(resolved.subscription.status, "active");
  assert.equal(resolved.derivedFrom.planCode, "pro");
  assert.equal(resolved.toolClasses.costDriving.allowed, true);
  assert.equal(resolved.channelsAndSurfaces.max, false);
  assert.equal(resolved.mediaClasses.video, false);
}

void run();
