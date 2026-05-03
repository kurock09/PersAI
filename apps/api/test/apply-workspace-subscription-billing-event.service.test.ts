import assert from "node:assert/strict";
import { ApplyWorkspaceSubscriptionBillingEventService } from "../src/modules/workspace-management/application/apply-workspace-subscription-billing-event.service";
import type { ManageWorkspaceSubscriptionLifecycleService } from "../src/modules/workspace-management/application/manage-workspace-subscription-lifecycle.service";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

async function run(): Promise<void> {
  const lifecycleCalls: Array<{ kind: string; eventCode?: string }> = [];
  const billingEvents: Array<Record<string, unknown>> = [];
  const currentSubscription = {
    id: "sub-1",
    workspaceId: "ws-1",
    planCode: "pro",
    status: "active" as const,
    currentPeriodStartedAt: new Date("2026-05-01T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-06-01T00:00:00.000Z"),
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-1"
  };

  const prisma = {
    workspaceSubscription: {
      async findUnique() {
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

  const service = new ApplyWorkspaceSubscriptionBillingEventService(prisma, {
    async startPaidGrace() {
      lifecycleCalls.push({ kind: "startPaidGrace" });
    },
    async recoverPayment() {
      lifecycleCalls.push({ kind: "recoverPayment" });
    },
    async activatePaidSubscription(input: { eventCode: string }) {
      lifecycleCalls.push({ kind: "activatePaidSubscription", eventCode: input.eventCode });
    },
    async applyImmediatePaidFallback() {
      lifecycleCalls.push({ kind: "applyImmediatePaidFallback" });
    }
  } as Pick<
    ManageWorkspaceSubscriptionLifecycleService,
    "startPaidGrace" | "recoverPayment" | "activatePaidSubscription" | "applyImmediatePaidFallback"
  > as ManageWorkspaceSubscriptionLifecycleService);

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

  const duplicate = await service.apply({
    workspaceId: "ws-1",
    userId: "user-1",
    source: "provider",
    eventCode: "renewal_failed",
    eventRef: "evt-renewal-failed",
    billingProvider: "stripe"
  });
  assert.deepEqual(duplicate, { status: "duplicate", billingEventId: "billing-event-1" });
  assert.deepEqual(lifecycleCalls, [{ kind: "startPaidGrace" }]);

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
  assert.deepEqual(ignored, { status: "ignored", billingEventId: "billing-event-2" });
  assert.deepEqual(lifecycleCalls, [{ kind: "startPaidGrace" }]);
  assert.equal(billingEvents[1]?.applyStatus, "ignored");

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
  assert.deepEqual(renewalSuccess, { status: "applied", billingEventId: "billing-event-3" });
  assert.deepEqual(lifecycleCalls, [
    { kind: "startPaidGrace" },
    { kind: "activatePaidSubscription", eventCode: "renewal_succeeded" }
  ]);
  assert.equal(billingEvents[2]?.applyStatus, "applied");
}

void run();
