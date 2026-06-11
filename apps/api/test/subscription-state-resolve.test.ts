import assert from "node:assert/strict";
import { ResolveEffectiveSubscriptionStateService } from "../src/modules/workspace-management/application/resolve-effective-subscription-state.service";
import type { BillingProviderPort } from "../src/modules/workspace-management/application/billing-provider.port";
import type { ManageWorkspaceSubscriptionLifecycleService } from "../src/modules/workspace-management/application/manage-workspace-subscription-lifecycle.service";
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
  lifecycleService?: Pick<
    ManageWorkspaceSubscriptionLifecycleService,
    "startPaidGrace" | "expireGrace" | "recoverPayment" | "applyCancelledPaidPeriodEndFallback"
  >;
  billingProviderPort?: Pick<BillingProviderPort, "getManagedSubscription">;
}): ResolveEffectiveSubscriptionStateService {
  let generation = 300;
  const lifecycleService =
    deps.lifecycleService ??
    ({
      async startPaidGrace() {
        throw new Error("unexpected startPaidGrace");
      },
      async expireGrace() {
        throw new Error("unexpected expireGrace");
      },
      async recoverPayment() {
        throw new Error("unexpected recoverPayment");
      },
      async applyCancelledPaidPeriodEndFallback() {
        throw new Error("unexpected applyCancelledPaidPeriodEndFallback");
      }
    } as Pick<
      ManageWorkspaceSubscriptionLifecycleService,
      "startPaidGrace" | "expireGrace" | "recoverPayment" | "applyCancelledPaidPeriodEndFallback"
    >);
  const billingProviderPort =
    deps.billingProviderPort ??
    ({
      async getManagedSubscription() {
        throw new Error("unexpected getManagedSubscription");
      }
    } as Pick<BillingProviderPort, "getManagedSubscription">);
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
      async emitForLifecycleEventIds() {
        return undefined;
      }
    } as never,
    {
      async execute() {
        generation += 1;
        return generation;
      }
    } as never,
    {
      async createAutomaticGlobalRollout() {
        return { id: "rollout-1" };
      }
    } as never,
    billingProviderPort as BillingProviderPort,
    lifecycleService as ManageWorkspaceSubscriptionLifecycleService
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

  let freeDefaultWriteCount = 0;
  const freeDefaultFromCatalog = await createService({
    workspaceSubscriptionRepo: {
      async findByWorkspaceId() {
        return null;
      },
      async upsertFromBillingSnapshot(snapshot) {
        freeDefaultWriteCount += 1;
        assert.equal(snapshot.planCode, "free");
        assert.equal(snapshot.status, "active");
        assert.equal(snapshot.trialStartedAt, null);
        assert.equal(snapshot.trialEndsAt, null);
        assert.equal(snapshot.currentPeriodStartedAt, null);
        assert.equal(snapshot.currentPeriodEndsAt, null);
        assert.equal(snapshot.billingProvider, null);
        assert.equal(snapshot.providerSubscriptionRef, null);
        return {
          id: "sub-free",
          workspaceId: snapshot.workspaceId,
          planCode: snapshot.planCode,
          status: snapshot.status,
          trialStartedAt: null,
          trialEndsAt: null,
          graceStartedAt: null,
          graceEndsAt: null,
          currentPeriodStartedAt: null,
          currentPeriodEndsAt: null,
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
      async findByCode() {
        return null;
      },
      async findDefaultRegistrationPlan() {
        return {
          id: "plan-free",
          code: "free",
          displayName: "Free",
          description: null,
          status: "active",
          billingProviderHints: {
            presentation: {
              price: {
                amount: 0,
                currency: "RUB",
                billingPeriod: "month"
              }
            }
          },
          entitlementModel: null,
          toolActivations: [],
          isDefaultFirstRegistrationPlan: true,
          isTrialPlan: false,
          trialDurationDays: null,
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
  assert.equal(freeDefaultFromCatalog.source, "catalog_default_fallback");
  assert.equal(freeDefaultFromCatalog.planCode, "free");
  assert.equal(freeDefaultFromCatalog.status, "active");
  assert.equal(freeDefaultFromCatalog.currentPeriodEndsAt, null);
  assert.equal(freeDefaultWriteCount, 1);

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

  let manualGraceStarted = false;
  const manualActiveSubscription = {
    id: "sub-manual",
    workspaceId: "ws-1",
    planCode: "pro",
    status: "active",
    trialStartedAt: null,
    trialEndsAt: null,
    graceStartedAt: null,
    graceEndsAt: null,
    currentPeriodStartedAt: new Date("2026-04-01T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-04-30T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    billingProvider: null,
    providerCustomerRef: null,
    providerSubscriptionRef: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const manualExpiredPaid = await createService({
    workspaceSubscriptionRepo: {
      async findByWorkspaceId() {
        return manualGraceStarted
          ? {
              ...manualActiveSubscription,
              status: "grace_period",
              graceStartedAt: new Date("2026-05-01T00:00:00.000Z"),
              graceEndsAt: new Date("2026-05-06T00:00:00.000Z")
            }
          : manualActiveSubscription;
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
    },
    lifecycleService: {
      async startPaidGrace(input) {
        manualGraceStarted = true;
        assert.equal(input.workspaceId, "ws-1");
        assert.equal(input.source, "system");
        assert.equal(input.refs?.metadata?.reason, "manual_paid_period_expired");
      }
    }
  }).execute({
    userId: "user-1",
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    assistantPlanOverrideCode: null,
    assistantQuotaPlanCode: null
  });
  assert.equal(manualGraceStarted, true);
  assert.equal(manualExpiredPaid.source, "workspace_subscription");
  assert.equal(manualExpiredPaid.status, "grace_period");
  assert.equal(manualExpiredPaid.planCode, "pro");

  let providerRecoverApplied = false;
  const providerOverdueSubscription = {
    id: "sub-provider-overdue",
    workspaceId: "ws-1",
    planCode: "basic",
    status: "active" as const,
    trialStartedAt: null,
    trialEndsAt: null,
    graceStartedAt: null,
    graceEndsAt: null,
    currentPeriodStartedAt: new Date("2026-05-10T20:14:32.000Z"),
    currentPeriodEndsAt: new Date("2026-06-10T20:14:32.000Z"),
    cancelAtPeriodEnd: false,
    billingProvider: "cloudpayments",
    providerCustomerRef: "acct-1",
    providerSubscriptionRef: "sub-provider-1",
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const providerRecovered = await createService({
    workspaceSubscriptionRepo: {
      async findByWorkspaceId() {
        return providerRecoverApplied
          ? {
              ...providerOverdueSubscription,
              currentPeriodStartedAt: new Date("2026-06-10T20:14:32.000Z"),
              currentPeriodEndsAt: new Date("2026-07-10T20:14:32.000Z")
            }
          : providerOverdueSubscription;
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
    },
    billingProviderPort: {
      async getManagedSubscription(input) {
        assert.equal(input.providerSubscriptionRef, "sub-provider-1");
        return {
          providerKey: "cloudpayments",
          providerSubscriptionRef: "sub-provider-1",
          status: "Active",
          nextChargeAt: "2026-07-10T20:14:32.000Z",
          amountMinor: 56000,
          currency: "RUB",
          interval: "Month",
          period: 1,
          customerPortalUrl: null,
          paymentMethodUpdateUrl: null,
          cancelUrl: null,
          raw: {}
        };
      }
    },
    lifecycleService: {
      async startPaidGrace() {
        throw new Error("unexpected startPaidGrace");
      },
      async expireGrace() {
        throw new Error("unexpected expireGrace");
      },
      async recoverPayment(input) {
        providerRecoverApplied = true;
        assert.equal(input.workspaceId, "ws-1");
        assert.equal(input.paidPlanCode, "basic");
        assert.equal(input.currentPeriodStartedAt, "2026-06-10T20:14:32.000Z");
        assert.equal(input.currentPeriodEndsAt, "2026-07-10T20:14:32.000Z");
        assert.equal(input.source, "system");
        assert.equal(
          input.refs?.metadata?.reason,
          "provider_subscription_reconciled_after_missed_webhook"
        );
      },
      async applyCancelledPaidPeriodEndFallback() {
        throw new Error("unexpected applyCancelledPaidPeriodEndFallback");
      }
    }
  }).execute({
    userId: "user-1",
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    assistantPlanOverrideCode: null,
    assistantQuotaPlanCode: null
  });
  assert.equal(providerRecoverApplied, true);
  assert.equal(providerRecovered.source, "workspace_subscription");
  assert.equal(providerRecovered.status, "active");
  assert.equal(providerRecovered.currentPeriodEndsAt, "2026-07-10T20:14:32.000Z");

  let providerCancelledFallbackApplied = false;
  const providerCancelled = await createService({
    workspaceSubscriptionRepo: {
      async findByWorkspaceId() {
        return providerCancelledFallbackApplied
          ? {
              ...providerOverdueSubscription,
              planCode: "free",
              status: "expired_fallback",
              billingProvider: null,
              providerCustomerRef: null,
              providerSubscriptionRef: null,
              currentPeriodStartedAt: new Date("2026-06-11T00:00:00.000Z"),
              currentPeriodEndsAt: null
            }
          : providerOverdueSubscription;
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
    },
    billingProviderPort: {
      async getManagedSubscription() {
        return {
          providerKey: "cloudpayments",
          providerSubscriptionRef: "sub-provider-1",
          status: "Cancelled",
          nextChargeAt: null,
          amountMinor: 56000,
          currency: "RUB",
          interval: "Month",
          period: 1,
          customerPortalUrl: null,
          paymentMethodUpdateUrl: null,
          cancelUrl: null,
          raw: {}
        };
      }
    },
    lifecycleService: {
      async startPaidGrace() {
        throw new Error("unexpected startPaidGrace");
      },
      async expireGrace() {
        throw new Error("unexpected expireGrace");
      },
      async recoverPayment() {
        throw new Error("unexpected recoverPayment");
      },
      async applyCancelledPaidPeriodEndFallback(input) {
        providerCancelledFallbackApplied = true;
        assert.equal(input.workspaceId, "ws-1");
        assert.equal(input.userId, "user-1");
      }
    }
  }).execute({
    userId: "user-1",
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    assistantPlanOverrideCode: null,
    assistantQuotaPlanCode: null
  });
  assert.equal(providerCancelledFallbackApplied, true);
  assert.equal(providerCancelled.source, "subscription_paid_fallback");
  assert.equal(providerCancelled.status, "expired_fallback");
  assert.equal(providerCancelled.planCode, "free");

  let expiredGraceApplied = false;
  const expiredGraceSubscription = {
    id: "sub-expired-grace",
    workspaceId: "ws-1",
    planCode: "pro",
    status: "grace_period" as const,
    trialStartedAt: null,
    trialEndsAt: null,
    graceStartedAt: new Date("2026-05-01T00:00:00.000Z"),
    graceEndsAt: new Date("2026-05-06T00:00:00.000Z"),
    currentPeriodStartedAt: new Date("2026-04-01T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-05-01T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    billingProvider: "cloudpayments",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-1",
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const expiredGraceResolved = await createService({
    workspaceSubscriptionRepo: {
      async findByWorkspaceId() {
        return expiredGraceApplied
          ? {
              ...expiredGraceSubscription,
              planCode: "starter",
              status: "expired_fallback",
              billingProvider: null,
              providerCustomerRef: null,
              providerSubscriptionRef: null,
              metadata: {
                lifecycleReason: "grace_expired_without_payment"
              }
            }
          : expiredGraceSubscription;
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
    },
    lifecycleService: {
      async startPaidGrace() {
        throw new Error("unexpected startPaidGrace");
      },
      async expireGrace(input) {
        expiredGraceApplied = true;
        assert.equal(input.workspaceId, "ws-1");
        assert.equal(input.userId, "user-1");
      }
    }
  }).execute({
    userId: "user-1",
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    assistantPlanOverrideCode: null,
    assistantQuotaPlanCode: null
  });
  assert.equal(expiredGraceApplied, true);
  assert.equal(expiredGraceResolved.source, "subscription_paid_fallback");
  assert.equal(expiredGraceResolved.status, "expired_fallback");
  assert.equal(expiredGraceResolved.planCode, "starter");

  let expiredGraceSkipCalls = 0;
  const expiredGraceSkipped = await createService({
    workspaceSubscriptionRepo: {
      async findByWorkspaceId() {
        return expiredGraceSubscription;
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
    },
    lifecycleService: {
      async startPaidGrace() {
        throw new Error("unexpected startPaidGrace");
      },
      async expireGrace() {
        expiredGraceSkipCalls += 1;
        throw new Error("fallback plan missing");
      }
    }
  }).execute({
    userId: "user-1",
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    assistantPlanOverrideCode: null,
    assistantQuotaPlanCode: null
  });
  assert.equal(expiredGraceSkipCalls, 1);
  assert.equal(expiredGraceSkipped.source, "workspace_subscription");
  assert.equal(expiredGraceSkipped.status, "grace_period");
  assert.equal(expiredGraceSkipped.planCode, "pro");

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
