import { Body, Controller, Get, Put, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageAdminBillingProviderCredentialsService } from "../../application/manage-admin-billing-provider-credentials.service";
import type { AdminBillingProviderCredentialsState } from "../../application/billing-provider-credential-settings";

@Controller("api/v1/admin/tools/billing")
export class AdminBillingProviderCredentialsController {
  constructor(
    private readonly manageAdminBillingProviderCredentialsService: ManageAdminBillingProviderCredentialsService
  ) {}

  @Get()
  async getCredentials(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    settings: AdminBillingProviderCredentialsState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const settings = await this.manageAdminBillingProviderCredentialsService.getCredentials(userId);
    return {
      requestId: req.requestId ?? null,
      settings
    };
  }

  @Put()
  async updateCredentials(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    settings: AdminBillingProviderCredentialsState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminBillingProviderCredentialsService.parseUpdateInput(body);
    const settings = await this.manageAdminBillingProviderCredentialsService.updateCredentials(
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
