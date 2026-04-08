import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import type {
  AdminOverviewDashboardState,
  OverviewLatencyTraceState
} from "../../application/overview-dashboard.types";
import { ManageAdminOverviewLatencyTraceService } from "../../application/manage-admin-overview-latency-trace.service";
import { ResolveAdminOverviewDashboardService } from "../../application/resolve-admin-overview-dashboard.service";

@Controller("api/v1/admin/overview")
export class AdminOverviewDashboardController {
  constructor(
    private readonly resolveAdminOverviewDashboardService: ResolveAdminOverviewDashboardService,
    private readonly manageAdminOverviewLatencyTraceService: ManageAdminOverviewLatencyTraceService
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

  @Post("latency-trace")
  @HttpCode(HttpStatus.OK)
  async setLatencyTrace(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    latencyTrace: OverviewLatencyTraceState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminOverviewLatencyTraceService.parseInput(body);
    const latencyTrace = await this.manageAdminOverviewLatencyTraceService.setEnabled(
      userId,
      input
    );
    return {
      requestId: req.requestId ?? null,
      latencyTrace
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
