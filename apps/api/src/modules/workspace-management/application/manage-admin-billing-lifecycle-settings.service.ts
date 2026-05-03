import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AdminAuthorizationService } from "./admin-authorization.service";
import {
  BILLING_LIFECYCLE_SETTINGS_ID,
  BILLING_LIFECYCLE_SETTINGS_SCHEMA,
  DEFAULT_BILLING_LIFECYCLE_NOTIFICATION_POLICY,
  buildBillingLifecycleSettingsMetadata,
  resolveBillingLifecycleNotificationPolicy,
  type BillingLifecycleSettingsInput,
  type BillingLifecycleNotificationPolicy,
  type BillingLifecycleSettingsState
} from "./billing-lifecycle-settings";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

function parseNullablePlanCode(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string or null.`);
  }
  return value.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class ManageAdminBillingLifecycleSettingsService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  parseUpdateInput(body: unknown): BillingLifecycleSettingsInput {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const record = body as Record<string, unknown>;
    if (
      typeof record.gracePeriodDays !== "number" ||
      !Number.isInteger(record.gracePeriodDays) ||
      record.gracePeriodDays <= 0 ||
      record.gracePeriodDays > 90
    ) {
      throw new BadRequestException("gracePeriodDays must be an integer from 1 to 90.");
    }
    return {
      gracePeriodDays: record.gracePeriodDays,
      globalFallbackPlanCode: parseNullablePlanCode(
        record.globalFallbackPlanCode,
        "globalFallbackPlanCode"
      ),
      notificationPolicy: this.parseNotificationPolicy(record.notificationPolicy)
    };
  }

  async getSettings(userId: string): Promise<BillingLifecycleSettingsState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    return this.resolveSettings();
  }

  async resolveSettings(): Promise<BillingLifecycleSettingsState> {
    const row = await this.prisma.billingLifecycleSettings.upsert({
      where: { id: BILLING_LIFECYCLE_SETTINGS_ID },
      create: {
        id: BILLING_LIFECYCLE_SETTINGS_ID,
        gracePeriodDays: 5,
        metadata: toJsonValue(
          buildBillingLifecycleSettingsMetadata(DEFAULT_BILLING_LIFECYCLE_NOTIFICATION_POLICY, {
            source: "service_default"
          })
        )
      },
      update: {}
    });
    const notificationPolicy = resolveBillingLifecycleNotificationPolicy(row.metadata);
    if (!isRecord(row.metadata) || row.metadata.schema !== BILLING_LIFECYCLE_SETTINGS_SCHEMA) {
      const updated = await this.prisma.billingLifecycleSettings.update({
        where: { id: BILLING_LIFECYCLE_SETTINGS_ID },
        data: {
          metadata: toJsonValue(
            buildBillingLifecycleSettingsMetadata(notificationPolicy, {
              source: "service_default"
            })
          )
        }
      });
      return this.toState(updated);
    }
    return this.toState(row);
  }

  async updateSettings(
    userId: string,
    input: BillingLifecycleSettingsInput,
    stepUpToken: string | null
  ): Promise<BillingLifecycleSettingsState> {
    await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.billing_lifecycle_settings.update",
      stepUpToken
    );
    if (input.globalFallbackPlanCode !== null) {
      const fallbackPlan = await this.prisma.planCatalogPlan.findUnique({
        where: { code: input.globalFallbackPlanCode },
        select: { status: true }
      });
      if (fallbackPlan === null || fallbackPlan.status !== "active") {
        throw new BadRequestException("globalFallbackPlanCode must reference an active plan.");
      }
    }

    const row = await this.prisma.billingLifecycleSettings.upsert({
      where: { id: BILLING_LIFECYCLE_SETTINGS_ID },
      create: {
        id: BILLING_LIFECYCLE_SETTINGS_ID,
        gracePeriodDays: input.gracePeriodDays,
        globalFallbackPlanCode: input.globalFallbackPlanCode,
        metadata: toJsonValue(buildBillingLifecycleSettingsMetadata(input.notificationPolicy)),
        updatedByUserId: userId
      },
      update: {
        gracePeriodDays: input.gracePeriodDays,
        globalFallbackPlanCode: input.globalFallbackPlanCode,
        metadata: toJsonValue(buildBillingLifecycleSettingsMetadata(input.notificationPolicy)),
        updatedByUserId: userId
      }
    });

    await this.appendAssistantAuditEventService.execute({
      workspaceId: null,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.billing_lifecycle_settings_updated",
      summary: "Billing lifecycle settings updated.",
      details: {
        gracePeriodDays: row.gracePeriodDays,
        globalFallbackPlanCode: row.globalFallbackPlanCode,
        notificationPolicy: input.notificationPolicy
      }
    });

    return this.toState(row);
  }

  private toState(row: {
    gracePeriodDays: number;
    globalFallbackPlanCode: string | null;
    metadata: unknown;
    updatedAt: Date;
  }): BillingLifecycleSettingsState {
    return {
      schema: BILLING_LIFECYCLE_SETTINGS_SCHEMA,
      gracePeriodDays: row.gracePeriodDays,
      globalFallbackPlanCode: row.globalFallbackPlanCode,
      notificationPolicy: resolveBillingLifecycleNotificationPolicy(row.metadata),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private parseNotificationPolicy(value: unknown): BillingLifecycleNotificationPolicy {
    const fallback = DEFAULT_BILLING_LIFECYCLE_NOTIFICATION_POLICY;
    if (value === undefined) {
      return fallback;
    }
    if (!isRecord(value)) {
      throw new BadRequestException("notificationPolicy must be an object.");
    }
    if (value.emailEnabled !== true) {
      throw new BadRequestException("Billing lifecycle email notifications are required.");
    }
    const assistantPushEnabled =
      value.assistantPushEnabled === undefined ? false : value.assistantPushEnabled;
    if (typeof assistantPushEnabled !== "boolean") {
      throw new BadRequestException("notificationPolicy.assistantPushEnabled must be boolean.");
    }
    const policy = resolveBillingLifecycleNotificationPolicy({
      notificationPolicy: {
        emailEnabled: true,
        assistantPushEnabled,
        rules: value.rules
      }
    });
    for (const rule of policy.rules) {
      if (rule.offsetDays !== null && (rule.offsetDays < 0 || rule.offsetDays > 30)) {
        throw new BadRequestException("Notification offsetDays must be from 0 to 30.");
      }
    }
    return policy;
  }
}
