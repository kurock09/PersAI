import { Controller, Get, Req } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageAdminPlansService } from "../../application/manage-admin-plans.service";
import type { PublicPricingPlanState } from "../../application/admin-plan-management.types";

@Controller("api/v1/public/plans")
export class PublicPricingPlansController {
  constructor(private readonly manageAdminPlansService: ManageAdminPlansService) {}

  @Get("pricing")
  async listPricingPlans(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    plans: PublicPricingPlanState[];
  }> {
    const plans = await this.manageAdminPlansService.listPublicPricingPlans();
    return {
      requestId: req.requestId ?? null,
      plans
    };
  }
}
