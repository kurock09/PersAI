import { Body, Controller, Get, Put, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import {
  ManageAdminRuntimeProviderSettingsService,
  type AdminRuntimeProviderSettingsReapplySummary
} from "../../application/manage-admin-runtime-provider-settings.service";
import type { PlatformRuntimeProviderSettingsState } from "../../application/platform-runtime-provider-settings";

@Controller("api/v1/admin/runtime/provider-settings")
export class AdminRuntimeProviderSettingsController {
  constructor(
    private readonly manageAdminRuntimeProviderSettingsService: ManageAdminRuntimeProviderSettingsService
  ) {}

  @Get()
  async getSettings(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    settings: PlatformRuntimeProviderSettingsState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const settings = await this.manageAdminRuntimeProviderSettingsService.getSettings(userId);
    return {
      requestId: req.requestId ?? null,
      settings
    };
  }

  @Put()
  async updateSettings(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    settings: PlatformRuntimeProviderSettingsState;
    reapplySummary: AdminRuntimeProviderSettingsReapplySummary;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminRuntimeProviderSettingsService.parseUpdateInput(body);
    const result = await this.manageAdminRuntimeProviderSettingsService.updateSettings(
      userId,
      input,
      this.resolveStepUpToken(req)
    );
    return {
      requestId: req.requestId ?? null,
      settings: result.settings,
      reapplySummary: result.reapplySummary
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
