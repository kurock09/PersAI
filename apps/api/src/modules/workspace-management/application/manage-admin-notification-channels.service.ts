import { BadRequestException, Injectable } from "@nestjs/common";
import { AdminNotificationChannelStatus } from "@prisma/client";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { AdminAuthorizationService } from "./admin-authorization.service";
import type { AdminNotificationChannelState } from "./admin-system-notification.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export type UpdateAdminWebhookNotificationChannelInput = {
  enabled: boolean;
  endpointUrl: string | null;
  signingSecret: string | null;
};

function toTrimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function assertWebhookUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BadRequestException("Webhook endpointUrl must be a valid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new BadRequestException("Webhook endpointUrl must use http or https.");
  }
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
}
