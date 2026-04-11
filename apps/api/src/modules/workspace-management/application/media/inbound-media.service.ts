import { Inject, Injectable, Logger } from "@nestjs/common";
import { PlatformHttpMetricsService } from "../../../platform-core/application/platform-http-metrics.service";
import { ASSISTANT_RUNTIME_FACADE, type AssistantRuntimeFacade } from "../assistant-runtime.facade";
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
import { TrackWorkspaceQuotaUsageService } from "../track-workspace-quota-usage.service";
import { validatePersaiMediaFile } from "./media-security-policy";

class MediaStorageQuotaExceededError extends Error {
  constructor(
    public readonly usedMb: number,
    public readonly limitMb: number | null
  ) {
    super(
      limitMb !== null
        ? `Media storage full: ${usedMb} MB used out of ${limitMb} MB.`
        : "Media storage quota exceeded."
    );
  }
}

@Injectable()
export class InboundMediaService {
  private readonly logger = new Logger(InboundMediaService.name);

  constructor(
    @Inject(ASSISTANT_RUNTIME_FACADE)
    private readonly assistantRuntime: AssistantRuntimeFacade,
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    private readonly preprocessor: MediaPreprocessorService,
    private readonly resolveAssistantRuntimeTierService: ResolveAssistantRuntimeTierService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly platformHttpMetricsService: PlatformHttpMetricsService
  ) {}

  async resolve(params: InboundMediaResolveParams): Promise<ResolvedInboundMedia> {
    if (params.rawAttachments.length === 0) {
      return { attachments: [], enrichedMessage: params.userMessage, systemNotices: [] };
    }

    const attachments: AssistantChatMessageAttachment[] = [];
    const contextLines: string[] = [];
    const failureNotices: string[] = [];
    const systemNotices: string[] = [];
    const runtimeTier = await this.resolveAssistantRuntimeTierService.resolveByAssistantId(
      params.assistantId
    );

    const wsLimits = await this.trackWorkspaceQuotaUsageService.resolveWorkspaceStorageLimit({
      id: params.assistantId,
      userId: params.userId,
      workspaceId: params.workspaceId
    } as Parameters<typeof this.trackWorkspaceQuotaUsageService.resolveWorkspaceStorageLimit>[0]);
    if (wsLimits.limitBytes !== null) {
      const wsUsage = await this.assistantRuntime.getWorkspaceStorageUsage(
        params.assistantId,
        runtimeTier
      );
      if (wsUsage.usedBytes >= Number(wsLimits.limitBytes)) {
        const usedMb = Math.round((wsUsage.usedBytes / 1_048_576) * 10) / 10;
        const limitMb = Math.round((Number(wsLimits.limitBytes) / 1_048_576) * 10) / 10;
        const sysNotice = `⚠ Workspace disk is full (${usedMb} MB / ${limitMb} MB). Delete old chats or files to free space.`;
        systemNotices.push(sysNotice);
        failureNotices.push(
          `[System: The workspace disk is full (${usedMb} MB / ${limitMb} MB). The user's file "${params.rawAttachments[0]?.originalFilename ?? "attachment"}" could not be saved. Please tell the user that the workspace storage is full and suggest deleting old files or chats to free space.]`
        );
        const enrichedMessage = this.buildEnrichedMessage(
          params.userMessage,
          contextLines,
          false,
          failureNotices
        );
        return { attachments, enrichedMessage, systemNotices };
      }
    }

    for (const raw of params.rawAttachments) {
      const startedAt = process.hrtime.bigint();
      let outcome: "success" | "failure" = "failure";
      try {
        const validated = await validatePersaiMediaFile({
          buffer: raw.buffer,
          mimeType: raw.mime,
          originalFilename: raw.originalFilename,
          surface: "channel_inbound"
        });
        const processed = await this.preprocessor.process(
          raw.buffer,
          validated.effectiveMimeType,
          raw.originalFilename,
          params.assistantId
        );

        const uploadResult = await this.assistantRuntime.uploadChatMedia({
          assistantId: params.assistantId,
          runtimeTier,
          chatId: params.chatId,
          messageId: params.messageId,
          fileBuffer: processed.normalizedBuffer,
          mimeType: processed.normalizedMime
        });

        const applied = await this.trackWorkspaceQuotaUsageService.recordMediaUpload({
          assistant: {
            id: params.assistantId,
            userId: params.userId,
            workspaceId: params.workspaceId
          } as Parameters<
            typeof this.trackWorkspaceQuotaUsageService.recordMediaUpload
          >[0]["assistant"],
          sizeBytes: BigInt(uploadResult.sizeBytes),
          source: `channel_inbound_${params.channel}`
        });

        if (applied.capped) {
          await this.assistantRuntime.deleteChatMedia(
            params.assistantId,
            uploadResult.storagePath,
            runtimeTier
          );
          const released = await this.trackWorkspaceQuotaUsageService.releaseMediaStorage({
            assistant: {
              id: params.assistantId,
              userId: params.userId,
              workspaceId: params.workspaceId
            } as Parameters<
              typeof this.trackWorkspaceQuotaUsageService.releaseMediaStorage
            >[0]["assistant"],
            sizeBytes: applied.appliedDelta,
            source: `channel_inbound_${params.channel}_rollback`
          });
          const usedMb =
            Math.round((Number(released.state.mediaStorageBytesUsed) / 1_048_576) * 10) / 10;
          const limitMb =
            released.state.mediaStorageBytesLimit !== null
              ? Math.round((Number(released.state.mediaStorageBytesLimit) / 1_048_576) * 10) / 10
              : null;
          throw new MediaStorageQuotaExceededError(usedMb, limitMb);
        }

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
        outcome = "success";
      } catch (err) {
        this.logger.warn(
          `Failed to process inbound attachment "${raw.originalFilename}": ${String(err)}`
        );
        const notice = this.renderInboundAttachmentFailureNotice(
          params.channel,
          raw.originalFilename,
          err
        );
        if (notice !== null) {
          failureNotices.push(notice);
        }
        if (err instanceof MediaStorageQuotaExceededError) {
          const sysNotice =
            err.limitMb !== null
              ? `⚠ Media storage is full (${err.usedMb} MB / ${err.limitMb} MB). Delete old chats or files to free space.`
              : "⚠ Media storage limit reached. Delete old chats or files to free space.";
          systemNotices.push(sysNotice);
        }
      } finally {
        const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        this.platformHttpMetricsService.recordMediaStage({
          stage: "inbound_resolve",
          channel: params.channel,
          outcome,
          latencyMs: Number(latencyMs.toFixed(2))
        });
      }
    }

    const enrichedMessage = this.buildEnrichedMessage(
      params.userMessage,
      contextLines,
      attachments.some((attachment) => attachment.attachmentType === "image"),
      failureNotices
    );

    return { attachments, enrichedMessage, systemNotices };
  }

  /**
   * Build the context block for attachments belonging to the current user
   * message only. Staged uploads are merged onto the message by
   * MergeStagedWebChatAttachmentsService before this method runs, so
   * querying by messageId is sufficient.
   */
  async buildContextForCurrentMessageAttachments(messageId: string): Promise<string | null> {
    try {
      const attachments = await this.attachmentRepository.listByMessageId(messageId);
      const ready = attachments.filter((a) => a.processingStatus === "ready");
      if (ready.length === 0) return null;

      const seen = new Set<string>();
      const deduped = ready.filter((a) => {
        if (seen.has(a.storagePath)) return false;
        seen.add(a.storagePath);
        return true;
      });

      const lines = deduped.map((attachment) =>
        this.formatContextLine(attachment, attachment.transcription, null)
      );

      return this.buildAttachmentBlock(
        "Files attached by user",
        lines,
        deduped.some((attachment) => attachment.attachmentType === "image")
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
    hasImageAttachments: boolean,
    failureNotices: string[]
  ): string {
    if (contextLines.length === 0 && failureNotices.length === 0) {
      return userMessage;
    }

    const blocks: string[] = [];

    if (failureNotices.length > 0) {
      blocks.push(
        [
          "[Attachment processing notes:",
          ...failureNotices,
          "Briefly explain these upload issues to the user before answering the rest of the message.]"
        ].join("\n")
      );
    }

    if (contextLines.length > 0) {
      blocks.push(
        this.buildAttachmentBlock("Files attached by user", contextLines, hasImageAttachments)
      );
    }

    const baseMessage = userMessage.trim().length > 0 ? userMessage : "User sent attachments only.";
    return `${blocks.join("\n")}\n${baseMessage}`;
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

  private renderInboundAttachmentFailureNotice(
    channel: InboundMediaResolveParams["channel"],
    originalFilename: string,
    error: unknown
  ): string | null {
    if (channel !== "telegram" && channel !== "whatsapp" && channel !== "vk") {
      return null;
    }

    const filename = originalFilename.trim().length > 0 ? `"${originalFilename}"` : "The file";

    if (error instanceof MediaStorageQuotaExceededError) {
      const usage =
        error.limitMb !== null ? ` (${error.usedMb} MB used out of ${error.limitMb} MB)` : "";
      return (
        `- ${filename} was not uploaded because the media storage limit was reached${usage}. ` +
        "Politely tell the user how much storage is used and that they need to delete old chats or files to free up space before uploading again."
      );
    }

    return `- ${filename} could not be processed, so continue without that attachment and tell the user it was not accepted.`;
  }
}
