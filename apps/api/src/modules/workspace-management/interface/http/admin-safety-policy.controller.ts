import { Body, Controller, Get, Put, Query, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageAdminSafetyPolicyService } from "../../application/manage-admin-safety-policy.service";

@Controller("api/v1/admin/safety-policy")
export class AdminSafetyPolicyController {
  constructor(private readonly manageAdminSafetyPolicyService: ManageAdminSafetyPolicyService) {}

  @Get("heuristic-rules")
  async listHeuristicRules(
    @Req() req: RequestWithPlatformContext,
    @Query("pack") pack?: string,
    @Query("locale") locale?: string,
    @Query("enabled") enabled?: string
  ) {
    const userId = this.resolveRequestUserId(req);
    const rules = await this.manageAdminSafetyPolicyService.listHeuristicRules(userId, {
      ...(pack !== undefined ? { pack } : {}),
      ...(locale !== undefined ? { locale } : {}),
      ...(enabled !== undefined ? { enabled } : {})
    });
    return {
      requestId: req.requestId ?? null,
      rules
    };
  }

  @Put("heuristic-rules")
  async replaceHeuristicRules(@Req() req: RequestWithPlatformContext, @Body() body: unknown) {
    const userId = this.resolveRequestUserId(req);
    const rules = await this.manageAdminSafetyPolicyService.replaceHeuristicRules(userId, body);
    return {
      requestId: req.requestId ?? null,
      rules
    };
  }

  @Get("settings")
  async getSettings(@Req() req: RequestWithPlatformContext) {
    const userId = this.resolveRequestUserId(req);
    const settings = await this.manageAdminSafetyPolicyService.getSettings(userId);
    return {
      requestId: req.requestId ?? null,
      settings
    };
  }

  @Put("settings")
  async updateSettings(@Req() req: RequestWithPlatformContext, @Body() body: unknown) {
    const userId = this.resolveRequestUserId(req);
    const settings = await this.manageAdminSafetyPolicyService.updateSettings(userId, body);
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
}
