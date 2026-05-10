import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
import {
  InternalRuntimeCompactionClientService,
  type InternalRuntimeCompactAndExtractOutcome
} from "./internal-runtime-compaction.client.service";

const POLL_INTERVAL_MS = 5_000;
// ADR-090: stable scheduler-unique advisory-lock id; must not collide with other
// pg_advisory locks in this service. Cross-reference: idle = 5_203_916_748_291_034n,
// background-task = 7_341_822_019_465_127n.
const COMPACTION_SCHEDULER_LOCK_ID = 3_891_047_162_837_456n;
// ADR-090: tick transaction timeout. Must comfortably cover one drain pass
// including upstream runtime call timeouts.
const SCHEDULER_TICK_TRANSACTION_TIMEOUT_MS = 10 * 60_000;
// ADR-090: defer interval after HTTP 409 from runtime (session busy).
const RUNTIME_SESSION_BUSY_DEFER_MS = 60_000;
const BATCH_SIZE = 8;
// ADR-074 Slice M2 — keep slightly above the runtime call timeout so a stuck
// runtime cannot starve the queue. Other replicas reclaim the row after this
// TTL expires even if the worker that claimed it crashed mid-flight.
const CLAIM_TTL_MS = 60_000;
const RETRY_BASE_DELAY_MS = 30_000;
// ADR-090: cap exponential backoff so a stuck job doesn't park forever.
const RETRY_MAX_DELAY_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

type ClaimedJob = {
  id: string;
  assistantId: string;
  workspaceId: string;
  channel: "web" | "telegram" | "max_ru";
  externalThreadKey: string;
  externalUserKey: string | null;
  runtimeTier: "free_shared_restricted" | "paid_shared_restricted" | "paid_isolated";
  enqueuedRequestId: string | null;
  attemptCount: number;
  claimToken: string;
  claimEpoch: number;
};

@Injectable()
export class PersaiBackgroundCompactionSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PersaiBackgroundCompactionSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    private readonly internalRuntimeCompactionClientService: InternalRuntimeCompactionClientService
  ) {}

  async onModuleInit(): Promise<void> {
    const epoch = await this.bumpConfigGenerationService.bumpBackgroundCompactionSchedulerEpoch();
    this.logger.log(`Background compaction scheduler epoch bumped to ${epoch}.`);
    this.scheduleNext(POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async processDueJobsBatch(limit = BATCH_SIZE): Promise<number> {
    const claimed = await this.claimDueJobs(limit);
    for (const job of claimed) {
      await this.processClaimedJob(job);
    }
    return claimed.length;
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
      this.scheduleNext(POLL_INTERVAL_MS);
      return;
    }
    this.running = true;
    try {
      // ADR-090: pool-vs-HTTP trade-off. The advisory lock is held for the
      // full drain pass — including outbound runtime LLM calls — pinning one
      // Prisma pool connection per leader. The per-tick early-break
      // (count < BATCH_SIZE) bounds that interval. If pool pressure grows,
      // the right move is to split lock acquisition (short tx) from job
      // processing (no tx) using a dedicated lease row, NOT to weaken the
      // lock itself.
      await this.prisma.$transaction(
        async (tx) => {
          const lockResult = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(${COMPACTION_SCHEDULER_LOCK_ID}::bigint) AS locked
          `;
          if (!lockResult[0]?.locked) {
            return;
          }
          let processed = 0;
          while (!this.stopped) {
            const count = await this.processDueJobsBatch();
            processed += count;
            if (count < BATCH_SIZE) {
              break;
            }
          }
          if (processed > 0) {
            this.logger.log(`Processed ${processed} background compaction job(s).`);
          }
        },
        { timeout: SCHEDULER_TICK_TRANSACTION_TIMEOUT_MS }
      );
    } catch (error) {
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Background compaction scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`,
        stack
      );
    } finally {
      this.running = false;
      this.scheduleNext(POLL_INTERVAL_MS);
    }
  }

  private async claimDueJobs(limit: number): Promise<ClaimedJob[]> {
    const now = new Date();
    const claimedUntil = new Date(now.getTime() + CLAIM_TTL_MS);
    const currentEpoch =
      await this.bumpConfigGenerationService.currentBackgroundCompactionSchedulerEpoch();

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          assistantId: string;
          workspaceId: string;
          channel: ClaimedJob["channel"];
          externalThreadKey: string;
          externalUserKey: string | null;
          runtimeTier: ClaimedJob["runtimeTier"];
          enqueuedRequestId: string | null;
          attemptCount: number;
        }>
      >(Prisma.sql`
        SELECT
          "id",
          "assistant_id"        AS "assistantId",
          "workspace_id"        AS "workspaceId",
          "channel"::text       AS "channel",
          "external_thread_key" AS "externalThreadKey",
          "external_user_key"   AS "externalUserKey",
          "runtime_tier"::text  AS "runtimeTier",
          "enqueued_request_id" AS "enqueuedRequestId",
          "attempt_count"       AS "attemptCount"
        FROM "assistant_background_compaction_jobs"
        WHERE "status" = 'pending'
          AND ("retry_after_at" IS NULL OR "retry_after_at" <= NOW())
          AND (
            "scheduler_claim_expires_at" IS NULL
            OR "scheduler_claim_expires_at" <= NOW()
            OR COALESCE("scheduler_claim_epoch", 0) < ${currentEpoch}
          )
        ORDER BY "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${Math.max(1, Math.floor(limit))}
      `);

      const claimed: ClaimedJob[] = [];
      for (const row of rows) {
        const claimToken = randomUUID();
        await tx.assistantBackgroundCompactionJob.update({
          where: { id: row.id },
          data: {
            status: "in_progress",
            schedulerClaimToken: claimToken,
            schedulerClaimEpoch: currentEpoch,
            schedulerClaimedAt: now,
            schedulerClaimExpiresAt: claimedUntil,
            // Free the dedupe slot so a fresh post-turn enqueue can land while
            // we run. The runtime always reads the live synopsis from the DB,
            // so a successor enqueue is harmless and naturally dedup-collapses
            // again only when this row finishes and a new pending row exists.
            pendingDedupeKey: null,
            attemptCount: row.attemptCount + 1
          }
        });
        claimed.push({
          id: row.id,
          assistantId: row.assistantId,
          workspaceId: row.workspaceId,
          channel: row.channel,
          externalThreadKey: row.externalThreadKey,
          externalUserKey: row.externalUserKey,
          runtimeTier: row.runtimeTier,
          enqueuedRequestId: row.enqueuedRequestId,
          attemptCount: row.attemptCount + 1,
          claimToken,
          claimEpoch: currentEpoch
        });
      }
      return claimed;
    });
  }

  private async processClaimedJob(job: ClaimedJob): Promise<void> {
    const currentEpoch =
      await this.bumpConfigGenerationService.currentBackgroundCompactionSchedulerEpoch();
    if (currentEpoch !== job.claimEpoch) {
      // Another deploy reclaimed scheduler ownership; release the row gently.
      await this.releaseToPending(job, "epoch_changed");
      return;
    }

    let outcome: InternalRuntimeCompactAndExtractOutcome;
    try {
      outcome = await this.internalRuntimeCompactionClientService.execute({
        assistantId: job.assistantId,
        workspaceId: job.workspaceId,
        channel: job.channel,
        externalThreadKey: job.externalThreadKey,
        externalUserKey: job.externalUserKey,
        runtimeTier: job.runtimeTier,
        enqueuedRequestId: job.enqueuedRequestId
      });
    } catch (error) {
      await this.handleFailure(
        job,
        true,
        "scheduler_internal_error",
        error instanceof Error ? error.message : "Background compaction scheduler failed."
      );
      return;
    }

    if (outcome.ok) {
      await this.completeJob(job, outcome.result);
      return;
    }

    if (outcome.status === 409) {
      await this.deferJobAfterBusy(job);
      return;
    }

    await this.handleFailure(
      job,
      outcome.retryable,
      outcome.code ?? "background_compaction_failed",
      outcome.message
    );
  }

  private async completeJob(job: ClaimedJob, result: unknown): Promise<void> {
    const lastResultPayload = this.serializeResult(result);
    await this.prisma.assistantBackgroundCompactionJob.updateMany({
      where: {
        id: job.id,
        schedulerClaimToken: job.claimToken,
        schedulerClaimEpoch: job.claimEpoch
      },
      data: {
        status: "completed",
        completedAt: new Date(),
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        retryAfterAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        ...(lastResultPayload === undefined ? {} : { lastResultPayload })
      }
    });
  }

  private serializeResult(result: unknown): Prisma.InputJsonValue | undefined {
    try {
      return JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;
    } catch {
      return undefined;
    }
  }

  private async handleFailure(
    job: ClaimedJob,
    retryable: boolean,
    code: string,
    message: string
  ): Promise<void> {
    if (!retryable || job.attemptCount >= MAX_ATTEMPTS) {
      await this.prisma.assistantBackgroundCompactionJob.updateMany({
        where: {
          id: job.id,
          schedulerClaimToken: job.claimToken,
          schedulerClaimEpoch: job.claimEpoch
        },
        data: {
          status: "failed",
          completedAt: new Date(),
          schedulerClaimToken: null,
          schedulerClaimEpoch: null,
          schedulerClaimedAt: null,
          schedulerClaimExpiresAt: null,
          retryAfterAt: null,
          lastErrorCode: code.slice(0, 128),
          lastErrorMessage: message
        }
      });
      this.logger.error(
        `Background compaction job ${job.id} failed permanently after ${job.attemptCount} attempt(s): ${code} – ${message}`
      );
      return;
    }

    const delayMs = Math.min(
      RETRY_MAX_DELAY_MS,
      RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, job.attemptCount - 1))
    );
    await this.prisma.assistantBackgroundCompactionJob.updateMany({
      where: {
        id: job.id,
        schedulerClaimToken: job.claimToken,
        schedulerClaimEpoch: job.claimEpoch
      },
      data: {
        status: "pending",
        retryAfterAt: new Date(Date.now() + delayMs),
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        lastErrorCode: code.slice(0, 128),
        lastErrorMessage: message
      }
    });
    this.logger.warn(
      `Background compaction job ${job.id} deferred for retry (attempt ${job.attemptCount}, code=${code}): ${message}`
    );
  }

  private async deferJobAfterBusy(job: ClaimedJob): Promise<void> {
    // ADR-090: 409 from runtime is a "session busy, try later" signal — not a
    // failure. Decrement attemptCount because the claim consumed one attempt
    // for what turned out to be no real evaluation.
    await this.prisma.assistantBackgroundCompactionJob.updateMany({
      where: {
        id: job.id,
        schedulerClaimToken: job.claimToken,
        schedulerClaimEpoch: job.claimEpoch
      },
      data: {
        status: "pending",
        retryAfterAt: new Date(Date.now() + RUNTIME_SESSION_BUSY_DEFER_MS),
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        attemptCount: Math.max(0, job.attemptCount - 1),
        lastErrorCode: "runtime_session_busy",
        lastErrorMessage: "Deferred: runtime session busy."
      }
    });
    this.logger.debug(
      `Background compaction job ${job.id} deferred for ${RUNTIME_SESSION_BUSY_DEFER_MS}ms (runtime session busy).`
    );
  }

  private async releaseToPending(job: ClaimedJob, reason: string): Promise<void> {
    await this.prisma.assistantBackgroundCompactionJob.updateMany({
      where: {
        id: job.id,
        schedulerClaimToken: job.claimToken,
        schedulerClaimEpoch: job.claimEpoch
      },
      data: {
        status: "pending",
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        // Decrement so we don't double-charge attempt budget on epoch flips.
        attemptCount: Math.max(0, job.attemptCount - 1),
        lastErrorCode: reason.slice(0, 128),
        // ADR-090 audit: keep parity with deferJobAfterBusy / failJob so
        // operators always see *why* a row went back to pending, not just
        // a bare error code.
        lastErrorMessage: `Released to pending: ${reason}`
      }
    });
  }
}
