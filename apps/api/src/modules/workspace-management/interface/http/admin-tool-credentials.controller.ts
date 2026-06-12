import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException
} from "@nestjs/common";
import type {
  RequestWithPlatformContext,
  ResponseWithPlatformContext
} from "../../../platform-core/interface/http/request-http.types";
import { ManageAdminToolCredentialsService } from "../../application/manage-admin-tool-credentials.service";
import type { AdminToolCredentialsState } from "../../application/tool-credential-settings";
import { streamRemoteAudioPreview } from "./stream-remote-audio-preview";

@Controller("api/v1/admin/runtime/tool-credentials")
export class AdminToolCredentialsController {
  constructor(
    private readonly manageAdminToolCredentialsService: ManageAdminToolCredentialsService
  ) {}

  @Get()
  async getCredentials(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    credentials: AdminToolCredentialsState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const credentials = await this.manageAdminToolCredentialsService.getCredentials(userId);
    return {
      requestId: req.requestId ?? null,
      credentials
    };
  }

  @Put()
  async updateCredentials(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    credentials: AdminToolCredentialsState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminToolCredentialsService.parseUpdateInput(body);
    const credentials = await this.manageAdminToolCredentialsService.updateCredentials(
      userId,
      input,
      this.resolveStepUpToken(req)
    );
    return {
      requestId: req.requestId ?? null,
      credentials
    };
  }

  @Post("heygen-voice-catalog/refresh")
  async refreshHeygenVoiceCatalog(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    credentials: AdminToolCredentialsState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const credentials = await this.manageAdminToolCredentialsService.refreshHeygenVoiceCatalog(
      userId,
      this.resolveStepUpToken(req)
    );
    return {
      requestId: req.requestId ?? null,
      credentials
    };
  }

  @Get("heygen-voice-catalog/curation")
  async listHeygenVoiceCuration(@Req() req: RequestWithPlatformContext) {
    const userId = this.resolveRequestUserId(req);
    const catalog = await this.manageAdminToolCredentialsService.listHeygenVoiceCuration(userId);
    return {
      requestId: req.requestId ?? null,
      catalog
    };
  }

  @Patch("heygen-voice-catalog/curation")
  async updateHeygenVoiceCuration(@Req() req: RequestWithPlatformContext, @Body() body: unknown) {
    const userId = this.resolveRequestUserId(req);
    const catalog = await this.manageAdminToolCredentialsService.updateHeygenVoiceCuration(
      userId,
      body,
      this.resolveStepUpToken(req)
    );
    return {
      requestId: req.requestId ?? null,
      catalog
    };
  }

  @Get("heygen-voice-catalog/:voiceId/preview")
  async getHeygenVoicePreview(
    @Req() req: RequestWithPlatformContext,
    @Res() res: ResponseWithPlatformContext,
    @Param("voiceId") voiceId: string
  ): Promise<void> {
    const userId = this.resolveRequestUserId(req);
    const previewUrl =
      await this.manageAdminToolCredentialsService.resolveAdminHeygenVoicePreviewUrl(
        userId,
        voiceId
      );
    if (previewUrl === null) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ message: "Preview audio not found.", code: "preview_not_found" }));
      return;
    }
    await streamRemoteAudioPreview({ request: req, response: res, sourceUrl: previewUrl });
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }

  private resolveStepUpToken(req: RequestWithPlatformContext): string | null {
    const header = req.headers["x-persai-step-up-token"];
    if (Array.isArray(header)) {
      return header[0] ?? null;
    }
    return typeof header === "string" ? header : null;
  }
}
