import { Inject, Injectable, Logger } from "@nestjs/common";
import type { RuntimeOutputArtifact, RuntimeUsageSnapshot } from "@persai/runtime-contract";
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

type MediaJobFailureFramingInput = {
  id: string;
  assistantId: string;
  workspaceId: string;
  chatId: string;
  surface: "web" | "telegram";
  kind: "image" | "audio" | "video";
  sourceUserMessageId: string;
  sourceUserMessageText: string;
  sourceUserMessageCreatedAt: string;
  failure: {
    code: string | null;
    message: string;
    attemptCount: number;
    maxAttempts: number;
    retryable: boolean;
    stage: "execution" | "delivery";
  };
};

@Injectable()
export class AssistantMediaJobCompletionTurnService {
  private readonly logger = new Logger(AssistantMediaJobCompletionTurnService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    private readonly ensureAssistantMaterializedSpecCurrentService: EnsureAssistantMaterializedSpecCurrentService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly internalRuntimeMediaJobClientService: InternalRuntimeMediaJobClientService
  ) {}

  async maybeFrame(input: MediaJobCompletionInput): Promise<{
    text: string | null;
    usage: RuntimeUsageSnapshot | null;
  }> {
    const context = await this.loadFramingContext(input.assistantId, input.chatId);

    const outcome = await this.internalRuntimeMediaJobClientService.complete({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      runtimeTier: context.runtimeTier,
      runtimeBundleDocument: context.runtimeBundleDocument,
      job: {
        id: input.id,
        surface: input.surface,
        kind: input.kind,
        chatId: input.chatId,
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
      throw new Error(outcome.message);
    }
    return {
      text: outcome.result.assistantText,
      usage: outcome.result.usage
    };
  }

  /**
   * Ask the LLM to author a user-facing explanation for a failed media job,
   * using the same runtime seam as the success path. Returns null if the
   * runtime call itself fails or returns empty text — callers must apply
   * their own fallback copy.
   */
  async maybeFrameFailure(input: MediaJobFailureFramingInput): Promise<string | null> {
    let context: Awaited<ReturnType<AssistantMediaJobCompletionTurnService["loadFramingContext"]>>;
    try {
      context = await this.loadFramingContext(input.assistantId, input.chatId);
    } catch (error) {
      this.logger.warn(
        `Skipping LLM failure-framing for media job ${input.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }

    const outcome = await this.internalRuntimeMediaJobClientService.complete({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      runtimeTier: context.runtimeTier,
      runtimeBundleDocument: context.runtimeBundleDocument,
      job: {
        id: input.id,
        surface: input.surface,
        kind: input.kind,
        chatId: input.chatId,
        sourceUserMessageId: input.sourceUserMessageId,
        sourceUserMessageText: input.sourceUserMessageText,
        sourceUserMessageCreatedAt: input.sourceUserMessageCreatedAt
      },
      currentHistory: context.history,
      failure: input.failure
    });

    if (!outcome.ok) {
      this.logger.warn(
        `LLM failure-framing call failed for media job ${input.id}: ${outcome.message}`
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
    runtimeTier: Parameters<InternalRuntimeMediaJobClientService["complete"]>[0]["runtimeTier"];
    runtimeBundleDocument: string;
    history: Array<{
      author: "user" | "assistant" | "system";
      content: string;
      createdAt: string;
    }>;
  }> {
    const assistant = await this.assistantRepository.findById(assistantId);
    if (assistant === null) {
      throw new Error("Assistant not found for media-job framing.");
    }
    const spec = await this.ensureAssistantMaterializedSpecCurrentService.resolveCurrent(assistant);
    if (spec?.runtimeBundleDocument === null || spec?.runtimeBundleDocument === undefined) {
      throw new Error("Assistant runtime bundle is not materialized for media-job framing.");
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
