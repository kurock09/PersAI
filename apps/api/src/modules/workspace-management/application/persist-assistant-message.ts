import type { AssistantChatMessage } from "../domain/assistant-chat-message.entity";
import type { AssistantChatRepository } from "../domain/assistant-chat.repository";
import type { AssistantMediaJobService } from "./workspace-media-job.service";
import type { ProviderGatewayToolExchange } from "@persai/runtime-contract";
import {
  stripToolInvocationsForClient,
  type ClientRuntimeTurnToolInvocation
} from "./strip-tool-invocations-for-client";

type PersistAssistantMessageInput = {
  chatRepository: Pick<
    AssistantChatRepository,
    "createMessage" | "updateMessageContent" | "findMessageByIdForAssistant"
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
  workingNotes?: string[] | undefined;
  toolInvocations?: readonly ClientRuntimeTurnToolInvocation[] | undefined;
  toolExchanges?: readonly ProviderGatewayToolExchange[] | undefined;
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
  const hasWorkingNotes = Array.isArray(input.workingNotes) && input.workingNotes.length > 0;
  const hasToolInvocations =
    Array.isArray(input.toolInvocations) && input.toolInvocations.length > 0;
  const hasSourceUserMessageId =
    typeof input.sourceUserMessageId === "string" && input.sourceUserMessageId.length > 0;
  const resolvedStatus = input.truncatedStatus ?? input.partialStatus;
  const hasStatus = resolvedStatus !== undefined;
  const metadata: Record<string, unknown> | undefined =
    hasFileRefs || hasWorkingNotes || hasToolInvocations || hasStatus || hasSourceUserMessageId
      ? {
          ...(hasSourceUserMessageId ? { sourceUserMessageId: input.sourceUserMessageId } : {}),
          ...(hasFileRefs ? { discoveredFilePaths: input.discoveredFilePaths } : {}),
          ...(hasWorkingNotes ? { workingNotes: input.workingNotes } : {}),
          ...(hasToolInvocations
            ? { toolInvocations: stripToolInvocationsForClient(input.toolInvocations ?? []) }
            : {}),
          ...(hasStatus ? { status: resolvedStatus } : {})
        }
      : undefined;

  const findPinnedDeliveryMessageId =
    input.assistantMediaJobService?.findPinnedDeliveryMessageId?.bind(
      input.assistantMediaJobService
    ) ?? null;
  const pinnedDeliveryMessageId =
    findPinnedDeliveryMessageId !== null && hasSourceUserMessageId
      ? await findPinnedDeliveryMessageId({
          assistantId: input.assistantId,
          sourceUserMessageId: input.sourceUserMessageId as string
        })
      : null;

  let assistantMessage: AssistantChatMessage | null = null;
  if (pinnedDeliveryMessageId !== null) {
    // Mid-turn media delivery may have already created the bubble (often with
    // empty ADR-157 image text + attachments). Reuse it for chat-model narration
    // instead of inventing a sibling orphan message.
    assistantMessage = await input.chatRepository.updateMessageContent(
      pinnedDeliveryMessageId,
      input.assistantId,
      input.content
    );
    if (assistantMessage === null) {
      assistantMessage = await input.chatRepository.findMessageByIdForAssistant(
        pinnedDeliveryMessageId,
        input.assistantId
      );
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
