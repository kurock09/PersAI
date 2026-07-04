import { Injectable } from "@nestjs/common";
import { Prisma, type PlanCatalogStatus, type ToolCatalogToolClass } from "@prisma/client";
import type {
  AssistantPlanCatalogDeleteImpact,
  AssistantPlanCatalogRepository,
  AssistantPlanCatalogWriteInput
} from "../../domain/assistant-plan-catalog.repository";
import type { AssistantPlanCatalog } from "../../domain/assistant-plan-catalog.entity";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";
import {
  CURRENT_TOOL_CODE_SET,
  defaultPlanFullProjection,
  isPlanManagedTool,
  isPlatformManagedTool,
  resolveToolPolicyClass
} from "../../../../../prisma/tool-catalog-data";

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

  async getDeleteImpactByCode(code: string): Promise<AssistantPlanCatalogDeleteImpact | null> {
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code },
      select: {
        code: true,
        isDefaultFirstRegistrationPlan: true
      }
    });
    if (plan === null) {
      return null;
    }
    const [workspaceSubscriptionCount, assistantOverrideCount, assistantFallbackCount] =
      await this.prisma.$transaction([
        this.prisma.workspaceSubscription.count({
          where: { planCode: code }
        }),
        this.prisma.assistantGovernance.count({
          where: { assistantPlanOverrideCode: code }
        }),
        this.prisma.assistantGovernance.count({
          where: { quotaPlanCode: code }
        })
      ]);
    return {
      isDefaultRegistrationPlan: plan.isDefaultFirstRegistrationPlan,
      workspaceSubscriptionCount,
      assistantOverrideCount,
      assistantFallbackCount
    };
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

  async deleteByCode(code: string): Promise<boolean> {
    const existing = await this.prisma.planCatalogPlan.findUnique({
      where: { code },
      select: { id: true }
    });
    if (existing === null) {
      return false;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.planCatalogToolActivation.deleteMany({
        where: { planId: existing.id }
      });
      await tx.planCatalogEntitlement.deleteMany({
        where: { planId: existing.id }
      });
      await tx.planCatalogPlan.delete({
        where: { id: existing.id }
      });
    });
    return true;
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
      toolActivations: plan.toolActivations
        .filter((activation) => CURRENT_TOOL_CODE_SET.has(activation.tool.code))
        .map((activation) => ({
          toolCode: activation.tool.code,
          displayName: activation.tool.displayName,
          toolClass: activation.tool.toolClass as "cost_driving" | "utility",
          policyClass: resolveToolPolicyClass(activation.tool.code),
          activationStatus:
            activation.activationStatus === "active" ? ("active" as const) : ("inactive" as const),
          dailyCallLimit: activation.dailyCallLimit,
          perTurnCap: activation.perTurnCap,
          maxFilePreviewBytes: activation.maxFilePreviewBytes,
          maxFilePreviewEdgePx: activation.maxFilePreviewEdgePx,
          fullProjection: activation.fullProjection
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
      where: {
        status: "active",
        code: {
          in: [...CURRENT_TOOL_CODE_SET]
        }
      },
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
      const activationStatus = isPlanManagedTool(tool.code)
        ? override
          ? override.active
            ? "active"
            : "inactive"
          : classFallback[tool.toolClass]
        : isPlatformManagedTool(tool.code)
          ? "active"
          : "inactive";
      const dailyCallLimit = isPlanManagedTool(tool.code)
        ? (override?.dailyCallLimit ?? null)
        : null;
      // ADR-074 Slice L1 — perTurnCap may be set on cost-driving tools
      // regardless of plan_managed/platform_managed since the runtime
      // applies it uniformly. Hidden internal tools (memory, etc.) keep
      // NULL and inherit the runtime default of "no cap".
      const perTurnCap = override?.perTurnCap ?? null;
      const maxFilePreviewBytes =
        tool.code === "files" ? (override?.maxFilePreviewBytes ?? null) : null;
      const maxFilePreviewEdgePx =
        tool.code === "files" ? (override?.maxFilePreviewEdgePx ?? null) : null;
      const fullProjection = defaultPlanFullProjection(tool.code);

      await tx.planCatalogToolActivation.upsert({
        where: {
          planId_toolId: { planId, toolId: tool.id }
        },
        update: {
          activationStatus,
          dailyCallLimit,
          perTurnCap,
          maxFilePreviewBytes,
          maxFilePreviewEdgePx
        },
        create: {
          planId,
          toolId: tool.id,
          activationStatus,
          dailyCallLimit,
          perTurnCap,
          maxFilePreviewBytes,
          maxFilePreviewEdgePx,
          fullProjection
        }
      });
    }
  }
}
