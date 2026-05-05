import assert from "node:assert/strict";
import { ResolveEffectiveSubscriptionStateService } from "../src/modules/workspace-management/application/resolve-effective-subscription-state.service";
import type { AssistantPlanCatalogRepository } from "../src/modules/workspace-management/domain/assistant-plan-catalog.repository";
import type { WorkspaceSubscriptionRepository } from "../src/modules/workspace-management/domain/workspace-subscription.repository";

type PlanRepoStub = Pick<
  AssistantPlanCatalogRepository,
  "findDefaultRegistrationPlan" | "findByCode"
>;
type SubscriptionRepoStub = Pick<
  WorkspaceSubscriptionRepository,
  "findByWorkspaceId" | "upsertFromBillingSnapshot"
>;

function createService(deps: {
  planRepo: PlanRepoStub;
  workspaceSubscriptionRepo: SubscriptionRepoStub;
}): ResolveEffectiveSubscriptionStateService {
  return new ResolveEffectiveSubscriptionStateService(
    deps.workspaceSubscriptionRepo as WorkspaceSubscriptionRepository,
    deps.planRepo as AssistantPlanCatalogRepository,
    {
      assistant: {
        async updateMany() {
          return { count: 1 };
        }
      },
      workspaceSubscriptionLifecycleEvent: {
        async create() {
          return { id: "event-1" };
        }
      }
    } as never,
    {
      async scheduleForLifecycleEventIds() {
        return undefined;
      }
    } as never
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
        graceStartedAt: null,
        graceEndsAt: null,
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
    },
    async upsertFromBillingSnapshot() {
      throw new Error("unexpected upsert");
    }
  };
  const planRepo: PlanRepoStub = {
    async findByCode() {
      return null;
    },
    async findDefaultRegistrationPlan() {
      return null;
    }
  };
  const service = createService({ workspaceSubscriptionRepo, planRepo });

  const fromWorkspace = await service.execute({
    userId: "user-1",
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    assistantPlanOverrideCode: "starter_trial",
    assistantQuotaPlanCode: "starter_trial"
  });
  assert.equal(fromWorkspace.source, "assistant_plan_override");
  assert.equal(fromWorkspace.status, "unconfigured");
  assert.equal(fromWorkspace.planCode, "starter_trial");

  const overrideFromAssistant = await createService({
    workspaceSubscriptionRepo: {
      async findByWorkspaceId() {
        return null;
      },
      async upsertFromBillingSnapshot() {
        throw new Error("unexpected upsert");
      }
    },
    planRepo: {
      async findByCode() {
        return null;
      },
      async findDefaultRegistrationPlan() {
        return null;
      }
    }
  }).execute({
    userId: "user-1",
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    assistantPlanOverrideCode: "pro_tester",
    assistantQuotaPlanCode: "starter_trial"
  });
  assert.equal(overrideFromAssistant.source, "assistant_plan_override");
  assert.equal(overrideFromAssistant.status, "unconfigured");
  assert.equal(overrideFromAssistant.planCode, "pro_tester");

  const fallbackFromAssistant = await createService({
    workspaceSubscriptionRepo: {
      async findByWorkspaceId() {
        return null;
      },
      async upsertFromBillingSnapshot() {
        throw new Error("unexpected upsert");
      }
    },
    planRepo: {
      async findByCode() {
        return null;
      },
      async findDefaultRegistrationPlan() {
        return null;
      }
    }
  }).execute({
    userId: "user-1",
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    assistantPlanOverrideCode: null,
    assistantQuotaPlanCode: "starter_trial"
  });
  assert.equal(fallbackFromAssistant.source, "assistant_plan_fallback");
  assert.equal(fallbackFromAssistant.status, "unconfigured");
  assert.equal(fallbackFromAssistant.planCode, "starter_trial");

  let catalogFallbackWriteCount = 0;
  const fallbackFromCatalog = await createService({
    workspaceSubscriptionRepo: {
      async findByWorkspaceId() {
        return null;
      },
      async upsertFromBillingSnapshot(snapshot) {
        catalogFallbackWriteCount += 1;
        return {
          id: "sub-created",
          workspaceId: snapshot.workspaceId,
          planCode: snapshot.planCode,
          status: snapshot.status,
          trialStartedAt:
            snapshot.trialStartedAt === null ? null : new Date(snapshot.trialStartedAt),
          trialEndsAt: snapshot.trialEndsAt === null ? null : new Date(snapshot.trialEndsAt),
          graceStartedAt:
            snapshot.graceStartedAt === undefined || snapshot.graceStartedAt === null
              ? null
              : new Date(snapshot.graceStartedAt),
          graceEndsAt:
            snapshot.graceEndsAt === undefined || snapshot.graceEndsAt === null
              ? null
              : new Date(snapshot.graceEndsAt),
          currentPeriodStartedAt:
            snapshot.currentPeriodStartedAt === null
              ? null
              : new Date(snapshot.currentPeriodStartedAt),
          currentPeriodEndsAt:
            snapshot.currentPeriodEndsAt === null ? null : new Date(snapshot.currentPeriodEndsAt),
          cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
          billingProvider: snapshot.billingProvider,
          providerCustomerRef: snapshot.providerCustomerRef,
          providerSubscriptionRef: snapshot.providerSubscriptionRef,
          metadata: snapshot.metadata,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }
    },
    planRepo: {
      async findByCode(code: string) {
        if (code === "starter_fallback") {
          return {
            id: "plan-fallback",
            code,
            displayName: "Starter Fallback",
            description: null,
            status: "active",
            billingProviderHints: null,
            entitlementModel: null,
            toolActivations: [],
            isDefaultFirstRegistrationPlan: false,
            isTrialPlan: false,
            trialDurationDays: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
        return null;
      },
      async findDefaultRegistrationPlan() {
        return {
          id: "plan-1",
          code: "starter_trial",
          displayName: "Starter Trial",
          description: null,
          status: "active",
          billingProviderHints: {
            lifecyclePolicy: {
              schema: "persai.planLifecyclePolicy.v1",
              trialFallbackPlanCode: "starter_fallback"
            }
          },
          entitlementModel: null,
          toolActivations: [],
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
    assistantPlanOverrideCode: null,
    assistantQuotaPlanCode: null
  });
  assert.equal(fallbackFromCatalog.source, "catalog_default_fallback");
  assert.equal(fallbackFromCatalog.planCode, "starter_trial");
  assert.equal(fallbackFromCatalog.status, "trialing");
  assert.notEqual(fallbackFromCatalog.trialEndsAt, null);
  assert.equal(catalogFallbackWriteCount, 1);

  catalogFallbackWriteCount = 0;
  const readOnlyFallbackFromCatalog = await createService({
    workspaceSubscriptionRepo: {
      async findByWorkspaceId() {
        return null;
      },
      async upsertFromBillingSnapshot(snapshot) {
        catalogFallbackWriteCount += 1;
        return {
          id: "sub-created",
          workspaceId: snapshot.workspaceId,
          planCode: snapshot.planCode,
          status: snapshot.status,
          trialStartedAt:
            snapshot.trialStartedAt === null ? null : new Date(snapshot.trialStartedAt),
          trialEndsAt: snapshot.trialEndsAt === null ? null : new Date(snapshot.trialEndsAt),
          graceStartedAt:
            snapshot.graceStartedAt === undefined || snapshot.graceStartedAt === null
              ? null
              : new Date(snapshot.graceStartedAt),
          graceEndsAt:
            snapshot.graceEndsAt === undefined || snapshot.graceEndsAt === null
              ? null
              : new Date(snapshot.graceEndsAt),
          currentPeriodStartedAt:
            snapshot.currentPeriodStartedAt === null
              ? null
              : new Date(snapshot.currentPeriodStartedAt),
          currentPeriodEndsAt:
            snapshot.currentPeriodEndsAt === null ? null : new Date(snapshot.currentPeriodEndsAt),
          cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
          billingProvider: snapshot.billingProvider,
          providerCustomerRef: snapshot.providerCustomerRef,
          providerSubscriptionRef: snapshot.providerSubscriptionRef,
          metadata: snapshot.metadata,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }
    },
    planRepo: {
      async findByCode(code: string) {
        if (code === "starter_fallback") {
          return {
            id: "plan-fallback",
            code,
            displayName: "Starter Fallback",
            description: null,
            status: "active",
            billingProviderHints: null,
            entitlementModel: null,
            toolActivations: [],
            isDefaultFirstRegistrationPlan: false,
            isTrialPlan: false,
            trialDurationDays: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
        return null;
      },
      async findDefaultRegistrationPlan() {
        return {
          id: "plan-1",
          code: "starter_trial",
          displayName: "Starter Trial",
          description: null,
          status: "active",
          billingProviderHints: {
            lifecyclePolicy: {
              schema: "persai.planLifecyclePolicy.v1",
              trialFallbackPlanCode: "starter_fallback"
            }
          },
          entitlementModel: null,
          toolActivations: [],
          isDefaultFirstRegistrationPlan: true,
          isTrialPlan: true,
          trialDurationDays: 14,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }
    }
  }).executeReadOnly({
    userId: "user-1",
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    assistantPlanOverrideCode: null,
    assistantQuotaPlanCode: null
  });
  assert.equal(readOnlyFallbackFromCatalog.source, "catalog_default_fallback");
  assert.equal(readOnlyFallbackFromCatalog.planCode, "starter_trial");
  assert.equal(readOnlyFallbackFromCatalog.status, "unconfigured");
  assert.equal(readOnlyFallbackFromCatalog.trialEndsAt, null);
  assert.equal(catalogFallbackWriteCount, 0);

  const expiredTrialFallback = await createService({
    workspaceSubscriptionRepo: {
      async findByWorkspaceId() {
        return {
          id: "sub-trial",
          workspaceId: "ws-1",
          planCode: "trial",
          status: "trialing",
          trialStartedAt: new Date("2026-04-01T00:00:00.000Z"),
          trialEndsAt: new Date("2026-04-08T00:00:00.000Z"),
          graceStartedAt: null,
          graceEndsAt: null,
          currentPeriodStartedAt: new Date("2026-04-01T00:00:00.000Z"),
          currentPeriodEndsAt: new Date("2026-04-08T00:00:00.000Z"),
          cancelAtPeriodEnd: false,
          billingProvider: null,
          providerCustomerRef: null,
          providerSubscriptionRef: null,
          metadata: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      },
      async upsertFromBillingSnapshot(snapshot) {
        assert.equal(snapshot.planCode, "fallback");
        assert.equal(snapshot.status, "expired_fallback");
        return {
          id: "sub-trial",
          workspaceId: snapshot.workspaceId,
          planCode: snapshot.planCode,
          status: snapshot.status,
          trialStartedAt:
            snapshot.trialStartedAt === null ? null : new Date(snapshot.trialStartedAt),
          trialEndsAt: snapshot.trialEndsAt === null ? null : new Date(snapshot.trialEndsAt),
          currentPeriodStartedAt: null,
          currentPeriodEndsAt: null,
          cancelAtPeriodEnd: false,
          billingProvider: snapshot.billingProvider,
          providerCustomerRef: null,
          providerSubscriptionRef: null,
          metadata: snapshot.metadata,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }
    },
    planRepo: {
      async findByCode(code: string) {
        if (code === "trial") {
          return {
            id: "plan-trial",
            code,
            displayName: "Trial",
            description: null,
            status: "active",
            billingProviderHints: {
              lifecyclePolicy: {
                schema: "persai.planLifecyclePolicy.v1",
                trialFallbackPlanCode: "fallback"
              }
            },
            entitlementModel: null,
            toolActivations: [],
            isDefaultFirstRegistrationPlan: false,
            isTrialPlan: true,
            trialDurationDays: 7,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
        if (code === "fallback") {
          return {
            id: "plan-fallback",
            code,
            displayName: "Fallback",
            description: null,
            status: "active",
            billingProviderHints: null,
            entitlementModel: null,
            toolActivations: [],
            isDefaultFirstRegistrationPlan: false,
            isTrialPlan: false,
            trialDurationDays: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
        return null;
      },
      async findDefaultRegistrationPlan() {
        return null;
      }
    }
  }).execute({
    userId: "user-1",
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    assistantPlanOverrideCode: null,
    assistantQuotaPlanCode: null
  });
  assert.equal(expiredTrialFallback.source, "subscription_trial_fallback");
  assert.equal(expiredTrialFallback.status, "expired_fallback");
  assert.equal(expiredTrialFallback.planCode, "fallback");

  const none = await createService({
    workspaceSubscriptionRepo: {
      async findByWorkspaceId() {
        return null;
      },
      async upsertFromBillingSnapshot() {
        throw new Error("unexpected upsert");
      }
    },
    planRepo: {
      async findByCode() {
        return null;
      },
      async findDefaultRegistrationPlan() {
        return null;
      }
    }
  }).execute({
    userId: "user-1",
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    assistantPlanOverrideCode: null,
    assistantQuotaPlanCode: null
  });
  assert.equal(none.source, "none");
  assert.equal(none.status, "unconfigured");
  assert.equal(none.planCode, null);
}

void run();
