import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { TOOL_CATALOG, STARTER_TRIAL_TOOL_POLICY } from "../../../../prisma/tool-catalog-data";
import { BOOTSTRAP_PRESET_DEFAULTS } from "../../../../prisma/bootstrap-preset-data";

const DEFAULT_PLAN_CODE = "starter_trial";

@Injectable()
export class SeedToolCatalogService implements OnModuleInit {
  private readonly logger = new Logger(SeedToolCatalogService.name);

  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.syncToolCatalog();
      await this.ensureDefaultPlan();
      await this.syncBootstrapPresets();
    } catch (err) {
      this.logger.warn(
        `Platform data auto-seed failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async syncToolCatalog(): Promise<void> {
    let upserted = 0;
    for (const t of TOOL_CATALOG) {
      const providerHints = t.requiredCredentialId
        ? {
            schema: "persai.toolCatalogProviderHints.v2",
            providerAgnostic: false,
            requiredCredentialId: t.requiredCredentialId
          }
        : { schema: "persai.toolCatalogProviderHints.v1", providerAgnostic: true };

      await this.prisma.toolCatalogTool.upsert({
        where: { code: t.code },
        update: {
          displayName: t.displayName,
          description: t.description,
          capabilityGroup: t.capabilityGroup,
          toolClass: t.toolClass,
          status: "active",
          providerHints
        },
        create: {
          id: t.id,
          code: t.code,
          displayName: t.displayName,
          description: t.description,
          capabilityGroup: t.capabilityGroup,
          toolClass: t.toolClass,
          status: "active",
          providerHints
        }
      });
      upserted++;
    }
    this.logger.log(`Tool catalog synced: ${upserted} entries`);
  }

  private async ensureDefaultPlan(): Promise<void> {
    const existing = await this.prisma.planCatalogPlan.findUnique({
      where: { code: DEFAULT_PLAN_CODE }
    });
    if (existing) {
      await this.syncToolActivations(existing.id);
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
          providerAgnostic: true
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
      const activationStatus =
        (policy?.active ?? tool.toolClass === "utility") ? "active" : "inactive";
      const dailyCallLimit = policy?.dailyCallLimit ?? null;

      await this.prisma.planCatalogToolActivation.upsert({
        where: { planId_toolId: { planId, toolId: tool.id } },
        update: { activationStatus, dailyCallLimit },
        create: { planId, toolId: tool.id, activationStatus, dailyCallLimit }
      });
    }
  }

  private async syncBootstrapPresets(): Promise<void> {
    const existing = await this.prisma.bootstrapDocumentPreset.count();
    if (existing > 0) return;

    for (const [id, template] of Object.entries(BOOTSTRAP_PRESET_DEFAULTS)) {
      await this.prisma.bootstrapDocumentPreset.upsert({
        where: { id },
        update: { template },
        create: { id, template }
      });
    }
    this.logger.log(
      `Bootstrap presets seeded: ${Object.keys(BOOTSTRAP_PRESET_DEFAULTS).length} entries`
    );
  }
}
