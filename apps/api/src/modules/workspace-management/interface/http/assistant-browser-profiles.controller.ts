import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import {
  AssistantBrowserProfileService,
  type AssistantBrowserProfileSettingsItem
} from "../../application/assistant-browser-profile.service";
import { ResolveActiveAssistantService } from "../../application/resolve-active-assistant.service";
import { resolveBrowserToolCredentialSecretId } from "../../application/tool-credential-settings";

type BrowserProfilesListResponse = {
  requestId: string | null;
  assistantId: string;
  profiles: AssistantBrowserProfileSettingsItem[];
};

type CompleteLoginResponse = {
  requestId: string | null;
  profile: AssistantBrowserProfileSettingsItem;
};

type ReconnectLoginResponse = {
  requestId: string | null;
  profileId: string;
  profileKey: string;
  displayName: string;
  liveUrl: string;
  loginUrl: string;
  status: AssistantBrowserProfileSettingsItem["status"];
};

type DeleteProfileResponse = {
  requestId: string | null;
  deleted: true;
};

@Controller("api/v1")
export class AssistantBrowserProfilesController {
  constructor(
    private readonly assistantBrowserProfileService: AssistantBrowserProfileService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService
  ) {}

  @Get("assistant/:assistantId/browser-profiles")
  async listProfiles(
    @Req() req: RequestWithPlatformContext,
    @Param("assistantId") assistantId: string
  ): Promise<BrowserProfilesListResponse> {
    const context = await this.resolveAssistantContext(req, assistantId);
    const result = await this.assistantBrowserProfileService.listProfiles(
      context.assistantId,
      context.workspaceId
    );
    return {
      requestId: req.requestId ?? null,
      assistantId: context.assistantId,
      profiles: result.profiles
    };
  }

  @Delete("assistant/:assistantId/browser-profiles/:profileId")
  @HttpCode(200)
  async deleteProfile(
    @Req() req: RequestWithPlatformContext,
    @Param("assistantId") assistantId: string,
    @Param("profileId") profileId: string
  ): Promise<DeleteProfileResponse> {
    const context = await this.resolveAssistantContext(req, assistantId);
    const browserCredentialSecretId = resolveBrowserToolCredentialSecretId();
    await this.assistantBrowserProfileService.deleteProfile({
      profileId,
      assistantId: context.assistantId,
      workspaceId: context.workspaceId,
      browserCredentialSecretId
    });
    return {
      requestId: req.requestId ?? null,
      deleted: true
    };
  }

  @Post("assistant/:assistantId/browser-profiles/:profileId/reconnect")
  @HttpCode(200)
  async reconnectLogin(
    @Req() req: RequestWithPlatformContext,
    @Param("assistantId") assistantId: string,
    @Param("profileId") profileId: string
  ): Promise<ReconnectLoginResponse> {
    const context = await this.resolveAssistantContext(req, assistantId);
    const browserCredentialSecretId = resolveBrowserToolCredentialSecretId();
    const result = await this.assistantBrowserProfileService.reconnectLogin({
      profileId,
      assistantId: context.assistantId,
      workspaceId: context.workspaceId,
      browserCredentialSecretId
    });
    return {
      requestId: req.requestId ?? null,
      profileId: result.profileId,
      profileKey: result.profileKey,
      displayName: result.displayName,
      liveUrl: result.liveUrl,
      loginUrl: result.loginUrl,
      status: result.status
    };
  }

  @Post("assistant/:assistantId/browser-profiles/:profileId/complete-login")
  @HttpCode(200)
  async completeLogin(
    @Req() req: RequestWithPlatformContext,
    @Param("assistantId") assistantId: string,
    @Param("profileId") profileId: string
  ): Promise<CompleteLoginResponse> {
    const context = await this.resolveAssistantContext(req, assistantId);
    const browserCredentialSecretId = resolveBrowserToolCredentialSecretId();
    const result = await this.assistantBrowserProfileService.completeLogin({
      profileId,
      assistantId: context.assistantId,
      workspaceId: context.workspaceId,
      browserCredentialSecretId
    });
    return {
      requestId: req.requestId ?? null,
      profile: result.profile
    };
  }

  @Get("assistant/:assistantId/browser-profiles/:profileId/live-upstream")
  async resolveLiveUpstream(
    @Req() req: RequestWithPlatformContext,
    @Param("assistantId") assistantId: string,
    @Param("profileId") profileId: string
  ): Promise<{ requestId: string | null; upstreamLiveUrl: string }> {
    const context = await this.resolveAssistantContext(req, assistantId);
    const result = await this.assistantBrowserProfileService.resolveLiveUpstreamForProfile({
      profileId,
      assistantId: context.assistantId,
      workspaceId: context.workspaceId
    });
    return {
      requestId: req.requestId ?? null,
      upstreamLiveUrl: result.upstreamLiveUrl
    };
  }

  private async resolveAssistantContext(req: RequestWithPlatformContext, assistantId: string) {
    const userId = this.resolveRequestUserId(req);
    return this.resolveActiveAssistantService.execute({ userId, assistantId });
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
