import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
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
import {
  ASSISTANT_RUNTIME_ADAPTER,
  type AssistantRuntimeAdapter
} from "./assistant-runtime-adapter.types";
import { MediaPreprocessorService } from "./media/media-preprocessor.service";

const ALLOWED_UPLOAD_MIME_PREFIXES = [
  "image/",
  "audio/",
  "video/",
  "application/pdf",
  "application/octet-stream"
];
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const AUDIO_MIMES_NEEDING_CONVERSION = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/opus",
  "audio/x-opus+ogg"
]);

function isAllowedMime(mime: string): boolean {
  return ALLOWED_UPLOAD_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

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
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly runtimeAdapter: AssistantRuntimeAdapter,
    private readonly preprocessor: MediaPreprocessorService
  ) {}

  async uploadAttachment(params: {
    userId: string;
    chatId: string;
    messageId: string;
    file: { buffer: Buffer; mimetype: string; originalname: string };
  }): Promise<AssistantChatMessageAttachment> {
    if (!isAllowedMime(params.file.mimetype)) {
      throw new BadRequestException("Unsupported file type.");
    }
    if (params.file.buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException("File exceeds maximum size of 25MB.");
    }

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

    const uploadResult = await this.runtimeAdapter.uploadChatMedia({
      assistantId: assistant.id,
      chatId: chat.id,
      messageId: message.id,
      fileBuffer: params.file.buffer,
      mimeType: params.file.mimetype
    });

    const attachment = await this.attachmentRepository.create({
      messageId: message.id,
      chatId: chat.id,
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      attachmentType: inferAttachmentType(params.file.mimetype),
      storagePath: uploadResult.storagePath,
      originalFilename: params.file.originalname || null,
      mimeType: uploadResult.mimeType,
      sizeBytes: BigInt(uploadResult.sizeBytes),
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
    if (!isAllowedMime(params.file.mimetype)) {
      throw new BadRequestException("Unsupported file type.");
    }
    if (params.file.buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException("File exceeds maximum size of 25MB.");
    }

    const assistant = await this.assistantRepository.findByUserId(params.userId);
    if (!assistant) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    let chat = await this.chatRepository.findChatBySurfaceThread(
      assistant.id,
      "web",
      params.surfaceThreadKey
    );
    if (!chat) {
      chat = await this.chatRepository.createChat({
        assistantId: assistant.id,
        userId: assistant.userId,
        workspaceId: assistant.workspaceId,
        surface: "web",
        surfaceThreadKey: params.surfaceThreadKey,
        title: null
      });
    }

    const stagingMessage = await this.chatRepository.createMessage({
      chatId: chat.id,
      assistantId: assistant.id,
      author: "user",
      content: `(attached: ${params.file.originalname || "file"})`
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
        params.file.mimetype,
        params.file.originalname,
        assistant.id
      );
    } catch (err) {
      this.logger.warn(
        `Preprocessing failed for staged upload "${params.file.originalname}", uploading raw: ${String(err)}`
      );
    }

    const fileBuffer = processed?.normalizedBuffer ?? params.file.buffer;
    const mimeType = processed?.normalizedMime ?? params.file.mimetype;

    const uploadResult = await this.runtimeAdapter.uploadChatMedia({
      assistantId: assistant.id,
      chatId: chat.id,
      messageId: stagingMessage.id,
      fileBuffer,
      mimeType
    });

    const attachment = await this.attachmentRepository.create({
      messageId: stagingMessage.id,
      chatId: chat.id,
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      attachmentType: inferAttachmentType(mimeType),
      storagePath: uploadResult.storagePath,
      originalFilename: params.file.originalname || null,
      mimeType: uploadResult.mimeType,
      sizeBytes: BigInt(uploadResult.sizeBytes),
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

    return { chatId: chat.id, messageId: stagingMessage.id, attachment };
  }

  async transcribeVoice(params: {
    userId: string;
    file: { buffer: Buffer; mimetype: string; originalname: string };
  }): Promise<{ text: string }> {
    if (!params.file.mimetype.startsWith("audio/")) {
      throw new BadRequestException("Only audio files can be transcribed.");
    }
    if (params.file.buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException("File exceeds maximum size of 25MB.");
    }

    const assistant = await this.assistantRepository.findByUserId(params.userId);
    if (!assistant) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    let fileBuffer = params.file.buffer;
    let mimeType = params.file.mimetype;
    const baseMime = (mimeType.split(";")[0] ?? mimeType).trim();

    if (AUDIO_MIMES_NEEDING_CONVERSION.has(baseMime)) {
      try {
        fileBuffer = await this.convertAudioToMp3(fileBuffer);
        mimeType = "audio/mpeg";
      } catch (err) {
        this.logger.warn(
          `Audio conversion failed for "${params.file.originalname}", keeping original: ${String(err)}`
        );
      }
    }

    const uploadResult = await this.runtimeAdapter.uploadChatMedia({
      assistantId: assistant.id,
      chatId: "_voice_tmp",
      messageId: "transcribe",
      fileBuffer,
      mimeType
    });

    try {
      const result = await this.runtimeAdapter.transcribeMedia(
        assistant.id,
        uploadResult.storagePath
      );
      return { text: result.text };
    } finally {
      void this.runtimeAdapter
        .deleteChatMedia(assistant.id, uploadResult.storagePath)
        .catch(() => {});
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

    const result = await this.runtimeAdapter.downloadChatMedia(
      assistant.id,
      attachment.storagePath
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
