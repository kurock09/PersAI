import { Inject, Injectable } from "@nestjs/common";
import type { RuntimeOutputArtifact } from "@persai/runtime-contract";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { EnsureAssistantMaterializedSpecCurrentService } from "./ensure-assistant-materialized-spec-current.service";
import { InternalRuntimeMediaJobClientService } from "./internal-runtime-media-job.client.service";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";

const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 500;

type MediaJobCompletionInput = {
  id: string;
  assistantId: string;
  workspaceId: string;
  chatId: string;
  surface: "web" | "telegram";
  kind: "image" | "audio" | "video";
  sourceUserMessageId: string;
  sourceUserMessageText: string;
  sourceUserMessageCreatedAt: string;
  resultText: string | null;
  artifacts: RuntimeOutputArtifact[];
};

@Injectable()
export class AssistantMediaJobCompletionTurnService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    private readonly ensureAssistantMaterializedSpecCurrentService: EnsureAssistantMaterializedSpecCurrentService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly internalRuntimeMediaJobClientService: InternalRuntimeMediaJobClientService
  ) {}

  async maybeFrame(input: MediaJobCompletionInput): Promise<string | null> {
    const assistant = await this.assistantRepository.findById(input.assistantId);
    if (assistant === null) {
      throw new Error("Assistant not found for media-job completion.");
    }
    const spec = await this.ensureAssistantMaterializedSpecCurrentService.resolveCurrent(assistant);
    if (spec?.runtimeBundleDocument === null || spec?.runtimeBundleDocument === undefined) {
      throw new Error("Assistant runtime bundle is not materialized for media-job completion.");
    }
    const runtimeContext =
      await this.resolveAssistantInboundRuntimeContextService.resolveByAssistantId(
        input.assistantId
      );
    const history = await this.assistantChatRepository.listMessagesByChatId(input.chatId);

    const outcome = await this.internalRuntimeMediaJobClientService.complete({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      runtimeTier: runtimeContext.runtimeTier,
      runtimeBundleDocument: spec.runtimeBundleDocument,
      job: {
        id: input.id,
        surface: input.surface,
        kind: input.kind,
        chatId: input.chatId,
        sourceUserMessageId: input.sourceUserMessageId,
        sourceUserMessageText: input.sourceUserMessageText,
        sourceUserMessageCreatedAt: input.sourceUserMessageCreatedAt
      },
      currentHistory: history.slice(-MAX_HISTORY_MESSAGES).map((message) => ({
        author: message.author,
        content: message.content.slice(0, MAX_HISTORY_CHARS),
        createdAt: message.createdAt.toISOString()
      })),
      workerResult: {
        assistantText: input.resultText,
        artifacts: input.artifacts.map((artifact) => ({
          type: artifact.kind,
          filename: artifact.filename ?? null,
          fileRef: artifact.fileRef ?? null
        }))
      }
    });

    if (!outcome.ok) {
      throw new Error(outcome.message);
    }
    return outcome.result.assistantText;
  }
}
