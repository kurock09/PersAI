import { Body, Controller, Get, Param, Patch, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageAdminPlansService } from "../../application/manage-admin-plans.service";
import type {
  AdminCreatePlanInput,
  AdminPlanInput,
  AdminPlanState
} from "../../application/admin-plan-management.types";

@Controller("api/v1/admin/plans")
export class AdminPlansController {
  constructor(private readonly manageAdminPlansService: ManageAdminPlansService) {}

  @Get()
  async listPlans(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    plans: AdminPlanState[];
  }> {
    const userId = this.resolveRequestUserId(req);
    const plans = await this.manageAdminPlansService.listPlans(userId);
    return {
      requestId: req.requestId ?? null,
      plans
    };
  }

  @Post()
  async createPlan(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    plan: AdminPlanState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input: AdminCreatePlanInput = this.manageAdminPlansService.parseCreateInput(body);
    const plan = await this.manageAdminPlansService.createPlan(userId, input);
    return {
      requestId: req.requestId ?? null,
      plan
    };
  }

  @Patch(":code")
  async updatePlan(
    @Req() req: RequestWithPlatformContext,
    @Param("code") code: string,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    plan: AdminPlanState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input: AdminPlanInput = this.manageAdminPlansService.parseUpdateInput(body);
    const plan = await this.manageAdminPlansService.updatePlan(userId, code, input);
    return {
      requestId: req.requestId ?? null,
      plan
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }

    return req.resolvedAppUser.id;
  }
}
