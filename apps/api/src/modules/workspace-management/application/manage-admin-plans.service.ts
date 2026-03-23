import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository,
  type AssistantPlanCatalogWriteInput
} from "../domain/assistant-plan-catalog.repository";
import type { AssistantPlanCatalog } from "../domain/assistant-plan-catalog.entity";
import type {
  AdminCreatePlanInput,
  AdminPlanInput,
  AdminPlanState
} from "./admin-plan-management.types";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import {
  AdminAuthorizationService,
  type DangerousAdminActionCode
} from "./admin-authorization.service";

function toBoolean(value: unknown): boolean {
  return value === true;
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseStatus(value: unknown): "active" | "inactive" {
  if (value === "active" || value === "inactive") {
    return value;
  }
  throw new BadRequestException("status must be 'active' or 'inactive'.");
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function parseTrialDuration(value: unknown, trialEnabled: boolean): number | null {
  if (!trialEnabled) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException("trialDurationDays must be an integer greater than 0 when trialEnabled=true.");
  }
  return value;
}

function parseObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(`${fieldName} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function hasAllowedFlag(items: unknown, key: string): boolean {
  if (!Array.isArray(items)) {
    return false;
  }
  return items.some((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }
    const typed = item as Record<string, unknown>;
    return typed.key === key && typed.allowed === true;
  });
}

function hasValueFlag(items: unknown, key: string): boolean {
  if (!Array.isArray(items)) {
    return false;
  }
  return items.some((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }
    const typed = item as Record<string, unknown>;
    return typed.key === key && typed.value === true;
  });
}

function hasQuotaGovernedFlag(items: unknown, key: string): boolean {
  if (!Array.isArray(items)) {
    return false;
  }
  return items.some((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }
    const typed = item as Record<string, unknown>;
    return typed.key === key && typed.quotaGoverned === true;
  });
}

@Injectable()
export class ManageAdminPlansService {
  constructor(
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly planCatalogRepository: AssistantPlanCatalogRepository,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly adminAuthorizationService: AdminAuthorizationService
  ) {}

  async listPlans(userId: string): Promise<AdminPlanState[]> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const plans = await this.planCatalogRepository.listAll();
    return plans.map((plan) => this.toAdminPlanState(plan));
  }

  parseCreateInput(body: unknown): AdminCreatePlanInput {
    const parsed = parseObject(body, "request body");
    return {
      code: parseRequiredString(parsed.code, "code").toLowerCase(),
      ...this.parsePlanInput(parsed)
    };
  }

  parseUpdateInput(body: unknown): AdminPlanInput {
    const parsed = parseObject(body, "request body");
    return this.parsePlanInput(parsed);
  }

  async createPlan(
    userId: string,
    input: AdminCreatePlanInput,
    stepUpToken: string | null
  ): Promise<AdminPlanState> {
    const access = await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.plan.create",
      stepUpToken
    );
    const existing = await this.planCatalogRepository.findByCode(input.code);
    if (existing !== null) {
      throw new ConflictException("Plan code already exists.");
    }

    const created = await this.planCatalogRepository.create(input.code, this.toWriteInput(input));
    await this.appendAssistantAuditEventService.execute({
      workspaceId: access.workspaceId,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.plan_created",
      summary: "Admin plan created.",
      details: {
        action: "admin.plan.create" as DangerousAdminActionCode,
        actorRoles: access.roles,
        legacyOwnerFallback: access.hasLegacyOwnerFallback,
        stepUpVerified: true,
        code: created.code,
        status: created.status,
        defaultOnRegistration: created.isDefaultFirstRegistrationPlan,
        trialEnabled: created.isTrialPlan
      }
    });
    return this.toAdminPlanState(created);
  }

  async updatePlan(
    userId: string,
    code: string,
    input: AdminPlanInput,
    stepUpToken: string | null
  ): Promise<AdminPlanState> {
    const access = await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.plan.update",
      stepUpToken
    );
    const normalizedCode = parseRequiredString(code, "code").toLowerCase();
    const updated = await this.planCatalogRepository.updateByCode(
      normalizedCode,
      this.toWriteInput(input)
    );
    if (updated === null) {
      throw new NotFoundException("Plan not found.");
    }
    await this.appendAssistantAuditEventService.execute({
      workspaceId: access.workspaceId,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.plan_updated",
      summary: "Admin plan updated.",
      details: {
        action: "admin.plan.update" as DangerousAdminActionCode,
        actorRoles: access.roles,
        legacyOwnerFallback: access.hasLegacyOwnerFallback,
        stepUpVerified: true,
        code: updated.code,
        status: updated.status,
        defaultOnRegistration: updated.isDefaultFirstRegistrationPlan,
        trialEnabled: updated.isTrialPlan
      }
    });
    return this.toAdminPlanState(updated);
  }

  private parsePlanInput(parsed: Record<string, unknown>): AdminPlanInput {
    const status = parseStatus(parsed.status);
    const trialEnabled = toBoolean(parsed.trialEnabled);
    const entitlements = parseObject(parsed.entitlements, "entitlements");
    const capabilities = parseObject(entitlements.capabilities, "entitlements.capabilities");
    const toolClasses = parseObject(entitlements.toolClasses, "entitlements.toolClasses");
    const channelsAndSurfaces = parseObject(
      entitlements.channelsAndSurfaces,
      "entitlements.channelsAndSurfaces"
    );
    const limitsPermissions = parseObject(
      entitlements.limitsPermissions,
      "entitlements.limitsPermissions"
    );
    const metadata = parseObject(parsed.metadata, "metadata");

    return {
      displayName: parseRequiredString(parsed.displayName, "displayName"),
      description: toNullableString(parsed.description),
      status,
      defaultOnRegistration: toBoolean(parsed.defaultOnRegistration),
      trialEnabled,
      trialDurationDays: parseTrialDuration(parsed.trialDurationDays, trialEnabled),
      metadata: {
        commercialTag: toNullableString(metadata.commercialTag),
        notes: toNullableString(metadata.notes)
      },
      entitlements: {
        capabilities: {
          assistantLifecycle: toBoolean(capabilities.assistantLifecycle),
          memoryCenter: toBoolean(capabilities.memoryCenter),
          tasksCenter: toBoolean(capabilities.tasksCenter)
        },
        toolClasses: {
          costDrivingTools: toBoolean(toolClasses.costDrivingTools),
          utilityTools: toBoolean(toolClasses.utilityTools),
          costDrivingQuotaGoverned: toBoolean(toolClasses.costDrivingQuotaGoverned),
          utilityQuotaGoverned: toBoolean(toolClasses.utilityQuotaGoverned)
        },
        channelsAndSurfaces: {
          webChat: toBoolean(channelsAndSurfaces.webChat),
          telegram: toBoolean(channelsAndSurfaces.telegram),
          whatsapp: toBoolean(channelsAndSurfaces.whatsapp),
          max: toBoolean(channelsAndSurfaces.max)
        },
        limitsPermissions: {
          viewLimitPercentages: toBoolean(limitsPermissions.viewLimitPercentages),
          tasksExcludedFromCommercialQuotas: toBoolean(
            limitsPermissions.tasksExcludedFromCommercialQuotas
          )
        }
      }
    };
  }

  private toWriteInput(input: AdminPlanInput): AssistantPlanCatalogWriteInput {
    return {
      displayName: input.displayName,
      description: input.description,
      status: input.status,
      isDefaultFirstRegistrationPlan: input.defaultOnRegistration,
      isTrialPlan: input.trialEnabled,
      trialDurationDays: input.trialDurationDays,
      billingProviderHints: {
        schema: "persai.billingHints.v1",
        providerAgnostic: true,
        commercialTag: input.metadata.commercialTag,
        notes: input.metadata.notes
      },
      entitlementModel: {
        schemaVersion: 1,
        capabilities: [
          { key: "assistant.lifecycle.publish_apply_rollback_reset", allowed: input.entitlements.capabilities.assistantLifecycle },
          { key: "assistant.memory.center", allowed: input.entitlements.capabilities.memoryCenter },
          { key: "assistant.tasks.center", allowed: input.entitlements.capabilities.tasksCenter }
        ],
        toolClasses: [
          {
            key: "cost_driving",
            allowed: input.entitlements.toolClasses.costDrivingTools,
            quotaGoverned: input.entitlements.toolClasses.costDrivingQuotaGoverned
          },
          {
            key: "utility",
            allowed: input.entitlements.toolClasses.utilityTools,
            quotaGoverned: input.entitlements.toolClasses.utilityQuotaGoverned
          }
        ],
        channelsAndSurfaces: [
          { key: "web_chat", allowed: input.entitlements.channelsAndSurfaces.webChat },
          { key: "telegram", allowed: input.entitlements.channelsAndSurfaces.telegram },
          { key: "whatsapp", allowed: input.entitlements.channelsAndSurfaces.whatsapp },
          { key: "max", allowed: input.entitlements.channelsAndSurfaces.max }
        ],
        limitsPermissions: [
          {
            key: "view_limit_percentages",
            allowed: input.entitlements.limitsPermissions.viewLimitPercentages
          },
          {
            key: "tasks_excluded_from_commercial_quotas",
            value: input.entitlements.limitsPermissions.tasksExcludedFromCommercialQuotas
          }
        ]
      }
    };
  }

  private toAdminPlanState(plan: AssistantPlanCatalog): AdminPlanState {
    const billingHints =
      plan.billingProviderHints !== null &&
      typeof plan.billingProviderHints === "object" &&
      !Array.isArray(plan.billingProviderHints)
        ? (plan.billingProviderHints as Record<string, unknown>)
        : {};
    const entitlement = plan.entitlementModel;
    const capabilities = entitlement?.capabilities ?? [];
    const toolClasses = entitlement?.toolClasses ?? [];
    const channelsAndSurfaces = entitlement?.channelsAndSurfaces ?? [];
    const limitsPermissions = entitlement?.limitsPermissions ?? [];

    return {
      code: plan.code,
      displayName: plan.displayName,
      description: plan.description,
      status: plan.status,
      defaultOnRegistration: plan.isDefaultFirstRegistrationPlan,
      trialEnabled: plan.isTrialPlan,
      trialDurationDays: plan.trialDurationDays,
      metadata: {
        commercialTag: toNullableString(billingHints.commercialTag),
        notes: toNullableString(billingHints.notes)
      },
      entitlements: {
        capabilities: {
          assistantLifecycle: hasAllowedFlag(
            capabilities,
            "assistant.lifecycle.publish_apply_rollback_reset"
          ),
          memoryCenter: hasAllowedFlag(capabilities, "assistant.memory.center"),
          tasksCenter: hasAllowedFlag(capabilities, "assistant.tasks.center")
        },
        toolClasses: {
          costDrivingTools: hasAllowedFlag(toolClasses, "cost_driving"),
          utilityTools: hasAllowedFlag(toolClasses, "utility"),
          costDrivingQuotaGoverned: hasQuotaGovernedFlag(toolClasses, "cost_driving"),
          utilityQuotaGoverned: hasQuotaGovernedFlag(toolClasses, "utility")
        },
        channelsAndSurfaces: {
          webChat: hasAllowedFlag(channelsAndSurfaces, "web_chat"),
          telegram: hasAllowedFlag(channelsAndSurfaces, "telegram"),
          whatsapp: hasAllowedFlag(channelsAndSurfaces, "whatsapp"),
          max: hasAllowedFlag(channelsAndSurfaces, "max")
        },
        limitsPermissions: {
          viewLimitPercentages: hasAllowedFlag(limitsPermissions, "view_limit_percentages"),
          tasksExcludedFromCommercialQuotas: hasValueFlag(
            limitsPermissions,
            "tasks_excluded_from_commercial_quotas"
          )
        }
      },
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString()
    };
  }

}
