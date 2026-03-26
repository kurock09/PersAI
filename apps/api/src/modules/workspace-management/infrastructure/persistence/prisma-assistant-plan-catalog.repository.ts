import { Injectable } from "@nestjs/common";
import { Prisma, type PlanCatalogStatus, type ToolCatalogToolClass } from "@prisma/client";
import type {
  AssistantPlanCatalogRepository,
  AssistantPlanCatalogWriteInput
} from "../../domain/assistant-plan-catalog.repository";
import type { AssistantPlanCatalog } from "../../domain/assistant-plan-catalog.entity";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

const PLAN_INCLUDE = {
  entitlement: true,
  toolActivations: {
    include: { tool: true },
    orderBy: { tool: { code: "asc" as const } }
  }
} as const;

type PlanWithRelations = Prisma.PlanCatalogPlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

@Injectable()
export class PrismaAssistantPlanCatalogRepository implements AssistantPlanCatalogRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async listAll(): Promise<AssistantPlanCatalog[]> {
    const plans = await this.prisma.planCatalogPlan.findMany({
      include: PLAN_INCLUDE,
      orderBy: [{ updatedAt: "desc" }, { code: "asc" }]
    });
    return plans.map((plan) => this.mapToDomain(plan));
  }

  async findByCode(code: string): Promise<AssistantPlanCatalog | null> {
    const plan = await this.prisma.planCatalogPlan.findFirst({
      where: { code },
      include: PLAN_INCLUDE
    });
    return plan ? this.mapToDomain(plan) : null;
  }

  async findDefaultRegistrationPlan(): Promise<AssistantPlanCatalog | null> {
    const plan = await this.prisma.planCatalogPlan.findFirst({
      where: {
        isDefaultFirstRegistrationPlan: true,
        status: "active"
      },
      include: PLAN_INCLUDE,
      orderBy: { updatedAt: "desc" }
    });
    return plan ? this.mapToDomain(plan) : null;
  }

  async create(code: string, input: AssistantPlanCatalogWriteInput): Promise<AssistantPlanCatalog> {
    await this.prisma.$transaction(async (tx) => {
      if (input.isDefaultFirstRegistrationPlan) {
        await tx.planCatalogPlan.updateMany({
          where: { isDefaultFirstRegistrationPlan: true },
          data: { isDefaultFirstRegistrationPlan: false }
        });
      }

      const created = await tx.planCatalogPlan.create({
        data: {
          code,
          displayName: input.displayName,
          description: input.description,
          status: input.status,
          isDefaultFirstRegistrationPlan: input.isDefaultFirstRegistrationPlan,
          isTrialPlan: input.isTrialPlan,
          trialDurationDays: input.trialDurationDays,
          billingProviderHints:
            input.billingProviderHints === null
              ? Prisma.DbNull
              : (input.billingProviderHints as Prisma.InputJsonValue),
          entitlement: {
            create: {
              schemaVersion: input.entitlementModel.schemaVersion,
              capabilities: input.entitlementModel.capabilities as Prisma.InputJsonValue,
              toolClasses: input.entitlementModel.toolClasses as Prisma.InputJsonValue,
              channelsAndSurfaces: input.entitlementModel
                .channelsAndSurfaces as Prisma.InputJsonValue,
              limitsPermissions: input.entitlementModel.limitsPermissions as Prisma.InputJsonValue
            }
          }
        },
        include: { entitlement: true }
      });
      await this.syncToolActivationsForPlan(tx, created.id, input);
      return created;
    });

    const created = await this.prisma.planCatalogPlan.findUnique({
      where: { code },
      include: PLAN_INCLUDE
    });
    if (created === null) {
      throw new Error("Plan create verification failed.");
    }
    return this.mapToDomain(created);
  }

  async updateByCode(
    code: string,
    input: AssistantPlanCatalogWriteInput
  ): Promise<AssistantPlanCatalog | null> {
    const existing = await this.prisma.planCatalogPlan.findUnique({
      where: { code },
      select: { id: true }
    });
    if (existing === null) {
      return null;
    }

    await this.prisma.$transaction(async (tx) => {
      if (input.isDefaultFirstRegistrationPlan) {
        await tx.planCatalogPlan.updateMany({
          where: { isDefaultFirstRegistrationPlan: true, id: { not: existing.id } },
          data: { isDefaultFirstRegistrationPlan: false }
        });
      }

      const updated = await tx.planCatalogPlan.update({
        where: { code },
        data: {
          displayName: input.displayName,
          description: input.description,
          status: input.status,
          isDefaultFirstRegistrationPlan: input.isDefaultFirstRegistrationPlan,
          isTrialPlan: input.isTrialPlan,
          trialDurationDays: input.trialDurationDays,
          billingProviderHints:
            input.billingProviderHints === null
              ? Prisma.DbNull
              : (input.billingProviderHints as Prisma.InputJsonValue),
          entitlement: {
            upsert: {
              create: {
                schemaVersion: input.entitlementModel.schemaVersion,
                capabilities: input.entitlementModel.capabilities as Prisma.InputJsonValue,
                toolClasses: input.entitlementModel.toolClasses as Prisma.InputJsonValue,
                channelsAndSurfaces: input.entitlementModel
                  .channelsAndSurfaces as Prisma.InputJsonValue,
                limitsPermissions: input.entitlementModel.limitsPermissions as Prisma.InputJsonValue
              },
              update: {
                schemaVersion: input.entitlementModel.schemaVersion,
                capabilities: input.entitlementModel.capabilities as Prisma.InputJsonValue,
                toolClasses: input.entitlementModel.toolClasses as Prisma.InputJsonValue,
                channelsAndSurfaces: input.entitlementModel
                  .channelsAndSurfaces as Prisma.InputJsonValue,
                limitsPermissions: input.entitlementModel.limitsPermissions as Prisma.InputJsonValue
              }
            }
          }
        },
        include: { entitlement: true }
      });
      await this.syncToolActivationsForPlan(tx, updated.id, input);
      return updated;
    });

    const updated = await this.prisma.planCatalogPlan.findUnique({
      where: { code },
      include: PLAN_INCLUDE
    });
    if (updated === null) {
      return null;
    }
    return this.mapToDomain(updated);
  }

  private mapToDomain(plan: PlanWithRelations): AssistantPlanCatalog {
    return {
      id: plan.id,
      code: plan.code,
      displayName: plan.displayName,
      description: plan.description,
      status: this.mapStatus(plan.status),
      billingProviderHints: plan.billingProviderHints,
      entitlementModel:
        plan.entitlement === null
          ? null
          : {
              schemaVersion: plan.entitlement.schemaVersion,
              capabilities: this.toArray(plan.entitlement.capabilities),
              toolClasses: this.toArray(plan.entitlement.toolClasses),
              channelsAndSurfaces: this.toArray(plan.entitlement.channelsAndSurfaces),
              limitsPermissions: this.toArray(plan.entitlement.limitsPermissions)
            },
      toolActivations: plan.toolActivations.map((activation) => ({
        toolCode: activation.tool.code,
        displayName: activation.tool.displayName,
        toolClass: activation.tool.toolClass as "cost_driving" | "utility",
        activationStatus:
          activation.activationStatus === "active" ? ("active" as const) : ("inactive" as const),
        dailyCallLimit: activation.dailyCallLimit
      })),
      isDefaultFirstRegistrationPlan: plan.isDefaultFirstRegistrationPlan,
      isTrialPlan: plan.isTrialPlan,
      trialDurationDays: plan.trialDurationDays,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt
    };
  }

  private mapStatus(status: PlanCatalogStatus): "active" | "inactive" {
    return status === "active" ? "active" : "inactive";
  }

  private toArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private hasAllowedToolClass(
    entitlementModel: AssistantPlanCatalogWriteInput["entitlementModel"],
    classKey: "cost_driving" | "utility"
  ): boolean {
    return entitlementModel.toolClasses.some((item) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        return false;
      }
      const row = item as Record<string, unknown>;
      return row.key === classKey && row.allowed === true;
    });
  }

  private toActivationStatusByClass(
    input: AssistantPlanCatalogWriteInput
  ): Record<ToolCatalogToolClass, "active" | "inactive"> {
    return {
      cost_driving: this.hasAllowedToolClass(input.entitlementModel, "cost_driving")
        ? "active"
        : "inactive",
      utility: this.hasAllowedToolClass(input.entitlementModel, "utility") ? "active" : "inactive"
    };
  }

  async backfillToolActivationsForPlans(planIds: string[]): Promise<void> {
    if (planIds.length === 0) return;
    const plans = await this.prisma.planCatalogPlan.findMany({
      where: { id: { in: planIds } },
      include: { entitlement: true }
    });

    for (const plan of plans) {
      const entitlement = plan.entitlement;
      const toolClasses: unknown[] = entitlement
        ? Array.isArray(entitlement.toolClasses)
          ? entitlement.toolClasses
          : []
        : [];
      const writeInput: AssistantPlanCatalogWriteInput = {
        displayName: plan.displayName,
        description: plan.description,
        status: plan.status === "active" ? "active" : "inactive",
        isDefaultFirstRegistrationPlan: plan.isDefaultFirstRegistrationPlan,
        isTrialPlan: plan.isTrialPlan,
        trialDurationDays: plan.trialDurationDays,
        billingProviderHints: plan.billingProviderHints as Record<string, unknown> | null,
        entitlementModel: {
          schemaVersion: entitlement?.schemaVersion ?? 1,
          capabilities: entitlement
            ? Array.isArray(entitlement.capabilities)
              ? entitlement.capabilities
              : []
            : [],
          toolClasses,
          channelsAndSurfaces: entitlement
            ? Array.isArray(entitlement.channelsAndSurfaces)
              ? entitlement.channelsAndSurfaces
              : []
            : [],
          limitsPermissions: entitlement
            ? Array.isArray(entitlement.limitsPermissions)
              ? entitlement.limitsPermissions
              : []
            : []
        },
        toolActivationOverrides: []
      };
      await this.syncToolActivationsForPlan(this.prisma, plan.id, writeInput);
    }
  }

  private async syncToolActivationsForPlan(
    tx: Prisma.TransactionClient,
    planId: string,
    input: AssistantPlanCatalogWriteInput
  ): Promise<void> {
    const tools = await tx.toolCatalogTool.findMany({
      where: { status: "active" },
      select: { id: true, code: true, toolClass: true }
    });

    const overridesByCode = new Map(
      (input.toolActivationOverrides ?? []).map((o) => [o.toolCode, o])
    );
    const classFallback = this.toActivationStatusByClass(input);
    const activeToolIds = tools.map((tool) => tool.id);

    await tx.planCatalogToolActivation.deleteMany({
      where: {
        planId,
        ...(activeToolIds.length > 0 ? { toolId: { notIn: activeToolIds } } : {})
      }
    });

    for (const tool of tools) {
      const override = overridesByCode.get(tool.code);
      const activationStatus = override
        ? override.active
          ? "active"
          : "inactive"
        : classFallback[tool.toolClass];
      const dailyCallLimit = override?.dailyCallLimit ?? null;

      await tx.planCatalogToolActivation.upsert({
        where: {
          planId_toolId: { planId, toolId: tool.id }
        },
        update: { activationStatus, dailyCallLimit },
        create: { planId, toolId: tool.id, activationStatus, dailyCallLimit }
      });
    }
  }
}
