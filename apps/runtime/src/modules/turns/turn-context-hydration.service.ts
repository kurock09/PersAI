import { Injectable } from "@nestjs/common";
import type { ProviderGatewayTextMessage, RuntimeTurnRequest } from "@persai/runtime-contract";
import { RuntimeStatePrismaService } from "../runtime-state/infrastructure/persistence/runtime-state-prisma.service";

const MAX_CANONICAL_WEB_CONTEXT_MESSAGES = 20;

type CanonicalChatMessageRow = {
  id: string;
  author: "user" | "assistant" | "system";
  content: string;
};

@Injectable()
export class TurnContextHydrationService {
  constructor(private readonly prisma: RuntimeStatePrismaService) {}

  async buildMessages(input: RuntimeTurnRequest): Promise<ProviderGatewayTextMessage[]> {
    if (input.conversation.channel !== "web") {
      return [this.createCurrentUserMessage(input)];
    }

    const chat = await this.prisma.assistantChat.findFirst({
      where: {
        assistantId: input.conversation.assistantId,
        surface: "web",
        surfaceThreadKey: input.conversation.externalThreadKey
      },
      select: {
        id: true
      }
    });
    if (chat === null) {
      return [this.createCurrentUserMessage(input)];
    }

    const storedMessages = await this.prisma.assistantChatMessage.findMany({
      where: {
        chatId: chat.id,
        assistantId: input.conversation.assistantId
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        author: true,
        content: true
      }
    });

    const hydrated = this.hydrateCanonicalWebMessages(storedMessages, input);
    return hydrated.length > 0 ? hydrated : [this.createCurrentUserMessage(input)];
  }

  private hydrateCanonicalWebMessages(
    storedMessages: CanonicalChatMessageRow[],
    input: RuntimeTurnRequest
  ): ProviderGatewayTextMessage[] {
    const hydrated: ProviderGatewayTextMessage[] = [];
    let currentMessageFound = false;

    for (const message of storedMessages) {
      if (message.author === "system") {
        continue;
      }

      if (message.author === "assistant") {
        hydrated.push({
          role: "assistant",
          content: message.content
        });
        continue;
      }

      const isCurrentInboundMessage = message.id === input.idempotencyKey;
      if (isCurrentInboundMessage) {
        currentMessageFound = true;
      }

      hydrated.push({
        role: "user",
        content: isCurrentInboundMessage ? input.message.text : message.content
      });
    }

    if (!currentMessageFound) {
      hydrated.push(this.createCurrentUserMessage(input));
    }

    return hydrated.slice(-MAX_CANONICAL_WEB_CONTEXT_MESSAGES);
  }

  private createCurrentUserMessage(input: RuntimeTurnRequest): ProviderGatewayTextMessage {
    return {
      role: "user",
      content: input.message.text
    };
  }
}
