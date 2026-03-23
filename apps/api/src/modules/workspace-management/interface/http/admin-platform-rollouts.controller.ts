import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import {
  ManagePlatformRolloutsService,
  type CreatePlatformRolloutInput
} from "../../application/manage-platform-rollouts.service";
import type { PlatformRolloutState } from "../../application/platform-rollout.types";

@Controller("api/v1/admin/platform-rollouts")
export class AdminPlatformRolloutsController {
  constructor(private readonly managePlatformRolloutsService: ManagePlatformRolloutsService) {}

  @Get()
  async listRollouts(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    rollouts: PlatformRolloutState[];
  }> {
    const userId = this.resolveRequestUserId(req);
    const rollouts = await this.managePlatformRolloutsService.listRollouts(userId);
    return {
      requestId: req.requestId ?? null,
      rollouts
    };
  }

  @Post()
  async createRollout(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    rollout: PlatformRolloutState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input: CreatePlatformRolloutInput = this.managePlatformRolloutsService.parseCreateInput(body);
    const rollout = await this.managePlatformRolloutsService.createRollout(
      userId,
      input,
      this.resolveStepUpToken(req)
    );
    return {
      requestId: req.requestId ?? null,
      rollout
    };
  }

  @Post(":rolloutId/rollback")
  async rollbackRollout(
    @Req() req: RequestWithPlatformContext,
    @Param("rolloutId") rolloutId: string
  ): Promise<{
    requestId: string | null;
    rollout: PlatformRolloutState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const rollout = await this.managePlatformRolloutsService.rollbackRollout(
      userId,
      rolloutId,
      this.resolveStepUpToken(req)
    );
    return {
      requestId: req.requestId ?? null,
      rollout
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }

  private resolveStepUpToken(req: RequestWithPlatformContext): string | null {
    const header = req.headers["x-persai-step-up-token"];
    if (Array.isArray(header)) {
      return header[0] ?? null;
    }
    return typeof header === "string" ? header : null;
  }
}
