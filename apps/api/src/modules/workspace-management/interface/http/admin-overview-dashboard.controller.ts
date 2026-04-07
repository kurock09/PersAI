import { Controller, Get, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import type { AdminOverviewDashboardState } from "../../application/overview-dashboard.types";
import { ResolveAdminOverviewDashboardService } from "../../application/resolve-admin-overview-dashboard.service";

@Controller("api/v1/admin/overview")
export class AdminOverviewDashboardController {
  constructor(
    private readonly resolveAdminOverviewDashboardService: ResolveAdminOverviewDashboardService
  ) {}

  @Get("dashboard")
  async getDashboard(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    dashboard: AdminOverviewDashboardState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const dashboard = await this.resolveAdminOverviewDashboardService.execute(userId);
    return {
      requestId: req.requestId ?? null,
      dashboard
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
