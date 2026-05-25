import type { AssistantChatMessage } from "../domain/assistant-chat-message.entity";
import type { AssistantChatRepository } from "../domain/assistant-chat.repository";
import type { AssistantMediaJobService } from "./assistant-media-job.service";

type PersistAssistantMessageInput = {
  chatRepository: Pick<AssistantChatRepository, "createMessage">;
  assistantMediaJobService?: Pick<AssistantMediaJobService, "attachAcknowledgementMessageId">;
  chatId: string;
  assistantId: string;
  content: string;
  discoveredFileRefIds?: string[] | undefined;
  deferredMediaJobCount?: number | undefined;
  sourceUserMessageId?: string | null | undefined;
};

export async function persistAssistantMessage(
  input: PersistAssistantMessageInput
): Promise<AssistantChatMessage> {
  const assistantMessage = await input.chatRepository.createMessage({
    chatId: input.chatId,
    assistantId: input.assistantId,
    author: "assistant",
    content: input.content,
    ...(input.discoveredFileRefIds !== undefined && input.discoveredFileRefIds.length > 0
      ? { metadata: { discoveredFileRefIds: input.discoveredFileRefIds } }
      : {})
  });

  if (
    input.assistantMediaJobService !== undefined &&
    input.sourceUserMessageId !== undefined &&
    input.sourceUserMessageId !== null &&
    (input.deferredMediaJobCount ?? 0) > 0
  ) {
    await input.assistantMediaJobService.attachAcknowledgementMessageId({
      assistantId: input.assistantId,
      sourceUserMessageId: input.sourceUserMessageId,
      assistantAcknowledgementMessageId: assistantMessage.id
    });
  }

  return assistantMessage;
}
