import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  isPlatformManagedTool,
  isPlanManagedTool,
  TOOL_CATALOG,
  STARTER_TRIAL_TOOL_POLICY
} from "../../../../prisma/tool-catalog-data";
import { upsertToolCatalogEntry } from "../../../../prisma/tool-catalog-sync";
import { PROMPT_TEMPLATE_DEFAULTS } from "../../../../prisma/bootstrap-preset-data";
import { SITE_PAGE_SEEDS } from "../../../../prisma/site-page-seed-data";

const DEFAULT_PLAN_CODE = "starter_trial";

@Injectable()
export class SeedToolCatalogService implements OnModuleInit {
  private readonly logger = new Logger(SeedToolCatalogService.name);

  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.syncToolCatalog();
      await this.ensureDefaultPlan();
      await this.syncNonPlanManagedToolPolicyAcrossPlans();
      await this.backfillNullPlanGovernances();
      await this.syncPromptTemplates();
      await this.syncPlatformSitePages();
    } catch (err) {
      this.logger.warn(
        `Platform data auto-seed failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async syncToolCatalog(): Promise<void> {
    const existingRows = await this.prisma.toolCatalogTool.findMany({
      select: { id: true, providerHints: true }
    });
    const providerHintsById = new Map(
      existingRows.map((row) => [row.id, row.providerHints] as const)
    );
    let upserted = 0;
    for (const t of TOOL_CATALOG) {
      await upsertToolCatalogEntry(this.prisma, t, providerHintsById.get(t.id) ?? null);
      upserted++;
    }
    this.logger.log(`Tool catalog synced: ${upserted} entries`);
  }

  private async syncPlatformSitePages(): Promise<void> {
    let inserted = 0;
    for (const page of SITE_PAGE_SEEDS) {
      await this.prisma.platformSitePage.upsert({
        where: {
          slug_market_locale_status: {
            slug: page.slug,
            market: page.market,
            locale: page.locale,
            status: page.status
          }
        },
        update: {},
        create: {
          slug: page.slug,
          market: page.market,
          locale: page.locale,
          status: page.status,
          title: page.title,
          bodyMarkdown: page.bodyMarkdown,
          version: page.version,
          publishedAt: page.status === "published" ? new Date() : null
        }
      });
      inserted++;
    }
    this.logger.log(`Platform site pages synced: ${inserted} seeded variants`);
  }

  private async ensureDefaultPlan(): Promise<void> {
    const existingDefaultPlan = await this.prisma.planCatalogPlan.findFirst({
      where: { isDefaultFirstRegistrationPlan: true },
      select: {
        id: true,
        code: true,
        billingProviderHints: true
      }
    });
    if (existingDefaultPlan) {
      if (existingDefaultPlan.code !== DEFAULT_PLAN_CODE) {
        return;
      }
      const billingHints =
        existingDefaultPlan.billingProviderHints &&
        typeof existingDefaultPlan.billingProviderHints === "object" &&
        !Array.isArray(existingDefaultPlan.billingProviderHints)
          ? (existingDefaultPlan.billingProviderHints as Record<string, unknown>)
          : {};
      const needsRuntimeTierBackfill = !Object.prototype.hasOwnProperty.call(
        billingHints,
        "runtimeTierDefault"
      );
      const needsAssistantPolicyBackfill = !Object.prototype.hasOwnProperty.call(
        billingHints,
        "assistantPolicy"
      );
      if (needsRuntimeTierBackfill || needsAssistantPolicyBackfill) {
        const nextBillingHints: Record<string, unknown> = {
          ...billingHints,
          schema:
            typeof billingHints.schema === "string"
              ? billingHints.schema
              : "persai.billingHints.v1",
          providerAgnostic: billingHints.providerAgnostic === true,
          runtimeTierDefault:
            typeof billingHints.runtimeTierDefault === "string"
              ? billingHints.runtimeTierDefault
              : "free_shared_restricted",
          assistantPolicy:
            billingHints.assistantPolicy &&
            typeof billingHints.assistantPolicy === "object" &&
            !Array.isArray(billingHints.assistantPolicy)
              ? billingHints.assistantPolicy
              : { schema: "persai.assistantPolicy.v1", maxAssistants: 1 }
        };
        await this.prisma.planCatalogPlan.update({
          where: { id: existingDefaultPlan.id },
          data: {
            billingProviderHints: nextBillingHints as Prisma.InputJsonValue
          }
        });
      }
      // Idempotent backfill only: if the admin already edited tool activations for this plan
      // through /admin/plans, we MUST NOT rewrite them from the hardcoded STARTER_TRIAL_TOOL_POLICY
      // on every API pod rollout. Historically this ran unconditionally and silently reverted
      // every operator edit (e.g. enabling image_generate for trial) on the next deploy.
      const existingActivationCount = await this.prisma.planCatalogToolActivation.count({
        where: { planId: existingDefaultPlan.id }
      });
      if (existingActivationCount === 0) {
        await this.syncToolActivations(existingDefaultPlan.id);
      }
      return;
    }

    const existingPlanCount = await this.prisma.planCatalogPlan.count();
    if (existingPlanCount > 0) {
      this.logger.warn(
        `No default registration plan found; leaving existing plan catalog unchanged instead of recreating "${DEFAULT_PLAN_CODE}".`
      );
      return;
    }

    const plan = await this.prisma.planCatalogPlan.create({
      data: {
        code: DEFAULT_PLAN_CODE,
        displayName: "Starter Trial",
        description:
          "Default first-registration trial plan (provider-agnostic control-plane baseline).",
        status: "active",
        isDefaultFirstRegistrationPlan: true,
        isTrialPlan: true,
        trialDurationDays: 14,
        billingProviderHints: {
          schema: "persai.billingHints.v1",
          providerAgnostic: true,
          runtimeTierDefault: "free_shared_restricted",
          assistantPolicy: { schema: "persai.assistantPolicy.v1", maxAssistants: 1 }
        }
      }
    });

    await this.prisma.planCatalogEntitlement.upsert({
      where: { planId: plan.id },
      update: {},
      create: {
        planId: plan.id,
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

    await this.syncToolActivations(plan.id);
    this.logger.log(
      `Default plan "${DEFAULT_PLAN_CODE}" created with entitlement and tool activations`
    );
  }

  private async syncToolActivations(planId: string): Promise<void> {
    const activeTools = await this.prisma.toolCatalogTool.findMany({
      where: { status: "active" },
      select: { id: true, code: true, toolClass: true }
    });

    for (const tool of activeTools) {
      const policy = STARTER_TRIAL_TOOL_POLICY[tool.code];
      const activationStatus = isPlanManagedTool(tool.code)
        ? (policy?.active ?? tool.toolClass === "utility")
          ? "active"
          : "inactive"
        : isPlatformManagedTool(tool.code)
          ? "active"
          : "inactive";
      const dailyCallLimit = isPlanManagedTool(tool.code) ? (policy?.dailyCallLimit ?? null) : null;
      const perTurnCap = isPlanManagedTool(tool.code) ? (policy?.perTurnCap ?? null) : null;

      await this.prisma.planCatalogToolActivation.upsert({
        where: { planId_toolId: { planId, toolId: tool.id } },
        update: { activationStatus, dailyCallLimit, perTurnCap },
        create: { planId, toolId: tool.id, activationStatus, dailyCallLimit, perTurnCap }
      });
    }
  }

  private async syncNonPlanManagedToolPolicyAcrossPlans(): Promise<void> {
    const [plans, tools] = await Promise.all([
      this.prisma.planCatalogPlan.findMany({
        select: { id: true }
      }),
      this.prisma.toolCatalogTool.findMany({
        where: { status: "active" },
        select: { id: true, code: true }
      })
    ]);

    if (plans.length === 0 || tools.length === 0) {
      return;
    }

    for (const plan of plans) {
      for (const tool of tools) {
        if (isPlanManagedTool(tool.code)) {
          continue;
        }

        await this.prisma.planCatalogToolActivation.upsert({
          where: { planId_toolId: { planId: plan.id, toolId: tool.id } },
          update: {
            activationStatus: isPlatformManagedTool(tool.code) ? "active" : "inactive",
            dailyCallLimit: null
          },
          create: {
            planId: plan.id,
            toolId: tool.id,
            activationStatus: isPlatformManagedTool(tool.code) ? "active" : "inactive",
            dailyCallLimit: null
          }
        });
      }
    }
  }

  private async backfillNullPlanGovernances(): Promise<void> {
    const plan = await this.prisma.planCatalogPlan.findFirst({
      where: { isDefaultFirstRegistrationPlan: true, status: "active" },
      select: { code: true }
    });
    if (!plan) return;

    const result = await this.prisma.assistantGovernance.updateMany({
      where: { quotaPlanCode: null },
      data: { quotaPlanCode: plan.code }
    });
    if (result.count > 0) {
      this.logger.log(
        `Backfilled ${result.count} assistant governance(s) with default plan "${plan.code}"`
      );
    }
  }

  private async syncPromptTemplates(): Promise<void> {
    const rows = await this.prisma.promptTemplate.findMany({ select: { id: true } });
    const have = new Set(rows.map((r) => r.id));
    let created = 0;
    for (const [id, template] of Object.entries(PROMPT_TEMPLATE_DEFAULTS)) {
      if (have.has(id)) continue;
      await this.prisma.promptTemplate.create({ data: { id, template } });
      created++;
    }
    if (created > 0) {
      this.logger.log(`Prompt templates backfilled: ${String(created)} new row(s)`);
    }
  }
}
