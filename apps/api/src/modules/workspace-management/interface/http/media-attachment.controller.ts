import {
  BadRequestException,
  Body,
  Delete,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
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
import {
  AssistantFileRegistryService,
  type AssistantFileRegistryRecord
} from "../../application/assistant-file-registry.service";
import { GetAssistantByUserIdService } from "../../application/get-assistant-by-user-id.service";
import { MAX_MEDIA_FILE_BYTES } from "../../application/media/media-security-policy";

@Controller("api/v1")
export class MediaAttachmentController {
  constructor(
    private readonly manageChatMediaService: ManageChatMediaService,
    private readonly getAssistantByUserIdService: GetAssistantByUserIdService,
    private readonly assistantFileRegistryService: AssistantFileRegistryService
  ) {}

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
        fileRef: result.attachment.assistantFileId,
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
        fileRef: attachment.assistantFileId,
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

  @Get("assistant/files")
  async listAssistantFiles(
    @Req() req: RequestWithPlatformContext,
    @Query("q") query?: string,
    @Query("limit") limit?: string
  ) {
    const assistant = await this.resolveRequestAssistant(req);
    const files = await this.assistantFileRegistryService.listAssistantFiles({
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      query: typeof query === "string" ? query : null,
      limit: this.parseLimit(limit)
    });
    return {
      requestId: req.requestId ?? null,
      files: files.map((file) => this.toFileState(file)),
      cleanup: this.toCleanupSummary(files)
    };
  }

  @Post("assistant/files/cleanup-cache")
  async cleanupAssistantFileCache(@Req() req: RequestWithPlatformContext) {
    const assistant = await this.resolveRequestAssistant(req);
    const cleanup = await this.assistantFileRegistryService.cleanupAssistantFileCache({
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId
    });
    return {
      requestId: req.requestId ?? null,
      cleanup
    };
  }

  @Get("assistant/files/:fileRef")
  async getAssistantFile(
    @Req() req: RequestWithPlatformContext,
    @Param("fileRef") fileRef: string
  ) {
    const assistant = await this.resolveRequestAssistant(req);
    const file = await this.assistantFileRegistryService.findAssistantFile({
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      fileRef
    });
    if (file === null) {
      throw new NotFoundException("File not found.");
    }
    return {
      requestId: req.requestId ?? null,
      file: this.toFileState(file)
    };
  }

  @Get("assistant/files/:fileRef/download")
  async downloadAssistantFile(
    @Req() req: RequestWithPlatformContext,
    @Res() res: ResponseWithPlatformContext,
    @Param("fileRef") fileRef: string,
    @Query("download") download?: string
  ): Promise<void> {
    const assistant = await this.resolveRequestAssistant(req);
    const result = await this.assistantFileRegistryService.downloadAssistantFile({
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      fileRef
    });

    const payload = this.prepareDownloadPayload({
      buffer: result.buffer,
      contentType: result.contentType,
      forceDownload: download === "1"
    });

    res.setHeader("Content-Type", payload.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Accept-Ranges", "bytes");
    if (result.file.displayName) {
      res.setHeader(
        "Content-Disposition",
        this.buildContentDisposition(
          result.file.displayName,
          download === "1" ? "attachment" : "inline"
        )
      );
    }

    // Honour Range requests so HTML5 `<video>` playback works in Capacitor
    // Android WebView. Without a real 206 reply to the initial
    // `Range: bytes=0-` probe the WebView shows a grey poster and never
    // starts playing. The buffer is already in memory so we just slice it.
    const totalSize = payload.buffer.length;
    const rangeHeader = typeof req.headers?.range === "string" ? req.headers.range : undefined;
    const parsedRange = rangeHeader ? this.parseSingleByteRange(rangeHeader, totalSize) : null;

    if (parsedRange) {
      const slice = payload.buffer.subarray(parsedRange.start, parsedRange.end + 1);
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${parsedRange.start}-${parsedRange.end}/${totalSize}`);
      res.setHeader("Content-Length", String(slice.length));
      res.end(slice);
      return;
    }

    if (rangeHeader && !parsedRange) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${totalSize}`);
      res.end();
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Length", String(totalSize));
    res.end(payload.buffer);
  }

  // RFC 7233 single-range parser. Returns null for unsupported / malformed /
  // unsatisfiable ranges so the caller can return 416 or fall back to 200.
  private parseSingleByteRange(
    rangeHeader: string,
    totalSize: number
  ): { start: number; end: number } | null {
    const match = /^\s*bytes=(\d*)-(\d*)\s*$/.exec(rangeHeader);
    if (!match) {
      return null;
    }
    const startRaw = match[1];
    const endRaw = match[2];
    if (totalSize <= 0) {
      return null;
    }
    let start: number;
    let end: number;
    if (startRaw === "" && endRaw !== "") {
      const suffix = Number(endRaw);
      if (!Number.isFinite(suffix) || suffix <= 0) {
        return null;
      }
      const length = Math.min(suffix, totalSize);
      start = totalSize - length;
      end = totalSize - 1;
    } else if (startRaw !== "") {
      start = Number(startRaw);
      end = endRaw === "" ? totalSize - 1 : Number(endRaw);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return null;
      }
      if (end >= totalSize) {
        end = totalSize - 1;
      }
    } else {
      return null;
    }
    if (start < 0 || start > end || start >= totalSize) {
      return null;
    }
    return { start, end };
  }

  @Patch("assistant/files/:fileRef")
  async updateAssistantFile(
    @Req() req: RequestWithPlatformContext,
    @Param("fileRef") fileRef: string,
    @Body() body: { displayName?: unknown }
  ) {
    const assistant = await this.resolveRequestAssistant(req);
    const displayName =
      typeof body.displayName === "string" && body.displayName.trim().length > 0
        ? body.displayName.trim()
        : null;
    const file = await this.assistantFileRegistryService.updateAssistantFileMetadata({
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      fileRef,
      displayName
    });
    return {
      requestId: req.requestId ?? null,
      file: this.toFileState(file)
    };
  }

  @Delete("assistant/files/:fileRef")
  async deleteAssistantFile(
    @Req() req: RequestWithPlatformContext,
    @Param("fileRef") fileRef: string
  ) {
    const assistant = await this.resolveRequestAssistant(req);
    await this.assistantFileRegistryService.deleteAssistantFile({
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      fileRef
    });
    return {
      requestId: req.requestId ?? null,
      deleted: true
    };
  }

  private buildContentDisposition(filename: string, mode: "attachment" | "inline"): string {
    const sanitizedFilename = filename.replace(/["\r\n]/g, "_");
    const encodedFilename = encodeURIComponent(filename);
    return `${mode}; filename="${sanitizedFilename}"; filename*=UTF-8''${encodedFilename}`;
  }

  private prepareDownloadPayload(input: {
    buffer: Buffer;
    contentType: string;
    forceDownload: boolean;
  }): { buffer: Buffer; contentType: string } {
    const contentType = this.withUtf8CharsetForText(input.contentType);
    if (!input.forceDownload || !this.isUtf8BomHelpfulTextContent(contentType)) {
      return { buffer: input.buffer, contentType };
    }
    if (
      input.buffer.length >= 3 &&
      input.buffer[0] === 0xef &&
      input.buffer[1] === 0xbb &&
      input.buffer[2] === 0xbf
    ) {
      return { buffer: input.buffer, contentType };
    }
    return { buffer: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), input.buffer]), contentType };
  }

  private withUtf8CharsetForText(contentType: string): string {
    const [rawMimeType, ...params] = contentType.split(";");
    const mimeType = (rawMimeType ?? contentType).trim().toLowerCase();
    if (!this.isTextLikeContentType(mimeType) || params.some((param) => /charset=/i.test(param))) {
      return contentType;
    }
    return `${mimeType}; charset=utf-8`;
  }

  private isTextLikeContentType(mimeTypeWithParams: string): boolean {
    const mimeType = mimeTypeWithParams.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    return (
      mimeType.startsWith("text/") ||
      mimeType === "application/json" ||
      mimeType === "application/x-ndjson" ||
      mimeType === "application/xml" ||
      mimeType === "application/yaml" ||
      mimeType === "application/x-yaml"
    );
  }

  private isUtf8BomHelpfulTextContent(contentType: string): boolean {
    const mimeType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    return (
      mimeType === "text/plain" ||
      mimeType === "text/markdown" ||
      mimeType === "text/csv" ||
      mimeType === "text/tab-separated-values"
    );
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }

  private async resolveRequestAssistant(req: RequestWithPlatformContext) {
    const userId = this.resolveRequestUserId(req);
    const assistant = await this.getAssistantByUserIdService.execute(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }
    return assistant;
  }

  private parseLimit(value: string | undefined): number {
    const parsed = typeof value === "string" ? Number.parseInt(value, 10) : 50;
    if (!Number.isFinite(parsed)) {
      return 50;
    }
    return Math.min(Math.max(parsed, 1), 100);
  }

  private toFileState(file: AssistantFileRegistryRecord) {
    return {
      fileRef: file.fileRef,
      origin: file.origin,
      displayName: file.displayName,
      filename: this.basename(file.relativePath),
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      logicalSizeBytes: file.logicalSizeBytes,
      fileBucket: file.fileBucket,
      cleanupEligible: file.cleanupEligible,
      cleanupReason: file.cleanupReason,
      createdAt: file.createdAt.toISOString()
    };
  }

  private toCleanupSummary(files: AssistantFileRegistryRecord[]) {
    return files.reduce(
      (summary, file) =>
        file.cleanupEligible
          ? {
              eligibleCount: summary.eligibleCount + 1,
              eligibleBytes: summary.eligibleBytes + file.sizeBytes
            }
          : summary,
      { eligibleCount: 0, eligibleBytes: 0 }
    );
  }

  private basename(relativePath: string): string {
    const parts = relativePath.split("/").filter((part) => part.length > 0);
    return parts.at(-1) ?? relativePath;
  }
}
