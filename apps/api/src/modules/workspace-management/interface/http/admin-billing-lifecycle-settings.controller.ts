import { Body, Controller, Get, Put, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageAdminBillingLifecycleSettingsService } from "../../application/manage-admin-billing-lifecycle-settings.service";
import type { BillingLifecycleSettingsState } from "../../application/billing-lifecycle-settings";

@Controller("api/v1/admin/billing/lifecycle-settings")
export class AdminBillingLifecycleSettingsController {
  constructor(
    private readonly manageAdminBillingLifecycleSettingsService: ManageAdminBillingLifecycleSettingsService
  ) {}

  @Get()
  async getSettings(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    settings: BillingLifecycleSettingsState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const settings = await this.manageAdminBillingLifecycleSettingsService.getSettings(userId);
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
    settings: BillingLifecycleSettingsState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminBillingLifecycleSettingsService.parseUpdateInput(body);
    const settings = await this.manageAdminBillingLifecycleSettingsService.updateSettings(
      userId,
      input,
      this.resolveStepUpToken(req)
    );
    return {
      requestId: req.requestId ?? null,
      settings
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
