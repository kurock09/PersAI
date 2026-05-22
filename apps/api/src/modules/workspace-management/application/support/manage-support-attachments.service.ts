import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { ResponseWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { AdminAuthorizationService } from "../admin-authorization.service";
import { MAX_MEDIA_FILE_BYTES, validatePersaiMediaFile } from "../media/media-security-policy";
import { PersaiMediaObjectStorageService } from "../media/persai-media-object-storage.service";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";

export const SUPPORT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export type SupportTicketAttachmentView = {
  id: string;
  mimeType: string;
  fileName: string | null;
  sizeBytes: number;
  createdAt: string;
};

@Injectable()
export class ManageSupportAttachmentsService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly adminAuthorizationService: AdminAuthorizationService
  ) {}

  buildObjectKey(input: {
    assistantId: string;
    ticketId: string;
    messageId: string;
    extension: string | null;
  }): string {
    const prefix = this.mediaObjectStorage.buildAssistantPrefix(input.assistantId);
    const ext =
      input.extension && input.extension.length > 0 ? input.extension.replace(/^\./, "") : "bin";
    return `${prefix}support/${input.ticketId}/${input.messageId}/${randomUUID()}.${ext}`;
  }

  async validateAndStoreForMessage(input: {
    assistantId: string;
    ticketId: string;
    messageId: string;
    file: { buffer: Buffer; mimetype: string; originalname: string };
  }): Promise<SupportTicketAttachmentView> {
    if (input.file.buffer.length > SUPPORT_ATTACHMENT_MAX_BYTES) {
      throw new BadRequestException(`Attachment exceeds ${SUPPORT_ATTACHMENT_MAX_BYTES} bytes.`);
    }

    const validated = await validatePersaiMediaFile({
      buffer: input.file.buffer,
      mimeType: input.file.mimetype,
      originalFilename: input.file.originalname,
      surface: "chat_upload"
    });
    if (!validated.effectiveMimeType.startsWith("image/")) {
      throw new BadRequestException("Only image attachments are supported.");
    }

    const extension = extname(input.file.originalname) || ".jpg";
    const objectKey = this.buildObjectKey({
      assistantId: input.assistantId,
      ticketId: input.ticketId,
      messageId: input.messageId,
      extension
    });
    await this.mediaObjectStorage.saveObject({
      objectKey,
      buffer: input.file.buffer,
      mimeType: validated.effectiveMimeType
    });

    const row = await this.prisma.supportTicketAttachment.create({
      data: {
        messageId: input.messageId,
        objectKey,
        mimeType: validated.effectiveMimeType,
        fileName: input.file.originalname.slice(0, 255) || null,
        sizeBytes: input.file.buffer.length
      }
    });

    return this.toView(row);
  }

  async streamForUser(userId: string, attachmentId: string, res: ResponseWithPlatformContext) {
    const attachment = await this.requireAttachment(attachmentId);
    const ticket = attachment.message.ticket;
    if (ticket.userId !== userId) {
      throw new ForbiddenException("Attachment not found.");
    }
    await this.writeObjectToResponse(attachment, res);
  }

  async streamForAdmin(
    callerUserId: string,
    attachmentId: string,
    res: ResponseWithPlatformContext
  ) {
    await this.adminAuthorizationService.assertCanReadAdminSurface(callerUserId);
    const attachment = await this.requireAttachment(attachmentId);
    await this.writeObjectToResponse(attachment, res);
  }

  private async requireAttachment(attachmentId: string) {
    const attachment = await this.prisma.supportTicketAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        message: {
          include: {
            ticket: {
              select: {
                userId: true,
                assistantId: true
              }
            }
          }
        }
      }
    });
    if (attachment === null) {
      throw new NotFoundException("Attachment not found.");
    }
    return attachment;
  }

  private async writeObjectToResponse(
    attachment: {
      objectKey: string;
      mimeType: string;
      fileName: string | null;
    },
    res: ResponseWithPlatformContext
  ) {
    const downloaded = await this.mediaObjectStorage.downloadObject(attachment.objectKey);
    if (downloaded === null) {
      throw new NotFoundException("Attachment object missing.");
    }
    if (downloaded.buffer.length > MAX_MEDIA_FILE_BYTES) {
      throw new ForbiddenException("Attachment too large.");
    }
    res.setHeader("Content-Type", downloaded.contentType || attachment.mimeType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (attachment.fileName) {
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${attachment.fileName.replace(/"/g, "")}"`
      );
    }
    res.statusCode = 200;
    res.end(downloaded.buffer);
  }

  toView(row: {
    id: string;
    mimeType: string;
    fileName: string | null;
    sizeBytes: number;
    createdAt: Date;
  }): SupportTicketAttachmentView {
    return {
      id: row.id,
      mimeType: row.mimeType,
      fileName: row.fileName,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString()
    };
  }
}
