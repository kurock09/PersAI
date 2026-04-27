import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  RequestWithPlatformContext,
  ResponseWithPlatformContext
} from "../../../platform-core/interface/http/request-http.types";
import { ManageChatMediaService } from "../../application/manage-chat-media.service";
import { MAX_MEDIA_FILE_BYTES } from "../../application/media/media-security-policy";

@Controller("api/v1")
export class MediaAttachmentController {
  constructor(private readonly manageChatMediaService: ManageChatMediaService) {}

  @Post("assistant/chat/web/stage-attachment")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_MEDIA_FILE_BYTES } }))
  async stageAttachment(
    @Req() req: RequestWithPlatformContext,
    @Body()
    body: { surfaceThreadKey?: string; clientTurnId?: string; clientAttachmentId?: string },
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string } | undefined
  ) {
    const userId = this.resolveRequestUserId(req);
    if (!file) {
      throw new NotFoundException("A file is required.");
    }
    const surfaceThreadKey =
      typeof body.surfaceThreadKey === "string" ? body.surfaceThreadKey.trim() : "";
    if (!surfaceThreadKey) {
      throw new BadRequestException("surfaceThreadKey is required.");
    }

    const result = await this.manageChatMediaService.stageForWebThread({
      userId,
      surfaceThreadKey,
      clientTurnId:
        typeof body.clientTurnId === "string" && body.clientTurnId.trim().length > 0
          ? body.clientTurnId.trim()
          : null,
      clientAttachmentId:
        typeof body.clientAttachmentId === "string" && body.clientAttachmentId.trim().length > 0
          ? body.clientAttachmentId.trim()
          : null,
      file
    });

    return {
      requestId: req.requestId ?? null,
      chatId: result.chatId,
      messageId: result.messageId,
      attachment: {
        id: result.attachment.id,
        messageId: result.attachment.messageId,
        chatId: result.attachment.chatId,
        attachmentType: result.attachment.attachmentType,
        originalFilename: result.attachment.originalFilename,
        mimeType: result.attachment.mimeType,
        sizeBytes: Number(result.attachment.sizeBytes),
        processingStatus: result.attachment.processingStatus,
        createdAt: result.attachment.createdAt.toISOString()
      }
    };
  }

  @Post("assistant/chat/:chatId/message/:messageId/attachment")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_MEDIA_FILE_BYTES } }))
  async uploadAttachment(
    @Req() req: RequestWithPlatformContext,
    @Param("chatId") chatId: string,
    @Param("messageId") messageId: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string } | undefined
  ) {
    const userId = this.resolveRequestUserId(req);
    if (!file) {
      throw new NotFoundException("A file is required.");
    }

    const attachment = await this.manageChatMediaService.uploadAttachment({
      userId,
      chatId,
      messageId,
      file
    });

    return {
      requestId: req.requestId ?? null,
      attachment: {
        id: attachment.id,
        messageId: attachment.messageId,
        chatId: attachment.chatId,
        attachmentType: attachment.attachmentType,
        originalFilename: attachment.originalFilename,
        mimeType: attachment.mimeType,
        sizeBytes: Number(attachment.sizeBytes),
        processingStatus: attachment.processingStatus,
        createdAt: attachment.createdAt.toISOString()
      }
    };
  }

  @Post("assistant/voice/transcribe")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_MEDIA_FILE_BYTES } }))
  async transcribeVoice(
    @Req() req: RequestWithPlatformContext,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string } | undefined
  ) {
    const userId = this.resolveRequestUserId(req);
    if (!file) {
      throw new NotFoundException("An audio file is required.");
    }

    const result = await this.manageChatMediaService.transcribeVoice({
      userId,
      file
    });

    return {
      requestId: req.requestId ?? null,
      text: result.text
    };
  }

  @Get("assistant/attachment/:attachmentId")
  async downloadAttachment(
    @Req() req: RequestWithPlatformContext,
    @Res() res: ResponseWithPlatformContext,
    @Param("attachmentId") attachmentId: string,
    @Query("download") download?: string
  ): Promise<void> {
    const userId = this.resolveRequestUserId(req);

    const result = await this.manageChatMediaService.downloadAttachment({
      userId,
      attachmentId
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (result.filename) {
      res.setHeader(
        "Content-Disposition",
        this.buildContentDisposition(result.filename, download === "1" ? "attachment" : "inline")
      );
    }
    res.end(result.buffer);
  }

  private buildContentDisposition(filename: string, mode: "attachment" | "inline"): string {
    const sanitizedFilename = filename.replace(/["\r\n]/g, "_");
    const encodedFilename = encodeURIComponent(filename);
    return `${mode}; filename="${sanitizedFilename}"; filename*=UTF-8''${encodedFilename}`;
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
