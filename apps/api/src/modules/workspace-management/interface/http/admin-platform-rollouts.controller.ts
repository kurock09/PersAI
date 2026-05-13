import { Controller, Get, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import {
  MaterializationRolloutService,
  type MaterializationRolloutQueueSummary
} from "../../application/materialization-rollout.service";

@Controller("api/v1/admin/platform-rollouts")
export class AdminPlatformRolloutsController {
  constructor(private readonly materializationRolloutService: MaterializationRolloutService) {}

  @Get()
  async listRollouts(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    rollouts: MaterializationRolloutQueueSummary[];
  }> {
    const userId = this.resolveRequestUserId(req);
    const rollouts = await this.materializationRolloutService.listRollouts(userId);
    return {
      requestId: req.requestId ?? null,
      rollouts
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
