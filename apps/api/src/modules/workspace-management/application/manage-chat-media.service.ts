import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
import type { Assistant } from "../domain/assistant.entity";
import { MediaPreprocessorService } from "./media/media-preprocessor.service";
import { NativeMediaTranscriptionService } from "./media/native-media-transcription.service";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { validatePersaiMediaFile } from "./media/media-security-policy";
import {
  buildStoredAttachmentMetadata,
  readStoredAttachmentSemanticSummary
} from "./media/media.types";
import { RegisterChatAttachmentService } from "./register-chat-attachment.service";
import { SandboxControlPlaneClientService } from "./sandbox-control-plane.client.service";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";
import { resolveUniqueWorkspaceInputStoragePath } from "./resolve-workspace-input-storage-path";
import {
  createAssistantInboundConflict,
  createMediaStorageQuotaExceededError
} from "./assistant-inbound-error";
import {
  RecordModelCostLedgerService,
  type ModelCostLedgerSurface
} from "./record-model-cost-ledger.service";
import type { RuntimeBillingFacts } from "@persai/runtime-contract";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";

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
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly chatRepository: AssistantChatRepository,
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    private readonly preprocessor: MediaPreprocessorService,
    private readonly nativeMediaTranscriptionService: NativeMediaTranscriptionService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly registerChatAttachmentService: RegisterChatAttachmentService,
    private readonly workspaceFileMetadataService: WorkspaceFileMetadataService,
    private readonly platformHttpMetricsService: PlatformHttpMetricsService,
    private readonly recordModelCostLedgerService: RecordModelCostLedgerService,
    private readonly sandboxControlPlaneClient: SandboxControlPlaneClientService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  private resolveLedgerSurface(surface: string): ModelCostLedgerSurface | null {
    return surface === "web" || surface === "telegram" ? surface : null;
  }

  /**
   * Strip the canonical `/workspace/input/` prefix off a model-facing storage
   * path and return the basename used by `resolveUniqueWorkspaceInputStoragePath`.
   * Returns `null` for anything that is not a workspace-input path (defence-
   * in-depth — the caller already constructed the path through that helper,
   * so a non-match should never happen in practice).
   */
  private extractWorkspaceInputBasename(storagePath: string): string | null {
    const prefix = "/workspace/input/";
    if (!storagePath.startsWith(prefix)) {
      return null;
    }
    const tail = storagePath.slice(prefix.length);
    if (tail.length === 0 || tail.includes("/")) {
      return null;
    }
    return tail;
  }

  private async appendSttLedgerFromPersistedBillingFacts(input: {
    workspaceId: string;
    assistantId: string;
    userId: string;
    surface: ModelCostLedgerSurface;
    attachmentId: string;
    billingFacts: RuntimeBillingFacts | null | undefined;
  }): Promise<void> {
    if (input.billingFacts === null || input.billingFacts === undefined) {
      return;
    }
    try {
      await this.recordModelCostLedgerService.recordPersistedBillingFactsEvent({
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        userId: input.userId,
        surface: input.surface,
        source: "attachment_stt_ingest",
        sourceEventId: `attachment:${input.attachmentId}`,
        billingFacts: input.billingFacts
      });
    } catch (error) {
      this.logger.warn(
        `attachment_stt_ledger_append_failed attachmentId=${input.attachmentId} message=${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

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

    const assistant = (await this.resolveActiveAssistantService.execute({ userId: params.userId }))
      .assistant;

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
    const storagePath = await resolveUniqueWorkspaceInputStoragePath({
      workspaceId: assistant.workspaceId,
      filename: validated.originalFilename,
      mimeType,
      referenceId: message.id,
      workspaceFileMetadataService: this.workspaceFileMetadataService
    });
    const objectKey = this.mediaObjectStorage.buildWorkspaceObjectKey({
      workspaceId: assistant.workspaceId,
      workspaceRelPath: storagePath
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
    const registered = await this.registerChatAttachmentService.execute({
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      chatId: chat.id,
      messageId: message.id,
      storagePath,
      attachmentType: inferAttachmentType(mimeType),
      mimeType: uploadResult.mimeType,
      sizeBytes: Number(uploadResult.sizeBytes),
      originalFilename: validated.originalFilename ?? "upload",
      kind: "user_upload",
      durationMs: processed?.durationMs ?? null,
      width: processed?.width ?? null,
      height: processed?.height ?? null,
      transcription: processed?.transcription ?? null,
      billingFacts: processed?.billingFacts ?? null,
      metadata: buildStoredAttachmentMetadata({
        source: "chat_upload",
        textExtract: processed?.textExtract ?? null,
        transcription: processed?.transcription ?? null
      }),
      shortDescription: readStoredAttachmentSemanticSummary(
        buildStoredAttachmentMetadata({
          source: "chat_upload",
          textExtract: processed?.textExtract ?? null,
          transcription: processed?.transcription ?? null
        })
      )
    });
    const attachment = (await this.attachmentRepository.findById(registered.attachmentId))!;

    const ledgerSurface = this.resolveLedgerSurface(chat.surface);
    if (ledgerSurface !== null) {
      await this.appendSttLedgerFromPersistedBillingFacts({
        workspaceId: assistant.workspaceId,
        assistantId: assistant.id,
        userId: assistant.userId,
        surface: ledgerSurface,
        attachmentId: attachment.id,
        billingFacts: processed?.billingFacts ?? null
      });
    }

    return attachment;
  }

  async stageForWebThread(params: {
    userId: string;
    surfaceThreadKey: string;
    clientTurnId?: string | null;
    clientAttachmentId?: string | null;
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

      assistant = (await this.resolveActiveAssistantService.execute({ userId: params.userId }))
        .assistant;

      const activeWebChatsLimit =
        await this.trackWorkspaceQuotaUsageService.resolveActiveWebChatsLimit(assistant);
      const chatResult = await this.chatRepository.getOrCreateWebChatBySurfaceThreadUnderCap({
        assistantId: assistant.id,
        userId: assistant.userId,
        workspaceId: assistant.workspaceId,
        surface: "web",
        surfaceThreadKey: params.surfaceThreadKey,
        title: null,
        activeWebChatsLimit
      });
      if (chatResult.outcome === "cap_reached") {
        throw createAssistantInboundConflict(
          "active_chat_cap_reached",
          `Active web chats cap reached (${chatResult.limit}). Archive an existing chat or continue in an existing thread.`,
          { limit: chatResult.limit }
        );
      }
      const chat = chatResult.chat;

      if (params.clientAttachmentId && params.clientAttachmentId.trim().length > 0) {
        const existing = await this.attachmentRepository.findStagedByClientAttachment({
          assistantId: assistant.id,
          chatId: chat.id,
          clientAttachmentId: params.clientAttachmentId.trim()
        });
        if (existing !== null) {
          this.logger.log(
            `web_attachment_stage_replay assistantId=${assistant.id} threadKey=${params.surfaceThreadKey} clientTurnId=${params.clientTurnId ?? "n/a"} clientAttachmentId=${params.clientAttachmentId.trim()} attachmentId=${existing.id}`
          );
          outcome = "success";
          return { chatId: chat.id, messageId: existing.messageId, attachment: existing };
        }
      }

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
      const storagePath = await resolveUniqueWorkspaceInputStoragePath({
        workspaceId: assistant.workspaceId,
        filename: validated.originalFilename,
        mimeType,
        referenceId: stagingMessage.id,
        workspaceFileMetadataService: this.workspaceFileMetadataService
      });
      const objectKey = this.mediaObjectStorage.buildWorkspaceObjectKey({
        workspaceId: assistant.workspaceId,
        workspaceRelPath: storagePath
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
      const registered = await this.registerChatAttachmentService.execute({
        assistantId: assistant.id,
        workspaceId: assistant.workspaceId,
        chatId: chat.id,
        messageId: stagingMessage.id,
        storagePath,
        attachmentType: inferAttachmentType(mimeType),
        mimeType: uploadResult.mimeType,
        sizeBytes: Number(uploadResult.sizeBytes),
        originalFilename: validated.originalFilename ?? "upload",
        kind: "user_upload",
        durationMs: processed?.durationMs ?? null,
        width: processed?.width ?? null,
        height: processed?.height ?? null,
        transcription: processed?.transcription ?? null,
        billingFacts: processed?.billingFacts ?? null,
        metadata: buildStoredAttachmentMetadata({
          source: "web_staged_upload",
          textExtract: processed?.textExtract ?? null,
          transcription: processed?.transcription ?? null
        }),
        clientTurnId: params.clientTurnId?.trim() || null,
        clientAttachmentId: params.clientAttachmentId?.trim() || null,
        shortDescription: readStoredAttachmentSemanticSummary(
          buildStoredAttachmentMetadata({
            source: "web_staged_upload",
            textExtract: processed?.textExtract ?? null,
            transcription: processed?.transcription ?? null
          })
        )
      });
      const attachment = (await this.attachmentRepository.findById(registered.attachmentId))!;

      // ADR-126 v3 amendment (2026-06-25) — best-effort hot-pod push of the
      // uploaded inbound bytes. The canonical store is the GCS object we just
      // wrote; this push is a latency optimisation so the running pod sees
      // the file on the *next turn* instead of only after the next cold-start
      // hydrate. Any failure (sandbox unreachable, pod cold, write rejected)
      // is logged at warn and never blocks the upload — `hydrateWorkspaceMountFromGcs`
      // is the authoritative recovery path.
      const workspaceInputBasename = this.extractWorkspaceInputBasename(storagePath);
      if (workspaceInputBasename !== null) {
        await this.sandboxControlPlaneClient.pushWorkspaceInboundBytes({
          assistantId: assistant.id,
          workspaceId: assistant.workspaceId,
          basename: workspaceInputBasename,
          contents: fileBuffer,
          mimeType
        });
      }

      const ledgerSurface = this.resolveLedgerSurface(chat.surface);
      if (ledgerSurface !== null) {
        await this.appendSttLedgerFromPersistedBillingFacts({
          workspaceId: assistant.workspaceId,
          assistantId: assistant.id,
          userId: assistant.userId,
          surface: ledgerSurface,
          attachmentId: attachment.id,
          billingFacts: processed?.billingFacts ?? null
        });
      }

      outcome = "success";
      if (params.clientAttachmentId) {
        this.logger.log(
          `web_attachment_stage_completed assistantId=${assistant.id} threadKey=${params.surfaceThreadKey} clientTurnId=${params.clientTurnId ?? "n/a"} clientAttachmentId=${params.clientAttachmentId} attachmentId=${attachment.id}`
        );
      }
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

    const assistant = (await this.resolveActiveAssistantService.execute({ userId: params.userId }))
      .assistant;

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
      const occurredAt = new Date(result.respondedAt);
      const voiceEvent = await this.prisma.assistantVoiceTranscriptionEvent.create({
        data: {
          assistantId: assistant.id,
          userId: assistant.userId,
          workspaceId: assistant.workspaceId,
          surface: "voice_http",
          ...(result.billingFacts === null || result.billingFacts === undefined
            ? {}
            : {
                billingFactsJson: result.billingFacts as unknown as Prisma.InputJsonValue
              }),
          mimeType: validated.effectiveMimeType,
          originalFilename: validated.originalFilename,
          occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt
        }
      });
      if (result.billingFacts !== null && result.billingFacts !== undefined) {
        try {
          await this.recordModelCostLedgerService.recordPersistedBillingFactsEvent({
            workspaceId: assistant.workspaceId,
            assistantId: assistant.id,
            userId: assistant.userId,
            surface: "web",
            source: "voice_http_transcribe",
            sourceEventId: `voice_transcription_event:${voiceEvent.id}`,
            billingFacts: result.billingFacts
          });
        } catch (error) {
          this.logger.warn(
            `voice_transcribe_ledger_append_failed eventId=${voiceEvent.id} message=${error instanceof Error ? error.message : String(error)}`
          );
        }
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

  async deleteChatWorkspaceFile(params: {
    userId: string;
    chatId: string;
    storagePath: string;
  }): Promise<void> {
    const assistant = (await this.resolveActiveAssistantService.execute({ userId: params.userId }))
      .assistant;
    const chat = await this.chatRepository.findChatById(params.chatId);
    if (chat === null || chat.assistantId !== assistant.id || chat.surface !== "web") {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }

    const attachments = await this.prisma.assistantChatMessageAttachment.findMany({
      where: {
        assistantId: assistant.id,
        workspaceId: chat.workspaceId,
        storagePath: params.storagePath
      }
    });
    if (attachments.length === 0) {
      throw new NotFoundException("File not found.");
    }

    const pathsToDelete = new Set<string>([params.storagePath]);
    for (const attachment of attachments) {
      if (attachment.thumbnailStoragePath) {
        pathsToDelete.add(attachment.thumbnailStoragePath);
      }
      if (attachment.posterStoragePath) {
        pathsToDelete.add(attachment.posterStoragePath);
      }
    }

    await this.deleteWorkspaceFileDurably({
      assistantId: assistant.id,
      workspaceId: chat.workspaceId,
      storagePath: params.storagePath,
      gcsPathsToDelete: [...pathsToDelete],
      clearAttachmentRows: async () => {
        await this.prisma.assistantChatMessageAttachment.updateMany({
          where: {
            assistantId: assistant.id,
            workspaceId: chat.workspaceId,
            storagePath: params.storagePath
          },
          data: {
            processingStatus: "unavailable",
            storagePath: null,
            thumbnailStoragePath: null,
            posterStoragePath: null
          }
        });
      }
    });
  }

  async deleteWorkspaceFile(params: {
    assistantId: string;
    workspaceId: string;
    path: string;
  }): Promise<void> {
    const storagePath = params.path.trim();
    const manifestRow = await this.workspaceFileMetadataService.get({
      workspaceId: params.workspaceId,
      path: storagePath
    });
    const objectKey = this.mediaObjectStorage.buildWorkspaceObjectKey({
      workspaceId: params.workspaceId,
      workspaceRelPath: storagePath
    });
    const objectExists = await this.mediaObjectStorage.existsObject(objectKey);
    if (manifestRow === null && !objectExists) {
      throw new NotFoundException("File not found.");
    }

    await this.deleteWorkspaceFileDurably({
      assistantId: params.assistantId,
      workspaceId: params.workspaceId,
      storagePath,
      gcsPathsToDelete: [storagePath]
    });
  }

  private async deleteWorkspaceFileDurably(input: {
    assistantId: string;
    workspaceId: string;
    storagePath: string;
    gcsPathsToDelete: readonly string[];
    clearAttachmentRows?: () => Promise<void>;
  }): Promise<void> {
    for (const workspaceRelPath of input.gcsPathsToDelete) {
      const objectKey = this.mediaObjectStorage.buildWorkspaceObjectKey({
        workspaceId: input.workspaceId,
        workspaceRelPath
      });
      await this.mediaObjectStorage.deleteObject(objectKey);
    }

    await this.workspaceFileMetadataService.delete({
      workspaceId: input.workspaceId,
      path: input.storagePath
    });

    if (input.clearAttachmentRows) {
      await input.clearAttachmentRows();
    }

    try {
      await this.sandboxControlPlaneClient.removeWorkspaceFileFromHotPods({
        workspaceId: input.workspaceId,
        path: input.storagePath
      });
    } catch (error) {
      this.logger.warn(
        `workspace_file_hot_pod_rm_failed workspace=${input.workspaceId} assistant=${input.assistantId} path=${input.storagePath} error=${error instanceof Error ? error.message : String(error)}`
      );
    }
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

  private asAttachmentMetadataObject(
    metadata: AssistantChatMessageAttachment["metadata"]
  ): Record<string, unknown> | null {
    return metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : null;
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
}
