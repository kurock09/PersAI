import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
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

const ALLOWED_UPLOAD_MIME_PREFIXES = [
  "image/",
  "audio/",
  "video/",
  "application/pdf",
  "application/octet-stream"
];
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

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
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly chatRepository: AssistantChatRepository,
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly runtimeAdapter: AssistantRuntimeAdapter
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

    const uploadResult = await this.runtimeAdapter.uploadChatMedia({
      assistantId: assistant.id,
      chatId: "_voice_tmp",
      messageId: "transcribe",
      fileBuffer: params.file.buffer,
      mimeType: params.file.mimetype
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
