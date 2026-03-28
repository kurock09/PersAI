import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { AssistantPreferredNotificationChannel as PrismaPreferredNotificationChannel } from "@prisma/client";
import type {
  AssistantNotificationPreferenceState,
  AssistantPreferredNotificationChannel
} from "./assistant-notification-preference.types";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export interface UpdateAssistantNotificationPreferenceRequest {
  channel: AssistantPreferredNotificationChannel;
}

const ALLOWED_CHANNELS: AssistantPreferredNotificationChannel[] = ["web", "telegram", "whatsapp"];

function isPreferredNotificationChannel(
  value: unknown
): value is AssistantPreferredNotificationChannel {
  return (
    typeof value === "string" &&
    ALLOWED_CHANNELS.includes(value as AssistantPreferredNotificationChannel)
  );
}

@Injectable()
export class UpdateAssistantNotificationPreferenceService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  parseInput(payload: unknown): UpdateAssistantNotificationPreferenceRequest {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Notification preference payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    if (!isPreferredNotificationChannel(body.channel)) {
      throw new BadRequestException("channel must be one of: web, telegram, whatsapp.");
    }

    return { channel: body.channel };
  }

  async execute(
    userId: string,
    request: UpdateAssistantNotificationPreferenceRequest
  ): Promise<AssistantNotificationPreferenceState> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { userId },
      select: {
        id: true,
        workspaceId: true,
        preferredNotificationChannel: true,
        channelSurfaceBindings: {
          where: {
            bindingState: "active",
            providerKey: { in: ["telegram", "whatsapp"] }
          },
          select: { providerKey: true }
        }
      }
    });
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const availableChannels = new Set<AssistantPreferredNotificationChannel>(["web"]);
    for (const binding of assistant.channelSurfaceBindings) {
      if (binding.providerKey === "telegram" || binding.providerKey === "whatsapp") {
        availableChannels.add(binding.providerKey);
      }
    }

    if (!availableChannels.has(request.channel)) {
      throw new ConflictException(
        `The ${request.channel} notification channel is not connected for this assistant.`
      );
    }

    await this.prisma.assistant.update({
      where: { id: assistant.id },
      data: {
        preferredNotificationChannel: request.channel as PrismaPreferredNotificationChannel
      }
    });

    await this.appendAssistantAuditEventService.execute({
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      actorUserId: userId,
      eventCategory: "assistant_channels",
      eventCode: "assistant.notification_preference_updated",
      summary: "Assistant reminder delivery preference updated.",
      details: {
        previousChannel: assistant.preferredNotificationChannel,
        selectedChannel: request.channel
      }
    });

    return {
      selectedChannel: request.channel,
      availableChannels: Array.from(availableChannels)
    };
  }
}
