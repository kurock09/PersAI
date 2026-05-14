import { Controller, Get, HttpCode, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import {
  MaterializationRolloutService,
  type MaterializationRolloutItemView,
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

  @Get(":rolloutId/failed-items")
  async listFailedItems(
    @Req() req: RequestWithPlatformContext,
    @Param("rolloutId") rolloutId: string
  ): Promise<{
    requestId: string | null;
    rollout: MaterializationRolloutQueueSummary;
    items: MaterializationRolloutItemView[];
  }> {
    const userId = this.resolveRequestUserId(req);
    const result = await this.materializationRolloutService.listFailedItems(userId, rolloutId);
    return {
      requestId: req.requestId ?? null,
      rollout: result.rollout,
      items: result.items
    };
  }

  @HttpCode(200)
  @Post(":rolloutId/retry-failed")
  async retryFailedItems(
    @Req() req: RequestWithPlatformContext,
    @Param("rolloutId") rolloutId: string
  ): Promise<{
    requestId: string | null;
    rollout: MaterializationRolloutQueueSummary;
    retriedCount: number;
  }> {
    const userId = this.resolveRequestUserId(req);
    const stepUpToken = this.readStepUpToken(req);
    const result = await this.materializationRolloutService.retryFailedItems(
      userId,
      rolloutId,
      stepUpToken
    );
    return {
      requestId: req.requestId ?? null,
      rollout: result.rollout,
      retriedCount: result.retriedCount
    };
  }

  @HttpCode(200)
  @Post(":rolloutId/cancel-pending")
  async cancelPendingItems(
    @Req() req: RequestWithPlatformContext,
    @Param("rolloutId") rolloutId: string
  ): Promise<{
    requestId: string | null;
    rollout: MaterializationRolloutQueueSummary;
    cancelledCount: number;
  }> {
    const userId = this.resolveRequestUserId(req);
    const stepUpToken = this.readStepUpToken(req);
    const result = await this.materializationRolloutService.cancelPendingItems(
      userId,
      rolloutId,
      stepUpToken
    );
    return {
      requestId: req.requestId ?? null,
      rollout: result.rollout,
      cancelledCount: result.cancelledCount
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }

  private readStepUpToken(req: RequestWithPlatformContext): string | null {
    const raw = req.headers["x-persai-step-up-token"];
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw.trim();
    }
    if (Array.isArray(raw)) {
      const first = raw.find((value) => typeof value === "string" && value.trim().length > 0);
      return first?.trim() ?? null;
    }
    return null;
  }
}
