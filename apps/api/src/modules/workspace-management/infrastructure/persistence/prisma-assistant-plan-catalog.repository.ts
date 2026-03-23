import { Injectable } from "@nestjs/common";
import { Prisma, type PlanCatalogStatus } from "@prisma/client";
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
      where: { code, status: "active" },
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

      return tx.planCatalogPlan.create({
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
              channelsAndSurfaces: input.entitlementModel.channelsAndSurfaces as Prisma.InputJsonValue,
              limitsPermissions: input.entitlementModel.limitsPermissions as Prisma.InputJsonValue
            }
          }
        },
        include: { entitlement: true }
      });
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

      return tx.planCatalogPlan.update({
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
                channelsAndSurfaces:
                  input.entitlementModel.channelsAndSurfaces as Prisma.InputJsonValue,
                limitsPermissions: input.entitlementModel.limitsPermissions as Prisma.InputJsonValue
              },
              update: {
                schemaVersion: input.entitlementModel.schemaVersion,
                capabilities: input.entitlementModel.capabilities as Prisma.InputJsonValue,
                toolClasses: input.entitlementModel.toolClasses as Prisma.InputJsonValue,
                channelsAndSurfaces:
                  input.entitlementModel.channelsAndSurfaces as Prisma.InputJsonValue,
                limitsPermissions: input.entitlementModel.limitsPermissions as Prisma.InputJsonValue
              }
            }
          }
        },
        include: { entitlement: true }
      });
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
}
