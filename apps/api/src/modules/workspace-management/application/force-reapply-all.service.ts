import { Injectable } from "@nestjs/common";
import { AdminAuthorizationService } from "./admin-authorization.service";
import {
  MaterializationRolloutService,
  type MaterializationRolloutQueueSummary
} from "./materialization-rollout.service";

export type ForceReapplyAllSummary = {
  rolloutId: string;
  targetGeneration: number;
  totalItems: number;
  pendingCount: number;
  runningCount: number;
  succeeded: number;
  degraded: number;
  failed: number;
  skipped: number;
  cancelledCount: number;
  status: string;
};

@Injectable()
export class ForceReapplyAllService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly materializationRolloutService: MaterializationRolloutService
  ) {}

  async execute(userId: string, stepUpToken: string | null): Promise<ForceReapplyAllSummary> {
    await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.force_reapply_all",
      stepUpToken
    );
    const rollout = await this.materializationRolloutService.createManualReapplyRollout(
      userId,
      stepUpToken
    );
    return this.mapSummary(rollout);
  }

  private mapSummary(rollout: MaterializationRolloutQueueSummary): ForceReapplyAllSummary {
    return {
      rolloutId: rollout.id,
      targetGeneration: rollout.targetGeneration,
      totalItems: rollout.totalItems,
      pendingCount: rollout.pendingCount,
      runningCount: rollout.runningCount,
      succeeded: rollout.succeededCount,
      degraded: rollout.degradedCount,
      failed: rollout.failedCount,
      skipped: rollout.skippedCount,
      cancelledCount: rollout.cancelledCount,
      status: rollout.status
    };
  }
}
