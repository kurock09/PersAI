import type { AssistantChatMessage } from "../domain/assistant-chat-message.entity";
import type { AssistantChatRepository } from "../domain/assistant-chat.repository";
import type { AssistantMediaJobService } from "./workspace-media-job.service";
import type { ProviderGatewayToolExchange } from "@persai/runtime-contract";
import {
  stripToolInvocationsForClient,
  type ClientRuntimeTurnToolInvocation
} from "./strip-tool-invocations-for-client";

type PersistAssistantMessageInput = {
  chatRepository: Pick<AssistantChatRepository, "createMessage">;
  assistantMediaJobService?: Pick<AssistantMediaJobService, "attachAcknowledgementMessageId">;
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

  const assistantMessage = await input.chatRepository.createMessage({
    chatId: input.chatId,
    assistantId: input.assistantId,
    author: "assistant",
    content: input.content,
    ...(metadata !== undefined ? { metadata } : {}),
    ...(input.toolExchanges !== undefined && input.toolExchanges.length > 0
      ? { toolExchanges: input.toolExchanges }
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
