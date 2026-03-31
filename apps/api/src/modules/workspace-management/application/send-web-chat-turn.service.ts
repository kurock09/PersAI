import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository
} from "../domain/assistant-chat-message-attachment.repository";
import {
  ASSISTANT_RUNTIME_ADAPTER,
  type AssistantRuntimeAdapter,
  type RuntimeMediaArtifact
} from "./assistant-runtime-adapter.types";
import { WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT } from "../domain/memory-source-policy";
import { RecordWebChatMemoryTurnService } from "./record-web-chat-memory-turn.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import type {
  AssistantWebChatMessageAttachmentState,
  AssistantWebChatTurnState
} from "./web-chat.types";
import { PrepareAssistantInboundTurnService } from "./prepare-assistant-inbound-turn.service";
import { toAssistantInboundHttpException } from "./assistant-inbound-error";

export interface SendWebChatTurnRequest {
  surfaceThreadKey: string;
  message: string;
  title?: string | null;
}

function normalizeOptionalTitle(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException("title must be a non-empty string, null, or omitted.");
  }

  return value.trim();
}

@Injectable()
export class SendWebChatTurnService {
  private readonly logger = new Logger(SendWebChatTurnService.name);

  constructor(
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly assistantRuntimeAdapter: AssistantRuntimeAdapter,
    private readonly prepareAssistantInboundTurnService: PrepareAssistantInboundTurnService,
    private readonly recordWebChatMemoryTurnService: RecordWebChatMemoryTurnService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService
  ) {}

  parseInput(payload: unknown): SendWebChatTurnRequest {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Web chat payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    const surfaceThreadKey = body.surfaceThreadKey;
    const message = body.message;
    const title = normalizeOptionalTitle(body.title);

    if (typeof surfaceThreadKey !== "string" || surfaceThreadKey.trim().length === 0) {
      throw new BadRequestException("surfaceThreadKey must be a non-empty string.");
    }
    if (typeof message !== "string" || message.trim().length === 0) {
      throw new BadRequestException("message must be a non-empty string.");
    }

    return {
      surfaceThreadKey: surfaceThreadKey.trim(),
      message: message.trim(),
      ...(title !== undefined ? { title } : {})
    };
  }

  async execute(
    userId: string,
    request: SendWebChatTurnRequest
  ): Promise<AssistantWebChatTurnState> {
    const prepared = await this.prepareAssistantInboundTurnService.execute({
      userId,
      surface: "web_chat",
      surfaceThreadKey: request.surfaceThreadKey,
      message: request.message,
      ...(request.title !== undefined ? { title: request.title } : {})
    });
    const runtimeResponse = await this.assistantRuntimeAdapter
      .sendWebChatTurn({
        assistantId: prepared.assistantId,
        publishedVersionId: prepared.publishedVersionId,
        chatId: prepared.chat.id,
        surfaceThreadKey: prepared.chat.surfaceThreadKey,
        userMessageId: prepared.userMessage.id,
        userMessage: prepared.userMessage.content,
        userTimezone: prepared.workspaceTimezone,
        currentTimeIso: new Date().toISOString()
      })
      .catch((error: unknown) => {
        throw toAssistantInboundHttpException(error);
      });

    const assistantMessage = await this.recordAssistantMessage(
      prepared.chat.id,
      prepared.assistantId,
      runtimeResponse.assistantMessage
    );

    const attachmentStates = await this.persistToolMediaAttachments(
      runtimeResponse.media,
      assistantMessage.id,
      prepared.chat.id,
      prepared.assistantId,
      prepared.assistant.workspaceId
    );

    await this.recordWebChatMemoryTurnService.execute({
      assistantId: prepared.assistantId,
      userId: prepared.userId,
      workspaceId: prepared.workspaceId,
      chatId: prepared.chat.id,
      userMessageId: prepared.userMessage.id,
      assistantMessageId: assistantMessage.id,
      userContent: prepared.userMessage.content,
      assistantContent: runtimeResponse.assistantMessage,
      memoryWriteContext: WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT
    });
    await this.trackWorkspaceQuotaUsageService.recordWebChatTurnUsage({
      assistant: prepared.assistant,
      userContent: prepared.userMessage.content,
      assistantContent: assistantMessage.content,
      source: "web_chat_turn_sync"
    });
    await this.consumeBootstrapBestEffort(prepared.assistantId);

    return {
      chat: prepared.chat,
      userMessage: prepared.userMessage,
      assistantMessage: {
        id: assistantMessage.id,
        chatId: assistantMessage.chatId,
        assistantId: assistantMessage.assistantId,
        author: assistantMessage.author,
        content: assistantMessage.content,
        attachments: attachmentStates,
        createdAt: assistantMessage.createdAt.toISOString()
      },
      runtime: {
        respondedAt: runtimeResponse.respondedAt
      }
    };
  }

  private inferMimeType(url: string, type: RuntimeMediaArtifact["type"]): string {
    const ext = url.split(".").pop()?.toLowerCase() ?? "";
    const extMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      mp3: "audio/mpeg",
      ogg: "audio/ogg",
      opus: "audio/opus",
      wav: "audio/wav",
      mp4: "video/mp4",
      webm: type === "audio" ? "audio/webm" : "video/webm",
      pdf: "application/pdf"
    };
    return extMap[ext] ?? (type === "image" ? "image/png" : "application/octet-stream");
  }

  private async persistToolMediaAttachments(
    media: RuntimeMediaArtifact[],
    messageId: string,
    chatId: string,
    assistantId: string,
    workspaceId: string
  ): Promise<AssistantWebChatMessageAttachmentState[]> {
    if (media.length === 0) return [];

    const results: AssistantWebChatMessageAttachmentState[] = [];
    for (const artifact of media) {
      try {
        const downloadResult = await this.assistantRuntimeAdapter.downloadChatMedia(
          assistantId,
          artifact.url
        );
        if (!downloadResult) {
          this.logger.warn(`Tool media not found on storage: ${artifact.url}`);
          continue;
        }

        const uploadResult = await this.assistantRuntimeAdapter.uploadChatMedia({
          assistantId,
          chatId,
          messageId,
          fileBuffer: downloadResult.buffer,
          mimeType: downloadResult.contentType
        });

        const mimeType =
          downloadResult.contentType !== "application/octet-stream"
            ? downloadResult.contentType
            : this.inferMimeType(artifact.url, artifact.type);

        const attachmentType = artifact.audioAsVoice ? "voice" : artifact.type;

        const attachment = await this.attachmentRepository.create({
          messageId,
          chatId,
          assistantId,
          workspaceId,
          attachmentType,
          storagePath: uploadResult.storagePath,
          originalFilename: artifact.url.split("/").pop() ?? null,
          mimeType,
          sizeBytes: BigInt(uploadResult.sizeBytes),
          durationMs: null,
          width: null,
          height: null,
          processingStatus: "ready",
          transcription: null,
          metadata: { source: "tool_output", originalUrl: artifact.url }
        });

        results.push({
          id: attachment.id,
          attachmentType: attachment.attachmentType,
          originalFilename: attachment.originalFilename,
          mimeType: attachment.mimeType,
          sizeBytes: Number(attachment.sizeBytes),
          processingStatus: attachment.processingStatus,
          createdAt: attachment.createdAt.toISOString()
        });
      } catch (error) {
        this.logger.warn(`Failed to persist tool media attachment: ${artifact.url}`, error);
      }
    }
    return results;
  }

  private async consumeBootstrapBestEffort(assistantId: string): Promise<void> {
    try {
      await this.assistantRuntimeAdapter.consumeBootstrapWorkspace(assistantId);
    } catch (error) {
      console.warn("[web-chat] Non-fatal: failed to consume BOOTSTRAP.md:", error);
    }
  }

  private async recordAssistantMessage(chatId: string, assistantId: string, content: string) {
    return this.assistantChatRepository.createMessage({
      chatId,
      assistantId,
      author: "assistant",
      content
    });
  }
}
