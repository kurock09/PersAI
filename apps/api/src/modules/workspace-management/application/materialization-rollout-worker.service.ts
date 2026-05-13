import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
  type AssistantMaterializedSpecRepository
} from "../domain/assistant-materialized-spec.repository";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ApplyAssistantPublishedVersionService } from "./apply-assistant-published-version.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { BackgroundSchedulerMetricsService } from "./background-scheduler-metrics.service";
import { LEASE_HEARTBEAT_INTERVAL_MS } from "./scheduler-lease.constants";
import { SchedulerLeaseService } from "./scheduler-lease.service";

const MATERIALIZATION_ROLLOUT_POLL_INTERVAL_MS = 5_000;
const MATERIALIZATION_ROLLOUT_BATCH_SIZE = 2;
const MATERIALIZATION_ROLLOUT_SCHEDULER_KEY = "materialization_rollout";

type ClaimedRolloutItem = {
  id: string;
  rolloutId: string;
  assistantId: string;
  workspaceId: string;
  userId: string;
  targetGeneration: number;
};

@Injectable()
export class MaterializationRolloutWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaterializationRolloutWorkerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private leaseLost = false;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly applyAssistantPublishedVersionService: ApplyAssistantPublishedVersionService,
    private readonly schedulerLeaseService: SchedulerLeaseService,
    private readonly backgroundSchedulerMetricsService: BackgroundSchedulerMetricsService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly publishedVersionRepository: AssistantPublishedVersionRepository,
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly materializedSpecRepository: AssistantMaterializedSpecRepository
  ) {}

  onModuleInit(): void {
    this.scheduleNext(MATERIALIZATION_ROLLOUT_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async processPendingBatch(limit = MATERIALIZATION_ROLLOUT_BATCH_SIZE): Promise<number> {
    const claimed = await this.claimPendingItems(limit);
    let processed = 0;
    for (const item of claimed) {
      if (this.leaseLost) {
        break;
      }
      await this.processClaimedItem(item);
      processed += 1;
    }
    return processed;
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (this.running) {
      this.scheduleNext(MATERIALIZATION_ROLLOUT_POLL_INTERVAL_MS);
      return;
    }
    this.running = true;
    this.leaseLost = false;
    const startedAt = Date.now();
    let processed = 0;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let leaseToken: string | null = null;
    let leaseLostReported = false;
    const markLeaseLost = (reason: string): void => {
      if (leaseLostReported) {
        return;
      }
      leaseLostReported = true;
      this.leaseLost = true;
      this.backgroundSchedulerMetricsService.recordLeaseLost(MATERIALIZATION_ROLLOUT_SCHEDULER_KEY);
      this.logger.warn(`Materialization rollout worker lease lost: ${reason}`);
    };
    try {
      const previousLease = await this.schedulerLeaseService.getLeaseState(
        MATERIALIZATION_ROLLOUT_SCHEDULER_KEY
      );
      const lease = await this.schedulerLeaseService.acquire(MATERIALIZATION_ROLLOUT_SCHEDULER_KEY);
      if (lease === null) {
        this.backgroundSchedulerMetricsService.recordTickSkipped(
          MATERIALIZATION_ROLLOUT_SCHEDULER_KEY
        );
        return;
      }
      leaseToken = lease.token;

      if (
        previousLease !== null &&
        previousLease.holderId !== "" &&
        previousLease.expiresAt.getTime() <= startedAt
      ) {
        this.backgroundSchedulerMetricsService.recordLeaseExpiredRecovered(
          MATERIALIZATION_ROLLOUT_SCHEDULER_KEY
        );
      }

      heartbeatTimer = setInterval(() => {
        void this.schedulerLeaseService
          .heartbeat(MATERIALIZATION_ROLLOUT_SCHEDULER_KEY, lease.token)
          .then((stillLeader) => {
            if (!stillLeader) {
              markLeaseLost("heartbeat token no longer matched active leader");
            }
          })
          .catch((error) => {
            markLeaseLost(error instanceof Error ? error.message : String(error));
          });
      }, LEASE_HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref?.();

      while (!this.stopped && !this.leaseLost) {
        const count = await this.processPendingBatch();
        processed += count;
        if (count < MATERIALIZATION_ROLLOUT_BATCH_SIZE) {
          break;
        }
      }

      if (processed > 0) {
        this.logger.log(`Processed ${processed} materialization rollout item(s).`);
      }
      this.backgroundSchedulerMetricsService.recordTickAcquired(
        MATERIALIZATION_ROLLOUT_SCHEDULER_KEY,
        Date.now() - startedAt,
        processed
      );
    } catch (error) {
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Materialization rollout worker tick failed: ${error instanceof Error ? error.message : String(error)}`,
        stack
      );
    } finally {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
      }
      if (leaseToken !== null) {
        await this.schedulerLeaseService.release(MATERIALIZATION_ROLLOUT_SCHEDULER_KEY, leaseToken);
      }
      this.leaseLost = false;
      this.running = false;
      this.scheduleNext(MATERIALIZATION_ROLLOUT_POLL_INTERVAL_MS);
    }
  }

  private async claimPendingItems(limit: number): Promise<ClaimedRolloutItem[]> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.materializationRolloutItem.findMany({
        where: {
          status: "pending",
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
          rollout: {
            status: {
              in: ["pending", "running"]
            }
          }
        },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        take: limit,
        select: {
          id: true,
          rolloutId: true,
          assistantId: true,
          workspaceId: true,
          userId: true,
          targetGeneration: true
        }
      });

      if (rows.length === 0) {
        return [];
      }

      const itemIds = rows.map((row) => row.id);
      const rolloutIds = [...new Set(rows.map((row) => row.rolloutId))];
      await tx.materializationRolloutItem.updateMany({
        where: { id: { in: itemIds } },
        data: {
          status: "running",
          startedAt: now,
          claimedAt: now,
          attempts: { increment: 1 }
        }
      });
      await tx.materializationRollout.updateMany({
        where: { id: { in: rolloutIds } },
        data: {
          status: "running",
          startedAt: now
        }
      });

      return rows;
    });
  }

  private async processClaimedItem(item: ClaimedRolloutItem): Promise<void> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: item.assistantId },
      select: {
        id: true,
        workspaceId: true,
        userId: true
      }
    });
    if (assistant === null) {
      await this.markItemTerminal(item, {
        status: "failed",
        errorCode: "assistant_missing",
        errorMessage: "Assistant no longer exists."
      });
      return;
    }

    const latestPublished = await this.publishedVersionRepository.findLatestByAssistantId(
      assistant.id
    );
    if (latestPublished === null) {
      await this.markItemTerminal(item, {
        status: "skipped",
        errorCode: null,
        errorMessage: null
      });
      return;
    }

    const latestSpec = await this.materializedSpecRepository.findLatestByAssistantId(assistant.id);
    if (
      latestSpec !== null &&
      latestSpec.materializedAtConfigGeneration >= item.targetGeneration &&
      latestSpec.publishedVersionId === latestPublished.id
    ) {
      await this.markItemTerminal(item, {
        status: "skipped",
        errorCode: null,
        errorMessage: null,
        materializedSpecId: latestSpec.id,
        materializedContentHash: latestSpec.contentHash,
        runtimeBundleHash: latestSpec.runtimeBundleHash
      });
      return;
    }

    try {
      await this.applyAssistantPublishedVersionService.execute(
        assistant.userId,
        latestPublished,
        true
      );
      const afterApply = await this.prisma.assistant.findUnique({
        where: { id: assistant.id },
        select: {
          applyStatus: true,
          applyErrorCode: true,
          applyErrorMessage: true
        }
      });
      const refreshedSpec = await this.materializedSpecRepository.findByPublishedVersionId(
        latestPublished.id
      );
      const applyStatus = afterApply?.applyStatus ?? "failed";
      await this.markItemTerminal(item, {
        status:
          applyStatus === "succeeded"
            ? "succeeded"
            : applyStatus === "degraded"
              ? "degraded"
              : "failed",
        errorCode: afterApply?.applyErrorCode ?? null,
        errorMessage: afterApply?.applyErrorMessage ?? null,
        materializedSpecId: refreshedSpec?.id ?? null,
        materializedContentHash: refreshedSpec?.contentHash ?? null,
        runtimeBundleHash: refreshedSpec?.runtimeBundleHash ?? null
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.markItemTerminal(item, {
        status: "failed",
        errorCode: "apply_exception",
        errorMessage
      });
    }
  }

  private async markItemTerminal(
    item: ClaimedRolloutItem,
    input: {
      status: "succeeded" | "degraded" | "failed" | "skipped" | "cancelled";
      errorCode: string | null;
      errorMessage: string | null;
      materializedSpecId?: string | null;
      materializedContentHash?: string | null;
      runtimeBundleHash?: string | null;
    }
  ): Promise<void> {
    const finishedAt = new Date();
    await this.prisma.materializationRolloutItem.update({
      where: { id: item.id },
      data: {
        status: input.status,
        finishedAt,
        lastErrorCode: input.errorCode,
        lastErrorMessage: input.errorMessage,
        materializedSpecId: input.materializedSpecId ?? null,
        materializedContentHash: input.materializedContentHash ?? null,
        runtimeBundleHash: input.runtimeBundleHash ?? null
      }
    });
    await this.refreshRolloutSummary(item.rolloutId, item.workspaceId);
  }

  private async refreshRolloutSummary(rolloutId: string, workspaceId: string): Promise<void> {
    const grouped = await this.prisma.materializationRolloutItem.groupBy({
      by: ["status"],
      where: { rolloutId },
      _count: { _all: true }
    });
    const counts = {
      pending: 0,
      running: 0,
      succeeded: 0,
      degraded: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0
    };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
    }

    const hasActive = counts.pending > 0 || counts.running > 0;
    const terminalStatus = hasActive ? "running" : counts.failed > 0 ? "failed" : "succeeded";
    const finishedAt = hasActive ? null : new Date();
    await this.prisma.materializationRollout.update({
      where: { id: rolloutId },
      data: {
        status: terminalStatus,
        pendingCount: counts.pending,
        runningCount: counts.running,
        succeededCount: counts.succeeded,
        degradedCount: counts.degraded,
        failedCount: counts.failed,
        skippedCount: counts.skipped,
        cancelledCount: counts.cancelled,
        finishedAt
      }
    });

    if (!hasActive) {
      await this.appendAssistantAuditEventService.execute({
        workspaceId,
        assistantId: null,
        actorUserId: null,
        eventCategory: "system_action",
        eventCode:
          terminalStatus === "succeeded"
            ? "system.materialization_rollout_completed"
            : "system.materialization_rollout_failed",
        summary:
          terminalStatus === "succeeded"
            ? "Materialization rollout completed."
            : "Materialization rollout completed with failures.",
        details: {
          rolloutId,
          status: terminalStatus,
          counts
        }
      });
    }
  }
}
