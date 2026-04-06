import assert from "node:assert/strict";
import { ManageAdminWorkspaceSubscriptionService } from "../src/modules/workspace-management/application/manage-admin-workspace-subscription.service";
import type { AdminAuthorizationService } from "../src/modules/workspace-management/application/admin-authorization.service";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";
import type { WorkspaceSubscriptionRepository } from "../src/modules/workspace-management/domain/workspace-subscription.repository";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

async function run(): Promise<void> {
  const authCalls: Array<{ userId: string; action: string; stepUpToken: string | null }> = [];
  const upserts: Array<{ workspaceId: string; planCode: string; status: string }> = [];
  const deletes: string[] = [];
  const dirtyWrites: string[] = [];

  let currentSubscription = {
    id: "sub-1",
    workspaceId: "ws-1",
    planCode: "starter_trial",
    status: "trialing" as const,
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

  const service = new ManageAdminWorkspaceSubscriptionService(
    {
      async assertCanPerformDangerousAdminAction(
        userId: string,
        action: string,
        stepUpToken: string | null
      ) {
        authCalls.push({ userId, action, stepUpToken });
        return {
          userId,
          workspaceId: "ws-admin",
          roles: ["business_admin"],
          hasLegacyOwnerFallback: false,
          hasGlobalPlatformAdminScope: false
        };
      }
    } as Pick<
      AdminAuthorizationService,
      "assertCanPerformDangerousAdminAction"
    > as AdminAuthorizationService,
    {
      async findByUserId(userId: string) {
        if (userId === "missing-user") {
          return null;
        }
        return {
          id: "assistant-1",
          userId,
          workspaceId: "ws-1",
          draftDisplayName: null,
          draftInstructions: null,
          draftTraits: null,
          draftAvatarEmoji: null,
          draftAvatarUrl: null,
          draftAssistantGender: null,
          draftUpdatedAt: null,
          applyStatus: "succeeded",
          applyTargetVersionId: null,
          applyAppliedVersionId: null,
          applyRequestedAt: null,
          applyStartedAt: null,
          applyFinishedAt: null,
          applyErrorCode: null,
          applyErrorMessage: null,
          configDirtyAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }
    } as Pick<AssistantRepository, "findByUserId"> as AssistantRepository,
    {
      async findByWorkspaceId() {
        return currentSubscription;
      },
      async upsertFromBillingSnapshot(snapshot) {
        upserts.push({
          workspaceId: snapshot.workspaceId,
          planCode: snapshot.planCode,
          status: snapshot.status
        });
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
    } as WorkspaceSubscriptionRepository,
    {
      assistant: {
        async updateMany(args: { where: { workspaceId: string }; data: { configDirtyAt: Date } }) {
          assert.equal(args.where.workspaceId, "ws-1");
          assert.ok(args.data.configDirtyAt instanceof Date);
          dirtyWrites.push(args.where.workspaceId);
          return { count: 1 };
        }
      }
    } as Pick<WorkspaceManagementPrismaService, "assistant"> as WorkspaceManagementPrismaService
  );

  const parsed = service.parseApplyInput({
    planCode: "pro",
    status: "active",
    currentPeriodEndsAt: "2026-05-01T00:00:00.000Z",
    metadata: { source: "admin" }
  });
  assert.equal(parsed.planCode, "pro");
  assert.equal(parsed.status, "active");
  assert.equal(parsed.currentPeriodEndsAt, "2026-05-01T00:00:00.000Z");
  assert.deepEqual(parsed.metadata, { source: "admin" });

  const unchanged = await service.setWorkspaceSubscription(
    "admin-1",
    "user-1",
    {
      planCode: "starter_trial",
      status: "trialing",
      trialStartedAt: "2026-04-06T00:00:00.000Z",
      trialEndsAt: "2026-04-20T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      providerCustomerRef: "cust-1",
      providerSubscriptionRef: "sub-1",
      metadata: { source: "seed" }
    },
    "step-up-1"
  );
  assert.deepEqual(unchanged, { ok: true, changed: false, workspaceId: "ws-1" });
  assert.deepEqual(upserts, []);
  assert.deepEqual(dirtyWrites, []);

  const changed = await service.setWorkspaceSubscription(
    "admin-1",
    "user-1",
    {
      planCode: "pro",
      status: "active",
      currentPeriodStartedAt: "2026-04-20T00:00:00.000Z",
      currentPeriodEndsAt: "2026-05-20T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      providerCustomerRef: "cust-2",
      providerSubscriptionRef: "sub-2",
      metadata: { source: "admin" }
    },
    "step-up-2"
  );
  assert.deepEqual(changed, { ok: true, changed: true, workspaceId: "ws-1" });
  assert.deepEqual(upserts, [{ workspaceId: "ws-1", planCode: "pro", status: "active" }]);
  assert.deepEqual(dirtyWrites, ["ws-1"]);

  const deleted = await service.resetWorkspaceSubscription("admin-1", "user-1", "step-up-3");
  assert.deepEqual(deleted, { ok: true, changed: true, workspaceId: "ws-1" });
  assert.deepEqual(deletes, ["ws-1"]);
  assert.deepEqual(dirtyWrites, ["ws-1", "ws-1"]);
  assert.deepEqual(authCalls, [
    { userId: "admin-1", action: "admin.plan.update", stepUpToken: "step-up-1" },
    { userId: "admin-1", action: "admin.plan.update", stepUpToken: "step-up-2" },
    { userId: "admin-1", action: "admin.plan.update", stepUpToken: "step-up-3" }
  ]);
}

void run();
