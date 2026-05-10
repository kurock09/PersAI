import assert from "node:assert/strict";
import { ApplyWorkspaceSubscriptionBillingEventService } from "../src/modules/workspace-management/application/apply-workspace-subscription-billing-event.service";
import type { ManageWorkspaceSubscriptionLifecycleService } from "../src/modules/workspace-management/application/manage-workspace-subscription-lifecycle.service";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

async function run(): Promise<void> {
  const lifecycleCalls: Array<{ kind: string; eventCode?: string }> = [];
  const billingEvents: Array<Record<string, unknown>> = [];
  const providerUpdateCalls: Array<Record<string, unknown>> = [];
  let currentSubscription: {
    id: string;
    workspaceId: string;
    planCode: string;
    status: "active";
    cancelAtPeriodEnd: boolean;
    currentPeriodStartedAt: Date | null;
    currentPeriodEndsAt: Date | null;
    billingProvider: string | null;
    providerCustomerRef: string | null;
    providerSubscriptionRef: string | null;
  } | null = {
    id: "sub-1",
    workspaceId: "ws-1",
    planCode: "pro",
    status: "active" as const,
    cancelAtPeriodEnd: false,
    currentPeriodStartedAt: new Date("2026-05-01T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-06-01T00:00:00.000Z"),
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-1"
  };

  const prisma = {
    planCatalogPlan: {
      async findUnique(args: { where: { code: string } }) {
        if (args.where.code === "pro") {
          return { displayName: "Pro" };
        }
        return null;
      }
    },
    workspaceSubscription: {
      async findUnique() {
        return currentSubscription;
      },
      async update() {
        return currentSubscription;
      }
    },
    workspaceSubscriptionBillingEvent: {
      async findUnique(args: { where: { source_eventRef: { source: string; eventRef: string } } }) {
        return (
          billingEvents.find(
            (event) =>
              event.source === args.where.source_eventRef.source &&
              event.eventRef === args.where.source_eventRef.eventRef
          ) ?? null
        );
      },
      async create(args: { data: Record<string, unknown> }) {
        const created = {
          id: `billing-event-${billingEvents.length + 1}`,
          applyStatus: "pending",
          ...args.data
        };
        billingEvents.push(created);
        return created;
      },
      async update(args: { where: { id: string }; data: Record<string, unknown> }) {
        const event = billingEvents.find((entry) => entry.id === args.where.id);
        if (!event) throw new Error("billing event not found");
        Object.assign(event, args.data);
        return event;
      }
    }
  } as unknown as WorkspaceManagementPrismaService;

  const service = new ApplyWorkspaceSubscriptionBillingEventService(
    prisma,
    {
      async startPaidGrace(input: { paidPlanCodeOverride?: string | null }) {
        if (currentSubscription !== null && input.paidPlanCodeOverride) {
          currentSubscription = {
            ...currentSubscription,
            planCode: input.paidPlanCodeOverride
          };
        }
        lifecycleCalls.push({ kind: "startPaidGrace" });
      },
      async recoverPayment() {
        lifecycleCalls.push({ kind: "recoverPayment" });
      },
      async activatePaidSubscription(input: {
        eventCode: string;
        providerSubscriptionRef?: string | null;
      }) {
        currentSubscription = {
          id: currentSubscription?.id ?? "sub-created-1",
          workspaceId: "ws-1",
          planCode: "pro",
          status: "active",
          cancelAtPeriodEnd: false,
          currentPeriodStartedAt: new Date("2026-06-01T00:00:00.000Z"),
          currentPeriodEndsAt: new Date("2026-07-01T00:00:00.000Z"),
          billingProvider: "stripe",
          providerCustomerRef: "cust-1",
          providerSubscriptionRef: input.providerSubscriptionRef ?? "sub-1"
        };
        lifecycleCalls.push({ kind: "activatePaidSubscription", eventCode: input.eventCode });
      },
      async schedulePaidCancellationAtPeriodEnd() {
        currentSubscription = currentSubscription
          ? {
              ...currentSubscription,
              cancelAtPeriodEnd: true
            }
          : currentSubscription;
        lifecycleCalls.push({ kind: "schedulePaidCancellationAtPeriodEnd" });
      },
      async applyImmediatePaidFallback() {
        lifecycleCalls.push({ kind: "applyImmediatePaidFallback" });
      },
      async enablePaidAutoRenew(input: {
        billingProvider: string | null;
        providerCustomerRef: string | null;
        providerSubscriptionRef: string;
      }) {
        currentSubscription = currentSubscription
          ? {
              ...currentSubscription,
              cancelAtPeriodEnd: false,
              billingProvider: input.billingProvider,
              providerCustomerRef: input.providerCustomerRef,
              providerSubscriptionRef: input.providerSubscriptionRef
            }
          : currentSubscription;
        lifecycleCalls.push({ kind: "enablePaidAutoRenew" });
      }
    } as Pick<
      ManageWorkspaceSubscriptionLifecycleService,
      | "startPaidGrace"
      | "recoverPayment"
      | "activatePaidSubscription"
      | "schedulePaidCancellationAtPeriodEnd"
      | "applyImmediatePaidFallback"
      | "enablePaidAutoRenew"
    > as ManageWorkspaceSubscriptionLifecycleService,
    {
      async updateManagedSubscription(input: Record<string, unknown>) {
        providerUpdateCalls.push(input);
        return {
          providerKey: "stripe",
          providerSubscriptionRef: "sub-updated-1",
          status: "Active",
          nextChargeAt: "2026-09-01T00:00:00.000Z",
          amountMinor: 19900,
          currency: "RUB",
          interval: "Month",
          period: 1,
          customerPortalUrl: null,
          paymentMethodUpdateUrl: null,
          cancelUrl: null,
          raw: {}
        };
      }
    } as never
  );

  const renewalFailed = await service.apply({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "provider",
    eventCode: "renewal_failed",
    eventRef: "evt-renewal-failed",
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-1",
    metadata: { reason: "card_declined" }
  });
  assert.deepEqual(renewalFailed, { status: "applied", billingEventId: "billing-event-1" });
  assert.deepEqual(lifecycleCalls, [{ kind: "startPaidGrace" }]);
  assert.equal(billingEvents[0]?.applyStatus, "applied");

  currentSubscription = {
    ...currentSubscription,
    planCode: "pro",
    status: "active",
    cancelAtPeriodEnd: false,
    currentPeriodStartedAt: new Date("2026-05-01T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-06-01T00:00:00.000Z"),
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-1"
  };
  const scheduledDowngradeRenewalFailed = await service.apply({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "provider",
    eventCode: "renewal_failed",
    eventRef: "evt-renewal-failed-downgrade",
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-1",
    metadata: { scheduledPaidPlanCode: "starter" }
  });
  assert.deepEqual(scheduledDowngradeRenewalFailed, {
    status: "applied",
    billingEventId: "billing-event-2"
  });
  assert.equal(currentSubscription?.planCode, "starter");

  const duplicate = await service.apply({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "provider",
    eventCode: "renewal_failed",
    eventRef: "evt-renewal-failed",
    billingProvider: "stripe"
  });
  assert.deepEqual(duplicate, { status: "duplicate", billingEventId: "billing-event-1" });
  assert.deepEqual(lifecycleCalls, [{ kind: "startPaidGrace" }, { kind: "startPaidGrace" }]);

  currentSubscription = {
    ...currentSubscription,
    planCode: "pro",
    status: "active",
    cancelAtPeriodEnd: false,
    currentPeriodStartedAt: new Date("2026-05-01T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-06-01T00:00:00.000Z"),
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-1"
  };

  const ignored = await service.apply({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "manual",
    eventCode: "payment_activated",
    paidPlanCode: "pro",
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-1",
    currentPeriodStartedAt: "2026-05-01T00:00:00.000Z",
    currentPeriodEndsAt: "2026-06-01T00:00:00.000Z"
  });
  assert.deepEqual(ignored, { status: "ignored", billingEventId: "billing-event-3" });
  assert.deepEqual(lifecycleCalls, [{ kind: "startPaidGrace" }, { kind: "startPaidGrace" }]);
  assert.equal(billingEvents[2]?.applyStatus, "ignored");

  const renewalSuccess = await service.apply({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "provider",
    eventCode: "renewal_succeeded",
    eventRef: "evt-renewal-succeeded",
    paidPlanCode: "pro",
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-1",
    currentPeriodStartedAt: "2026-06-01T00:00:00.000Z",
    currentPeriodEndsAt: "2026-07-01T00:00:00.000Z"
  });
  assert.deepEqual(renewalSuccess, { status: "applied", billingEventId: "billing-event-4" });
  assert.deepEqual(lifecycleCalls, [
    { kind: "startPaidGrace" },
    { kind: "startPaidGrace" },
    { kind: "activatePaidSubscription", eventCode: "renewal_succeeded" }
  ]);
  assert.equal(billingEvents[3]?.applyStatus, "applied");
  assert.equal(billingEvents[3]?.subscriptionId, "sub-1");

  currentSubscription = null;
  const firstPaidActivation = await service.apply({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "provider",
    eventCode: "payment_activated",
    eventRef: "evt-first-payment",
    paidPlanCode: "pro",
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-1",
    currentPeriodStartedAt: "2026-07-01T00:00:00.000Z",
    currentPeriodEndsAt: "2026-08-01T00:00:00.000Z"
  });
  assert.deepEqual(firstPaidActivation, {
    status: "applied",
    billingEventId: "billing-event-5"
  });
  assert.deepEqual(lifecycleCalls, [
    { kind: "startPaidGrace" },
    { kind: "startPaidGrace" },
    { kind: "activatePaidSubscription", eventCode: "renewal_succeeded" },
    { kind: "activatePaidSubscription", eventCode: "payment_activated" }
  ]);
  assert.equal(billingEvents[4]?.applyStatus, "applied");
  assert.equal(billingEvents[4]?.subscriptionId, "sub-created-1");

  currentSubscription = {
    id: "sub-1",
    workspaceId: "ws-1",
    planCode: "pro",
    status: "active",
    cancelAtPeriodEnd: false,
    currentPeriodStartedAt: new Date("2026-07-01T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-08-01T00:00:00.000Z"),
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-1"
  };
  const cancelScheduled = await service.apply({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "provider",
    eventCode: "subscription_cancel_scheduled",
    eventRef: "evt-cancel-scheduled",
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-1",
    paidPlanCode: "pro"
  });
  assert.deepEqual(cancelScheduled, { status: "applied", billingEventId: "billing-event-6" });
  assert.equal(currentSubscription.cancelAtPeriodEnd, true);
  assert.deepEqual(lifecycleCalls.at(-1), { kind: "schedulePaidCancellationAtPeriodEnd" });

  currentSubscription = {
    id: "sub-1",
    workspaceId: "ws-1",
    planCode: "pro",
    status: "active",
    cancelAtPeriodEnd: false,
    currentPeriodStartedAt: new Date("2026-07-01T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-08-01T00:00:00.000Z"),
    billingProvider: null,
    providerCustomerRef: null,
    providerSubscriptionRef: null
  };
  const autoRenewEnabled = await service.apply({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "provider",
    eventCode: "auto_renew_enabled",
    eventRef: "evt-bind-success",
    billingProvider: "cloudpayments",
    providerCustomerRef: "acct-1",
    providerSubscriptionRef: "sub-bound-1"
  });
  assert.deepEqual(autoRenewEnabled, { status: "applied", billingEventId: "billing-event-7" });
  assert.deepEqual(lifecycleCalls.at(-1), { kind: "enablePaidAutoRenew" });
  assert.equal(currentSubscription.providerSubscriptionRef, "sub-bound-1");

  currentSubscription = {
    id: "sub-1",
    workspaceId: "ws-1",
    planCode: "pro",
    status: "active",
    cancelAtPeriodEnd: false,
    currentPeriodStartedAt: new Date("2026-07-01T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-08-01T00:00:00.000Z"),
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-current"
  };
  const staleProviderEvent = await service.apply({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "provider",
    eventCode: "renewal_succeeded",
    eventRef: "evt-stale-renewal",
    paidPlanCode: "pro",
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-stale",
    currentPeriodStartedAt: "2026-08-01T00:00:00.000Z",
    currentPeriodEndsAt: "2026-09-01T00:00:00.000Z"
  });
  assert.deepEqual(staleProviderEvent, { status: "ignored", billingEventId: "billing-event-8" });
  assert.deepEqual(lifecycleCalls.at(-1), { kind: "enablePaidAutoRenew" });
  assert.equal(billingEvents[7]?.applyStatus, "ignored");

  currentSubscription = {
    id: "sub-1",
    workspaceId: "ws-1",
    planCode: "pro",
    status: "active",
    cancelAtPeriodEnd: false,
    currentPeriodStartedAt: new Date("2026-08-01T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-09-01T00:00:00.000Z"),
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-existing-1"
  };
  const managedUpgrade = await service.apply({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "provider",
    eventCode: "payment_activated",
    eventRef: "evt-managed-upgrade",
    paidPlanCode: "pro",
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-existing-1",
    currentPeriodStartedAt: "2026-09-01T00:00:00.000Z",
    currentPeriodEndsAt: "2026-10-01T00:00:00.000Z",
    metadata: {
      managedRecurringSubscriptionUpdate: {
        providerSubscriptionRef: "sub-existing-1",
        amountMinor: 19900,
        currency: "RUB",
        startDate: "2026-10-01T00:00:00.000Z",
        interval: "Month",
        period: 1,
        maxPeriods: null
      }
    }
  });
  assert.deepEqual(managedUpgrade, { status: "applied", billingEventId: "billing-event-9" });
  assert.equal(providerUpdateCalls.length, 1);
  assert.equal(providerUpdateCalls[0]?.providerSubscriptionRef, "sub-existing-1");
  assert.equal(providerUpdateCalls[0]?.description, "PersAI Pro");
  assert.equal(currentSubscription.providerSubscriptionRef, "sub-updated-1");

  billingEvents[8] = {
    ...billingEvents[8],
    applyStatus: "failed"
  };
  currentSubscription = {
    ...currentSubscription,
    providerSubscriptionRef: "sub-existing-1"
  };
  const managedUpgradeReplay = await service.apply({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "provider",
    eventCode: "payment_activated",
    eventRef: "evt-managed-upgrade",
    paidPlanCode: "pro",
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-existing-1",
    currentPeriodStartedAt: "2026-09-01T00:00:00.000Z",
    currentPeriodEndsAt: "2026-10-01T00:00:00.000Z",
    metadata: {
      managedRecurringSubscriptionUpdate: {
        providerSubscriptionRef: "sub-existing-1",
        amountMinor: 19900,
        currency: "RUB",
        startDate: "2026-10-01T00:00:00.000Z",
        interval: "Month",
        period: 1,
        maxPeriods: null
      }
    }
  });
  assert.deepEqual(managedUpgradeReplay, {
    status: "applied",
    billingEventId: "billing-event-9"
  });
  assert.equal(providerUpdateCalls.length, 1);
  assert.equal(currentSubscription.providerSubscriptionRef, "sub-updated-1");

  const managedUpgradeDuplicate = await service.apply({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "provider",
    eventCode: "payment_activated",
    eventRef: "evt-managed-upgrade",
    paidPlanCode: "pro",
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-existing-1",
    currentPeriodStartedAt: "2026-09-01T00:00:00.000Z",
    currentPeriodEndsAt: "2026-10-01T00:00:00.000Z"
  });
  assert.deepEqual(managedUpgradeDuplicate, {
    status: "duplicate",
    billingEventId: "billing-event-9"
  });
  assert.equal(providerUpdateCalls.length, 1);
}

void run();
