import {
  PlanCatalogStatus,
  PlanToolActivationStatus,
  PrismaClient,
  ToolCatalogCapabilityGroup,
  ToolCatalogStatus,
  ToolCatalogToolClass,
  WorkspaceRole,
  WorkspaceStatus,
  WorkspaceSubscriptionStatus
} from "@prisma/client";

const prisma = new PrismaClient();

const SEED_USER_ID = "11111111-1111-1111-1111-111111111111";
const SEED_WORKSPACE_ID = "22222222-2222-2222-2222-222222222222";
const SEED_WORKSPACE_MEMBER_ID = "33333333-3333-3333-3333-333333333333";
const SEED_DEFAULT_PLAN_ID = "44444444-4444-4444-4444-444444444444";
const SEED_DEFAULT_PLAN_ENTITLEMENT_ID = "55555555-5555-5555-5555-555555555555";
const SEED_DEFAULT_PLAN_CODE = "starter_trial";
const SEED_WORKSPACE_SUBSCRIPTION_ID = "66666666-6666-6666-6666-666666666666";
const SEED_TOOL_COST_DRIVING_WEB_SEARCH_ID = "77777777-7777-7777-7777-777777777777";
const SEED_TOOL_UTILITY_MEMORY_CENTER_ID = "88888888-8888-8888-8888-888888888888";
const SEED_TOOL_UTILITY_TASKS_CENTER_ID = "99999999-9999-9999-9999-999999999999";

async function upsertToolCatalogTool(params: {
  id: string;
  code: string;
  displayName: string;
  description: string;
  capabilityGroup: ToolCatalogCapabilityGroup;
  toolClass: ToolCatalogToolClass;
}): Promise<void> {
  await prisma.toolCatalogTool.upsert({
    where: { code: params.code },
    update: {
      displayName: params.displayName,
      description: params.description,
      capabilityGroup: params.capabilityGroup,
      toolClass: params.toolClass,
      status: ToolCatalogStatus.active,
      providerHints: {
        schema: "persai.toolCatalogProviderHints.v1",
        providerAgnostic: true
      }
    },
    create: {
      id: params.id,
      code: params.code,
      displayName: params.displayName,
      description: params.description,
      capabilityGroup: params.capabilityGroup,
      toolClass: params.toolClass,
      status: ToolCatalogStatus.active,
      providerHints: {
        schema: "persai.toolCatalogProviderHints.v1",
        providerAgnostic: true
      }
    }
  });
}

async function main(): Promise<void> {
  await upsertToolCatalogTool({
    id: SEED_TOOL_COST_DRIVING_WEB_SEARCH_ID,
    code: "web_search",
    displayName: "Web Search",
    description: "Provider-backed external web lookup tool.",
    capabilityGroup: ToolCatalogCapabilityGroup.knowledge,
    toolClass: ToolCatalogToolClass.cost_driving
  });
  await upsertToolCatalogTool({
    id: SEED_TOOL_UTILITY_MEMORY_CENTER_ID,
    code: "memory_center_read",
    displayName: "Memory Center Read",
    description: "Utility read access for Memory Center summaries.",
    capabilityGroup: ToolCatalogCapabilityGroup.workspace_ops,
    toolClass: ToolCatalogToolClass.utility
  });
  await upsertToolCatalogTool({
    id: SEED_TOOL_UTILITY_TASKS_CENTER_ID,
    code: "tasks_center_control",
    displayName: "Tasks Center Control",
    description: "Utility control actions for task registry items.",
    capabilityGroup: ToolCatalogCapabilityGroup.workspace_ops,
    toolClass: ToolCatalogToolClass.utility
  });

  await prisma.appUser.upsert({
    where: { id: SEED_USER_ID },
    update: {
      email: "seed-owner@example.com",
      displayName: "Seed Owner",
      clerkUserId: "seed-clerk-owner"
    },
    create: {
      id: SEED_USER_ID,
      email: "seed-owner@example.com",
      displayName: "Seed Owner",
      clerkUserId: "seed-clerk-owner"
    }
  });

  await prisma.workspace.upsert({
    where: { id: SEED_WORKSPACE_ID },
    update: {
      name: "Seed Workspace",
      locale: "en-US",
      timezone: "UTC",
      status: WorkspaceStatus.active
    },
    create: {
      id: SEED_WORKSPACE_ID,
      name: "Seed Workspace",
      locale: "en-US",
      timezone: "UTC",
      status: WorkspaceStatus.active
    }
  });

  await prisma.workspaceMember.upsert({
    where: { id: SEED_WORKSPACE_MEMBER_ID },
    update: {
      workspaceId: SEED_WORKSPACE_ID,
      userId: SEED_USER_ID,
      role: WorkspaceRole.owner
    },
    create: {
      id: SEED_WORKSPACE_MEMBER_ID,
      workspaceId: SEED_WORKSPACE_ID,
      userId: SEED_USER_ID,
      role: WorkspaceRole.owner
    }
  });

  await prisma.planCatalogPlan.updateMany({
    where: { isDefaultFirstRegistrationPlan: true, code: { not: SEED_DEFAULT_PLAN_CODE } },
    data: { isDefaultFirstRegistrationPlan: false }
  });

  await prisma.planCatalogPlan.upsert({
    where: { code: SEED_DEFAULT_PLAN_CODE },
    update: {
      displayName: "Starter Trial",
      description: "Default first-registration trial plan (provider-agnostic control-plane baseline).",
      status: PlanCatalogStatus.active,
      isDefaultFirstRegistrationPlan: true,
      isTrialPlan: true,
      trialDurationDays: 14,
      billingProviderHints: {
        schema: "persai.billingHints.v1",
        providerAgnostic: true
      }
    },
    create: {
      id: SEED_DEFAULT_PLAN_ID,
      code: SEED_DEFAULT_PLAN_CODE,
      displayName: "Starter Trial",
      description: "Default first-registration trial plan (provider-agnostic control-plane baseline).",
      status: PlanCatalogStatus.active,
      isDefaultFirstRegistrationPlan: true,
      isTrialPlan: true,
      trialDurationDays: 14,
      billingProviderHints: {
        schema: "persai.billingHints.v1",
        providerAgnostic: true
      }
    }
  });

  const seedPlan = await prisma.planCatalogPlan.findUnique({
    where: { code: SEED_DEFAULT_PLAN_CODE },
    select: { id: true }
  });
  if (seedPlan !== null) {
    await prisma.planCatalogEntitlement.upsert({
      where: { planId: seedPlan.id },
      update: {
        schemaVersion: 1,
        capabilities: [
          { key: "assistant.lifecycle.publish_apply_rollback_reset", allowed: true },
          { key: "assistant.memory.center", allowed: true },
          { key: "assistant.tasks.center", allowed: true }
        ],
        toolClasses: [
          { key: "cost_driving", allowed: false, quotaGoverned: true },
          { key: "utility", allowed: true, quotaGoverned: true }
        ],
        channelsAndSurfaces: [
          { key: "web_chat", allowed: true },
          { key: "telegram", allowed: true },
          { key: "whatsapp", allowed: false },
          { key: "max", allowed: false }
        ],
        limitsPermissions: [
          { key: "view_limit_percentages", allowed: true },
          { key: "tasks_excluded_from_commercial_quotas", value: true }
        ]
      },
      create: {
        id: SEED_DEFAULT_PLAN_ENTITLEMENT_ID,
        planId: seedPlan.id,
        schemaVersion: 1,
        capabilities: [
          { key: "assistant.lifecycle.publish_apply_rollback_reset", allowed: true },
          { key: "assistant.memory.center", allowed: true },
          { key: "assistant.tasks.center", allowed: true }
        ],
        toolClasses: [
          { key: "cost_driving", allowed: false, quotaGoverned: true },
          { key: "utility", allowed: true, quotaGoverned: true }
        ],
        channelsAndSurfaces: [
          { key: "web_chat", allowed: true },
          { key: "telegram", allowed: true },
          { key: "whatsapp", allowed: false },
          { key: "max", allowed: false }
        ],
        limitsPermissions: [
          { key: "view_limit_percentages", allowed: true },
          { key: "tasks_excluded_from_commercial_quotas", value: true }
        ]
      }
    });

    await prisma.workspaceSubscription.upsert({
      where: { workspaceId: SEED_WORKSPACE_ID },
      update: {
        planCode: SEED_DEFAULT_PLAN_CODE,
        status: WorkspaceSubscriptionStatus.trialing,
        trialStartedAt: new Date("2026-03-26T00:00:00.000Z"),
        trialEndsAt: new Date("2026-04-09T00:00:00.000Z"),
        currentPeriodStartedAt: new Date("2026-03-26T00:00:00.000Z"),
        currentPeriodEndsAt: new Date("2026-04-09T00:00:00.000Z"),
        cancelAtPeriodEnd: false,
        billingProvider: null,
        providerCustomerRef: null,
        providerSubscriptionRef: null,
        metadata: {
          schema: "persai.subscriptionState.v1",
          source: "seed_baseline"
        }
      },
      create: {
        id: SEED_WORKSPACE_SUBSCRIPTION_ID,
        workspaceId: SEED_WORKSPACE_ID,
        planCode: SEED_DEFAULT_PLAN_CODE,
        status: WorkspaceSubscriptionStatus.trialing,
        trialStartedAt: new Date("2026-03-26T00:00:00.000Z"),
        trialEndsAt: new Date("2026-04-09T00:00:00.000Z"),
        currentPeriodStartedAt: new Date("2026-03-26T00:00:00.000Z"),
        currentPeriodEndsAt: new Date("2026-04-09T00:00:00.000Z"),
        cancelAtPeriodEnd: false,
        billingProvider: null,
        providerCustomerRef: null,
        providerSubscriptionRef: null,
        metadata: {
          schema: "persai.subscriptionState.v1",
          source: "seed_baseline"
        }
      }
    });

    const activeTools = await prisma.toolCatalogTool.findMany({
      where: { status: ToolCatalogStatus.active },
      select: { id: true, toolClass: true }
    });

    for (const tool of activeTools) {
      const activationStatus =
        tool.toolClass === ToolCatalogToolClass.utility
          ? PlanToolActivationStatus.active
          : PlanToolActivationStatus.inactive;
      await prisma.planCatalogToolActivation.upsert({
        where: {
          planId_toolId: {
            planId: seedPlan.id,
            toolId: tool.id
          }
        },
        update: {
          activationStatus
        },
        create: {
          planId: seedPlan.id,
          toolId: tool.id,
          activationStatus
        }
      });
    }
  }
}

main()
  .catch(async (error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
