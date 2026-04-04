import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  ASSISTANT_RUNTIME_ADAPTER,
  type AssistantRuntimeAdapter
} from "../assistant-runtime-adapter.types";
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository
} from "../../domain/assistant-chat-message-attachment.repository";
import type { AssistantChatMessageAttachment } from "../../domain/assistant-chat-message-attachment.entity";
import { MediaPreprocessorService } from "./media-preprocessor.service";
import {
  inferAttachmentTypeFromMime,
  type InboundMediaResolveParams,
  type ResolvedInboundMedia
} from "./media.types";
import { ResolveAssistantRuntimeTierService } from "../resolve-assistant-runtime-tier.service";

@Injectable()
export class InboundMediaService {
  private readonly logger = new Logger(InboundMediaService.name);

  constructor(
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly runtimeAdapter: AssistantRuntimeAdapter,
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    private readonly preprocessor: MediaPreprocessorService,
    private readonly resolveAssistantRuntimeTierService: ResolveAssistantRuntimeTierService
  ) {}

  async resolve(params: InboundMediaResolveParams): Promise<ResolvedInboundMedia> {
    if (params.rawAttachments.length === 0) {
      return { attachments: [], enrichedMessage: params.userMessage };
    }

    const attachments: AssistantChatMessageAttachment[] = [];
    const contextLines: string[] = [];
    const runtimeTier = await this.resolveAssistantRuntimeTierService.resolveByAssistantId(
      params.assistantId
    );

    for (const raw of params.rawAttachments) {
      try {
        const processed = await this.preprocessor.process(
          raw.buffer,
          raw.mime,
          raw.originalFilename,
          params.assistantId
        );

        const uploadResult = await this.runtimeAdapter.uploadChatMedia({
          assistantId: params.assistantId,
          runtimeTier,
          chatId: params.chatId,
          messageId: params.messageId,
          fileBuffer: processed.normalizedBuffer,
          mimeType: processed.normalizedMime
        });

        const attachmentType = inferAttachmentTypeFromMime(processed.normalizedMime);

        const attachment = await this.attachmentRepository.create({
          messageId: params.messageId,
          chatId: params.chatId,
          assistantId: params.assistantId,
          workspaceId: params.workspaceId,
          attachmentType,
          storagePath: uploadResult.storagePath,
          originalFilename: raw.originalFilename || null,
          mimeType: processed.normalizedMime,
          sizeBytes: BigInt(uploadResult.sizeBytes),
          durationMs: processed.durationMs,
          width: processed.width,
          height: processed.height,
          processingStatus: "ready",
          transcription: processed.transcription,
          metadata: {
            source: raw.source,
            ...(processed.textExtract ? { textExtract: "stored" } : {})
          }
        });

        attachments.push(attachment);
        contextLines.push(
          this.formatContextLine(attachment, processed.transcription, processed.textExtract)
        );
      } catch (err) {
        this.logger.warn(
          `Failed to process inbound attachment "${raw.originalFilename}": ${String(err)}`
        );
      }
    }

    const enrichedMessage = this.buildEnrichedMessage(
      params.userMessage,
      contextLines,
      attachments.some((attachment) => attachment.attachmentType === "image")
    );

    return { attachments, enrichedMessage };
  }

  /**
   * Build the context block for already-persisted attachments (e.g., web
   * staged uploads that were created before the turn was sent).
   */
  async buildContextForExistingAttachments(chatId: string): Promise<string | null> {
    try {
      const attachments = await this.attachmentRepository.listByChatId(chatId);
      const ready = attachments.filter((a) => a.processingStatus === "ready");
      if (ready.length === 0) return null;

      const lines = ready.map((attachment) =>
        this.formatContextLine(attachment, attachment.transcription, null)
      );

      return this.buildAttachmentBlock(
        "Files available in your workspace",
        lines,
        ready.some((attachment) => attachment.attachmentType === "image")
      );
    } catch {
      return null;
    }
  }

  private formatContextLine(
    attachment: AssistantChatMessageAttachment,
    transcription: string | null,
    textExtract: string | null
  ): string {
    const name = attachment.originalFilename ? ` "${attachment.originalFilename}"` : "";
    const extras: string[] = [];

    if (transcription) {
      extras.push(`transcription: "${transcription.slice(0, 500)}"`);
    }
    if (textExtract) {
      const preview = textExtract.slice(0, 1000).replace(/\n/g, " ");
      extras.push(`content preview: "${preview}"`);
    }

    const extrasStr = extras.length > 0 ? ", " + extras.join(", ") : "";
    return `- media/${attachment.storagePath} (${attachment.attachmentType}${name}${extrasStr})`;
  }

  private buildEnrichedMessage(
    userMessage: string,
    contextLines: string[],
    hasImageAttachments: boolean
  ): string {
    if (contextLines.length === 0) return userMessage;

    const block = this.buildAttachmentBlock(
      "Files attached by user",
      contextLines,
      hasImageAttachments
    );

    return `${block}\n${userMessage}`;
  }

  private buildAttachmentBlock(
    title: string,
    contextLines: string[],
    hasImageAttachments: boolean
  ): string {
    const lines = [`[${title}:`, ...contextLines];
    if (hasImageAttachments) {
      lines.push(
        "If any attached file is an image, inspect it with the image tool before answering. Do not guess from the filename or path alone."
      );
    }
    lines.push("You can read or reference them by their path.]");
    return lines.join("\n");
  }
}
