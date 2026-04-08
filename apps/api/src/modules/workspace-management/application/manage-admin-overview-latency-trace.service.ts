import { BadRequestException, Injectable } from "@nestjs/common";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { OverviewLatencyTraceService } from "./overview-latency-trace.service";
import type { OverviewLatencyTraceState } from "./overview-dashboard.types";

export type SetAdminOverviewLatencyTraceInput = {
  enabled: boolean;
};

@Injectable()
export class ManageAdminOverviewLatencyTraceService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly overviewLatencyTraceService: OverviewLatencyTraceService
  ) {}

  parseInput(body: unknown): SetAdminOverviewLatencyTraceInput {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    if (typeof row.enabled !== "boolean") {
      throw new BadRequestException("enabled must be a boolean.");
    }
    return { enabled: row.enabled };
  }

  async setEnabled(
    adminUserId: string,
    input: SetAdminOverviewLatencyTraceInput
  ): Promise<OverviewLatencyTraceState> {
    await this.adminAuthorizationService.assertCanManageAbuseControls(adminUserId);
    return this.overviewLatencyTraceService.setEnabled(input.enabled);
  }
}
