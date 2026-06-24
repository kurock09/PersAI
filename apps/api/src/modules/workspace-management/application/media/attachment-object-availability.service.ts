import { Injectable, Logger } from "@nestjs/common";
import type { AssistantChatMessageAttachment } from "../../domain/assistant-chat-message-attachment.entity";
import { createAssistantInboundValidationError } from "../assistant-inbound-error";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";

type AttachmentObjectRef = Pick<
  AssistantChatMessageAttachment,
  "id" | "attachmentType" | "storagePath" | "originalFilename" | "mimeType" | "processingStatus"
>;

@Injectable()
export class AttachmentObjectAvailabilityService {
  private readonly logger = new Logger(AttachmentObjectAvailabilityService.name);

  constructor(private readonly mediaObjectStorage: PersaiMediaObjectStorageService) {}

  async assertRuntimeReadable(input: {
    assistantId: string;
    workspaceId: string;
    chatId: string;
    messageId: string;
    channel: "telegram" | "web";
    attachments: AttachmentObjectRef[];
  }): Promise<void> {
    if (input.attachments.length === 0) {
      return;
    }

    const unavailable: AttachmentObjectRef[] = [];
    for (const attachment of input.attachments) {
      if (attachment.processingStatus !== "ready") {
        unavailable.push(attachment);
        continue;
      }
      const storagePath = attachment.storagePath;
      if (storagePath === null || storagePath.trim().length === 0) {
        unavailable.push(attachment);
        continue;
      }
      const objectKey = this.mediaObjectStorage.buildSharedObjectKey({
        workspaceId: input.workspaceId,
        workspaceRelPath: storagePath
      });
      const exists = await this.mediaObjectStorage.existsObject(objectKey);
      if (!exists) {
        unavailable.push(attachment);
      }
    }

    if (unavailable.length === 0) {
      return;
    }

    this.logger.warn(
      `attachment_object_unavailable assistantId=${input.assistantId} chatId=${input.chatId} messageId=${input.messageId} channel=${input.channel} attachmentIds=${unavailable
        .map((attachment) => attachment.id)
        .join(",")}`
    );

    throw createAssistantInboundValidationError(
      "attachment_object_unavailable",
      "One or more attached files are no longer available. Please send the file again.",
      {
        channel: input.channel,
        chatId: input.chatId,
        messageId: input.messageId,
        attachmentIds: unavailable.map((attachment) => attachment.id),
        filenames: unavailable.map((attachment) => attachment.originalFilename).filter(Boolean)
      }
    );
  }
}
