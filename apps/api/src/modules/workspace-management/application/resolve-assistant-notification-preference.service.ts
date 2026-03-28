import { Injectable, NotFoundException } from "@nestjs/common";
import type { AssistantPreferredNotificationChannel as PrismaPreferredNotificationChannel } from "@prisma/client";
import type {
  AssistantNotificationPreferenceState,
  AssistantPreferredNotificationChannel
} from "./assistant-notification-preference.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const CONNECTABLE_PROVIDER_KEYS = ["telegram", "whatsapp"] as const;

function toPreferredNotificationChannel(
  value: PrismaPreferredNotificationChannel | null | undefined
): AssistantPreferredNotificationChannel {
  if (value === "telegram" || value === "whatsapp") {
    return value;
  }
  return "web";
}

@Injectable()
export class ResolveAssistantNotificationPreferenceService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async execute(userId: string): Promise<AssistantNotificationPreferenceState> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { userId },
      select: {
        preferredNotificationChannel: true,
        channelSurfaceBindings: {
          where: {
            bindingState: "active",
            providerKey: { in: [...CONNECTABLE_PROVIDER_KEYS] }
          },
          select: { providerKey: true }
        }
      }
    });
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const availableChannelSet = new Set<AssistantPreferredNotificationChannel>(["web"]);
    for (const binding of assistant.channelSurfaceBindings) {
      if (binding.providerKey === "telegram" || binding.providerKey === "whatsapp") {
        availableChannelSet.add(binding.providerKey);
      }
    }

    const availableChannels = Array.from(availableChannelSet);
    const storedSelection = toPreferredNotificationChannel(assistant.preferredNotificationChannel);
    const selectedChannel = availableChannelSet.has(storedSelection) ? storedSelection : "web";

    return {
      selectedChannel,
      availableChannels
    };
  }
}
