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
const SEED_TOOL_COST_DRIVING_WEB_FETCH_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SEED_TOOL_COST_DRIVING_IMAGE_GENERATE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SEED_TOOL_COST_DRIVING_TTS_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const SEED_TOOL_COST_DRIVING_BROWSER_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const SEED_TOOL_UTILITY_MEMORY_SEARCH_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

async function upsertToolCatalogTool(params: {
  id: string;
  code: string;
  displayName: string;
  description: string;
  capabilityGroup: ToolCatalogCapabilityGroup;
  toolClass: ToolCatalogToolClass;
  requiredCredentialId?: string;
}): Promise<void> {
  const providerHints = params.requiredCredentialId
    ? {
        schema: "persai.toolCatalogProviderHints.v2",
        providerAgnostic: false,
        requiredCredentialId: params.requiredCredentialId
      }
    : {
        schema: "persai.toolCatalogProviderHints.v1",
        providerAgnostic: true
      };
  await prisma.toolCatalogTool.upsert({
    where: { code: params.code },
    update: {
      displayName: params.displayName,
      description: params.description,
      capabilityGroup: params.capabilityGroup,
      toolClass: params.toolClass,
      status: ToolCatalogStatus.active,
      providerHints: providerHints
    },
    create: {
      id: params.id,
      code: params.code,
      displayName: params.displayName,
      description: params.description,
      capabilityGroup: params.capabilityGroup,
      toolClass: params.toolClass,
      status: ToolCatalogStatus.active,
      providerHints: providerHints
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
    toolClass: ToolCatalogToolClass.cost_driving,
    requiredCredentialId: "tool_web_search"
  });
  await upsertToolCatalogTool({
    id: SEED_TOOL_COST_DRIVING_WEB_FETCH_ID,
    code: "web_fetch",
    displayName: "Web Fetch",
    description: "Structured webpage content extraction via Firecrawl or fallback fetch.",
    capabilityGroup: ToolCatalogCapabilityGroup.knowledge,
    toolClass: ToolCatalogToolClass.cost_driving,
    requiredCredentialId: "tool_web_fetch"
  });
  await upsertToolCatalogTool({
    id: SEED_TOOL_COST_DRIVING_IMAGE_GENERATE_ID,
    code: "image_generate",
    displayName: "Image Generate",
    description: "AI image generation via DALL-E or other supported providers.",
    capabilityGroup: ToolCatalogCapabilityGroup.knowledge,
    toolClass: ToolCatalogToolClass.cost_driving,
    requiredCredentialId: "tool_image_generate"
  });
  await upsertToolCatalogTool({
    id: SEED_TOOL_COST_DRIVING_TTS_ID,
    code: "tts",
    displayName: "Text to Speech",
    description: "Text-to-speech synthesis via OpenAI TTS, ElevenLabs, or other providers.",
    capabilityGroup: ToolCatalogCapabilityGroup.communication,
    toolClass: ToolCatalogToolClass.cost_driving,
    requiredCredentialId: "tool_tts"
  });
  await upsertToolCatalogTool({
    id: SEED_TOOL_COST_DRIVING_BROWSER_ID,
    code: "browser",
    displayName: "Browser",
    description: "Automated web browser for interactive page navigation and content extraction.",
    capabilityGroup: ToolCatalogCapabilityGroup.knowledge,
    toolClass: ToolCatalogToolClass.cost_driving
  });
  await upsertToolCatalogTool({
    id: SEED_TOOL_UTILITY_MEMORY_SEARCH_ID,
    code: "memory_search",
    displayName: "Memory Search",
    description: "Semantic search across assistant memory using remote embeddings.",
    capabilityGroup: ToolCatalogCapabilityGroup.workspace_ops,
    toolClass: ToolCatalogToolClass.utility,
    requiredCredentialId: "tool_memory_search"
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
      select: { id: true, code: true, toolClass: true }
    });

    const STARTER_TRIAL_TOOL_POLICY: Record<
      string,
      { active: boolean; dailyCallLimit: number | null }
    > = {
      web_search: { active: true, dailyCallLimit: 30 },
      web_fetch: { active: true, dailyCallLimit: 20 },
      image_generate: { active: false, dailyCallLimit: null },
      tts: { active: false, dailyCallLimit: null },
      browser: { active: false, dailyCallLimit: null },
      memory_search: { active: true, dailyCallLimit: null },
      memory_center_read: { active: true, dailyCallLimit: null },
      tasks_center_control: { active: true, dailyCallLimit: null }
    };

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
