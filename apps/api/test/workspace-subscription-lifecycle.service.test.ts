import assert from "node:assert/strict";
import { ManageWorkspaceSubscriptionLifecycleService } from "../src/modules/workspace-management/application/manage-workspace-subscription-lifecycle.service";
import type { ManageAdminBillingLifecycleSettingsService } from "../src/modules/workspace-management/application/manage-admin-billing-lifecycle-settings.service";

async function run(): Promise<void> {
  const events: Array<{
    id: string;
    eventCode: string;
    previousPlanCode: string | null;
    nextPlanCode: string | null;
  }> = [];
  const dirtyWorkspaces: string[] = [];
  const scheduledEventIds: string[][] = [];
  const immediateActivationWorkspaces: string[] = [];
  let subscription = {
    id: "sub-1",
    workspaceId: "ws-1",
    planCode: "starter_trial",
    status: "trialing" as const,
    trialStartedAt: new Date("2026-05-01T00:00:00.000Z"),
    trialEndsAt: new Date("2026-05-08T00:00:00.000Z"),
    graceStartedAt: null as Date | null,
    graceEndsAt: null as Date | null,
    currentPeriodStartedAt: new Date("2026-05-01T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-05-08T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    billingProvider: null,
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-provider-1",
    metadata: null,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-01T00:00:00.000Z")
  };

  const planRows: Record<string, { status: "active" | "inactive"; billingProviderHints: unknown }> =
    {
      pro: {
        status: "active",
        billingProviderHints: {
          lifecyclePolicy: {
            schema: "persai.planLifecyclePolicy.v1",
            trialFallbackPlanCode: null,
            paidFallbackPlanCode: "starter"
          }
        }
      },
      starter_trial: {
        status: "active",
        billingProviderHints: {
          lifecyclePolicy: {
            schema: "persai.planLifecyclePolicy.v1",
            trialFallbackPlanCode: "starter",
            paidFallbackPlanCode: null
          }
        }
      },
      starter: { status: "active", billingProviderHints: null }
    };

  const prisma = {
    async $transaction<T>(fn: (tx: typeof prisma) => Promise<T>) {
      return fn(prisma);
    },
    workspaceSubscription: {
      async findUnique() {
        return subscription;
      },
      async update(args: { data: Partial<typeof subscription> }) {
        subscription = {
          ...subscription,
          ...args.data,
          updatedAt: new Date()
        } as typeof subscription;
        return subscription;
      }
    },
    workspaceSubscriptionLifecycleEvent: {
      async create(args: {
        data: { eventCode: string; previousPlanCode: string | null; nextPlanCode: string | null };
      }) {
        const id = `event-${events.length + 1}`;
        events.push({
          id,
          eventCode: args.data.eventCode,
          previousPlanCode: args.data.previousPlanCode,
          nextPlanCode: args.data.nextPlanCode
        });
        return { id };
      }
    },
    planCatalogPlan: {
      async findUnique(args: { where: { code: string } }) {
        const row = planRows[args.where.code];
        return row ?? null;
      }
    },
    assistant: {
      async updateMany(args: { where: { workspaceId: string } }) {
        dirtyWorkspaces.push(args.where.workspaceId);
        return { count: 1 };
      }
    }
  };

  const settings = {
    async resolveSettings() {
      return {
        schema: "persai.billingLifecycleSettings.v1",
        gracePeriodDays: 5,
        globalFallbackPlanCode: "starter",
        updatedAt: "2026-05-03T00:00:00.000Z"
      };
    }
  } as Pick<ManageAdminBillingLifecycleSettingsService, "resolveSettings">;

  const service = new ManageWorkspaceSubscriptionLifecycleService(
    prisma as never,
    settings as ManageAdminBillingLifecycleSettingsService,
    {
      async scheduleForLifecycleEventIds(eventIds: string[]) {
        scheduledEventIds.push(eventIds);
      }
    } as never,
    {
      async execute(workspaceId: string) {
        immediateActivationWorkspaces.push(workspaceId);
        return {
          attemptedAssistants: 1,
          refreshedAssistants: 1,
          failedAssistants: 0
        };
      }
    } as never
  );

  await service.activatePaidSubscription({
    workspaceId: "ws-1",
    userId: "user-1",
    paidPlanCode: "pro",
    currentPeriodStartedAt: "2026-05-02T00:00:00.000Z",
    currentPeriodEndsAt: "2026-06-02T00:00:00.000Z",
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-provider-1",
    source: "provider",
    refs: { relatedProviderEventRef: "evt-renewed" },
    eventCode: "renewal_succeeded",
    lifecycleReason: "renewal_succeeded"
  });
  assert.equal(subscription.status, "active");
  assert.equal(subscription.trialStartedAt, null);
  assert.equal(subscription.trialEndsAt, null);
  assert.equal(subscription.billingProvider, "stripe");
  assert.equal(subscription.currentPeriodEndsAt?.toISOString(), "2026-06-02T00:00:00.000Z");
  assert.equal(events[0]?.eventCode, "renewal_succeeded");

  await service.startPaidGrace({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "provider",
    refs: { relatedProviderEventRef: "evt-renewal-failed" }
  });
  assert.equal(subscription.status, "grace_period");
  assert.equal(subscription.planCode, "pro");
  assert.ok(subscription.graceStartedAt instanceof Date);
  assert.ok(subscription.graceEndsAt instanceof Date);
  assert.equal(events[1]?.eventCode, "renewal_failed");
  assert.equal(events[2]?.eventCode, "grace_started");

  subscription.graceEndsAt = new Date("2026-05-02T00:00:00.000Z");
  await service.expireGrace({
    workspaceId: "ws-1",
    userId: "user-1",
    now: new Date("2026-05-03T00:00:00.000Z")
  });
  assert.equal(subscription.status, "expired_fallback");
  assert.equal(subscription.planCode, "starter");
  assert.equal(subscription.billingProvider, null);
  assert.equal(subscription.providerCustomerRef, null);
  assert.equal(subscription.providerSubscriptionRef, null);
  assert.equal(events.at(-2)?.eventCode, "grace_expired");
  assert.equal(events.at(-1)?.eventCode, "fallback_applied");

  await service.recoverPayment({
    workspaceId: "ws-1",
    userId: "user-1",
    paidPlanCode: "pro",
    currentPeriodStartedAt: "2026-05-03T00:00:00.000Z",
    currentPeriodEndsAt: "2026-06-03T00:00:00.000Z",
    source: "provider"
  });
  assert.equal(subscription.status, "active");
  assert.equal(subscription.planCode, "pro");
  assert.equal(subscription.graceStartedAt, null);
  assert.equal(subscription.graceEndsAt, null);
  assert.equal(events.at(-1)?.eventCode, "payment_recovered");

  await service.schedulePaidCancellationAtPeriodEnd({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "provider",
    refs: { relatedProviderEventRef: "evt-cancel-scheduled" }
  });
  assert.equal(subscription.cancelAtPeriodEnd, true);
  assert.equal(events.at(-1)?.eventCode, "auto_renew_disabled");

  subscription.currentPeriodEndsAt = new Date("2026-05-03T00:00:00.000Z");
  await service.applyCancelledPaidPeriodEndFallback({
    workspaceId: "ws-1",
    userId: "user-1",
    now: new Date("2026-05-04T00:00:00.000Z")
  });
  assert.equal(subscription.status, "expired_fallback");
  assert.equal(subscription.planCode, "starter");
  assert.equal(subscription.cancelAtPeriodEnd, false);
  assert.equal(subscription.billingProvider, null);
  assert.equal(subscription.providerCustomerRef, null);
  assert.equal(subscription.providerSubscriptionRef, null);
  assert.equal(events.at(-2)?.eventCode, "subscription_canceled");
  assert.equal(events.at(-1)?.eventCode, "fallback_applied");

  subscription = {
    ...subscription,
    planCode: "pro",
    status: "active",
    cancelAtPeriodEnd: false,
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-provider-1",
    currentPeriodStartedAt: new Date("2026-05-04T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-06-04T00:00:00.000Z")
  };
  await service.applyImmediatePaidFallback({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "provider",
    refs: { relatedProviderEventRef: "evt-chargeback" },
    lifecycleReason: "payment_reversed",
    eventCode: "payment_reversed"
  });
  assert.equal(subscription.status, "expired_fallback");
  assert.equal(subscription.planCode, "starter");
  assert.equal(subscription.billingProvider, null);
  assert.equal(subscription.providerCustomerRef, null);
  assert.equal(subscription.providerSubscriptionRef, null);
  assert.equal(events.at(-2)?.eventCode, "payment_reversed");
  assert.equal(events.at(-1)?.eventCode, "fallback_applied");
  subscription = {
    ...subscription,
    planCode: "starter_trial",
    status: "trialing",
    trialStartedAt: new Date("2026-05-03T00:00:00.000Z"),
    trialEndsAt: new Date("2026-05-10T00:00:00.000Z"),
    currentPeriodStartedAt: new Date("2026-05-03T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-05-10T00:00:00.000Z")
  };
  await service.extendTrial({
    workspaceId: "ws-1",
    userId: "user-1",
    newTrialEndsAt: "2026-05-17T00:00:00.000Z",
    source: "admin"
  });
  assert.equal(subscription.trialEndsAt?.toISOString(), "2026-05-17T00:00:00.000Z");
  assert.equal(subscription.currentPeriodEndsAt?.toISOString(), "2026-05-17T00:00:00.000Z");
  assert.equal(events.at(-1)?.eventCode, "trial_extended");

  await service.applyFallbackNow({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "admin",
    now: new Date("2026-05-05T00:00:00.000Z")
  });
  assert.equal(subscription.status, "expired_fallback");
  assert.equal(subscription.planCode, "starter");
  assert.equal(subscription.billingProvider, null);
  assert.equal(subscription.providerCustomerRef, null);
  assert.equal(subscription.providerSubscriptionRef, null);
  assert.equal(events.at(-1)?.eventCode, "fallback_applied");

  subscription = {
    ...subscription,
    planCode: "pro",
    status: "active",
    trialStartedAt: null,
    trialEndsAt: null,
    graceStartedAt: null,
    graceEndsAt: null,
    currentPeriodStartedAt: new Date("2026-05-05T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-06-05T00:00:00.000Z")
  };
  await service.grantGrace({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "admin"
  });
  assert.equal(subscription.status, "grace_period");
  assert.equal(events.at(-1)?.eventCode, "grace_started");

  const previousGraceEndsAt = subscription.graceEndsAt?.toISOString();
  await service.extendGrace({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "admin"
  });
  assert.notEqual(subscription.graceEndsAt?.toISOString(), previousGraceEndsAt);
  assert.equal(events.at(-1)?.eventCode, "grace_extended");

  await service.recordBillingReminder({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "admin"
  });
  assert.equal(events.at(-1)?.eventCode, "billing_reminder_requested");
  assert.deepEqual(dirtyWorkspaces, [
    "ws-1",
    "ws-1",
    "ws-1",
    "ws-1",
    "ws-1",
    "ws-1",
    "ws-1",
    "ws-1",
    "ws-1",
    "ws-1"
  ]);
  assert.deepEqual(scheduledEventIds, [
    ["event-1"],
    ["event-2", "event-3"],
    ["event-4", "event-5"],
    ["event-6"],
    ["event-8", "event-9"],
    ["event-10", "event-11"],
    ["event-12"],
    ["event-13"],
    ["event-14"],
    ["event-15"],
    ["event-16"]
  ]);
  assert.deepEqual(immediateActivationWorkspaces, ["ws-1", "ws-1"]);
}

void run();
