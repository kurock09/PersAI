import assert from "node:assert/strict";
import { ManageAdminWorkspaceSubscriptionService } from "../src/modules/workspace-management/application/manage-admin-workspace-subscription.service";
import type { AdminAuthorizationService } from "../src/modules/workspace-management/application/admin-authorization.service";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";
import type { WorkspaceSubscriptionRepository } from "../src/modules/workspace-management/domain/workspace-subscription.repository";
import type { AssistantPlanCatalogRepository } from "../src/modules/workspace-management/domain/assistant-plan-catalog.repository";
import type { AssistantPlanCatalog } from "../src/modules/workspace-management/domain/assistant-plan-catalog.entity";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";
import type { ApplyWorkspaceSubscriptionBillingEventService } from "../src/modules/workspace-management/application/apply-workspace-subscription-billing-event.service";

async function run(): Promise<void> {
  const authCalls: Array<{ userId: string; action: string; stepUpToken: string | null }> = [];
  const upserts: Array<{ workspaceId: string; planCode: string; status: string }> = [];
  const deletes: string[] = [];
  const dirtyWrites: string[] = [];
  const rolloutRequests: Array<{ reason: string | null; targetGeneration: number }> = [];
  const appliedBillingEvents: Array<{
    eventCode: string;
    source: string;
    planCode: string | null;
  }> = [];
  let generation = 400;

  const planCatalogByCode: Record<
    string,
    Pick<AssistantPlanCatalog, "isTrialPlan" | "trialDurationDays" | "billingProviderHints">
  > = {
    starter_trial: {
      isTrialPlan: true,
      trialDurationDays: 14,
      billingProviderHints: {
        lifecyclePolicy: {
          schema: "persai.planLifecyclePolicy.v1",
          trialFallbackPlanCode: "pro"
        }
      }
    },
    pro: { isTrialPlan: false, trialDurationDays: null, billingProviderHints: null },
    free: {
      isTrialPlan: false,
      trialDurationDays: null,
      billingProviderHints: {
        presentation: {
          price: {
            amount: 0,
            currency: "RUB",
            billingPeriod: "month"
          }
        }
      }
    },
    fresh_trial: {
      isTrialPlan: true,
      trialDurationDays: 7,
      billingProviderHints: {
        lifecyclePolicy: {
          schema: "persai.planLifecyclePolicy.v1",
          trialFallbackPlanCode: "pro"
        }
      }
    }
  };

  let currentSubscription = {
    id: "sub-1",
    workspaceId: "ws-1",
    planCode: "starter_trial",
    status: "trialing" as const,
    trialStartedAt: new Date("2026-04-06T00:00:00.000Z"),
    trialEndsAt: new Date("2026-04-20T00:00:00.000Z"),
    graceStartedAt: null as Date | null,
    graceEndsAt: null as Date | null,
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
          graceStartedAt: snapshot.graceStartedAt ? new Date(snapshot.graceStartedAt) : null,
          graceEndsAt: snapshot.graceEndsAt ? new Date(snapshot.graceEndsAt) : null,
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
        deletes.push(workspaceId);
        currentSubscription = null;
      }
    } as WorkspaceSubscriptionRepository,
    {
      async findByCode(code: string) {
        const row = planCatalogByCode[code];
        if (!row) return null;
        return {
          id: `plan-${code}`,
          code,
          displayName: code,
          description: null,
          status: "active",
          billingProviderHints: row.billingProviderHints,
          entitlementModel: null,
          toolActivations: [],
          isDefaultFirstRegistrationPlan: false,
          isTrialPlan: row.isTrialPlan,
          trialDurationDays: row.trialDurationDays,
          createdAt: new Date(),
          updatedAt: new Date()
        } as AssistantPlanCatalog;
      }
    } as Pick<AssistantPlanCatalogRepository, "findByCode"> as AssistantPlanCatalogRepository,
    {
      assistant: {
        async updateMany(args: { where: { workspaceId: string }; data: { configDirtyAt: Date } }) {
          assert.equal(args.where.workspaceId, "ws-1");
          assert.ok(args.data.configDirtyAt instanceof Date);
          dirtyWrites.push(args.where.workspaceId);
          return { count: 1 };
        }
      }
    } as Pick<WorkspaceManagementPrismaService, "assistant"> as WorkspaceManagementPrismaService,
    {
      async apply(input) {
        appliedBillingEvents.push({
          eventCode: input.eventCode,
          source: input.source,
          planCode: input.paidPlanCode ?? null
        });
        currentSubscription = {
          ...(currentSubscription ?? {
            id: "sub-1",
            workspaceId: input.workspaceId,
            createdAt: new Date("2026-04-06T00:00:00.000Z"),
            updatedAt: new Date("2026-04-06T00:00:00.000Z"),
            trialStartedAt: null,
            trialEndsAt: null,
            graceStartedAt: null,
            graceEndsAt: null,
            cancelAtPeriodEnd: false,
            metadata: null,
            billingProvider: null,
            providerCustomerRef: null,
            providerSubscriptionRef: null
          }),
          workspaceId: input.workspaceId,
          planCode: input.paidPlanCode ?? currentSubscription?.planCode ?? "pro",
          status:
            input.eventCode === "payment_recovered" || input.eventCode === "renewal_succeeded"
              ? "active"
              : "active",
          billingProvider: input.billingProvider ?? null,
          providerCustomerRef: input.providerCustomerRef ?? null,
          providerSubscriptionRef: input.providerSubscriptionRef ?? null,
          currentPeriodStartedAt: input.currentPeriodStartedAt
            ? new Date(input.currentPeriodStartedAt)
            : null,
          currentPeriodEndsAt: input.currentPeriodEndsAt
            ? new Date(input.currentPeriodEndsAt)
            : null,
          graceStartedAt: null,
          graceEndsAt: null,
          updatedAt: new Date()
        };
        return {
          status: "applied",
          billingEventId: `billing-event-${appliedBillingEvents.length}`
        };
      }
    } as Pick<
      ApplyWorkspaceSubscriptionBillingEventService,
      "apply"
    > as ApplyWorkspaceSubscriptionBillingEventService,
    {
      async execute() {
        generation += 1;
        return generation;
      }
    } as never,
    {
      async createAutomaticGlobalRollout(input: {
        targetGeneration: number;
        scopeMetadata?: { reason?: string | null };
      }) {
        rolloutRequests.push({
          reason: input.scopeMetadata?.reason ?? null,
          targetGeneration: input.targetGeneration
        });
        return { id: `rollout-${rolloutRequests.length}` };
      }
    } as never
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
  assert.deepEqual(upserts, []);
  assert.deepEqual(appliedBillingEvents, [
    { eventCode: "payment_activated", source: "manual", planCode: "pro" }
  ]);
  assert.deepEqual(dirtyWrites, []);
  assert.equal(currentSubscription?.status, "active");
  assert.equal(currentSubscription?.planCode, "pro");

  const deleted = await service.resetWorkspaceSubscription("admin-1", "user-1", "step-up-3");
  assert.deepEqual(deleted, { ok: true, changed: true, workspaceId: "ws-1" });
  assert.deepEqual(deletes, ["ws-1"]);
  assert.deepEqual(dirtyWrites, ["ws-1"]);
  assert.deepEqual(rolloutRequests, [
    { reason: "admin.workspace_subscription.reset", targetGeneration: 401 }
  ]);
  assert.deepEqual(authCalls, [
    { userId: "admin-1", action: "admin.plan.update", stepUpToken: "step-up-1" },
    { userId: "admin-1", action: "admin.plan.update", stepUpToken: "step-up-2" },
    { userId: "admin-1", action: "admin.plan.update", stepUpToken: "step-up-3" }
  ]);

  // Trial auto-default: when the admin passes only { planCode } and the plan is marked
  // isTrialPlan=true with trialDurationDays > 0, the service must auto-fill
  // status="trialing" and trialEndsAt = now + trialDurationDays instead of defaulting
  // to status="active" with null trial windows.
  const beforeTrial = Date.now();
  const trialResult = await service.setWorkspaceSubscription(
    "admin-1",
    "user-1",
    { planCode: "fresh_trial" },
    "step-up-4"
  );
  const afterTrial = Date.now();
  assert.equal(trialResult.changed, true);
  assert.equal(currentSubscription?.planCode, "fresh_trial");
  assert.equal(currentSubscription?.status, "trialing");
  assert.ok(currentSubscription?.trialStartedAt instanceof Date);
  assert.ok(currentSubscription?.trialEndsAt instanceof Date);
  assert.ok(currentSubscription?.currentPeriodStartedAt instanceof Date);
  assert.ok(currentSubscription?.currentPeriodEndsAt instanceof Date);
  assert.deepEqual(currentSubscription?.metadata, {
    schema: "persai.subscriptionLifecycle.v1",
    lifecycleState: "trialing",
    lifecycleReason: "admin_trial_assignment",
    trialFallbackPlanCode: "pro"
  });
  const startedAtMs = currentSubscription?.trialStartedAt?.getTime() ?? 0;
  const endsAtMs = currentSubscription?.trialEndsAt?.getTime() ?? 0;
  assert.ok(startedAtMs >= beforeTrial && startedAtMs <= afterTrial);
  const sevenDaysMs = 7 * 86400_000;
  assert.ok(Math.abs(endsAtMs - startedAtMs - sevenDaysMs) < 1000);

  // Explicit admin override must still win over the auto-default: when the admin passes
  // status/trial dates explicitly, the service must not silently overwrite them.
  await service.resetWorkspaceSubscription("admin-1", "user-1", "step-up-5");
  const explicit = await service.setWorkspaceSubscription(
    "admin-1",
    "user-1",
    {
      planCode: "fresh_trial",
      status: "active",
      trialStartedAt: null,
      trialEndsAt: null
    },
    "step-up-6"
  );
  assert.equal(explicit.changed, true);
  assert.equal(currentSubscription?.status, "active");
  assert.equal(currentSubscription?.trialStartedAt, null);
  assert.equal(currentSubscription?.trialEndsAt, null);

  // Non-trial plan: one-click apply must still land status="active" with null trial dates.
  await service.resetWorkspaceSubscription("admin-1", "user-1", "step-up-7");
  await service.setWorkspaceSubscription("admin-1", "user-1", { planCode: "pro" }, "step-up-8");
  assert.equal(currentSubscription?.status, "active");
  assert.equal(currentSubscription?.trialStartedAt, null);
  assert.equal(currentSubscription?.trialEndsAt, null);

  await assert.rejects(
    () => service.setWorkspaceSubscription("admin-1", "user-1", { planCode: "free" }, "step-up-9"),
    /Use Apply fallback now for FREE access instead of Apply workspace subscription/
  );
  assert.deepEqual(rolloutRequests, [
    { reason: "admin.workspace_subscription.reset", targetGeneration: 401 },
    { reason: "admin.workspace_subscription.set", targetGeneration: 402 },
    { reason: "admin.workspace_subscription.reset", targetGeneration: 403 },
    { reason: "admin.workspace_subscription.set", targetGeneration: 404 },
    { reason: "admin.workspace_subscription.reset", targetGeneration: 405 },
    { reason: "admin.workspace_subscription.set", targetGeneration: 406 }
  ]);
}

void run();
