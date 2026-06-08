import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type {
  RequestWithPlatformContext,
  ResponseWithPlatformContext
} from "../../../platform-core/interface/http/request-http.types";
import { MAX_MEDIA_FILE_BYTES } from "../../application/media/media-security-policy";
import {
  ManageWorkspaceVideoClonedVoicesService,
  type CreateClonedVoiceResult,
  type WorkspaceVideoClonedVoiceDto
} from "../../application/heygen/manage-workspace-video-cloned-voices.service";
import { ReadWorkspaceVideoPreviewService } from "../../application/heygen/read-workspace-video-preview.service";
import { ResolveActiveAssistantService } from "../../application/resolve-active-assistant.service";
import { streamRemoteAudioPreview } from "./stream-remote-audio-preview";

@Controller("api/v1/workspaces/:workspaceId/video-cloned-voices")
export class WorkspaceVideoClonedVoicesController {
  constructor(
    private readonly manageWorkspaceVideoClonedVoicesService: ManageWorkspaceVideoClonedVoicesService,
    private readonly readWorkspaceVideoPreviewService: ReadWorkspaceVideoPreviewService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor("audio", { limits: { fileSize: MAX_MEDIA_FILE_BYTES } }))
  async createClonedVoice(
    @Req() req: RequestWithPlatformContext,
    @Param("workspaceId") workspaceId: string,
    @Body() rawBody: unknown,
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; originalname: string } | undefined
  ): Promise<CreateClonedVoiceResult> {
    const userId = this.resolveUserId(req);
    await this.assertWorkspaceAccess(userId, workspaceId);
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw new BadRequestException({
        message: "Audio file is required.",
        code: "audio_required"
      });
    }
    const body = this.getBodyRecord(rawBody);
    return this.manageWorkspaceVideoClonedVoicesService.createClonedVoice({
      workspaceId,
      displayName: this.parseRequiredString(body, "displayName"),
      audioFile: {
        buffer: file.buffer,
        mimeType: file.mimetype,
        originalFilename: file.originalname
      },
      languageHint: this.parseOptionalString(body, "languageHint"),
      removeBackgroundNoise: this.parseBoolean(body, "removeBackgroundNoise")
    });
  }

  @Get()
  async listClonedVoices(
    @Req() req: RequestWithPlatformContext,
    @Param("workspaceId") workspaceId: string
  ): Promise<{
    clonedVoices: WorkspaceVideoClonedVoiceDto[];
    limit: number;
    creationVcoinCost: number;
  }> {
    const userId = this.resolveUserId(req);
    await this.assertWorkspaceAccess(userId, workspaceId);
    return this.manageWorkspaceVideoClonedVoicesService.listClonedVoices({ workspaceId });
  }

  @Get(":clonedVoiceId/preview")
  async getClonedVoicePreview(
    @Req() req: RequestWithPlatformContext,
    @Param("workspaceId") workspaceId: string,
    @Param("clonedVoiceId") clonedVoiceId: string,
    @Res() res: ResponseWithPlatformContext
  ): Promise<void> {
    const userId = this.resolveUserId(req);
    await this.assertWorkspaceAccess(userId, workspaceId);
    const previewUrl = await this.readWorkspaceVideoPreviewService.resolveClonedVoicePreviewUrl({
      workspaceId,
      clonedVoiceId
    });
    if (previewUrl === null) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ message: "Preview audio not found.", code: "preview_not_found" }));
      return;
    }
    await streamRemoteAudioPreview({ request: req, response: res, sourceUrl: previewUrl });
  }

  @Delete(":clonedVoiceId")
  @HttpCode(200)
  async archiveClonedVoice(
    @Req() req: RequestWithPlatformContext,
    @Param("workspaceId") workspaceId: string,
    @Param("clonedVoiceId") clonedVoiceId: string
  ): Promise<{ archived: true; clonedVoiceId: string }> {
    const userId = this.resolveUserId(req);
    await this.assertWorkspaceAccess(userId, workspaceId);
    return this.manageWorkspaceVideoClonedVoicesService.archiveClonedVoice({
      workspaceId,
      clonedVoiceId
    });
  }

  @Post(":clonedVoiceId/default")
  async setDefaultClonedVoice(
    @Req() req: RequestWithPlatformContext,
    @Param("workspaceId") workspaceId: string,
    @Param("clonedVoiceId") clonedVoiceId: string
  ): Promise<{ clonedVoice: WorkspaceVideoClonedVoiceDto }> {
    const userId = this.resolveUserId(req);
    await this.assertWorkspaceAccess(userId, workspaceId);
    return this.manageWorkspaceVideoClonedVoicesService.setDefaultClonedVoice({
      workspaceId,
      clonedVoiceId
    });
  }

  private async assertWorkspaceAccess(userId: string, workspaceId: string): Promise<void> {
    const membership = await this.resolveActiveAssistantService.resolveMembership(userId);
    if (membership.workspaceId !== workspaceId) {
      throw new UnauthorizedException(
        "Access denied: the requested workspace does not match your authenticated workspace context."
      );
    }
  }

  private resolveUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }

  private getBodyRecord(rawBody: unknown): Record<string, unknown> {
    return rawBody !== null && typeof rawBody === "object"
      ? (rawBody as Record<string, unknown>)
      : {};
  }

  private parseRequiredString(body: Record<string, unknown>, fieldName: string): string {
    const value = body[fieldName];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException({
        message: `Field "${fieldName}" is required and must be a non-empty string.`,
        code: "invalid_field"
      });
    }
    return value.trim();
  }

  private parseOptionalString(body: Record<string, unknown>, fieldName: string): string | null {
    const value = body[fieldName];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private parseBoolean(body: Record<string, unknown>, fieldName: string): boolean {
    const value = body[fieldName];
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") {
        return true;
      }
      if (normalized === "false" || normalized === "") {
        return false;
      }
    }
    if (value === undefined || value === null) {
      return false;
    }
    throw new BadRequestException({
      message: `Field "${fieldName}" must be a boolean when provided.`,
      code: "invalid_field"
    });
  }
}
