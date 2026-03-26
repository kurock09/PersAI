import {
  PlanCatalogStatus,
  PlanToolActivationStatus,
  PrismaClient,
  ToolCatalogStatus,
  ToolCatalogToolClass,
  WorkspaceRole,
  WorkspaceStatus,
  WorkspaceSubscriptionStatus
} from "@prisma/client";
import { TOOL_CATALOG, STARTER_TRIAL_TOOL_POLICY } from "./tool-catalog-data.js";
import { BOOTSTRAP_PRESET_DEFAULTS } from "./bootstrap-preset-data.js";

const prisma = new PrismaClient();

const SEED_USER_ID = "11111111-1111-1111-1111-111111111111";
const SEED_WORKSPACE_ID = "22222222-2222-2222-2222-222222222222";
const SEED_WORKSPACE_MEMBER_ID = "33333333-3333-3333-3333-333333333333";
const SEED_DEFAULT_PLAN_ID = "44444444-4444-4444-4444-444444444444";
const SEED_DEFAULT_PLAN_ENTITLEMENT_ID = "55555555-5555-5555-5555-555555555555";
const SEED_DEFAULT_PLAN_CODE = "starter_trial";
const SEED_WORKSPACE_SUBSCRIPTION_ID = "66666666-6666-6666-6666-666666666666";

async function upsertToolCatalog(): Promise<void> {
  for (const t of TOOL_CATALOG) {
    const providerHints = t.requiredCredentialId
      ? {
          schema: "persai.toolCatalogProviderHints.v2",
          providerAgnostic: false,
          requiredCredentialId: t.requiredCredentialId
        }
      : { schema: "persai.toolCatalogProviderHints.v1", providerAgnostic: true };
    await prisma.toolCatalogTool.upsert({
      where: { code: t.code },
      update: {
        displayName: t.displayName,
        description: t.description,
        capabilityGroup: t.capabilityGroup,
        toolClass: t.toolClass,
        status: ToolCatalogStatus.active,
        providerHints
      },
      create: {
        id: t.id,
        code: t.code,
        displayName: t.displayName,
        description: t.description,
        capabilityGroup: t.capabilityGroup,
        toolClass: t.toolClass,
        status: ToolCatalogStatus.active,
        providerHints
      }
    });
  }
}

async function upsertBootstrapPresets(): Promise<void> {
  for (const [id, template] of Object.entries(BOOTSTRAP_PRESET_DEFAULTS)) {
    await prisma.bootstrapDocumentPreset.upsert({
      where: { id },
      update: { template },
      create: { id, template }
    });
  }
}

async function main(): Promise<void> {
  await upsertToolCatalog();
  await upsertBootstrapPresets();

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
      description:
        "Default first-registration trial plan (provider-agnostic control-plane baseline).",
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
      description:
        "Default first-registration trial plan (provider-agnostic control-plane baseline).",
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
        capabilities: [],
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
        limitsPermissions: []
      },
      create: {
        id: SEED_DEFAULT_PLAN_ENTITLEMENT_ID,
        planId: seedPlan.id,
        schemaVersion: 1,
        capabilities: [],
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
        limitsPermissions: []
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
      select: { id: true, code: true, toolClass: true }
    });

    for (const tool of activeTools) {
      const policy = STARTER_TRIAL_TOOL_POLICY[tool.code];
      const activationStatus =
        (policy?.active ?? tool.toolClass === ToolCatalogToolClass.utility)
          ? PlanToolActivationStatus.active
          : PlanToolActivationStatus.inactive;
      const dailyCallLimit = policy?.dailyCallLimit ?? null;
      await prisma.planCatalogToolActivation.upsert({
        where: {
          planId_toolId: {
            planId: seedPlan.id,
            toolId: tool.id
          }
        },
        update: {
          activationStatus,
          dailyCallLimit
        },
        create: {
          planId: seedPlan.id,
          toolId: tool.id,
          activationStatus,
          dailyCallLimit
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
