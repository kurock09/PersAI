import assert from "node:assert/strict";
import { ManageAdminOpsBillingSupportService } from "../src/modules/workspace-management/application/manage-admin-ops-billing-support.service";
import type { AdminAuthorizationService } from "../src/modules/workspace-management/application/admin-authorization.service";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";
import type { ManageWorkspaceSubscriptionLifecycleService } from "../src/modules/workspace-management/application/manage-workspace-subscription-lifecycle.service";
import type { ResolveEffectiveSubscriptionStateService } from "../src/modules/workspace-management/application/resolve-effective-subscription-state.service";

async function run(): Promise<void> {
  const authCalls: Array<{ userId: string; action: string; stepUpToken: string | null }> = [];
  const lifecycleCalls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const initializationCalls: Array<Record<string, unknown>> = [];
  const governanceUpdates: Array<{
    where: { assistantId: string };
    data: { quotaPlanCode: null };
  }> = [];

  let currentSubscription: {
    id: string;
    workspaceId: string;
    planCode: string;
    status: string;
    trialStartedAt: Date | null;
    trialEndsAt: Date | null;
    graceStartedAt: Date | null;
    graceEndsAt: Date | null;
    currentPeriodStartedAt: Date | null;
    currentPeriodEndsAt: Date | null;
    billingProvider: string | null;
    providerCustomerRef: string | null;
    providerSubscriptionRef: string | null;
    metadata: unknown;
  } | null = {
    id: "sub-1",
    workspaceId: "ws-1",
    planCode: "starter_trial",
    status: "trialing",
    trialStartedAt: new Date("2026-05-01T00:00:00.000Z"),
    trialEndsAt: new Date("2026-05-08T00:00:00.000Z"),
    graceStartedAt: null,
    graceEndsAt: null,
    currentPeriodStartedAt: new Date("2026-05-01T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-05-08T00:00:00.000Z"),
    billingProvider: "manual",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-provider-1",
    metadata: null
  };

  const service = new ManageAdminOpsBillingSupportService(
    {
      async assertCanPerformDangerousAdminAction(
        userId: string,
        action: string,
        stepUpToken: string | null
      ) {
        authCalls.push({ userId, action, stepUpToken });
      }
    } as Pick<
      AdminAuthorizationService,
      "assertCanPerformDangerousAdminAction"
    > as AdminAuthorizationService,
    {
      async findByUserId(userId: string) {
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
      workspaceSubscription: {
        async findUnique() {
          return currentSubscription;
        }
      },
      assistantGovernance: {
        async findUnique() {
          return {
            assistantPlanOverrideCode: null,
            quotaPlanCode: "starter_trial"
          };
        },
        async updateMany(args: { where: { assistantId: string }; data: { quotaPlanCode: null } }) {
          governanceUpdates.push(args);
          return { count: 1 };
        }
      },
      planCatalogPlan: {
        async findUnique(args: { where: { code: string } }) {
          if (args.where.code === "starter_trial") {
            return { trialDurationDays: 7, isTrialPlan: true, status: "active" };
          }
          if (args.where.code === "pro") {
            return { trialDurationDays: null, isTrialPlan: false, status: "active" };
          }
          return null;
        }
      },
      workspaceSubscriptionLifecycleEvent: {}
    } as Pick<
      WorkspaceManagementPrismaService,
      | "workspaceSubscription"
      | "assistantGovernance"
      | "planCatalogPlan"
      | "workspaceSubscriptionLifecycleEvent"
    > as WorkspaceManagementPrismaService,
    {
      async extendTrial(input) {
        lifecycleCalls.push({ method: "extendTrial", payload: input as Record<string, unknown> });
      },
      async grantGrace(input) {
        lifecycleCalls.push({ method: "grantGrace", payload: input as Record<string, unknown> });
      },
      async extendGrace(input) {
        lifecycleCalls.push({ method: "extendGrace", payload: input as Record<string, unknown> });
      },
      async recordBillingReminder(input) {
        lifecycleCalls.push({
          method: "recordBillingReminder",
          payload: input as Record<string, unknown>
        });
      },
      async applyFallbackNow(input) {
        lifecycleCalls.push({
          method: "applyFallbackNow",
          payload: input as Record<string, unknown>
        });
      },
      async activatePaidSubscription(input) {
        lifecycleCalls.push({
          method: "activatePaidSubscription",
          payload: input as Record<string, unknown>
        });
      }
    } as Pick<
      ManageWorkspaceSubscriptionLifecycleService,
      | "extendTrial"
      | "grantGrace"
      | "extendGrace"
      | "recordBillingReminder"
      | "applyFallbackNow"
      | "activatePaidSubscription"
    > as ManageWorkspaceSubscriptionLifecycleService,
    {
      async initializeLifecycleNow(input) {
        initializationCalls.push(input as Record<string, unknown>);
        return {
          source: "workspace_subscription",
          status: "trialing",
          planCode: "starter_trial",
          trialEndsAt: "2026-05-10T00:00:00.000Z",
          currentPeriodEndsAt: "2026-05-10T00:00:00.000Z",
          cancelAtPeriodEnd: false
        };
      }
    } as Pick<
      ResolveEffectiveSubscriptionStateService,
      "initializeLifecycleNow"
    > as ResolveEffectiveSubscriptionStateService
  );

  const parsed = service.parseActionInput({ action: "extend_trial" });
  assert.equal(parsed.action, "extend_trial");
  const parsedManual = service.parseActionInput({
    action: "activate_paid_manually",
    manualPayment: {
      planCode: "pro",
      billingPeriod: "month"
    }
  });
  assert.deepEqual(parsedManual, {
    action: "activate_paid_manually",
    manualPayment: {
      planCode: "pro",
      billingPeriod: "month"
    }
  });

  currentSubscription = null;
  const initialized = await service.execute(
    "admin-1",
    "user-1",
    { action: "initialize_lifecycle_now" },
    "step-up-0"
  );
  assert.equal(initialized.action, "initialize_lifecycle_now");
  assert.match(initialized.summary, /Lifecycle initialized from current registration policy/);
  assert.deepEqual(initializationCalls, [
    {
      workspaceId: "ws-1",
      userId: "user-1",
      source: "admin"
    }
  ]);
  assert.deepEqual(governanceUpdates, [
    {
      where: { assistantId: "assistant-1" },
      data: { quotaPlanCode: null }
    }
  ]);

  currentSubscription = {
    id: "sub-1",
    workspaceId: "ws-1",
    planCode: "starter_trial",
    status: "trialing",
    trialStartedAt: new Date("2026-05-01T00:00:00.000Z"),
    trialEndsAt: new Date("2026-05-08T00:00:00.000Z"),
    graceStartedAt: null,
    graceEndsAt: null,
    currentPeriodStartedAt: new Date("2026-05-01T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-05-08T00:00:00.000Z"),
    billingProvider: "manual",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-provider-1",
    metadata: null
  };

  const extendedTrial = await service.execute(
    "admin-1",
    "user-1",
    { action: "extend_trial" },
    "step-up-1"
  );
  assert.equal(extendedTrial.action, "extend_trial");
  assert.match(extendedTrial.summary, /Trial extended until/);
  assert.equal(lifecycleCalls[0]?.method, "extendTrial");

  currentSubscription = {
    ...currentSubscription,
    planCode: "pro",
    status: "active",
    trialStartedAt: null,
    trialEndsAt: null,
    graceStartedAt: null,
    graceEndsAt: null,
    currentPeriodStartedAt: new Date("2026-05-01T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-06-01T00:00:00.000Z")
  };
  await service.execute("admin-1", "user-1", { action: "grant_grace" }, "step-up-2");
  assert.equal(lifecycleCalls[1]?.method, "grantGrace");

  currentSubscription = {
    ...currentSubscription,
    status: "grace_period",
    graceStartedAt: new Date("2026-05-01T00:00:00.000Z"),
    graceEndsAt: new Date("2026-05-06T00:00:00.000Z")
  };
  await service.execute("admin-1", "user-1", { action: "extend_grace" }, "step-up-3");
  await service.execute("admin-1", "user-1", { action: "send_billing_reminder" }, "step-up-4");
  await service.execute("admin-1", "user-1", { action: "apply_fallback_now" }, "step-up-5");
  assert.equal(lifecycleCalls[2]?.method, "extendGrace");
  assert.equal(lifecycleCalls[3]?.method, "recordBillingReminder");
  assert.equal(lifecycleCalls[4]?.method, "applyFallbackNow");

  currentSubscription = {
    ...currentSubscription,
    planCode: "starter",
    status: "expired_fallback",
    graceStartedAt: new Date("2026-05-01T00:00:00.000Z"),
    graceEndsAt: new Date("2026-05-06T00:00:00.000Z"),
    currentPeriodStartedAt: new Date("2026-05-06T00:00:00.000Z"),
    currentPeriodEndsAt: null
  };
  const restored = await service.execute(
    "admin-1",
    "user-1",
    {
      action: "activate_paid_manually",
      manualPayment: {
        planCode: "pro",
        billingPeriod: "month"
      }
    },
    "step-up-6"
  );
  assert.match(restored.summary, /Manual\/admin paid activation applied on pro until/);
  assert.equal(lifecycleCalls[5]?.method, "activatePaidSubscription");
  assert.equal(lifecycleCalls[5]?.payload.paidPlanCode, "pro");
  assert.equal(lifecycleCalls[5]?.payload.eventCode, "payment_activated");
  assert.equal(lifecycleCalls[5]?.payload.refs?.metadata?.manualPayment?.billingPeriod, "month");

  assert.deepEqual(authCalls, [
    { userId: "admin-1", action: "admin.plan.update", stepUpToken: "step-up-0" },
    { userId: "admin-1", action: "admin.plan.update", stepUpToken: "step-up-1" },
    { userId: "admin-1", action: "admin.plan.update", stepUpToken: "step-up-2" },
    { userId: "admin-1", action: "admin.plan.update", stepUpToken: "step-up-3" },
    { userId: "admin-1", action: "admin.plan.update", stepUpToken: "step-up-4" },
    { userId: "admin-1", action: "admin.plan.update", stepUpToken: "step-up-5" },
    { userId: "admin-1", action: "admin.plan.update", stepUpToken: "step-up-6" }
  ]);
}

void run();
