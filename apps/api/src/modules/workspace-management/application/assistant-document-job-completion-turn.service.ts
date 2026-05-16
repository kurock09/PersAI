import { Inject, Injectable, Logger } from "@nestjs/common";
import type { RuntimeOutputArtifact } from "@persai/runtime-contract";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { EnsureAssistantMaterializedSpecCurrentService } from "./ensure-assistant-materialized-spec-current.service";
import { InternalRuntimeDocumentJobClientService } from "./internal-runtime-document-job.client.service";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";

const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 500;

type DocumentJobCompletionInput = {
  id: string;
  docId: string;
  versionId: string;
  assistantId: string;
  workspaceId: string;
  chatId: string;
  surface: "web" | "telegram";
  outputFormat: "pdf" | "pptx";
  descriptorMode:
    | "create_pdf_document"
    | "create_presentation"
    | "revise_document"
    | "export_or_redeliver";
  sourceUserMessageId: string;
  sourceUserMessageText: string;
  sourceUserMessageCreatedAt: string;
  resultText: string | null;
  artifacts: RuntimeOutputArtifact[];
};

@Injectable()
export class AssistantDocumentJobCompletionTurnService {
  private readonly logger = new Logger(AssistantDocumentJobCompletionTurnService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    private readonly ensureAssistantMaterializedSpecCurrentService: EnsureAssistantMaterializedSpecCurrentService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly internalRuntimeDocumentJobClientService: InternalRuntimeDocumentJobClientService
  ) {}

  async maybeFrame(input: DocumentJobCompletionInput): Promise<string | null> {
    let context: Awaited<
      ReturnType<AssistantDocumentJobCompletionTurnService["loadFramingContext"]>
    >;
    try {
      context = await this.loadFramingContext(input.assistantId, input.chatId);
    } catch (error) {
      this.logger.warn(
        `Skipping LLM document completion framing for job ${input.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }

    const outcome = await this.internalRuntimeDocumentJobClientService.complete({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      runtimeTier: context.runtimeTier,
      runtimeBundleDocument: context.runtimeBundleDocument,
      job: {
        id: input.id,
        docId: input.docId,
        versionId: input.versionId,
        surface: input.surface,
        chatId: input.chatId,
        outputFormat: input.outputFormat,
        descriptorMode: input.descriptorMode,
        sourceUserMessageId: input.sourceUserMessageId,
        sourceUserMessageText: input.sourceUserMessageText,
        sourceUserMessageCreatedAt: input.sourceUserMessageCreatedAt
      },
      currentHistory: context.history,
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
      this.logger.warn(
        `Document completion framing call failed for job ${input.id}: ${outcome.message}`
      );
      return null;
    }
    const text = outcome.result.assistantText?.trim() ?? "";
    return text.length === 0 ? null : text;
  }

  private async loadFramingContext(
    assistantId: string,
    chatId: string
  ): Promise<{
    runtimeTier: Parameters<InternalRuntimeDocumentJobClientService["complete"]>[0]["runtimeTier"];
    runtimeBundleDocument: string;
    history: Array<{
      author: "user" | "assistant" | "system";
      content: string;
      createdAt: string;
    }>;
  }> {
    const assistant = await this.assistantRepository.findById(assistantId);
    if (assistant === null) {
      throw new Error("Assistant not found for document-job framing.");
    }
    const spec = await this.ensureAssistantMaterializedSpecCurrentService.resolveCurrent(assistant);
    if (spec?.runtimeBundleDocument === null || spec?.runtimeBundleDocument === undefined) {
      throw new Error("Assistant runtime bundle is not materialized for document-job framing.");
    }
    const runtimeContext =
      await this.resolveAssistantInboundRuntimeContextService.resolveByAssistantId(assistantId);
    const history = await this.assistantChatRepository.listMessagesByChatId(chatId);
    return {
      runtimeTier: runtimeContext.runtimeTier,
      runtimeBundleDocument: spec.runtimeBundleDocument,
      history: history.slice(-MAX_HISTORY_MESSAGES).map((message) => ({
        author: message.author,
        content: message.content.slice(0, MAX_HISTORY_CHARS),
        createdAt: message.createdAt.toISOString()
      }))
    };
  }
}
