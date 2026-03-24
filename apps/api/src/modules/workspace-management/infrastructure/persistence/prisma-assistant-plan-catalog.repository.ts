import { Injectable } from "@nestjs/common";
import { Prisma, type PlanCatalogStatus, type ToolCatalogToolClass } from "@prisma/client";
import type {
  AssistantPlanCatalogRepository,
  AssistantPlanCatalogWriteInput
} from "../../domain/assistant-plan-catalog.repository";
import type { AssistantPlanCatalog } from "../../domain/assistant-plan-catalog.entity";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaAssistantPlanCatalogRepository implements AssistantPlanCatalogRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async listAll(): Promise<AssistantPlanCatalog[]> {
    const plans = await this.prisma.planCatalogPlan.findMany({
      include: { entitlement: true },
      orderBy: [{ updatedAt: "desc" }, { code: "asc" }]
    });
    return plans.map((plan) => this.mapToDomain(plan));
  }

  async findByCode(code: string): Promise<AssistantPlanCatalog | null> {
    const plan = await this.prisma.planCatalogPlan.findFirst({
      where: { code },
      include: { entitlement: true }
    });
    return plan ? this.mapToDomain(plan) : null;
  }

  async findDefaultRegistrationPlan(): Promise<AssistantPlanCatalog | null> {
    const plan = await this.prisma.planCatalogPlan.findFirst({
      where: {
        isDefaultFirstRegistrationPlan: true,
        status: "active"
      },
      include: { entitlement: true },
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
      include: { entitlement: true }
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
      include: { entitlement: true }
    });
    if (updated === null) {
      return null;
    }
    return this.mapToDomain(updated);
  }

  private mapToDomain(
    plan: Prisma.PlanCatalogPlanGetPayload<{ include: { entitlement: true } }>
  ): AssistantPlanCatalog {
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

  private async syncToolActivationsForPlan(
    tx: Prisma.TransactionClient,
    planId: string,
    input: AssistantPlanCatalogWriteInput
  ): Promise<void> {
    const tools = await tx.toolCatalogTool.findMany({
      where: {
        status: "active"
      },
      select: {
        id: true,
        toolClass: true
      }
    });

    const statusByClass = this.toActivationStatusByClass(input);
    const activeToolIds = tools.map((tool) => tool.id);

    await tx.planCatalogToolActivation.deleteMany({
      where: {
        planId,
        ...(activeToolIds.length > 0 ? { toolId: { notIn: activeToolIds } } : {})
      }
    });

    for (const tool of tools) {
      await tx.planCatalogToolActivation.upsert({
        where: {
          planId_toolId: {
            planId,
            toolId: tool.id
          }
        },
        update: {
          activationStatus: statusByClass[tool.toolClass]
        },
        create: {
          planId,
          toolId: tool.id,
          activationStatus: statusByClass[tool.toolClass]
        }
      });
    }
  }
}
