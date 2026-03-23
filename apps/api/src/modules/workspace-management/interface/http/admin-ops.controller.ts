import { Controller, Get, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ResolveAdminOpsCockpitService } from "../../application/resolve-admin-ops-cockpit.service";
import type { AdminOpsCockpitState } from "../../application/ops-cockpit.types";

@Controller("api/v1/admin/ops")
export class AdminOpsController {
  constructor(private readonly resolveAdminOpsCockpitService: ResolveAdminOpsCockpitService) {}

  @Get("cockpit")
  async getOpsCockpit(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    cockpit: AdminOpsCockpitState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const cockpit = await this.resolveAdminOpsCockpitService.execute(userId);
    return {
      requestId: req.requestId ?? null,
      cockpit
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
