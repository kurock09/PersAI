import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import { PlatformHttpMetricsService } from "../../platform-core/application/platform-http-metrics.service";
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
import { ASSISTANT_RUNTIME_FACADE, type AssistantRuntimeFacade } from "./assistant-runtime.facade";
import { MediaPreprocessorService } from "./media/media-preprocessor.service";
import { ResolveAssistantRuntimeTierService } from "./resolve-assistant-runtime-tier.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { validatePersaiMediaFile } from "./media/media-security-policy";
import {
  createAssistantInboundConflict,
  createMediaStorageQuotaExceededError,
  createWorkspaceStorageFullError
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
    @Inject(ASSISTANT_RUNTIME_FACADE)
    private readonly assistantRuntime: AssistantRuntimeFacade,
    private readonly preprocessor: MediaPreprocessorService,
    private readonly resolveAssistantRuntimeTierService: ResolveAssistantRuntimeTierService,
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

    const runtimeTier = await this.resolveAssistantRuntimeTierService.resolveByAssistantId(
      assistant.id
    );

    const uploadResult = await this.assistantRuntime.uploadChatMedia({
      assistantId: assistant.id,
      runtimeTier,
      chatId: chat.id,
      messageId: message.id,
      fileBuffer: params.file.buffer,
      mimeType: validated.effectiveMimeType
    });

    const sizeBytes = BigInt(uploadResult.sizeBytes);
    await this.ensureMediaStorageQuotaApplied({
      assistant,
      runtimeTier,
      storagePath: uploadResult.storagePath,
      sizeBytes,
      source: "chat_upload"
    });
    const attachment = await this.attachmentRepository.create({
      messageId: message.id,
      chatId: chat.id,
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      attachmentType: inferAttachmentType(validated.effectiveMimeType),
      storagePath: uploadResult.storagePath,
      originalFilename: validated.originalFilename,
      mimeType: uploadResult.mimeType,
      sizeBytes,
      durationMs: null,
      width: null,
      height: null,
      processingStatus: "ready",
      transcription: null,
      metadata: null
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
    try {
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

      let processed: {
        normalizedBuffer: Buffer;
        normalizedMime: string;
        transcription: string | null;
        textExtract: string | null;
        durationMs: number | null;
        width: number | null;
        height: number | null;
      } | null = null;

      try {
        processed = await this.preprocessor.process(
          params.file.buffer,
          validated.effectiveMimeType,
          params.file.originalname,
          assistant.id
        );
      } catch (err) {
        this.logger.warn(
          `Preprocessing failed for staged upload "${params.file.originalname}", uploading raw: ${String(err)}`
        );
      }

      const quotaCheck =
        await this.trackWorkspaceQuotaUsageService.checkMediaStorageQuota(assistant);
      if (!quotaCheck.allowed) {
        throw createMediaStorageQuotaExceededError(quotaCheck.usedBytes, quotaCheck.limitBytes);
      }

      const fileBuffer = processed?.normalizedBuffer ?? params.file.buffer;
      const mimeType = processed?.normalizedMime ?? validated.effectiveMimeType;
      const runtimeTier = await this.resolveAssistantRuntimeTierService.resolveByAssistantId(
        assistant.id
      );

      const wsLimits =
        await this.trackWorkspaceQuotaUsageService.resolveWorkspaceStorageLimit(assistant);
      if (wsLimits.limitBytes !== null) {
        const wsUsage = await this.assistantRuntime.getWorkspaceStorageUsage(
          assistant.id,
          runtimeTier
        );
        if (wsUsage.usedBytes >= Number(wsLimits.limitBytes)) {
          throw createWorkspaceStorageFullError(wsUsage.usedBytes, wsLimits.limitBytes);
        }
      }

      const uploadResult = await this.assistantRuntime.uploadChatMedia({
        assistantId: assistant.id,
        runtimeTier,
        chatId: chat.id,
        messageId: stagingMessage.id,
        fileBuffer,
        mimeType
      });

      const sizeBytes = BigInt(uploadResult.sizeBytes);
      await this.ensureMediaStorageQuotaApplied({
        assistant,
        runtimeTier,
        storagePath: uploadResult.storagePath,
        sizeBytes,
        source: "web_staged_upload"
      });
      const attachment = await this.attachmentRepository.create({
        messageId: stagingMessage.id,
        chatId: chat.id,
        assistantId: assistant.id,
        workspaceId: assistant.workspaceId,
        attachmentType: inferAttachmentType(mimeType),
        storagePath: uploadResult.storagePath,
        originalFilename: validated.originalFilename,
        mimeType: uploadResult.mimeType,
        sizeBytes,
        durationMs: processed?.durationMs ?? null,
        width: processed?.width ?? null,
        height: processed?.height ?? null,
        processingStatus: "ready",
        transcription: processed?.transcription ?? null,
        metadata: {
          source: "web_staged_upload",
          ...(processed?.textExtract ? { textExtract: "stored" } : {})
        }
      });

      outcome = "success";
      return { chatId: chat.id, messageId: stagingMessage.id, attachment };
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
    const runtimeTier = await this.resolveAssistantRuntimeTierService.resolveByAssistantId(
      assistant.id
    );

    let fileBuffer = params.file.buffer;
    let mimeType = validated.effectiveMimeType;
    const baseMime = (mimeType.split(";")[0] ?? mimeType).trim();
    const { randomUUID } = await import("crypto");
    const transientChatId = `_voice_tmp_${randomUUID()}`;

    if (AUDIO_MIMES_NEEDING_CONVERSION.has(baseMime)) {
      try {
        fileBuffer = await this.convertAudioToMp3(fileBuffer);
        mimeType = "audio/mpeg";
      } catch (err) {
        this.logger.warn(
          `Audio conversion failed for "${validated.originalFilename ?? "voice-input"}", keeping original: ${String(err)}`
        );
      }
    }

    const uploadResult = await this.assistantRuntime.uploadChatMedia({
      assistantId: assistant.id,
      runtimeTier,
      chatId: transientChatId,
      messageId: "transcribe",
      fileBuffer,
      mimeType
    });

    try {
      const result = await this.assistantRuntime.transcribeMedia(
        assistant.id,
        uploadResult.storagePath,
        runtimeTier
      );
      const text = result.text.trim();
      if (text.length === 0) {
        throw new BadRequestException("Voice transcription returned empty text. Please try again.");
      }
      outcome = "success";
      return { text };
    } finally {
      await this.assistantRuntime.deleteChatMediaBatch(assistant.id, transientChatId, runtimeTier);
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

  private async ensureMediaStorageQuotaApplied(params: {
    assistant: Assistant;
    runtimeTier: "free_shared_restricted" | "paid_shared_restricted" | "paid_isolated";
    storagePath: string;
    sizeBytes: bigint;
    source: "chat_upload" | "web_staged_upload";
  }): Promise<void> {
    const applied = await this.trackWorkspaceQuotaUsageService.recordMediaUpload({
      assistant: params.assistant,
      sizeBytes: params.sizeBytes,
      source: params.source
    });
    if (applied.capped) {
      await this.assistantRuntime.deleteChatMedia(
        params.assistant.id,
        params.storagePath,
        params.runtimeTier
      );
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
    const runtimeTier = await this.resolveAssistantRuntimeTierService.resolveByAssistantId(
      assistant.id
    );

    const result = await this.assistantRuntime.downloadChatMedia(
      assistant.id,
      attachment.storagePath,
      runtimeTier
    );
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
