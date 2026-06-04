import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import {
  ManageWorkspaceVideoPersonasService,
  type CreatePersonaResult,
  type PersonaListItem
} from "../../application/heygen/manage-workspace-video-personas.service";

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
    private readonly manageWorkspaceVideoPersonasService: ManageWorkspaceVideoPersonasService
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
    this.assertWorkspaceAccess(req, workspaceId);

    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw new BadRequestException({
        message: "Portrait image file is required.",
        code: "portrait_required"
      });
    }

    const displayName = this.parseStringField(body, "displayName");
    const heygenVoiceId = this.parseStringField(body, "heygenVoiceId");

    return this.manageWorkspaceVideoPersonasService.createPersona({
      workspaceId,
      userId,
      displayName,
      portraitImageFile: {
        buffer: file.buffer,
        mimeType: file.mimetype,
        originalFilename: file.originalname
      },
      heygenVoiceId
    });
  }

  @Get()
  async listPersonas(
    @Req() req: RequestWithPlatformContext,
    @Param("workspaceId") workspaceId: string
  ): Promise<{ personas: PersonaListItem[]; limit: number }> {
    this.resolveUserId(req);
    this.assertWorkspaceAccess(req, workspaceId);
    return this.manageWorkspaceVideoPersonasService.listPersonas({ workspaceId });
  }

  @Delete(":personaId")
  @HttpCode(200)
  async archivePersona(
    @Req() req: RequestWithPlatformContext,
    @Param("workspaceId") workspaceId: string,
    @Param("personaId") personaId: string
  ): Promise<{ archived: true; personaId: string }> {
    this.resolveUserId(req);
    this.assertWorkspaceAccess(req, workspaceId);
    return this.manageWorkspaceVideoPersonasService.archivePersona({ workspaceId, personaId });
  }

  /**
   * Fail-closed workspace ownership guard. Compares the `:workspaceId` URL
   * param against the user's resolved workspace from the auth middleware.
   * If they don't match, the user is either unauthenticated or attempting
   * cross-workspace access — both cases are rejected as 401.
   *
   * Note: `req.workspaceId` is the authenticated user's current workspace,
   * set by the platform auth middleware from the user's session context.
   */
  private assertWorkspaceAccess(req: RequestWithPlatformContext, workspaceId: string): void {
    if (req.workspaceId !== workspaceId) {
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
}
