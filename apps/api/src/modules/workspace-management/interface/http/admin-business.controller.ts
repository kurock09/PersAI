import { Controller, Get, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import type { AdminBusinessCockpitState } from "../../application/business-cockpit.types";
import type { AdminBusinessPlatformState } from "../../application/platform-business.types";
import { ResolveAdminBusinessCockpitService } from "../../application/resolve-admin-business-cockpit.service";
import { ResolveAdminBusinessPlatformService } from "../../application/resolve-admin-business-platform.service";

@Controller("api/v1/admin/business")
export class AdminBusinessController {
  constructor(
    private readonly resolveAdminBusinessCockpitService: ResolveAdminBusinessCockpitService,
    private readonly resolveAdminBusinessPlatformService: ResolveAdminBusinessPlatformService
  ) {}

  @Get("cockpit")
  async getBusinessCockpit(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    cockpit: AdminBusinessCockpitState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const cockpit = await this.resolveAdminBusinessCockpitService.execute(userId);
    return {
      requestId: req.requestId ?? null,
      cockpit
    };
  }

  @Get("platform")
  async getBusinessPlatform(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    platform: AdminBusinessPlatformState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const platform = await this.resolveAdminBusinessPlatformService.execute(userId);
    return {
      requestId: req.requestId ?? null,
      platform
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
