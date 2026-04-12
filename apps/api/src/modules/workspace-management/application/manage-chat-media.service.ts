import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import { PlatformHttpMetricsService } from "../../platform-core/application/platform-http-metrics.service";
import { ApiErrorHttpException } from "../../platform-core/interface/http/api-error";
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository,
  type CreateAttachmentInput
} from "../domain/assistant-chat-message-attachment.repository";
import type { AssistantChatMessageAttachment } from "../domain/assistant-chat-message-attachment.entity";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import type { Assistant } from "../domain/assistant.entity";
import { MediaPreprocessorService } from "./media/media-preprocessor.service";
import { NativeMediaTranscriptionService } from "./media/native-media-transcription.service";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { validatePersaiMediaFile } from "./media/media-security-policy";
import { buildStoredAttachmentMetadata } from "./media/media.types";
import {
  createAssistantInboundConflict,
  createMediaStorageQuotaExceededError
} from "./assistant-inbound-error";

const AUDIO_MIMES_NEEDING_CONVERSION = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/opus",
  "audio/x-opus+ogg"
]);

function inferAttachmentType(mimeType: string): CreateAttachmentInput["attachmentType"] {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

@Injectable()
export class ManageChatMediaService {
  private readonly logger = new Logger(ManageChatMediaService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly chatRepository: AssistantChatRepository,
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    private readonly preprocessor: MediaPreprocessorService,
    private readonly nativeMediaTranscriptionService: NativeMediaTranscriptionService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly platformHttpMetricsService: PlatformHttpMetricsService
  ) {}

  async uploadAttachment(params: {
    userId: string;
    chatId: string;
    messageId: string;
    file: { buffer: Buffer; mimetype: string; originalname: string };
  }): Promise<AssistantChatMessageAttachment> {
    const validated = await validatePersaiMediaFile({
      buffer: params.file.buffer,
      mimeType: params.file.mimetype,
      originalFilename: params.file.originalname,
      surface: "chat_upload"
    });

    const assistant = await this.assistantRepository.findByUserId(params.userId);
    if (!assistant) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const chat = await this.chatRepository.findChatById(params.chatId);
    if (!chat || chat.assistantId !== assistant.id) {
      throw new NotFoundException("Chat does not exist for this assistant.");
    }

    const message = await this.chatRepository.findMessageByIdForAssistant(
      params.messageId,
      assistant.id
    );
    if (!message || message.chatId !== chat.id) {
      throw new NotFoundException("Message does not exist in this chat.");
    }
    const quotaCheck = await this.trackWorkspaceQuotaUsageService.checkMediaStorageQuota(assistant);
    if (!quotaCheck.allowed) {
      throw createMediaStorageQuotaExceededError(quotaCheck.usedBytes, quotaCheck.limitBytes);
    }

    const processed = await this.preprocessUploadBestEffort({
      buffer: params.file.buffer,
      mimeType: validated.effectiveMimeType,
      originalFilename: params.file.originalname,
      assistantId: assistant.id,
      logContext: "direct upload"
    });
    const fileBuffer = processed?.normalizedBuffer ?? params.file.buffer;
    const mimeType = processed?.normalizedMime ?? validated.effectiveMimeType;
    const objectKey = this.mediaObjectStorage.buildChatMessageObjectKey({
      assistantId: assistant.id,
      chatId: chat.id,
      messageId: message.id,
      extension: processed?.normalizedExtension ?? validated.normalizedExtension
    });
    const uploadResult = await this.mediaObjectStorage.saveObject({
      objectKey,
      buffer: fileBuffer,
      mimeType
    });

    const sizeBytes = BigInt(uploadResult.sizeBytes);
    await this.ensureMediaStorageQuotaApplied({
      assistant,
      objectKey: uploadResult.objectKey,
      sizeBytes,
      source: "chat_upload"
    });
    const attachment = await this.attachmentRepository.create({
      messageId: message.id,
      chatId: chat.id,
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      attachmentType: inferAttachmentType(mimeType),
      storagePath: uploadResult.objectKey,
      originalFilename: validated.originalFilename,
      mimeType: uploadResult.mimeType,
      sizeBytes,
      durationMs: processed?.durationMs ?? null,
      width: processed?.width ?? null,
      height: processed?.height ?? null,
      processingStatus: "ready",
      transcription: processed?.transcription ?? null,
      metadata: buildStoredAttachmentMetadata({
        source: "chat_upload",
        textExtract: processed?.textExtract ?? null
      })
    });

    return attachment;
  }

  async stageForWebThread(params: {
    userId: string;
    surfaceThreadKey: string;
    file: { buffer: Buffer; mimetype: string; originalname: string };
  }): Promise<{ chatId: string; messageId: string; attachment: AssistantChatMessageAttachment }> {
    const startedAt = process.hrtime.bigint();
    let outcome: "success" | "failure" = "failure";
    let assistant: Assistant | null = null;
    let stagingMessageId: string | null = null;
    let uploadedObjectKey: string | null = null;
    let reservedStorageBytes: bigint | null = null;
    try {
      const validated = await validatePersaiMediaFile({
        buffer: params.file.buffer,
        mimeType: params.file.mimetype,
        originalFilename: params.file.originalname,
        surface: "chat_upload"
      });

      assistant = await this.assistantRepository.findByUserId(params.userId);
      if (!assistant) {
        throw new NotFoundException("Assistant does not exist for this user.");
      }

      const config = loadApiConfig(process.env);
      const chatResult = await this.chatRepository.getOrCreateWebChatBySurfaceThreadUnderCap({
        assistantId: assistant.id,
        userId: assistant.userId,
        workspaceId: assistant.workspaceId,
        surface: "web",
        surfaceThreadKey: params.surfaceThreadKey,
        title: null,
        activeWebChatsLimit: config.WEB_ACTIVE_CHATS_CAP
      });
      if (chatResult.outcome === "cap_reached") {
        throw createAssistantInboundConflict(
          "active_chat_cap_reached",
          `Active web chats cap reached (${chatResult.limit}). Archive an existing chat or continue in an existing thread.`,
          { limit: chatResult.limit }
        );
      }
      const chat = chatResult.chat;

      const stagingMessage = await this.chatRepository.createMessage({
        chatId: chat.id,
        assistantId: assistant.id,
        author: "user",
        content: ""
      });
      stagingMessageId = stagingMessage.id;

      const processed = await this.preprocessUploadBestEffort({
        buffer: params.file.buffer,
        mimeType: validated.effectiveMimeType,
        originalFilename: params.file.originalname,
        assistantId: assistant.id,
        logContext: "staged upload"
      });

      const quotaCheck =
        await this.trackWorkspaceQuotaUsageService.checkMediaStorageQuota(assistant);
      if (!quotaCheck.allowed) {
        throw createMediaStorageQuotaExceededError(quotaCheck.usedBytes, quotaCheck.limitBytes);
      }

      const fileBuffer = processed?.normalizedBuffer ?? params.file.buffer;
      const mimeType = processed?.normalizedMime ?? validated.effectiveMimeType;
      const objectKey = this.mediaObjectStorage.buildChatMessageObjectKey({
        assistantId: assistant.id,
        chatId: chat.id,
        messageId: stagingMessage.id,
        extension: processed?.normalizedExtension ?? validated.normalizedExtension
      });
      const uploadResult = await this.mediaObjectStorage.saveObject({
        objectKey,
        buffer: fileBuffer,
        mimeType
      });
      uploadedObjectKey = uploadResult.objectKey;

      const sizeBytes = BigInt(uploadResult.sizeBytes);
      try {
        await this.ensureMediaStorageQuotaApplied({
          assistant,
          objectKey: uploadResult.objectKey,
          sizeBytes,
          source: "web_staged_upload"
        });
      } catch (error) {
        if (
          error instanceof ApiErrorHttpException &&
          error.errorObject.code === "media_storage_quota_exceeded"
        ) {
          uploadedObjectKey = null;
        }
        throw error;
      }
      reservedStorageBytes = sizeBytes;
      const attachment = await this.attachmentRepository.create({
        messageId: stagingMessage.id,
        chatId: chat.id,
        assistantId: assistant.id,
        workspaceId: assistant.workspaceId,
        attachmentType: inferAttachmentType(mimeType),
        storagePath: uploadResult.objectKey,
        originalFilename: validated.originalFilename,
        mimeType: uploadResult.mimeType,
        sizeBytes,
        durationMs: processed?.durationMs ?? null,
        width: processed?.width ?? null,
        height: processed?.height ?? null,
        processingStatus: "ready",
        transcription: processed?.transcription ?? null,
        metadata: buildStoredAttachmentMetadata({
          source: "web_staged_upload",
          textExtract: processed?.textExtract ?? null
        })
      });

      outcome = "success";
      return { chatId: chat.id, messageId: stagingMessage.id, attachment };
    } catch (error) {
      await this.rollbackFailedStagedUpload({
        assistant,
        stagingMessageId,
        uploadedObjectKey,
        reservedStorageBytes
      });
      throw error;
    } finally {
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      this.platformHttpMetricsService.recordMediaStage({
        stage: "web_stage_attachment",
        channel: "web",
        outcome,
        latencyMs: Number(latencyMs.toFixed(2))
      });
    }
  }

  async transcribeVoice(params: {
    userId: string;
    file: { buffer: Buffer; mimetype: string; originalname: string };
  }): Promise<{ text: string }> {
    const startedAt = process.hrtime.bigint();
    let outcome: "success" | "failure" = "failure";
    const validated = await validatePersaiMediaFile({
      buffer: params.file.buffer,
      mimeType: params.file.mimetype,
      originalFilename: params.file.originalname,
      surface: "voice_transcription"
    });

    const assistant = await this.assistantRepository.findByUserId(params.userId);
    if (!assistant) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    let fileBuffer = params.file.buffer;
    let mimeType = validated.effectiveMimeType;
    let transcriptionFilename = params.file.originalname;
    const baseMime = (mimeType.split(";")[0] ?? mimeType).trim();

    if (AUDIO_MIMES_NEEDING_CONVERSION.has(baseMime)) {
      try {
        fileBuffer = await this.convertAudioToMp3(fileBuffer);
        mimeType = "audio/mpeg";
        transcriptionFilename = this.replaceFilenameExtension(transcriptionFilename, "mp3");
      } catch (err) {
        this.logger.warn(
          `Audio conversion failed for "${validated.originalFilename ?? "voice-input"}", keeping original: ${String(err)}`
        );
      }
    }

    try {
      const result = await this.nativeMediaTranscriptionService.transcribe({
        buffer: fileBuffer,
        mimeType,
        filename: transcriptionFilename
      });
      const text = result.text.trim();
      if (text.length === 0) {
        throw new BadRequestException("Voice transcription returned empty text. Please try again.");
      }
      outcome = "success";
      return { text };
    } finally {
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      this.platformHttpMetricsService.recordMediaStage({
        stage: "stt_transcribe",
        channel: "voice_http",
        outcome,
        latencyMs: Number(latencyMs.toFixed(2))
      });
    }
  }

  private async convertAudioToMp3(buffer: Buffer): Promise<Buffer> {
    const { execFile } = await import("child_process");
    const { writeFile, readFile, unlink } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const { randomUUID } = await import("crypto");

    const id = randomUUID();
    const inputPath = join(tmpdir(), `persai-voice-in-${id}.webm`);
    const outputPath = join(tmpdir(), `persai-voice-out-${id}.mp3`);

    await writeFile(inputPath, buffer);

    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          "ffmpeg",
          ["-i", inputPath, "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k", outputPath, "-y"],
          { timeout: 30_000 },
          (err) => (err ? reject(err) : resolve())
        );
      });
      return await readFile(outputPath);
    } finally {
      await unlink(inputPath).catch(() => {});
      await unlink(outputPath).catch(() => {});
    }
  }

  private replaceFilenameExtension(filename: string, extension: string): string {
    const trimmed = filename.trim();
    if (trimmed.length === 0) {
      return `audio.${extension}`;
    }

    const lastSlash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    const lastDot = trimmed.lastIndexOf(".");
    if (lastDot > lastSlash) {
      return `${trimmed.slice(0, lastDot)}.${extension}`;
    }
    return `${trimmed}.${extension}`;
  }

  private async ensureMediaStorageQuotaApplied(params: {
    assistant: Assistant;
    objectKey: string;
    sizeBytes: bigint;
    source: "chat_upload" | "web_staged_upload";
  }): Promise<void> {
    const applied = await this.trackWorkspaceQuotaUsageService.recordMediaUpload({
      assistant: params.assistant,
      sizeBytes: params.sizeBytes,
      source: params.source
    });
    if (applied.capped) {
      await this.mediaObjectStorage.deleteObject(params.objectKey);
      const released = await this.trackWorkspaceQuotaUsageService.releaseMediaStorage({
        assistant: params.assistant,
        sizeBytes: applied.appliedDelta,
        source: `${params.source}_rollback`
      });
      throw createMediaStorageQuotaExceededError(
        released.state.mediaStorageBytesUsed,
        released.state.mediaStorageBytesLimit
      );
    }
  }

  private async rollbackFailedStagedUpload(input: {
    assistant: Assistant | null;
    stagingMessageId: string | null;
    uploadedObjectKey: string | null;
    reservedStorageBytes: bigint | null;
  }): Promise<void> {
    if (input.uploadedObjectKey !== null) {
      await this.mediaObjectStorage.deleteObject(input.uploadedObjectKey);
    }

    if (input.assistant !== null && input.reservedStorageBytes !== null) {
      try {
        await this.trackWorkspaceQuotaUsageService.releaseMediaStorage({
          assistant: input.assistant,
          sizeBytes: input.reservedStorageBytes,
          source: "web_staged_upload_rollback"
        });
      } catch (error) {
        this.logger.warn(
          `Failed to release staged-upload quota usage for assistant "${input.assistant.id}": ${String(error)}`
        );
      }
    }

    if (input.assistant !== null && input.stagingMessageId !== null) {
      try {
        await this.chatRepository.deleteMessage(input.stagingMessageId, input.assistant.id);
      } catch (error) {
        this.logger.warn(
          `Failed to delete orphan staged-upload message "${input.stagingMessageId}": ${String(error)}`
        );
      }
    }
  }

  private async preprocessUploadBestEffort(input: {
    buffer: Buffer;
    mimeType: string;
    originalFilename: string;
    assistantId: string;
    logContext: string;
  }): Promise<Awaited<ReturnType<MediaPreprocessorService["process"]>> | null> {
    try {
      return await this.preprocessor.process(input.buffer, input.mimeType, input.originalFilename);
    } catch (err) {
      this.logger.warn(
        `Preprocessing failed for ${input.logContext} "${input.originalFilename}", uploading raw: ${String(err)}`
      );
      return null;
    }
  }

  async downloadAttachment(params: {
    userId: string;
    attachmentId: string;
  }): Promise<{ buffer: Buffer; contentType: string; filename: string | null }> {
    const assistant = await this.assistantRepository.findByUserId(params.userId);
    if (!assistant) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const attachment = await this.attachmentRepository.findById(params.attachmentId);
    if (!attachment || attachment.assistantId !== assistant.id) {
      throw new NotFoundException("Attachment not found.");
    }
    const result = await this.mediaObjectStorage.downloadObject(attachment.storagePath);
    if (!result) {
      throw new NotFoundException("Media file not found on storage.");
    }

    return {
      buffer: result.buffer,
      contentType: result.contentType,
      filename: attachment.originalFilename
    };
  }
}
