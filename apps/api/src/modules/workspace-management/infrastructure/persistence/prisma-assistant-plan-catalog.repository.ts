import { Injectable } from "@nestjs/common";
import type { PlanCatalogStatus, Prisma } from "@prisma/client";
import type { AssistantPlanCatalogRepository } from "../../domain/assistant-plan-catalog.repository";
import type { AssistantPlanCatalog } from "../../domain/assistant-plan-catalog.entity";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaAssistantPlanCatalogRepository implements AssistantPlanCatalogRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

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
