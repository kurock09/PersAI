import { Body, Controller, Get, Put, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageAdminRuntimeProviderSettingsService } from "../../application/manage-admin-runtime-provider-settings.service";
import type { PlatformLiveVoiceReadinessSettings } from "../../application/platform-runtime-provider-settings";

/**
 * ADR-114 — admin surface for live voice readiness (enabled, agentId,
 * transportRoute). Kept separate from the full provider-settings replace so a
 * small toggle does not rewrite the whole runtime profile or trigger a
 * materialization rollout. Follows the same raw-fetch admin convention used by
 * the tool-credentials surface (not part of the OpenAPI contract).
 */
@Controller("api/v1/admin/runtime/live-voice")
export class AdminLiveVoiceSettingsController {
  constructor(
    private readonly manageAdminRuntimeProviderSettingsService: ManageAdminRuntimeProviderSettingsService
  ) {}

  @Get()
  async getReadiness(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    liveVoice: PlatformLiveVoiceReadinessSettings;
  }> {
    const userId = this.resolveRequestUserId(req);
    const liveVoice =
      await this.manageAdminRuntimeProviderSettingsService.getLiveVoiceReadiness(userId);
    return {
      requestId: req.requestId ?? null,
      liveVoice
    };
  }

  @Put()
  async updateReadiness(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    liveVoice: PlatformLiveVoiceReadinessSettings;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminRuntimeProviderSettingsService.parseLiveVoiceInput(body);
    const liveVoice = await this.manageAdminRuntimeProviderSettingsService.updateLiveVoiceReadiness(
      userId,
      input,
      this.resolveStepUpToken(req)
    );
    return {
      requestId: req.requestId ?? null,
      liveVoice
    };
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
