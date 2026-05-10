import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { EnsureAssistantMaterializedSpecCurrentService } from "./ensure-assistant-materialized-spec-current.service";
import { NotificationIntentService } from "./notifications/notification-intent.service";
import {
  InternalRuntimeBackgroundTaskClientService,
  type InternalRuntimeBackgroundTaskEvaluationOutcome
} from "./internal-runtime-background-task.client.service";
import { BackgroundSchedulerMetricsService } from "./background-scheduler-metrics.service";
import { computeReminderNextRunAtMs, parseReminderSchedule } from "./reminder-schedule";
import { readRuntimeAssignmentStateFromMaterializedLayers } from "./runtime-assignment";
import { LEASE_HEARTBEAT_INTERVAL_MS } from "./scheduler-lease.constants";
import { SchedulerLeaseService } from "./scheduler-lease.service";

// ADR-091 audit: scheduler cadence / batch / retry knobs stay centralized in this
// constants block until we have enough production evidence to justify env tuning.
const BACKGROUND_TASK_POLL_INTERVAL_MS = 5_000;
const BACKGROUND_TASK_SCHEDULER_KEY = "background_task";
// ADR-090: defer interval after HTTP 409 from runtime (session busy).
const RUNTIME_SESSION_BUSY_DEFER_MS = 60_000;
const BACKGROUND_TASK_BATCH_SIZE = 8;
const BACKGROUND_TASK_CLAIM_TTL_MS = 90_000;
const BACKGROUND_TASK_RETRY_BASE_DELAY_MS = 30_000;
const BACKGROUND_TASK_RETRY_MAX_DELAY_MS = 60 * 60 * 1000;
const BACKGROUND_TASK_MAX_ATTEMPTS = 5;
const BACKGROUND_TASK_LAST_ERROR_MAX_CHARS = 1_000;

type ClaimedBackgroundTask = {
  id: string;
  runId: string;
  assistantId: string;
  userId: string;
  workspaceId: string;
  title: string;
  brief: string;
  scheduleJson: unknown;
  pushPolicyJson: unknown | null;
  scheduledRunAt: Date;
  runCount: number;
  lastRunAt: Date | null;
  lastRunStatus: "running" | "no_push" | "pushed" | "completed" | "failed" | "skipped" | null;
  externalRef: string | null;
  attemptCount: number;
  claimToken: string;
  claimEpoch: number;
};

function truncateLastError(message: string): string {
  if (message.length <= BACKGROUND_TASK_LAST_ERROR_MAX_CHARS) {
    return message;
  }
  return `${message.slice(0, BACKGROUND_TASK_LAST_ERROR_MAX_CHARS - 1)}…`;
}

function computeRetryBackoffMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    BACKGROUND_TASK_RETRY_MAX_DELAY_MS,
    BACKGROUND_TASK_RETRY_BASE_DELAY_MS * 2 ** (safeAttempt - 1)
  );
}

@Injectable()
export class PersaiBackgroundTaskSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PersaiBackgroundTaskSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private leaseLost = false;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly ensureAssistantMaterializedSpecCurrentService: EnsureAssistantMaterializedSpecCurrentService,
    private readonly internalRuntimeBackgroundTaskClientService: InternalRuntimeBackgroundTaskClientService,
    private readonly notificationIntentService: NotificationIntentService,
    private readonly schedulerLeaseService: SchedulerLeaseService,
    private readonly backgroundSchedulerMetricsService: BackgroundSchedulerMetricsService
  ) {}

  onModuleInit(): void {
    this.scheduleNext(BACKGROUND_TASK_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async processDueTasksBatch(limit = BACKGROUND_TASK_BATCH_SIZE): Promise<number> {
    const claimed = await this.claimDueTasks(limit);
    let processed = 0;
    for (const task of claimed) {
      if (this.leaseLost) {
        break;
      }
      await this.processClaimedTask(task);
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
      this.scheduleNext(BACKGROUND_TASK_POLL_INTERVAL_MS);
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
      this.backgroundSchedulerMetricsService.recordLeaseLost(BACKGROUND_TASK_SCHEDULER_KEY);
      this.logger.warn(`Assistant background-task scheduler lease lost: ${reason}`);
    };
    try {
      const previousLease = await this.schedulerLeaseService.getLeaseState(
        BACKGROUND_TASK_SCHEDULER_KEY
      );
      const lease = await this.schedulerLeaseService.acquire(BACKGROUND_TASK_SCHEDULER_KEY);
      if (lease === null) {
        this.backgroundSchedulerMetricsService.recordTickSkipped(BACKGROUND_TASK_SCHEDULER_KEY);
        return;
      }
      leaseToken = lease.token;

      if (
        previousLease !== null &&
        previousLease.holderId !== "" &&
        previousLease.expiresAt.getTime() <= startedAt
      ) {
        this.backgroundSchedulerMetricsService.recordLeaseExpiredRecovered(
          BACKGROUND_TASK_SCHEDULER_KEY
        );
      }

      heartbeatTimer = setInterval(() => {
        void this.schedulerLeaseService
          .heartbeat(BACKGROUND_TASK_SCHEDULER_KEY, lease.token)
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
        const count = await this.processDueTasksBatch();
        processed += count;
        if (count < BACKGROUND_TASK_BATCH_SIZE) {
          break;
        }
      }
      if (processed > 0) {
        this.logger.log(`Processed ${processed} assistant background task(s).`);
      }
      this.backgroundSchedulerMetricsService.recordTickAcquired(
        BACKGROUND_TASK_SCHEDULER_KEY,
        Date.now() - startedAt,
        processed
      );
    } catch (error) {
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Assistant background-task scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`,
        stack
      );
    } finally {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
      }
      if (leaseToken !== null) {
        await this.schedulerLeaseService.release(BACKGROUND_TASK_SCHEDULER_KEY, leaseToken);
      }
      this.leaseLost = false;
      this.running = false;
      this.scheduleNext(BACKGROUND_TASK_POLL_INTERVAL_MS);
    }
  }

  private async claimDueTasks(limit: number): Promise<ClaimedBackgroundTask[]> {
    const now = new Date();
    const claimExpiresAt = new Date(now.getTime() + BACKGROUND_TASK_CLAIM_TTL_MS);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          assistantId: string;
          userId: string;
          workspaceId: string;
          title: string;
          brief: string;
          scheduleJson: unknown;
          pushPolicyJson: unknown | null;
          nextRunAt: Date;
          runCount: number;
          lastRunAt: Date | null;
          lastRunStatus:
            | "running"
            | "no_push"
            | "pushed"
            | "completed"
            | "failed"
            | "skipped"
            | null;
          externalRef: string | null;
          attemptCount: number;
        }>
      >(Prisma.sql`
        SELECT
          "id",
          "assistant_id"      AS "assistantId",
          "user_id"           AS "userId",
          "workspace_id"      AS "workspaceId",
          "title",
          "brief",
          "schedule_json"     AS "scheduleJson",
          "push_policy_json"  AS "pushPolicyJson",
          "next_run_at"       AS "nextRunAt",
          "run_count"         AS "runCount",
          "last_run_at"       AS "lastRunAt",
          "last_run_status"::text AS "lastRunStatus",
          "external_ref"      AS "externalRef",
          "attempt_count"     AS "attemptCount"
        FROM "assistant_background_tasks"
        WHERE "status" = 'active'
          AND "next_run_at" IS NOT NULL
          AND "next_run_at" <= NOW()
          AND ("retry_after_at" IS NULL OR "retry_after_at" <= NOW())
          AND (
            "scheduler_claim_expires_at" IS NULL
            OR "scheduler_claim_expires_at" <= NOW()
          )
        ORDER BY "next_run_at" ASC, "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${Math.max(1, Math.floor(limit))}
      `);

      const claimed: ClaimedBackgroundTask[] = [];
      for (const row of rows) {
        const claimToken = randomUUID();
        const claimEpoch = row.attemptCount + 1;
        await tx.assistantBackgroundTask.update({
          where: { id: row.id },
          data: {
            schedulerClaimToken: claimToken,
            schedulerClaimEpoch: claimEpoch,
            schedulerClaimedAt: now,
            schedulerClaimExpiresAt: claimExpiresAt,
            attemptCount: claimEpoch
          }
        });
        const run = await tx.assistantBackgroundTaskRun.create({
          data: {
            taskId: row.id,
            assistantId: row.assistantId,
            userId: row.userId,
            workspaceId: row.workspaceId,
            scheduledRunAt: row.nextRunAt,
            startedAt: now,
            status: "running"
          },
          select: { id: true }
        });
        claimed.push({
          ...row,
          // ADR-090: post-claim attempt count is what the DB now holds and what
          // every downstream check (failTask exhaustion, backoff, deferTask
          // rewind) must compare against. Spreading `row` would leak the
          // pre-claim value and produce off-by-one budget arithmetic.
          attemptCount: claimEpoch,
          runId: run.id,
          scheduledRunAt: row.nextRunAt,
          claimToken,
          claimEpoch
        });
      }
      return claimed;
    });
  }

  private async processClaimedTask(task: ClaimedBackgroundTask): Promise<void> {
    const schedule = parseReminderSchedule(task.scheduleJson);
    if (schedule === null) {
      await this.failTask(task, false, "invalid_schedule", "Background task schedule is invalid.");
      return;
    }

    const assistant = await this.assistantRepository.findById(task.assistantId);
    if (assistant === null) {
      await this.failTask(task, false, "assistant_not_found", "Assistant not found.");
      return;
    }
    const spec = await this.ensureAssistantMaterializedSpecCurrentService.resolveCurrent(assistant);
    if (spec?.runtimeBundleDocument === null || spec?.runtimeBundleDocument === undefined) {
      await this.failTask(
        task,
        false,
        "runtime_bundle_missing",
        "Assistant runtime bundle is not materialized."
      );
      return;
    }

    const outcome = await this.internalRuntimeBackgroundTaskClientService.evaluate({
      assistantId: task.assistantId,
      workspaceId: task.workspaceId,
      runtimeTier:
        readRuntimeAssignmentStateFromMaterializedLayers(spec.layers)?.effectiveTier ??
        "free_shared_restricted",
      runtimeBundleDocument: spec.runtimeBundleDocument,
      task: {
        id: task.id,
        title: task.title,
        brief: task.brief,
        scheduleJson: task.scheduleJson,
        pushPolicyJson: task.pushPolicyJson,
        scheduledRunAt: task.scheduledRunAt.toISOString(),
        runCount: task.runCount,
        lastRunStatus: task.lastRunStatus,
        lastRunAt: task.lastRunAt?.toISOString() ?? null
      }
    });

    if (!outcome.ok) {
      if (outcome.deferred) {
        await this.deferTask(task, RUNTIME_SESSION_BUSY_DEFER_MS, "runtime_session_busy");
        return;
      }
      await this.failTask(
        task,
        outcome.retryable,
        outcome.code ?? "background_task_evaluation_failed",
        outcome.message
      );
      return;
    }

    await this.completeEvaluatedTask(task, schedule, outcome);
  }

  private async completeEvaluatedTask(
    task: ClaimedBackgroundTask,
    schedule: NonNullable<ReturnType<typeof parseReminderSchedule>>,
    outcome: Extract<InternalRuntimeBackgroundTaskEvaluationOutcome, { ok: true }>
  ): Promise<void> {
    const result = outcome.result;
    let deliveryResultJson: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
    const runStatus: "no_push" | "pushed" | "completed" =
      result.decision === "push"
        ? "pushed"
        : result.decision === "complete"
          ? "completed"
          : "no_push";
    if (result.decision === "push" && result.pushText) {
      const dedupeKey = `background_task:${task.id}:${task.scheduledRunAt.toISOString()}`;
      const intent = await this.notificationIntentService.createIntent({
        workspaceId: task.workspaceId,
        assistantId: task.assistantId,
        userId: task.userId,
        source: "background_task_push",
        class: "conversational",
        priority: "immediate",
        renderStrategy: "grounded_llm",
        factPayload: {
          pushText: result.pushText,
          backgroundTaskRunId: task.runId,
          artifacts: result.artifacts
        },
        dedupeKey,
        traceId: randomUUID()
      });
      deliveryResultJson = {
        intentId: intent.id,
        dedupeKey,
        lifecycleStatus: intent.lifecycleStatus
      };
    }

    const nextRunAtMs =
      result.decision === "complete"
        ? undefined
        : computeReminderNextRunAtMs(schedule, task.scheduledRunAt.getTime());
    const shouldCompleteTask = nextRunAtMs === undefined || result.decision === "complete";
    const taskUpdateData = {
      status: shouldCompleteTask ? ("completed" as const) : ("active" as const),
      nextRunAt: shouldCompleteTask ? null : new Date(nextRunAtMs!),
      completedAt: shouldCompleteTask ? new Date() : null,
      runCount: { increment: 1 },
      lastRunAt: new Date(),
      lastRunStatus: runStatus,
      ...(result.decision === "push" ? { lastPushAt: new Date() } : {}),
      attemptCount: 0,
      retryAfterAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastErrorAt: null,
      schedulerClaimToken: null,
      schedulerClaimEpoch: null,
      schedulerClaimedAt: null,
      schedulerClaimExpiresAt: null
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.assistantBackgroundTaskRun.updateMany({
        where: { id: task.runId, taskId: task.id },
        data: {
          status: runStatus,
          finishedAt: new Date(),
          decisionJson: {
            decision: result.decision,
            rationale: result.rationale,
            confidence: result.confidence,
            toolRunText: result.toolRunText,
            artifacts: result.artifacts.map((artifact) => ({
              artifactId: artifact.artifactId,
              kind: artifact.kind,
              objectKey: artifact.objectKey,
              mimeType: artifact.mimeType,
              filename: artifact.filename,
              sizeBytes: artifact.sizeBytes
            }))
          } as Prisma.InputJsonValue,
          pushText: result.pushText,
          deliveryResultJson,
          usageJson:
            result.usage === null
              ? Prisma.DbNull
              : (result.usage as unknown as Prisma.InputJsonValue)
        }
      });
      await tx.assistantBackgroundTask.updateMany({
        where: {
          id: task.id,
          schedulerClaimToken: task.claimToken,
          schedulerClaimEpoch: task.claimEpoch
        },
        data: {
          ...taskUpdateData
        }
      });
    });
  }

  private async deferTask(
    task: ClaimedBackgroundTask,
    delayMs: number,
    code: string
  ): Promise<void> {
    // ADR-090: A defer is "rewind to pending" — not a failure and not a success.
    // Close the run row that claimDueTasks created so we never leave orphan
    // `running` rows, and decrement attemptCount because claimDueTasks already
    // incremented it for what turned out to be an unconsumed attempt.
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.assistantBackgroundTaskRun.updateMany({
        where: { id: task.runId, taskId: task.id },
        data: {
          status: "skipped",
          finishedAt: now,
          errorCode: code,
          errorMessage: "Deferred: runtime session busy."
        }
      });
      await tx.assistantBackgroundTask.updateMany({
        where: {
          id: task.id,
          schedulerClaimToken: task.claimToken,
          schedulerClaimEpoch: task.claimEpoch
        },
        data: {
          status: "active",
          retryAfterAt: new Date(now.getTime() + delayMs),
          attemptCount: Math.max(0, task.attemptCount - 1),
          schedulerClaimToken: null,
          schedulerClaimEpoch: null,
          schedulerClaimedAt: null,
          schedulerClaimExpiresAt: null,
          lastErrorCode: code,
          lastErrorMessage: "Deferred: runtime session busy."
        }
      });
    });
    this.logger.debug(`Background task ${task.id} deferred for ${delayMs}ms (${code}).`);
  }

  private async failTask(
    task: ClaimedBackgroundTask,
    retryable: boolean,
    code: string,
    message: string
  ): Promise<void> {
    const now = new Date();
    const lastErrorMessage = truncateLastError(message);
    const exhausted = !retryable || task.attemptCount >= BACKGROUND_TASK_MAX_ATTEMPTS;
    await this.prisma.$transaction(async (tx) => {
      await tx.assistantBackgroundTaskRun.updateMany({
        where: { id: task.runId, taskId: task.id },
        data: {
          status: "failed",
          finishedAt: now,
          errorCode: code,
          errorMessage: lastErrorMessage
        }
      });
      await tx.assistantBackgroundTask.updateMany({
        where: {
          id: task.id,
          schedulerClaimToken: task.claimToken,
          schedulerClaimEpoch: task.claimEpoch
        },
        data: {
          status: exhausted ? "failed" : "active",
          retryAfterAt: exhausted
            ? null
            : new Date(now.getTime() + computeRetryBackoffMs(task.attemptCount)),
          disabledAt: exhausted ? now : null,
          lastRunAt: now,
          lastRunStatus: "failed",
          lastErrorCode: code,
          lastErrorMessage,
          lastErrorAt: now,
          schedulerClaimToken: null,
          schedulerClaimEpoch: null,
          schedulerClaimedAt: null,
          schedulerClaimExpiresAt: null
        }
      });
    });
    this.logger.warn({
      event: "assistant_background_task_failed",
      taskId: task.id,
      runId: task.runId,
      code,
      retryable,
      exhausted,
      message: lastErrorMessage
    });
  }
}
