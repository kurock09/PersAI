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
import type { LocalBrowserBridgeDeviceKind } from "@persai/runtime-contract";
import { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import {
  AssistantBrowserProfileService,
  type AssistantBrowserProfileSettingsItem
} from "../../application/assistant-browser-profile.service";
import { ResolveActiveAssistantService } from "../../application/resolve-active-assistant.service";

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
  loginUrl: string;
  workspaceId: string;
  bridgeClientKind: LocalBrowserBridgeDeviceKind;
  status: AssistantBrowserProfileSettingsItem["status"];
  completionMode?: "login" | "assist";
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
    await this.assistantBrowserProfileService.deleteProfile({
      profileId,
      assistantId: context.assistantId,
      workspaceId: context.workspaceId
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
    const result = await this.assistantBrowserProfileService.reconnectLogin({
      profileId,
      assistantId: context.assistantId,
      workspaceId: context.workspaceId
    });
    return {
      requestId: req.requestId ?? null,
      profileId: result.profileId,
      profileKey: result.profileKey,
      displayName: result.displayName,
      loginUrl: result.loginUrl,
      workspaceId: result.workspaceId,
      bridgeClientKind: result.bridgeClientKind,
      status: result.status
    };
  }

  @Post("assistant/:assistantId/browser-profiles/:profileId/open-live")
  @HttpCode(200)
  async openLiveView(
    @Req() req: RequestWithPlatformContext,
    @Param("assistantId") assistantId: string,
    @Param("profileId") profileId: string
  ): Promise<ReconnectLoginResponse> {
    const context = await this.resolveAssistantContext(req, assistantId);
    const result = await this.assistantBrowserProfileService.openLiveView({
      profileId,
      assistantId: context.assistantId,
      workspaceId: context.workspaceId
    });
    return {
      requestId: req.requestId ?? null,
      profileId: result.profileId,
      profileKey: result.profileKey,
      displayName: result.displayName,
      loginUrl: result.loginUrl,
      workspaceId: result.workspaceId,
      bridgeClientKind: result.bridgeClientKind,
      status: result.status,
      completionMode: result.completionMode
    };
  }

  @Post("assistant/:assistantId/browser-profiles/:profileId/dismiss-live")
  @HttpCode(200)
  async dismissLiveView(
    @Req() req: RequestWithPlatformContext,
    @Param("assistantId") assistantId: string,
    @Param("profileId") profileId: string
  ): Promise<{ requestId: string | null; dismissed: true }> {
    const context = await this.resolveAssistantContext(req, assistantId);
    await this.assistantBrowserProfileService.dismissLiveView({
      profileId,
      assistantId: context.assistantId,
      workspaceId: context.workspaceId
    });
    return {
      requestId: req.requestId ?? null,
      dismissed: true
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
    const result = await this.assistantBrowserProfileService.completeLogin({
      profileId,
      assistantId: context.assistantId,
      workspaceId: context.workspaceId
    });
    return {
      requestId: req.requestId ?? null,
      profile: result.profile
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
