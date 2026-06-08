import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { BackgroundSchedulerMetricsService } from "./background-scheduler-metrics.service";
import { EnqueueBackgroundCompactionJobService } from "./enqueue-background-compaction-job.service";
import { LEASE_HEARTBEAT_INTERVAL_MS } from "./scheduler-lease.constants";
import { SchedulerLeaseService } from "./scheduler-lease.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const IDLE_MEMORY_EXTRACTION_POLL_INTERVAL_MS = 5 * 60_000;
const IDLE_MEMORY_EXTRACTION_BATCH_SIZE = 24;
const IDLE_MEMORY_EXTRACTION_MIN_NEW_MESSAGES = 10;
const IDLE_MEMORY_EXTRACTION_IDLE_MS = 20 * 60_000;
const IDLE_MEMORY_EXTRACTION_SCHEDULER_KEY = "idle_memory_extraction";

type IdleCandidate = {
  assistantId: string;
  workspaceId: string;
  channel: "web" | "telegram";
  externalThreadKey: string;
  externalUserKey: string | null;
  runtimeTier: "free_shared_restricted" | "paid_shared_restricted" | "paid_isolated";
};

@Injectable()
export class PersaiIdleSessionMemoryExtractionSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PersaiIdleSessionMemoryExtractionSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private leaseLost = false;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly enqueueBackgroundCompactionJobService: EnqueueBackgroundCompactionJobService,
    private readonly schedulerLeaseService: SchedulerLeaseService,
    private readonly backgroundSchedulerMetricsService: BackgroundSchedulerMetricsService
  ) {}

  onModuleInit(): void {
    this.scheduleNext(IDLE_MEMORY_EXTRACTION_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async processDueIdleExtractionBatch(limit = IDLE_MEMORY_EXTRACTION_BATCH_SIZE): Promise<number> {
    const candidates = await this.findDueCandidates(limit);
    let processed = 0;
    for (const candidate of candidates) {
      if (this.leaseLost) {
        break;
      }
      await this.enqueueBackgroundCompactionJobService.execute({
        assistantId: candidate.assistantId,
        workspaceId: candidate.workspaceId,
        channel: candidate.channel,
        externalThreadKey: candidate.externalThreadKey,
        externalUserKey: candidate.externalUserKey,
        runtimeTier: candidate.runtimeTier,
        trigger: "idle_extract",
        enqueuedRequestId: null
      });
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
      this.scheduleNext(IDLE_MEMORY_EXTRACTION_POLL_INTERVAL_MS);
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
      this.backgroundSchedulerMetricsService.recordLeaseLost(IDLE_MEMORY_EXTRACTION_SCHEDULER_KEY);
      this.logger.warn(`Idle memory extraction scheduler lease lost: ${reason}`);
    };

    try {
      const previousLease = await this.schedulerLeaseService.getLeaseState(
        IDLE_MEMORY_EXTRACTION_SCHEDULER_KEY
      );
      const lease = await this.schedulerLeaseService.acquire(IDLE_MEMORY_EXTRACTION_SCHEDULER_KEY);
      if (lease === null) {
        this.backgroundSchedulerMetricsService.recordTickSkipped(
          IDLE_MEMORY_EXTRACTION_SCHEDULER_KEY
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
          IDLE_MEMORY_EXTRACTION_SCHEDULER_KEY
        );
      }

      heartbeatTimer = setInterval(() => {
        void this.schedulerLeaseService
          .heartbeat(IDLE_MEMORY_EXTRACTION_SCHEDULER_KEY, lease.token)
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
        const count = await this.processDueIdleExtractionBatch();
        processed += count;
        if (count < IDLE_MEMORY_EXTRACTION_BATCH_SIZE) {
          break;
        }
      }

      if (processed > 0) {
        this.logger.log(`Enqueued ${processed} idle memory extraction job(s).`);
      }
      this.backgroundSchedulerMetricsService.recordTickAcquired(
        IDLE_MEMORY_EXTRACTION_SCHEDULER_KEY,
        Date.now() - startedAt,
        processed
      );
    } catch (error) {
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Idle memory extraction scheduler tick failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        stack
      );
    } finally {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
      }
      if (leaseToken !== null) {
        await this.schedulerLeaseService.release(IDLE_MEMORY_EXTRACTION_SCHEDULER_KEY, leaseToken);
      }
      this.leaseLost = false;
      this.running = false;
      this.scheduleNext(IDLE_MEMORY_EXTRACTION_POLL_INTERVAL_MS);
    }
  }

  private async findDueCandidates(limit: number): Promise<IdleCandidate[]> {
    const candidates: IdleCandidate[] = [];
    const idleCutoff = new Date(Date.now() - IDLE_MEMORY_EXTRACTION_IDLE_MS);
    const sessions = await this.prisma.runtimeSession.findMany({
      where: {
        closedAt: null,
        lastTurnAt: { lte: idleCutoff },
        channel: { in: ["web", "telegram"] }
      },
      orderBy: [{ lastTurnAt: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
      take: Math.max(1, Math.floor(limit * 4)),
      select: {
        assistantId: true,
        workspaceId: true,
        channel: true,
        externalThreadKey: true,
        externalUserKey: true,
        runtimeTier: true,
        lastTurnAt: true,
        memoryExtractionWatermark: true
      }
    });

    for (const session of sessions) {
      if (candidates.length >= limit) {
        break;
      }
      if (session.lastTurnAt === null) {
        continue;
      }
      const channel =
        session.channel === "web" || session.channel === "telegram" ? session.channel : null;
      if (channel === null) {
        continue;
      }
      const latestIdleJob = await this.prisma.assistantBackgroundCompactionJob.findFirst({
        where: {
          assistantId: session.assistantId,
          channel,
          externalThreadKey: session.externalThreadKey,
          trigger: "idle_extract"
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          status: true,
          createdAt: true
        }
      });
      if (latestIdleJob?.status === "pending" || latestIdleJob?.status === "in_progress") {
        continue;
      }
      if (
        latestIdleJob !== null &&
        (latestIdleJob.status === "completed" || latestIdleJob.status === "failed") &&
        latestIdleJob.createdAt.getTime() >= session.lastTurnAt.getTime()
      ) {
        continue;
      }

      const hydratableMessageCount = await this.countHydratableMessages({
        assistantId: session.assistantId,
        channel,
        externalThreadKey: session.externalThreadKey
      });
      if (
        hydratableMessageCount - Math.max(0, session.memoryExtractionWatermark) <
        IDLE_MEMORY_EXTRACTION_MIN_NEW_MESSAGES
      ) {
        continue;
      }

      candidates.push({
        assistantId: session.assistantId,
        workspaceId: session.workspaceId,
        channel,
        externalThreadKey: session.externalThreadKey,
        externalUserKey: session.externalUserKey,
        runtimeTier: session.runtimeTier
      });
    }

    return candidates;
  }

  private async countHydratableMessages(input: {
    assistantId: string;
    channel: "web" | "telegram";
    externalThreadKey: string;
  }): Promise<number> {
    const chat = await this.prisma.assistantChat.findUnique({
      where: {
        assistantId_surface_surfaceThreadKey: {
          assistantId: input.assistantId,
          surface: input.channel,
          surfaceThreadKey: input.externalThreadKey
        }
      },
      select: { id: true, archivedAt: true }
    });
    if (chat === null || chat.archivedAt !== null) {
      return 0;
    }

    const rows = await this.prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS "count"
      FROM "assistant_chat_messages" AS message
      WHERE message."chat_id" = ${chat.id}::uuid
        AND message."assistant_id" = ${input.assistantId}::uuid
        AND message."author" <> 'system'
        AND (
          length(btrim(message."content")) > 0
          OR EXISTS (
            SELECT 1
            FROM "assistant_chat_message_attachments" AS attachment
            WHERE attachment."message_id" = message."id"
              AND attachment."processing_status" = 'ready'
              AND COALESCE((attachment."metadata"->>'fileDeleted')::boolean, false) = false
          )
        )
    `);
    return rows[0]?.count ?? 0;
  }
}
