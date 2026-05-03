import assert from "node:assert/strict";
import { SyncWorkspaceSubscriptionService } from "../src/modules/workspace-management/application/sync-workspace-subscription.service";
import type { BillingProviderPort } from "../src/modules/workspace-management/application/billing-provider.port";
import type { ApplyWorkspaceSubscriptionBillingEventService } from "../src/modules/workspace-management/application/apply-workspace-subscription-billing-event.service";
import type { WorkspaceSubscriptionRepository } from "../src/modules/workspace-management/domain/workspace-subscription.repository";

async function run(): Promise<void> {
  const appliedEvents: Array<{
    eventCode: string;
    eventRef: string | null;
    billingProvider: string | null;
  }> = [];

  let currentSubscription: ReturnType<
    WorkspaceSubscriptionRepository["findByWorkspaceId"]
  > extends Promise<infer T>
    ? T
    : never = {
    id: "sub-1",
    workspaceId: "ws-1",
    planCode: "pro",
    status: "active",
    trialStartedAt: null,
    trialEndsAt: null,
    graceStartedAt: null,
    graceEndsAt: null,
    currentPeriodStartedAt: new Date("2026-04-06T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-05-06T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    billingProvider: "stripe",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-1",
    metadata: { source: "seed" },
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    updatedAt: new Date("2026-04-06T00:00:00.000Z")
  };

  const repository: WorkspaceSubscriptionRepository = {
    async findByWorkspaceId() {
      return currentSubscription;
    },
    async upsertFromBillingSnapshot(snapshot) {
      currentSubscription = {
        id: "sub-1",
        workspaceId: snapshot.workspaceId,
        planCode: snapshot.planCode,
        status: snapshot.status,
        graceStartedAt: snapshot.graceStartedAt ? new Date(snapshot.graceStartedAt) : null,
        graceEndsAt: snapshot.graceEndsAt ? new Date(snapshot.graceEndsAt) : null,
        trialStartedAt: snapshot.trialStartedAt ? new Date(snapshot.trialStartedAt) : null,
        trialEndsAt: snapshot.trialEndsAt ? new Date(snapshot.trialEndsAt) : null,
        currentPeriodStartedAt: snapshot.currentPeriodStartedAt
          ? new Date(snapshot.currentPeriodStartedAt)
          : null,
        currentPeriodEndsAt: snapshot.currentPeriodEndsAt
          ? new Date(snapshot.currentPeriodEndsAt)
          : null,
        cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
        billingProvider: snapshot.billingProvider,
        providerCustomerRef: snapshot.providerCustomerRef,
        providerSubscriptionRef: snapshot.providerSubscriptionRef,
        metadata: snapshot.metadata,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      return currentSubscription;
    },
    async deleteByWorkspaceId(workspaceId) {
      void workspaceId;
      currentSubscription = null;
    }
  };

  let providerSnapshot = {
    workspaceId: "ws-1",
    planCode: "pro",
    status: "active" as const,
    billingProvider: "stripe",
    trialStartedAt: null,
    trialEndsAt: null,
    graceStartedAt: null,
    graceEndsAt: null,
    currentPeriodStartedAt: "2026-04-06T00:00:00.000Z",
    currentPeriodEndsAt: "2026-05-06T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-1",
    metadata: { source: "seed" }
  };

  const service = new SyncWorkspaceSubscriptionService(
    {
      async pullWorkspaceSubscription() {
        return providerSnapshot;
      }
    } as BillingProviderPort,
    repository,
    {
      async apply(input) {
        appliedEvents.push({
          eventCode: input.eventCode,
          eventRef: input.eventRef ?? null,
          billingProvider: input.billingProvider ?? null
        });
        return { status: "applied", billingEventId: `billing-event-${appliedEvents.length}` };
      }
    } as Pick<
      ApplyWorkspaceSubscriptionBillingEventService,
      "apply"
    > as ApplyWorkspaceSubscriptionBillingEventService
  );

  const unchanged = await service.syncWorkspace("ws-1");
  assert.deepEqual(unchanged, { status: "unchanged", workspaceId: "ws-1" });
  assert.deepEqual(appliedEvents, []);

  providerSnapshot = {
    ...providerSnapshot,
    currentPeriodStartedAt: "2026-05-06T00:00:00.000Z",
    currentPeriodEndsAt: "2026-06-06T00:00:00.000Z"
  };
  const changed = await service.syncWorkspace("ws-1");
  assert.deepEqual(changed, { status: "updated", workspaceId: "ws-1", changed: true });
  assert.deepEqual(appliedEvents, [
    {
      eventCode: "renewal_succeeded",
      eventRef: "stripe:ws-1:sub-1:active:2026-06-06T00:00:00.000Z",
      billingProvider: "stripe"
    }
  ]);

  const missingProvider = await new SyncWorkspaceSubscriptionService(
    {
      async pullWorkspaceSubscription() {
        return null;
      }
    } as BillingProviderPort,
    repository,
    {
      async apply() {
        throw new Error("provider-null sync should not apply a billing event");
      }
    } as Pick<
      ApplyWorkspaceSubscriptionBillingEventService,
      "apply"
    > as ApplyWorkspaceSubscriptionBillingEventService
  ).syncWorkspace("ws-1");
  assert.deepEqual(missingProvider, { status: "unchanged", workspaceId: "ws-1" });
}

void run();
