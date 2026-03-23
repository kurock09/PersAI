import { Controller, Get, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import type { AdminBusinessCockpitState } from "../../application/business-cockpit.types";
import { ResolveAdminBusinessCockpitService } from "../../application/resolve-admin-business-cockpit.service";

@Controller("api/v1/admin/business")
export class AdminBusinessController {
  constructor(
    private readonly resolveAdminBusinessCockpitService: ResolveAdminBusinessCockpitService
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

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
