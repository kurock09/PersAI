import type { AssistantChatMessage } from "../domain/assistant-chat-message.entity";
import type { AssistantChatRepository } from "../domain/assistant-chat.repository";
import type { AssistantMediaJobService } from "./workspace-media-job.service";
import type { ProviderGatewayToolExchange } from "@persai/runtime-contract";

type PersistAssistantMessageInput = {
  chatRepository: Pick<
    AssistantChatRepository,
    | "createMessage"
    | "updateMessageContent"
    | "findMessageByIdForAssistant"
    | "mergeMessageMetadata"
  >;
  assistantMediaJobService?: Pick<
    AssistantMediaJobService,
    "attachAcknowledgementMessageId" | "findPinnedDeliveryMessageId"
  >;
  chatId: string;
  assistantId: string;
  content: string;
  discoveredFilePaths?: string[] | undefined;
  deferredMediaJobCount?: number | undefined;
  sourceUserMessageId?: string | null | undefined;
  toolExchanges?: readonly ProviderGatewayToolExchange[] | undefined;
  /** ADR-165 — reuse an early mid-stream live assistant message when present. */
  reuseMessageId?: string | null | undefined;
  /** "partial" when the turn was aborted / stalled before a completed event arrived. */
  partialStatus?: "partial" | undefined;
  /** ADR-122 Slice 3: "truncated" when the provider stopped due to the output-token ceiling. */
  truncatedStatus?: "truncated" | undefined;
};

export async function persistAssistantMessage(
  input: PersistAssistantMessageInput
): Promise<AssistantChatMessage> {
  const hasFileRefs =
    input.discoveredFilePaths !== undefined && input.discoveredFilePaths.length > 0;
  const hasSourceUserMessageId =
    typeof input.sourceUserMessageId === "string" && input.sourceUserMessageId.length > 0;
  const resolvedStatus = input.truncatedStatus ?? input.partialStatus;
  const hasStatus = resolvedStatus !== undefined;
  const metadata: Record<string, unknown> | undefined =
    hasFileRefs || hasStatus || hasSourceUserMessageId
      ? {
          ...(hasSourceUserMessageId ? { sourceUserMessageId: input.sourceUserMessageId } : {}),
          ...(hasFileRefs ? { discoveredFilePaths: input.discoveredFilePaths } : {}),
          ...(hasStatus ? { status: resolvedStatus } : {})
        }
      : undefined;

  const explicitReuseMessageId =
    typeof input.reuseMessageId === "string" && input.reuseMessageId.trim().length > 0
      ? input.reuseMessageId.trim()
      : null;

  const findPinnedDeliveryMessageId =
    input.assistantMediaJobService?.findPinnedDeliveryMessageId?.bind(
      input.assistantMediaJobService
    ) ?? null;
  const pinnedDeliveryMessageId =
    explicitReuseMessageId === null &&
    findPinnedDeliveryMessageId !== null &&
    hasSourceUserMessageId
      ? await findPinnedDeliveryMessageId({
          assistantId: input.assistantId,
          sourceUserMessageId: input.sourceUserMessageId as string
        })
      : null;

  const reuseMessageId = explicitReuseMessageId ?? pinnedDeliveryMessageId;

  let assistantMessage: AssistantChatMessage | null = null;
  if (reuseMessageId !== null) {
    // Mid-turn media delivery may have already created the bubble (often with
    // empty ADR-157/ADR-165 image text + attachments). Reuse it for chat-model
    // narration instead of inventing a sibling orphan message.
    assistantMessage = await input.chatRepository.updateMessageContent(
      reuseMessageId,
      input.assistantId,
      input.content
    );
    if (assistantMessage === null) {
      assistantMessage = await input.chatRepository.findMessageByIdForAssistant(
        reuseMessageId,
        input.assistantId
      );
    }
    if (assistantMessage !== null && metadata !== undefined) {
      const merged = await input.chatRepository.mergeMessageMetadata(
        assistantMessage.id,
        input.assistantId,
        metadata
      );
      if (merged !== null) {
        assistantMessage = merged;
      }
    }
  }

  if (assistantMessage === null) {
    assistantMessage = await input.chatRepository.createMessage({
      chatId: input.chatId,
      assistantId: input.assistantId,
      author: "assistant",
      content: input.content,
      ...(metadata !== undefined ? { metadata } : {}),
      ...(input.toolExchanges !== undefined && input.toolExchanges.length > 0
        ? { toolExchanges: input.toolExchanges }
        : {})
    });
  }

  if (
    input.assistantMediaJobService !== undefined &&
    input.sourceUserMessageId !== undefined &&
    input.sourceUserMessageId !== null &&
    ((input.deferredMediaJobCount ?? 0) > 0 || pinnedDeliveryMessageId !== null)
  ) {
    await input.assistantMediaJobService.attachAcknowledgementMessageId({
      assistantId: input.assistantId,
      sourceUserMessageId: input.sourceUserMessageId,
      assistantAcknowledgementMessageId: assistantMessage.id
    });
  }

  return assistantMessage;
}
