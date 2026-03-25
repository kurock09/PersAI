import { createHmac } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import type {
  AdminSystemNotificationEnvelope,
  AdminSystemNotificationSignalCode,
  AdminSystemNotificationSeverity
} from "./admin-system-notification.types";
import { assertPublicWebhookUrl } from "./admin-webhook-url-policy";

const WEBHOOK_TIMEOUT_MS = 3000;

type NotificationSignalDefinition = {
  code: AdminSystemNotificationSignalCode;
  severity: AdminSystemNotificationSeverity;
};

const SIGNAL_BY_AUDIT_EVENT_CODE: Record<string, NotificationSignalDefinition | undefined> = {
  "assistant.runtime.apply_failed": {
    code: "assistant.runtime.apply_failed",
    severity: "high"
  },
  "assistant.runtime.apply_degraded": {
    code: "assistant.runtime.apply_degraded",
    severity: "elevated"
  },
  "assistant.runtime.apply_succeeded": {
    code: "assistant.runtime.apply_succeeded",
    severity: "info"
  },
  "admin.plan_created": {
    code: "admin.plan_created",
    severity: "elevated"
  },
  "admin.plan_updated": {
    code: "admin.plan_updated",
    severity: "elevated"
  }
};

export type DeliverAdminSystemNotificationFromAuditInput = {
  workspaceId: string | null;
  assistantId: string | null;
  actorUserId: string | null;
  eventCode: string;
  summary: string;
  details: Record<string, unknown>;
  createdAt: string;
};

@Injectable()
export class DeliverAdminSystemNotificationService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async executeFromAuditEvent(input: DeliverAdminSystemNotificationFromAuditInput): Promise<void> {
    if (input.workspaceId === null) {
      return;
    }
    const signal = SIGNAL_BY_AUDIT_EVENT_CODE[input.eventCode];
    if (signal === undefined) {
      return;
    }
    const channels = await this.prisma.workspaceAdminNotificationChannel.findMany({
      where: {
        workspaceId: input.workspaceId,
        channelType: "webhook",
        status: "active",
        endpointUrl: { not: null }
      }
    });
    if (channels.length === 0) {
      return;
    }

    const envelope: AdminSystemNotificationEnvelope = {
      schema: "persai.adminSystemNotification.v1",
      workspaceId: input.workspaceId,
      signal: {
        code: signal.code,
        severity: signal.severity,
        summary: input.summary,
        occurredAt: input.createdAt
      },
      actor: {
        userId: input.actorUserId
      },
      assistant: {
        assistantId: input.assistantId
      },
      details: input.details
    };

    await Promise.all(
      channels.map(async (channel) => {
        const payload = envelope as unknown as Prisma.InputJsonValue;
        try {
          const response = await this.postWebhook(
            channel.endpointUrl as string,
            envelope,
            channel.signingSecret
          );
          if (!response.ok) {
            await this.prisma.adminNotificationDelivery.create({
              data: {
                workspaceId: input.workspaceId as string,
                channelId: channel.id,
                signalCode: signal.code,
                deliveryStatus: "failed",
                payload,
                errorMessage: `Webhook returned HTTP ${response.status}.`
              }
            });
            return;
          }
          await this.prisma.adminNotificationDelivery.create({
            data: {
              workspaceId: input.workspaceId as string,
              channelId: channel.id,
              signalCode: signal.code,
              deliveryStatus: "succeeded",
              payload
            }
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown webhook delivery failure.";
          await this.prisma.adminNotificationDelivery.create({
            data: {
              workspaceId: input.workspaceId as string,
              channelId: channel.id,
              signalCode: signal.code,
              deliveryStatus: "failed",
              payload,
              errorMessage: message.slice(0, 512)
            }
          });
        }
      })
    );
  }

  private async postWebhook(
    endpointUrl: string,
    envelope: AdminSystemNotificationEnvelope,
    signingSecret: string | null
  ): Promise<Response> {
    assertPublicWebhookUrl(endpointUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const payloadText = JSON.stringify(envelope);
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-persai-notification-signal": envelope.signal.code
      };
      if (signingSecret !== null) {
        headers["x-persai-signature"] = createHmac("sha256", signingSecret)
          .update(payloadText)
          .digest("hex");
      }
      return await fetch(endpointUrl, {
        method: "POST",
        headers,
        body: payloadText,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
