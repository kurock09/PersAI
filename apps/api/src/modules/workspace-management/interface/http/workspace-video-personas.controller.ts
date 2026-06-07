import {
  BadRequestException,
  Body,
  Controller,
  Patch,
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
import {
  ManageWorkspaceVideoPersonasService,
  type CreatePersonaResult,
  type UpdatePersonaResult,
  type PersonaListItem
} from "../../application/heygen/manage-workspace-video-personas.service";
import {
  ReadHeygenVoiceCatalogForWorkspaceService,
  type WorkspaceVoiceCatalogResult
} from "../../application/heygen/read-heygen-voice-catalog-for-workspace.service";
import { ResolveActiveAssistantService } from "../../application/resolve-active-assistant.service";

/**
 * ADR-109 Slice 5 — workspace-scoped video persona REST controller.
 *
 * Route prefix: `api/v1/workspaces/:workspaceId/video-personas`
 *
 * Authorization: fail-closed workspace ownership check — the authenticated
 * user's resolved workspace (`req.workspaceId` set by auth middleware) must
 * match the `:workspaceId` URL param. If they don't match the request is
 * rejected with 401. This is a simple, safe implementation; a full
 * `WorkspaceMembershipGuard` abstraction can be extracted in a follow-up
 * slice if the pattern needs to be reused.
 *
 * Persona creation is REST-only (cross-slice invariant #14). The runtime
 * MUST NOT route to this controller or mutate `workspace_video_personas`.
 */
@Controller("api/v1/workspaces/:workspaceId/video-personas")
export class WorkspaceVideoPersonasController {
  constructor(
    private readonly manageWorkspaceVideoPersonasService: ManageWorkspaceVideoPersonasService,
    private readonly readHeygenVoiceCatalogForWorkspaceService: ReadHeygenVoiceCatalogForWorkspaceService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor("portrait"))
  async createPersona(
    @Req() req: RequestWithPlatformContext,
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; originalname: string } | undefined
  ): Promise<CreatePersonaResult> {
    const userId = this.resolveUserId(req);
    await this.assertWorkspaceAccess(userId, workspaceId);

    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw new BadRequestException({
        message: "Portrait image file is required.",
        code: "portrait_required"
      });
    }

    const displayName = this.parseStringField(body, "displayName");
    const heygenVoiceId = this.parseStringField(body, "heygenVoiceId");
    const clonedVoiceId = this.parseNullableStringField(body, "clonedVoiceId");

    return this.manageWorkspaceVideoPersonasService.createPersona({
      workspaceId,
      userId,
      displayName,
      portraitImageFile: {
        buffer: file.buffer,
        mimeType: file.mimetype,
        originalFilename: file.originalname
      },
      heygenVoiceId,
      ...(clonedVoiceId === undefined ? {} : { clonedVoiceId })
    });
  }

  @Get()
  async listPersonas(
    @Req() req: RequestWithPlatformContext,
    @Param("workspaceId") workspaceId: string
  ): Promise<{ personas: PersonaListItem[]; limit: number; creationVcoinCost: number }> {
    const userId = this.resolveUserId(req);
    await this.assertWorkspaceAccess(userId, workspaceId);
    return this.manageWorkspaceVideoPersonasService.listPersonas({ workspaceId });
  }

  @Get("voice-catalog")
  async getVoiceCatalog(
    @Req() req: RequestWithPlatformContext,
    @Param("workspaceId") workspaceId: string
  ): Promise<{ provider: "heygen"; voices: NonNullable<WorkspaceVoiceCatalogResult>["voices"] }> {
    const userId = this.resolveUserId(req);
    await this.assertWorkspaceAccess(userId, workspaceId);
    const result =
      await this.readHeygenVoiceCatalogForWorkspaceService.getVoiceCatalogForWorkspace(workspaceId);
    return {
      provider: "heygen",
      voices: result?.voices ?? []
    };
  }

  @Delete(":personaId")
  @HttpCode(200)
  async archivePersona(
    @Req() req: RequestWithPlatformContext,
    @Param("workspaceId") workspaceId: string,
    @Param("personaId") personaId: string
  ): Promise<{ archived: true; personaId: string }> {
    const userId = this.resolveUserId(req);
    await this.assertWorkspaceAccess(userId, workspaceId);
    return this.manageWorkspaceVideoPersonasService.archivePersona({ workspaceId, personaId });
  }

  @Patch(":personaId")
  async updatePersona(
    @Req() req: RequestWithPlatformContext,
    @Param("workspaceId") workspaceId: string,
    @Param("personaId") personaId: string,
    @Body() body: unknown
  ): Promise<UpdatePersonaResult> {
    const userId = this.resolveUserId(req);
    await this.assertWorkspaceAccess(userId, workspaceId);

    const displayName = this.parseStringField(body, "displayName");
    const heygenVoiceId = this.parseOptionalStringField(body, "heygenVoiceId");
    const clonedVoiceId = this.parseNullableStringField(body, "clonedVoiceId");

    return this.manageWorkspaceVideoPersonasService.updatePersona({
      workspaceId,
      personaId,
      displayName,
      ...(heygenVoiceId === undefined ? {} : { heygenVoiceId }),
      ...(clonedVoiceId === undefined ? {} : { clonedVoiceId })
    });
  }

  @Get(":personaId/portrait")
  async getPersonaPortrait(
    @Req() req: RequestWithPlatformContext,
    @Res() res: ResponseWithPlatformContext,
    @Param("workspaceId") workspaceId: string,
    @Param("personaId") personaId: string
  ): Promise<void> {
    const userId = this.resolveUserId(req);
    await this.assertWorkspaceAccess(userId, workspaceId);
    const portrait = await this.manageWorkspaceVideoPersonasService.readPersonaPortrait({
      workspaceId,
      personaId
    });
    res.statusCode = 200;
    res.setHeader("Content-Type", portrait.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("ETag", `"${portrait.etag}"`);
    res.end(portrait.buffer);
  }

  /**
   * Fail-closed workspace membership guard. Resolves the user's current
   * workspace from canonical membership state instead of `req.workspaceId`,
   * because some authenticated web flows currently carry `userId` without
   * hydrating `req.workspaceId` on these routes.
   */
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

  /**
   * Defensively parse a string field from a multipart form body object.
   * The body arrives as a plain object from NestJS FileInterceptor — no
   * implicit `as any` casts.
   */
  private parseStringField(rawBody: unknown, fieldName: string): string {
    const body =
      rawBody !== null && typeof rawBody === "object" ? (rawBody as Record<string, unknown>) : {};
    const value = body[fieldName];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException({
        message: `Field "${fieldName}" is required and must be a non-empty string.`,
        code: "invalid_field"
      });
    }
    return value.trim();
  }

  private parseOptionalStringField(rawBody: unknown, fieldName: string): string | undefined {
    const body =
      rawBody !== null && typeof rawBody === "object" ? (rawBody as Record<string, unknown>) : {};
    if (!(fieldName in body)) {
      return undefined;
    }
    const value = body[fieldName];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException({
        message: `Field "${fieldName}" must be a non-empty string when provided.`,
        code: "invalid_field"
      });
    }
    return value.trim();
  }

  private parseNullableStringField(rawBody: unknown, fieldName: string): string | null | undefined {
    const body =
      rawBody !== null && typeof rawBody === "object" ? (rawBody as Record<string, unknown>) : {};
    if (!(fieldName in body)) {
      return undefined;
    }
    const value = body[fieldName];
    if (value === null) {
      return null;
    }
    if (typeof value !== "string") {
      throw new BadRequestException({
        message: `Field "${fieldName}" must be a string, null, or omitted.`,
        code: "invalid_field"
      });
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
}
