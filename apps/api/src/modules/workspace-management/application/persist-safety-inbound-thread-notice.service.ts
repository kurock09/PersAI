import { Injectable } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { SAFETY_INBOUND_RESTRICTED_PLACEHOLDER_MESSAGE } from "../domain/safety-policy.types";

@Injectable()
export class PersistSafetyInboundThreadNoticeService {
  constructor(
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository
  ) {}

  async persistPlaceholderIfPossible(input: {
    chatId: string | null;
    assistantId: string;
    reasonCode: string;
  }): Promise<string | null> {
    if (input.chatId === null) {
      return null;
    }
    const message = await this.assistantChatRepository.createMessage({
      chatId: input.chatId,
      assistantId: input.assistantId,
      author: "system",
      content: SAFETY_INBOUND_RESTRICTED_PLACEHOLDER_MESSAGE,
      metadata: {
        kind: "safety_inbound_restricted",
        reasonCode: input.reasonCode
      }
    });
    return message.id;
  }
}
