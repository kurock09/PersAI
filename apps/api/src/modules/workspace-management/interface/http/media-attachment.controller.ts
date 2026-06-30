import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
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
import { MediaDeliveryService } from "../../application/media/media-delivery.service";
import { PrepareAssistantDocumentPptxService } from "../../application/prepare-assistant-document-pptx.service";
import { ResolveActiveAssistantService } from "../../application/resolve-active-assistant.service";
import { MAX_MEDIA_FILE_BYTES } from "../../application/media/media-security-policy";
import { toAssistantWebChatMessageAttachmentState } from "../../application/media/media.types";
import { ListChatWorkspaceFilesService } from "../../application/list-chat-workspace-files.service";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";

@Controller("api/v1")
export class MediaAttachmentController {
  constructor(
    private readonly manageChatMediaService: ManageChatMediaService,
    private readonly mediaDeliveryService: MediaDeliveryService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    private readonly prepareAssistantDocumentPptxService: PrepareAssistantDocumentPptxService,
    private readonly listChatWorkspaceFilesService: ListChatWorkspaceFilesService,
    private readonly prisma: WorkspaceManagementPrismaService
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
    const attachmentState = toAssistantWebChatMessageAttachmentState({
      id: result.attachment.id,
      storagePath: result.attachment.storagePath,
      thumbnailStoragePath: result.attachment.thumbnailStoragePath,
      posterStoragePath: result.attachment.posterStoragePath,
      attachmentType: result.attachment.attachmentType,
      originalFilename: result.attachment.originalFilename,
      mimeType: result.attachment.mimeType,
      sizeBytes: result.attachment.sizeBytes,
      processingStatus: result.attachment.processingStatus,
      metadata:
        result.attachment.metadata !== null &&
        typeof result.attachment.metadata === "object" &&
        !Array.isArray(result.attachment.metadata)
          ? (result.attachment.metadata as Record<string, unknown>)
          : null,
      createdAt: result.attachment.createdAt
    });

    return {
      requestId: req.requestId ?? null,
      chatId: result.chatId,
      messageId: result.messageId,
      attachment: {
        ...attachmentState,
        messageId: result.attachment.messageId,
        chatId: result.attachment.chatId
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
    const attachmentState = toAssistantWebChatMessageAttachmentState({
      id: attachment.id,
      storagePath: attachment.storagePath,
      thumbnailStoragePath: attachment.thumbnailStoragePath,
      posterStoragePath: attachment.posterStoragePath,
      attachmentType: attachment.attachmentType,
      originalFilename: attachment.originalFilename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      processingStatus: attachment.processingStatus,
      metadata:
        attachment.metadata !== null &&
        typeof attachment.metadata === "object" &&
        !Array.isArray(attachment.metadata)
          ? (attachment.metadata as Record<string, unknown>)
          : null,
      createdAt: attachment.createdAt
    });

    return {
      requestId: req.requestId ?? null,
      attachment: {
        ...attachmentState,
        messageId: attachment.messageId,
        chatId: attachment.chatId
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

  @Get("assistant/chats/web/:chatId/workspace-files")
  async listWorkspaceFiles(
    @Req() req: RequestWithPlatformContext,
    @Param("chatId") chatId: string,
    @Query("scope") scope?: string,
    @Query("type") type?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string
  ) {
    const userId = this.resolveRequestUserId(req);
    const parsedLimit = typeof limit === "string" && limit.trim().length > 0 ? Number(limit) : null;
    const result = await this.listChatWorkspaceFilesService.execute({
      userId,
      chatId,
      scope: scope ?? null,
      type: type ?? null,
      cursor: cursor ?? null,
      ...(parsedLimit !== null && Number.isFinite(parsedLimit) ? { limit: parsedLimit } : {})
    });
    return {
      requestId: req.requestId ?? null,
      files: result.files,
      nextCursor: result.nextCursor
    };
  }

  @Delete("assistant/chats/web/:chatId/files")
  @HttpCode(204)
  async deleteChatFile(
    @Req() req: RequestWithPlatformContext,
    @Param("chatId") chatId: string,
    @Query("path") path: string | undefined
  ): Promise<void> {
    const userId = this.resolveRequestUserId(req);
    const storagePath = typeof path === "string" ? path.trim() : "";
    if (storagePath.length === 0) {
      throw new BadRequestException("path query parameter is required.");
    }
    await this.manageChatMediaService.deleteChatWorkspaceFile({
      userId,
      chatId,
      storagePath
    });
  }

  @Delete("assistant/workspaces/:workspaceId/files")
  @HttpCode(204)
  async deleteWorkspaceFile(
    @Req() req: RequestWithPlatformContext,
    @Param("workspaceId") workspaceId: string,
    @Query("path") path: string | undefined
  ): Promise<void> {
    const assistant = await this.resolveRequestAssistant(req);
    if (assistant.workspaceId !== workspaceId) {
      throw new ForbiddenException("Workspace does not belong to the active assistant.");
    }
    const storagePath = typeof path === "string" ? path.trim() : "";
    if (storagePath.length === 0) {
      throw new BadRequestException("path query parameter is required.");
    }
    if (!storagePath.startsWith("/workspace/")) {
      throw new BadRequestException('path must start with "/workspace/".');
    }
    await this.manageChatMediaService.deleteWorkspaceFile({
      assistantId: assistant.id,
      workspaceId,
      path: storagePath
    });
  }

  // ADR-127 W1 — kept for backward compatibility with existing web clients
  // that still address files by `(chatId, path)`. The workspace-scoped
  // variants (`GET /assistant/workspaces/:workspaceId/files[...]`) handle
  // manifest-only orphan files that have no chatId.
  @Get("assistant/chats/web/:chatId/files")
  async downloadChatFile(
    @Req() req: RequestWithPlatformContext,
    @Res() res: ResponseWithPlatformContext,
    @Param("chatId") chatId: string,
    @Query("path") path: string | undefined,
    @Query("download") download?: string
  ): Promise<void> {
    const assistant = await this.resolveRequestAssistant(req);
    const storagePath = typeof path === "string" ? path.trim() : "";
    if (storagePath.length === 0) {
      throw new BadRequestException("path query parameter is required.");
    }
    await this.assertOwnedWebChat(assistant.id, chatId);

    const result = await this.mediaDeliveryService.downloadChatFileByPath({
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      chatId,
      path: storagePath
    });

    const payload = this.prepareDownloadPayload({
      buffer: result.buffer,
      contentType: this.resolveDownloadContentType(result.contentType, result.mimeType),
      forceDownload: download === "1"
    });

    res.setHeader("Content-Type", payload.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Accept-Ranges", "bytes");
    const resolvedDownloadFilename = this.resolveDownloadFilename(
      result.originalFilename,
      result.mimeType
    );
    if (resolvedDownloadFilename !== null) {
      res.setHeader(
        "Content-Disposition",
        this.buildContentDisposition(
          resolvedDownloadFilename,
          download === "1" ? "attachment" : "inline"
        )
      );
    }

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

  @Get("assistant/chats/web/:chatId/files/preview")
  async previewChatFile(
    @Req() req: RequestWithPlatformContext,
    @Res() res: ResponseWithPlatformContext,
    @Param("chatId") chatId: string,
    @Query("path") path: string | undefined
  ): Promise<void> {
    const assistant = await this.resolveRequestAssistant(req);
    const storagePath = typeof path === "string" ? path.trim() : "";
    if (storagePath.length === 0) {
      throw new BadRequestException("path query parameter is required.");
    }
    await this.assertOwnedWebChat(assistant.id, chatId);

    const result = await this.mediaDeliveryService.previewChatFileByPath({
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      chatId,
      path: storagePath
    });

    const payload = await this.preparePreviewPayload({
      buffer: result.buffer,
      contentType: this.resolveDownloadContentType(result.contentType, result.mimeType)
    });
    res.setHeader("Content-Type", payload.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.statusCode = 200;
    res.setHeader("Content-Length", String(payload.buffer.length));
    res.end(payload.buffer);
  }

  // ADR-127 W1 — workspace-scoped delivery for files whose existence is
  // recorded in `workspace_file_metadata` but who have no chat origin
  // (model `files.write` orphans). Auth gate: resolve the assistant from
  // the auth context and require its workspaceId to match the path.
  // Streaming logic mirrors `downloadChatFile` so existing clients see
  // identical headers (range, content-disposition, content-type, BOM).
  @Get("assistant/workspaces/:workspaceId/files")
  async downloadWorkspaceFile(
    @Req() req: RequestWithPlatformContext,
    @Res() res: ResponseWithPlatformContext,
    @Param("workspaceId") workspaceId: string,
    @Query("path") path: string | undefined,
    @Query("download") download?: string
  ): Promise<void> {
    const assistant = await this.resolveRequestAssistant(req);
    if (assistant.workspaceId !== workspaceId) {
      throw new NotFoundException("Workspace not found for this assistant.");
    }
    const storagePath = typeof path === "string" ? path.trim() : "";
    if (storagePath.length === 0) {
      throw new BadRequestException("path query parameter is required.");
    }

    const result = await this.mediaDeliveryService.downloadWorkspaceFileByPath({
      workspaceId,
      path: storagePath
    });

    const payload = this.prepareDownloadPayload({
      buffer: result.buffer,
      contentType: this.resolveDownloadContentType(result.contentType, result.mimeType),
      forceDownload: download === "1"
    });

    res.setHeader("Content-Type", payload.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Accept-Ranges", "bytes");
    const resolvedDownloadFilename = this.resolveDownloadFilename(
      result.originalFilename,
      result.mimeType
    );
    if (resolvedDownloadFilename !== null) {
      res.setHeader(
        "Content-Disposition",
        this.buildContentDisposition(
          resolvedDownloadFilename,
          download === "1" ? "attachment" : "inline"
        )
      );
    }

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

  @Get("assistant/workspaces/:workspaceId/files/preview")
  async previewWorkspaceFile(
    @Req() _req: RequestWithPlatformContext,
    @Res() res: ResponseWithPlatformContext,
    @Param("workspaceId") workspaceId: string,
    @Query("path") path: string | undefined
  ): Promise<void> {
    const assistant = await this.resolveRequestAssistant(_req);
    if (assistant.workspaceId !== workspaceId) {
      throw new NotFoundException("Workspace not found for this assistant.");
    }
    const storagePath = typeof path === "string" ? path.trim() : "";
    if (storagePath.length === 0) {
      throw new BadRequestException("path query parameter is required.");
    }

    const result = await this.mediaDeliveryService.previewWorkspaceFileByPath({
      workspaceId,
      path: storagePath
    });

    const payload = await this.preparePreviewPayload({
      buffer: result.buffer,
      contentType: this.resolveDownloadContentType(result.contentType, result.mimeType)
    });
    res.setHeader("Content-Type", payload.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.statusCode = 200;
    res.setHeader("Content-Length", String(payload.buffer.length));
    res.end(payload.buffer);
  }

  @HttpCode(202)
  @Post("assistant/documents/:docId/prepare-pptx")
  async preparePresentationPptx(
    @Req() req: RequestWithPlatformContext,
    @Param("docId") docId: string,
    @Body() body: { versionId?: unknown }
  ) {
    const assistant = await this.resolveRequestAssistant(req);
    const result = await this.prepareAssistantDocumentPptxService.execute({
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      docId,
      versionId: typeof body.versionId === "string" ? body.versionId : null
    });
    if (result.status === "rejected") {
      throw new ConflictException(result);
    }
    return {
      requestId: req.requestId ?? null,
      ...result
    };
  }

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

  private buildContentDisposition(filename: string, mode: "attachment" | "inline"): string {
    const sanitizedFilename = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\r\n]/g, "_");
    const encodedFilename = encodeURIComponent(filename);
    return `${mode}; filename="${sanitizedFilename}"; filename*=UTF-8''${encodedFilename}`;
  }

  private resolveDownloadFilename(
    originalFilename: string | null,
    mimeType: string
  ): string | null {
    const preferred = originalFilename?.trim();
    if (preferred && preferred.length > 0) {
      return preferred;
    }
    return this.defaultFilenameForMimeType(mimeType);
  }

  private defaultFilenameForMimeType(mimeType: string): string {
    const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (normalized.startsWith("video/")) {
      return "persai-video";
    }
    if (normalized.startsWith("image/")) {
      return "persai-image";
    }
    if (normalized.startsWith("audio/")) {
      return "persai-audio";
    }
    if (normalized === "application/pdf") {
      return "persai-document.pdf";
    }
    return "persai-file";
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

  private async preparePreviewPayload(input: {
    buffer: Buffer;
    contentType: string;
  }): Promise<{ buffer: Buffer; contentType: string }> {
    const normalizedContentType = input.contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!normalizedContentType.startsWith("image/")) {
      return input;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const sharpFn = require("sharp") as any;
      const result = await sharpFn(input.buffer)
        .rotate()
        .resize(256, 256, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
      return { buffer: result as Buffer, contentType: "image/webp" };
    } catch {
      return input;
    }
  }

  private resolveDownloadContentType(
    storageContentType: string,
    fileMimeType?: string | null
  ): string {
    const normalizedStorage = storageContentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    const normalizedFile = fileMimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (
      typeof fileMimeType === "string" &&
      normalizedFile.length > 0 &&
      (normalizedStorage.length === 0 ||
        normalizedStorage === "application/octet-stream" ||
        normalizedStorage === "binary/octet-stream")
    ) {
      return fileMimeType;
    }
    return storageContentType;
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
    return (await this.resolveActiveAssistantService.execute({ userId })).assistant;
  }

  private async assertOwnedWebChat(assistantId: string, chatId: string): Promise<void> {
    const chat = await this.prisma.assistantChat.findFirst({
      where: { id: chatId, assistantId, surface: "web" },
      select: { id: true }
    });
    if (chat === null) {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }
  }
}
