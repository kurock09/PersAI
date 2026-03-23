import { PlanCatalogStatus, PrismaClient, WorkspaceRole, WorkspaceStatus } from "@prisma/client";

const prisma = new PrismaClient();

const SEED_USER_ID = "11111111-1111-1111-1111-111111111111";
const SEED_WORKSPACE_ID = "22222222-2222-2222-2222-222222222222";
const SEED_WORKSPACE_MEMBER_ID = "33333333-3333-3333-3333-333333333333";
const SEED_DEFAULT_PLAN_ID = "44444444-4444-4444-4444-444444444444";
const SEED_DEFAULT_PLAN_ENTITLEMENT_ID = "55555555-5555-5555-5555-555555555555";
const SEED_DEFAULT_PLAN_CODE = "starter_trial";

async function main(): Promise<void> {
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
