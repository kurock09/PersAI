import assert from "node:assert/strict";
import { PrismaWorkspaceSubscriptionRepository } from "../src/modules/workspace-management/infrastructure/persistence/prisma-workspace-subscription.repository";

async function run(): Promise<void> {
  const deletedWorkspaceIds: string[] = [];
  const repository = new PrismaWorkspaceSubscriptionRepository({
    workspaceSubscription: {
      findUnique: async ({ where }: { where: { workspaceId: string } }) =>
        where.workspaceId === "ws-1"
          ? {
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
            }
          : null,
      upsert: async ({ create }: { create: Record<string, unknown> }) => ({
        id: "sub-1",
        workspaceId: create.workspaceId,
        planCode: create.planCode,
        status: create.status,
        trialStartedAt: create.trialStartedAt,
        trialEndsAt: create.trialEndsAt,
        currentPeriodStartedAt: create.currentPeriodStartedAt,
        currentPeriodEndsAt: create.currentPeriodEndsAt,
        cancelAtPeriodEnd: create.cancelAtPeriodEnd,
        billingProvider: create.billingProvider,
        providerCustomerRef: create.providerCustomerRef,
        providerSubscriptionRef: create.providerSubscriptionRef,
        metadata: create.metadata,
        createdAt: new Date("2026-04-06T00:00:00.000Z"),
        updatedAt: new Date("2026-04-06T00:00:01.000Z")
      }),
      deleteMany: async ({ where }: { where: { workspaceId: string } }) => {
        deletedWorkspaceIds.push(where.workspaceId);
        return { count: 1 };
      }
    }
  } as never);

  const existing = await repository.findByWorkspaceId("ws-1");
  assert.equal(existing?.planCode, "starter_trial");

  const upserted = await repository.upsertFromBillingSnapshot({
    workspaceId: "ws-1",
    planCode: "pro",
    status: "active",
    trialStartedAt: null,
    trialEndsAt: null,
    currentPeriodStartedAt: "2026-04-21T00:00:00.000Z",
    currentPeriodEndsAt: "2026-05-21T00:00:00.000Z",
    cancelAtPeriodEnd: true,
    providerCustomerRef: "cust-2",
    providerSubscriptionRef: "sub-2",
    metadata: { source: "billing_sync" }
  });
  assert.equal(upserted.planCode, "pro");
  assert.equal(upserted.status, "active");
  assert.equal(upserted.currentPeriodStartedAt?.toISOString(), "2026-04-21T00:00:00.000Z");
  assert.equal(upserted.currentPeriodEndsAt?.toISOString(), "2026-05-21T00:00:00.000Z");

  await repository.deleteByWorkspaceId("ws-1");
  assert.deepEqual(deletedWorkspaceIds, ["ws-1"]);
}

void run();
