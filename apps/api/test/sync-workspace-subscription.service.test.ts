import assert from "node:assert/strict";
import { SyncWorkspaceSubscriptionService } from "../src/modules/workspace-management/application/sync-workspace-subscription.service";
import type { BillingProviderPort } from "../src/modules/workspace-management/application/billing-provider.port";
import type { WorkspaceSubscriptionRepository } from "../src/modules/workspace-management/domain/workspace-subscription.repository";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

async function run(): Promise<void> {
  const dirtyWrites: string[] = [];
  const upserts: string[] = [];
  const deletes: string[] = [];

  let currentSubscription: ReturnType<
    WorkspaceSubscriptionRepository["findByWorkspaceId"]
  > extends Promise<infer T>
    ? T
    : never = {
    id: "sub-1",
    workspaceId: "ws-1",
    planCode: "starter_trial",
    status: "trialing",
    trialStartedAt: new Date("2026-04-06T00:00:00.000Z"),
    trialEndsAt: new Date("2026-04-20T00:00:00.000Z"),
    currentPeriodStartedAt: null,
    currentPeriodEndsAt: null,
    cancelAtPeriodEnd: false,
    billingProvider: null,
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
      upserts.push(snapshot.workspaceId);
      currentSubscription = {
        id: "sub-1",
        workspaceId: snapshot.workspaceId,
        planCode: snapshot.planCode,
        status: snapshot.status,
        trialStartedAt: snapshot.trialStartedAt ? new Date(snapshot.trialStartedAt) : null,
        trialEndsAt: snapshot.trialEndsAt ? new Date(snapshot.trialEndsAt) : null,
        currentPeriodStartedAt: snapshot.currentPeriodStartedAt
          ? new Date(snapshot.currentPeriodStartedAt)
          : null,
        currentPeriodEndsAt: snapshot.currentPeriodEndsAt
          ? new Date(snapshot.currentPeriodEndsAt)
          : null,
        cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
        billingProvider: null,
        providerCustomerRef: snapshot.providerCustomerRef,
        providerSubscriptionRef: snapshot.providerSubscriptionRef,
        metadata: snapshot.metadata,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      return currentSubscription;
    },
    async deleteByWorkspaceId(workspaceId) {
      deletes.push(workspaceId);
      currentSubscription = null;
    }
  };

  let providerSnapshot = {
    workspaceId: "ws-1",
    planCode: "starter_trial",
    status: "trialing" as const,
    trialStartedAt: "2026-04-06T00:00:00.000Z",
    trialEndsAt: "2026-04-20T00:00:00.000Z",
    currentPeriodStartedAt: null,
    currentPeriodEndsAt: null,
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
      assistant: {
        async updateMany(args: { where: { workspaceId: string }; data: { configDirtyAt: Date } }) {
          assert.equal(args.where.workspaceId, "ws-1");
          assert.ok(args.data.configDirtyAt instanceof Date);
          dirtyWrites.push(args.where.workspaceId);
          return { count: 2 };
        }
      }
    } as Pick<WorkspaceManagementPrismaService, "assistant"> as WorkspaceManagementPrismaService
  );

  const unchanged = await service.syncWorkspace("ws-1");
  assert.deepEqual(unchanged, { status: "unchanged", workspaceId: "ws-1" });
  assert.deepEqual(upserts, []);
  assert.deepEqual(dirtyWrites, []);

  providerSnapshot = {
    ...providerSnapshot,
    planCode: "pro",
    status: "active"
  };
  const changed = await service.syncWorkspace("ws-1");
  assert.deepEqual(changed, { status: "updated", workspaceId: "ws-1", changed: true });
  assert.deepEqual(upserts, ["ws-1"]);
  assert.deepEqual(dirtyWrites, ["ws-1"]);

  const deleted = await new SyncWorkspaceSubscriptionService(
    {
      async pullWorkspaceSubscription() {
        return null;
      }
    } as BillingProviderPort,
    repository,
    {
      assistant: {
        async updateMany(args: { where: { workspaceId: string }; data: { configDirtyAt: Date } }) {
          assert.equal(args.where.workspaceId, "ws-1");
          assert.ok(args.data.configDirtyAt instanceof Date);
          dirtyWrites.push(`delete:${args.where.workspaceId}`);
          return { count: 2 };
        }
      }
    } as Pick<WorkspaceManagementPrismaService, "assistant"> as WorkspaceManagementPrismaService
  ).syncWorkspace("ws-1");
  assert.deepEqual(deleted, { status: "deleted", workspaceId: "ws-1", changed: true });
  assert.deepEqual(deletes, ["ws-1"]);
  assert.deepEqual(dirtyWrites, ["ws-1", "delete:ws-1"]);
}

void run();
