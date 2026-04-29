import { BadRequestException, Injectable } from "@nestjs/common";
import { AdminNotificationChannelStatus, WorkspaceNotificationPolicySource } from "@prisma/client";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { assertPublicWebhookUrl } from "./admin-webhook-url-policy";
import type {
  AdminNotificationChannelState,
  IdleReengagementNotificationPolicyState
} from "./admin-system-notification.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export type UpdateAdminWebhookNotificationChannelInput = {
  enabled: boolean;
  endpointUrl: string | null;
  signingSecret: string | null;
};

export type UpdateIdleReengagementNotificationPolicyInput = {
  enabled: boolean;
  idleHours: number;
  cooldownHours: number;
  llmInstruction: string;
};

const DEFAULT_IDLE_REENGAGEMENT_LLM_INSTRUCTION = [
  "Decide whether to send a short, warm reengagement message after the user has been away.",
  "Use the recent conversation context and active open loops. Push only when it is genuinely helpful.",
  "The message must be one brief user-facing sentence, non-pushy, no guilt, no exact idle duration."
].join("\n");

function toTrimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function assertWebhookUrl(value: string): void {
  try {
    assertPublicWebhookUrl(value);
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : "Invalid webhook endpointUrl."
    );
  }
}

function parsePositiveInteger(value: unknown, fieldName: string, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    throw new BadRequestException(`${fieldName} must be an integer between 1 and ${max}.`);
  }
  return value;
}

@Injectable()
export class ManageAdminNotificationChannelsService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  async listChannels(userId: string): Promise<AdminNotificationChannelState[]> {
    const context = await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const channels = await this.prisma.workspaceAdminNotificationChannel.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { channelType: "asc" },
      include: {
        deliveries: {
          orderBy: { attemptedAt: "desc" },
          take: 1
        }
      }
    });

    return channels.map((channel) => ({
      channelType: "webhook",
      status: channel.status,
      endpointUrl: channel.endpointUrl,
      hasSigningSecret: channel.signingSecret !== null,
      updatedAt: channel.updatedAt.toISOString(),
      lastDelivery:
        channel.deliveries[0] === undefined
          ? null
          : {
              deliveryStatus: channel.deliveries[0].deliveryStatus,
              attemptedAt: channel.deliveries[0].attemptedAt.toISOString(),
              errorMessage: channel.deliveries[0].errorMessage
            }
    }));
  }

  async getIdleReengagementPolicy(
    userId: string
  ): Promise<IdleReengagementNotificationPolicyState> {
    const context = await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    return this.resolveIdleReengagementPolicyState(context.workspaceId);
  }

  parseWebhookUpdateInput(body: unknown): UpdateAdminWebhookNotificationChannelInput {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    if (typeof row.enabled !== "boolean") {
      throw new BadRequestException("enabled must be a boolean.");
    }
    const endpointUrl = toTrimmedOrNull(row.endpointUrl);
    if (row.enabled) {
      if (endpointUrl === null) {
        throw new BadRequestException("endpointUrl is required when enabling webhook channel.");
      }
      assertWebhookUrl(endpointUrl);
    } else if (endpointUrl !== null) {
      assertWebhookUrl(endpointUrl);
    }
    const signingSecret = toTrimmedOrNull(row.signingSecret);
    return {
      enabled: row.enabled,
      endpointUrl,
      signingSecret
    };
  }

  parseIdleReengagementPolicyUpdateInput(
    body: unknown
  ): UpdateIdleReengagementNotificationPolicyInput {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    if (typeof row.enabled !== "boolean") {
      throw new BadRequestException("enabled must be a boolean.");
    }
    const llmInstruction = toTrimmedOrNull(row.llmInstruction);
    if (llmInstruction === null) {
      throw new BadRequestException("llmInstruction is required.");
    }
    return {
      enabled: row.enabled,
      idleHours: parsePositiveInteger(row.idleHours, "idleHours", 720),
      cooldownHours: parsePositiveInteger(row.cooldownHours, "cooldownHours", 720),
      llmInstruction
    };
  }

  async updateWebhookChannel(
    userId: string,
    input: UpdateAdminWebhookNotificationChannelInput
  ): Promise<AdminNotificationChannelState> {
    const context =
      await this.adminAuthorizationService.assertCanManageAdminSystemNotifications(userId);
    const status: AdminNotificationChannelStatus = input.enabled ? "active" : "inactive";

    const channel = await this.prisma.workspaceAdminNotificationChannel.upsert({
      where: {
        workspaceId_channelType: {
          workspaceId: context.workspaceId,
          channelType: "webhook"
        }
      },
      create: {
        workspaceId: context.workspaceId,
        channelType: "webhook",
        status,
        endpointUrl: input.endpointUrl,
        signingSecret: input.signingSecret,
        createdByUserId: userId
      },
      update: {
        status,
        endpointUrl: input.endpointUrl,
        signingSecret: input.signingSecret
      }
    });

    await this.appendAssistantAuditEventService.execute({
      workspaceId: context.workspaceId,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.notification_channel_updated",
      summary: "Admin notification webhook channel updated.",
      details: {
        channelType: "webhook",
        status,
        hasEndpointUrl: input.endpointUrl !== null,
        hasSigningSecret: input.signingSecret !== null,
        actorRoles: context.roles,
        legacyOwnerFallback: context.hasLegacyOwnerFallback
      }
    });

    const lastDelivery = await this.prisma.adminNotificationDelivery.findFirst({
      where: { channelId: channel.id },
      orderBy: { attemptedAt: "desc" }
    });

    return {
      channelType: "webhook",
      status: channel.status,
      endpointUrl: channel.endpointUrl,
      hasSigningSecret: channel.signingSecret !== null,
      updatedAt: channel.updatedAt.toISOString(),
      lastDelivery:
        lastDelivery === null
          ? null
          : {
              deliveryStatus: lastDelivery.deliveryStatus,
              attemptedAt: lastDelivery.attemptedAt.toISOString(),
              errorMessage: lastDelivery.errorMessage
            }
    };
  }

  async updateIdleReengagementPolicy(
    userId: string,
    input: UpdateIdleReengagementNotificationPolicyInput
  ): Promise<IdleReengagementNotificationPolicyState> {
    const context =
      await this.adminAuthorizationService.assertCanManageAdminSystemNotifications(userId);
    const policy = await this.prisma.workspaceNotificationPolicy.upsert({
      where: {
        workspaceId_source: {
          workspaceId: context.workspaceId,
          source: WorkspaceNotificationPolicySource.idle_reengagement
        }
      },
      create: {
        workspaceId: context.workspaceId,
        source: WorkspaceNotificationPolicySource.idle_reengagement,
        enabled: input.enabled,
        idleHours: input.idleHours,
        cooldownHours: input.cooldownHours,
        llmInstruction: input.llmInstruction,
        updatedByUserId: userId
      },
      update: {
        enabled: input.enabled,
        idleHours: input.idleHours,
        cooldownHours: input.cooldownHours,
        llmInstruction: input.llmInstruction,
        updatedByUserId: userId
      }
    });

    await this.appendAssistantAuditEventService.execute({
      workspaceId: context.workspaceId,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.notification_policy_updated",
      summary: "Idle reengagement notification policy updated.",
      details: {
        source: "idle_reengagement",
        enabled: input.enabled,
        idleHours: input.idleHours,
        cooldownHours: input.cooldownHours,
        actorRoles: context.roles,
        legacyOwnerFallback: context.hasLegacyOwnerFallback
      }
    });

    return this.toIdleReengagementPolicyState(policy);
  }

  private async resolveIdleReengagementPolicyState(
    workspaceId: string
  ): Promise<IdleReengagementNotificationPolicyState> {
    const policy = await this.prisma.workspaceNotificationPolicy.findUnique({
      where: {
        workspaceId_source: {
          workspaceId,
          source: WorkspaceNotificationPolicySource.idle_reengagement
        }
      }
    });
    if (policy === null) {
      return {
        source: "idle_reengagement",
        enabled: false,
        idleHours: 24,
        cooldownHours: 72,
        llmInstruction: DEFAULT_IDLE_REENGAGEMENT_LLM_INSTRUCTION,
        updatedAt: new Date(0).toISOString(),
        updatedByUserId: null
      };
    }
    return this.toIdleReengagementPolicyState(policy);
  }

  private toIdleReengagementPolicyState(policy: {
    enabled: boolean;
    idleHours: number;
    cooldownHours: number;
    llmInstruction: string;
    updatedAt: Date;
    updatedByUserId: string | null;
  }): IdleReengagementNotificationPolicyState {
    return {
      source: "idle_reengagement",
      enabled: policy.enabled,
      idleHours: policy.idleHours,
      cooldownHours: policy.cooldownHours,
      llmInstruction: policy.llmInstruction,
      updatedAt: policy.updatedAt.toISOString(),
      updatedByUserId: policy.updatedByUserId
    };
  }
}
