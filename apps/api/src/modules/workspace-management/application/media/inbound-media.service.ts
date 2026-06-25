import { Inject, Injectable, Logger } from "@nestjs/common";
import { PlatformHttpMetricsService } from "../../../platform-core/application/platform-http-metrics.service";
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository
} from "../../domain/assistant-chat-message-attachment.repository";
import type { AssistantChatMessageAttachment } from "../../domain/assistant-chat-message-attachment.entity";
import { MediaPreprocessorService } from "./media-preprocessor.service";
import {
  buildStoredAttachmentMetadata,
  inferAttachmentTypeFromMime,
  readStoredAttachmentContentPreview,
  readStoredAttachmentSemanticSummary,
  type InboundMediaResolveParams,
  type ResolvedInboundMedia
} from "./media.types";
import { TrackWorkspaceQuotaUsageService } from "../track-workspace-quota-usage.service";
import { validatePersaiMediaFile } from "./media-security-policy";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import { RegisterChatAttachmentService } from "../register-chat-attachment.service";
import { WorkspaceFileMetadataService } from "../workspace-file-metadata.service";
import { resolveUniqueWorkspaceInputStoragePath } from "../resolve-workspace-input-storage-path";

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
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    private readonly preprocessor: MediaPreprocessorService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly registerChatAttachmentService: RegisterChatAttachmentService,
    private readonly workspaceFileMetadataService: WorkspaceFileMetadataService,
    private readonly platformHttpMetricsService: PlatformHttpMetricsService
  ) {}

  async resolve(params: InboundMediaResolveParams): Promise<ResolvedInboundMedia> {
    if (params.rawAttachments.length === 0) {
      return { attachments: [], enrichedMessage: params.userMessage };
    }

    const attachments: AssistantChatMessageAttachment[] = [];
    const contextLines: string[] = [];
    const failureNotices: string[] = [];

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
          raw.originalFilename
        );

        const storagePath = await resolveUniqueWorkspaceInputStoragePath({
          workspaceId: params.workspaceId,
          filename: raw.originalFilename,
          mimeType: processed.normalizedMime,
          referenceId: params.messageId,
          workspaceFileMetadataService: this.workspaceFileMetadataService
        });
        const objectKey = this.mediaObjectStorage.buildWorkspaceObjectKey({
          workspaceId: params.workspaceId,
          workspaceRelPath: storagePath
        });
        const uploadResult = await this.mediaObjectStorage.saveObject({
          objectKey,
          buffer: processed.normalizedBuffer,
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
          await this.mediaObjectStorage.deleteObject(uploadResult.objectKey);
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

        let thumbnailStoragePath: string | null = null;
        let posterStoragePath: string | null = null;
        const normalizedMime = processed.normalizedMime;
        if (
          normalizedMime.startsWith("image/") &&
          normalizedMime !== "image/svg+xml" &&
          normalizedMime !== "image/gif"
        ) {
          const thumb = await this.preprocessor.createImageThumbnail(processed.normalizedBuffer);
          if (thumb !== null) {
            thumbnailStoragePath = `${storagePath}.thumb.webp`;
            await this.mediaObjectStorage.saveObject({
              objectKey: this.mediaObjectStorage.buildWorkspaceObjectKey({
                workspaceId: params.workspaceId,
                workspaceRelPath: thumbnailStoragePath
              }),
              buffer: thumb.buffer,
              mimeType: thumb.mimeType
            });
          }
        } else if (normalizedMime.startsWith("video/")) {
          const poster = await this.preprocessor.createVideoPoster(processed.normalizedBuffer);
          if (poster !== null) {
            posterStoragePath = `${storagePath}.poster.jpg`;
            await this.mediaObjectStorage.saveObject({
              objectKey: this.mediaObjectStorage.buildWorkspaceObjectKey({
                workspaceId: params.workspaceId,
                workspaceRelPath: posterStoragePath
              }),
              buffer: poster.buffer,
              mimeType: poster.mimeType
            });
          }
        }

        const attachmentType = inferAttachmentTypeFromMime(processed.normalizedMime);
        const metadata = buildStoredAttachmentMetadata({
          source: raw.source,
          textExtract: processed.textExtract,
          transcription: processed.transcription
        });
        const registered = await this.registerChatAttachmentService.execute({
          assistantId: params.assistantId,
          workspaceId: params.workspaceId,
          chatId: params.chatId,
          messageId: params.messageId,
          storagePath,
          attachmentType,
          mimeType: processed.normalizedMime,
          sizeBytes: uploadResult.sizeBytes,
          originalFilename: raw.originalFilename || "upload",
          kind: "user_upload",
          durationMs: processed.durationMs,
          width: processed.width,
          height: processed.height,
          transcription: processed.transcription,
          metadata,
          shortDescription: readStoredAttachmentSemanticSummary(metadata),
          thumbnailStoragePath,
          posterStoragePath
        });
        const attachment = (await this.attachmentRepository.findById(registered.attachmentId))!;

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

    return { attachments, enrichedMessage };
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
        if (a.storagePath === null || seen.has(a.storagePath)) return false;
        seen.add(a.storagePath);
        return true;
      });

      const lines = deduped.map((attachment) =>
        this.formatContextLine(
          attachment,
          attachment.transcription,
          readStoredAttachmentContentPreview(attachment.metadata)
        )
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
    return `- attachment (${attachment.attachmentType}${name}${extrasStr})`;
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
        "Image attachments are present. Do not guess visual details that are not described in the attachment metadata or user message."
      );
    }
    lines.push("Use the attachment metadata, transcription, and content preview when available.]");
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
      return (
        `- ${filename} was not uploaded. The storage system reported: "${error.message}". ` +
        "Tell the user this exact storage-limit result and ask them to delete old chats or files before uploading again."
      );
    }

    return `- ${filename} could not be processed, so continue without that attachment and tell the user it was not accepted.`;
  }
}
