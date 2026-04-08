import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import type {
  AdminOverviewDataSource,
  AdminOverviewDashboardState,
  OverviewLatencyTraceState
} from "../../application/overview-dashboard.types";
import { resolveAdminOverviewDataSource } from "../../application/admin-overview-data-source";
import { ManageAdminOverviewLatencyTraceService } from "../../application/manage-admin-overview-latency-trace.service";
import { ResolveAdminOverviewDashboardService } from "../../application/resolve-admin-overview-dashboard.service";

@Controller("api/v1/admin/overview")
export class AdminOverviewDashboardController {
  constructor(
    private readonly resolveAdminOverviewDashboardService: ResolveAdminOverviewDashboardService,
    private readonly manageAdminOverviewLatencyTraceService: ManageAdminOverviewLatencyTraceService
  ) {}

  @Get("dashboard")
  async getDashboard(
    @Req() req: RequestWithPlatformContext,
    @Res({ passthrough: true })
    res: { setHeader(name: string, value: string): unknown }
  ): Promise<{
    requestId: string | null;
    dashboard: AdminOverviewDashboardState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const dashboard = await this.resolveAdminOverviewDashboardService.execute(userId);
    const source = resolveAdminOverviewDataSource();
    res.setHeader("X-Persai-Api-Instance", source.instanceId);
    if (source.podIp !== null) {
      res.setHeader("X-Persai-Api-Pod-Ip", source.podIp);
    }
    return {
      requestId: req.requestId ?? null,
      dashboard
    };
  }

  @Post("latency-trace")
  @HttpCode(HttpStatus.OK)
  async setLatencyTrace(
    @Req() req: RequestWithPlatformContext,
    @Res({ passthrough: true })
    res: { setHeader(name: string, value: string): unknown },
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    latencyTrace: OverviewLatencyTraceState;
    dataSource: AdminOverviewDataSource;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminOverviewLatencyTraceService.parseInput(body);
    const latencyTrace = await this.manageAdminOverviewLatencyTraceService.setEnabled(
      userId,
      input
    );
    const source = resolveAdminOverviewDataSource();
    res.setHeader("X-Persai-Api-Instance", source.instanceId);
    if (source.podIp !== null) {
      res.setHeader("X-Persai-Api-Pod-Ip", source.podIp);
    }
    return {
      requestId: req.requestId ?? null,
      latencyTrace,
      dataSource: source
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
