import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { HandleInternalCronFireService } from "./handle-internal-cron-fire.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
import {
  computeReminderNextRunAtMs,
  parseReminderSchedule,
  type ReminderSchedule
} from "./reminder-schedule";
import { ProactivePushPolicyService } from "./proactive-push-policy.service";

const SCHEDULED_ACTION_POLL_INTERVAL_MS = 5_000;
const SCHEDULED_ACTION_BATCH_SIZE = 8;
const SCHEDULED_ACTION_CLAIM_TTL_MS = 120_000;
// ADR-074 F1 (background-task hygiene): the previous flat 30 s retry +
// `RuntimeTurnReceipt`-counted exhaustion saturated within ~1.5 min on a
// stable upstream failure (multiple receipts per turn) and gave the user no
// observable signal. Replaced by a per-task `attemptCount` (single bump per
// `processClaimedTask` invocation) with exponential backoff capped at 1 h
// and a hard MAX_ATTEMPTS dead-letter for both audiences.
const SCHEDULED_ACTION_RETRY_BASE_DELAY_MS = 30_000;
const SCHEDULED_ACTION_RETRY_MAX_DELAY_MS = 60 * 60_000;
const SCHEDULED_ACTION_MAX_ATTEMPTS = 5;
const SCHEDULED_ACTION_LAST_ERROR_MESSAGE_MAX_CHARS = 2000;

type ClaimedScheduledAction = {
  id: string;
  assistantId: string;
  userId: string;
  workspaceId: string;
  externalRef: string;
  title: string;
  audience: "user" | "assistant";
  actionType: string | null;
  actionPayload: Record<string, unknown> | null;
  nextRunAt: Date;
  payloadText: string;
  schedule: ReminderSchedule;
  claimToken: string;
  claimEpoch: number;
  // ADR-074 Slice T1 frequency-safeguard bookkeeping (audience="user" only).
  lastFiredAt: Date | null;
  lastAnsweredCheckAt: Date | null;
  consecutiveUnanswered: number;
  workspaceTimezone: string | null;
  // ADR-074 F1: per-task attempt counter for backoff + dead-letter.
  attemptCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

@Injectable()
export class PersaiScheduledActionSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PersaiScheduledActionSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly handleInternalCronFireService: HandleInternalCronFireService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    private readonly proactivePushPolicyService: ProactivePushPolicyService
  ) {}

  async onModuleInit(): Promise<void> {
    const epoch = await this.bumpConfigGenerationService.bumpReminderSchedulerEpoch();
    this.logger.log(`Scheduled action scheduler epoch bumped to ${epoch}.`);
    this.scheduleNext(SCHEDULED_ACTION_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async processDueJobsBatch(limit = SCHEDULED_ACTION_BATCH_SIZE): Promise<number> {
    const claimed = await this.claimDueTasks(limit);
    for (const task of claimed) {
      await this.processClaimedTask(task);
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
      this.scheduleNext(SCHEDULED_ACTION_POLL_INTERVAL_MS);
      return;
    }

    this.running = true;
    try {
      let processed = 0;
      while (!this.stopped) {
        const count = await this.processDueJobsBatch();
        processed += count;
        if (count < SCHEDULED_ACTION_BATCH_SIZE) {
          break;
        }
      }
      if (processed > 0) {
        this.logger.log(`Processed ${processed} due scheduled action(s).`);
      }
    } catch (error) {
      this.logger.error(
        `Scheduled action scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.running = false;
      this.scheduleNext(SCHEDULED_ACTION_POLL_INTERVAL_MS);
    }
  }

  private async claimDueTasks(limit: number): Promise<ClaimedScheduledAction[]> {
    const now = new Date();
    const claimedUntil = new Date(now.getTime() + SCHEDULED_ACTION_CLAIM_TTL_MS);
    const currentEpoch = await this.bumpConfigGenerationService.currentReminderSchedulerEpoch();

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          assistantId: string;
          userId: string;
          workspaceId: string;
          externalRef: string;
          title: string;
          audience: "user" | "assistant";
          actionType: string | null;
          actionPayloadJson: Prisma.JsonValue;
          nextRunAt: Date;
          payloadText: string;
          scheduleJson: Prisma.JsonValue;
          lastFiredAt: Date | null;
          lastAnsweredCheckAt: Date | null;
          consecutiveUnanswered: number;
          workspaceTimezone: string | null;
          attemptCount: number;
        }>
      >(Prisma.sql`
        SELECT
          t."id",
          t."assistant_id" AS "assistantId",
          t."user_id" AS "userId",
          t."workspace_id" AS "workspaceId",
          t."external_ref" AS "externalRef",
          t."title",
          t."audience",
          t."action_type" AS "actionType",
          t."action_payload_json" AS "actionPayloadJson",
          t."next_run_at" AS "nextRunAt",
          t."reminder_payload_text" AS "payloadText",
          t."schedule_json" AS "scheduleJson",
          t."last_fired_at" AS "lastFiredAt",
          t."last_answered_check_at" AS "lastAnsweredCheckAt",
          t."consecutive_unanswered" AS "consecutiveUnanswered",
          t."attempt_count" AS "attemptCount",
          w."timezone" AS "workspaceTimezone"
        FROM "assistant_task_registry_items" t
        LEFT JOIN "workspaces" w ON w."id" = t."workspace_id"
        WHERE t."control_status" = CAST('active' AS "AssistantTaskRegistryControlStatus")
          AND t."external_ref" IS NOT NULL
          AND t."next_run_at" IS NOT NULL
          AND t."reminder_payload_text" IS NOT NULL
          AND t."schedule_json" IS NOT NULL
          AND t."next_run_at" <= NOW()
          AND (t."retry_after_at" IS NULL OR t."retry_after_at" <= NOW())
          AND (
            t."scheduler_claim_expires_at" IS NULL
            OR t."scheduler_claim_expires_at" <= NOW()
            OR COALESCE(t."scheduler_claim_epoch", 0) < ${currentEpoch}
          )
        ORDER BY t."next_run_at" ASC, t."created_at" ASC
        FOR UPDATE OF t SKIP LOCKED
        LIMIT ${Math.max(1, Math.floor(limit))}
      `);

      const claimed: ClaimedScheduledAction[] = [];
      for (const row of rows) {
        const schedule = parseReminderSchedule(row.scheduleJson);
        if (schedule === null) {
          continue;
        }
        const claimToken = randomUUID();
        await tx.assistantTaskRegistryItem.update({
          where: { id: row.id },
          data: {
            schedulerClaimToken: claimToken,
            schedulerClaimEpoch: currentEpoch,
            schedulerClaimedAt: now,
            schedulerClaimExpiresAt: claimedUntil
          }
        });
        claimed.push({
          id: row.id,
          assistantId: row.assistantId,
          userId: row.userId,
          workspaceId: row.workspaceId,
          externalRef: row.externalRef,
          title: row.title,
          audience: row.audience,
          actionType: row.actionType,
          actionPayload: isRecord(row.actionPayloadJson) ? row.actionPayloadJson : null,
          nextRunAt: row.nextRunAt,
          payloadText: row.payloadText,
          schedule,
          claimToken,
          claimEpoch: currentEpoch,
          lastFiredAt: row.lastFiredAt,
          lastAnsweredCheckAt: row.lastAnsweredCheckAt,
          consecutiveUnanswered: row.consecutiveUnanswered,
          workspaceTimezone: row.workspaceTimezone,
          attemptCount: row.attemptCount
        });
      }
      return claimed;
    });
  }

  private async processClaimedTask(task: ClaimedScheduledAction): Promise<void> {
    const dueAtMs = task.nextRunAt.getTime();
    const nextRunAtMs = computeReminderNextRunAtMs(task.schedule, dueAtMs);
    try {
      const currentEpoch = await this.bumpConfigGenerationService.currentReminderSchedulerEpoch();
      if (currentEpoch !== task.claimEpoch) {
        await this.clearClaim(task.id, task.claimToken, task.claimEpoch);
        return;
      }
      if (task.audience === "assistant") {
        await this.disableRetiredAssistantScheduledAction(task);
        return;
      }
      // ADR-074 Slice T1 hard constraint #11: gate fires only on
      // `audience="user"` tasks.
      const policyDecision = await this.evaluateProactivePushForUserTask(task);
      if (policyDecision.action === "defer") {
        this.logger.log(
          `Scheduled action ${task.id} deferred by proactive-push policy (reason=${policyDecision.reason}, until=${policyDecision.deferUntil.toISOString()}).`
        );
        await this.deferUserTaskByPolicy(task.id, task.claimToken, task.claimEpoch, {
          deferUntil: policyDecision.deferUntil,
          consecutiveUnansweredAfter: policyDecision.consecutiveUnansweredAfter,
          lastAnsweredCheckAtAfter: policyDecision.lastAnsweredCheckAtAfter
        });
        return;
      }
      await this.handleInternalCronFireService.execute({
        assistantId: task.assistantId,
        jobId: task.externalRef,
        action: "finished",
        status: "ok",
        summary: task.payloadText,
        runAtMs: dueAtMs,
        ...(nextRunAtMs === undefined ? {} : { nextRunAtMs })
      });
      // ADR-074 Slice T1 hard constraint #12: bump `lastFiredAt` atomically
      // with the existing claim release, only after the user-visible
      // dispatch succeeds. The unanswered counter and answered-check
      // timestamp follow the policy decision so a task whose previous
      // window just elapsed transitions cleanly.
      await this.completeUserActionRun(task.id, task.claimToken, task.claimEpoch, nextRunAtMs, {
        firedAt: new Date(),
        consecutiveUnansweredAfter: policyDecision.consecutiveUnansweredAfter,
        lastAnsweredCheckAtAfter: policyDecision.lastAnsweredCheckAtAfter
      });
    } catch (error) {
      // ADR-074 F1: ALL audiences now share one attempt-counter / backoff /
      // dead-letter contract; previously assistant-side counted failed
      // `RuntimeTurnReceipt` rows (saturated in 3 wall-clock minutes) and
      // user-side had no cap at all (could retry forever every 30 s with no
      // signal). Single contract: bump attemptCount once per failure, defer
      // with exponential backoff up to MAX_ATTEMPTS, then disable + emit a
      // structured `task_disabled_after_exhausted_retries` log.
      const nextAttempt = task.attemptCount + 1;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.name : "UnknownError";
      const truncatedErrorMessage = truncateForLastError(errorMessage);
      if (nextAttempt >= SCHEDULED_ACTION_MAX_ATTEMPTS) {
        await this.disableAfterExhaustedRetries(
          task.id,
          task.claimToken,
          task.claimEpoch,
          truncatedErrorMessage
        );
        this.logger.error({
          event: "task_disabled_after_exhausted_retries",
          taskId: task.id,
          externalRef: task.externalRef,
          audience: task.audience,
          scheduleKind: task.schedule.kind,
          attemptCount: nextAttempt,
          decision: "disable",
          errorName,
          errorMessage
        });
        return;
      }
      const backoffMs = computeRetryBackoffMs(nextAttempt);
      await this.deferRetryWithBackoff(
        task.id,
        task.claimToken,
        task.claimEpoch,
        backoffMs,
        nextAttempt,
        truncatedErrorMessage
      );
      this.logger.error({
        event: "scheduled_action_failed_deferred",
        taskId: task.id,
        externalRef: task.externalRef,
        audience: task.audience,
        scheduleKind: task.schedule.kind,
        attemptCount: nextAttempt,
        backoffMs,
        decision: "defer",
        errorName,
        errorMessage
      });
    }
  }

  // ADR-074 F1: `countFailedAssistantActionReceipts` removed — the unified
  // `attemptCount` column on `AssistantTaskRegistryItem` is the single source
  // of truth for retry exhaustion now. The previous receipt-count approach
  // saturated on a single failing turn whose tool loop iterated more than once
  // (each iteration produced its own receipt row), giving us a deceptive
  // "5 failed delivery attempts" signal after 3 wall-clock retries.

  private async clearClaim(id: string, claimToken: string, claimEpoch: number): Promise<void> {
    await this.prisma.assistantTaskRegistryItem.updateMany({
      where: { id, schedulerClaimToken: claimToken, schedulerClaimEpoch: claimEpoch },
      data: {
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      }
    });
  }

  private async disableRetiredAssistantScheduledAction(
    task: ClaimedScheduledAction
  ): Promise<void> {
    const now = new Date();
    await this.prisma.assistantTaskRegistryItem.updateMany({
      where: {
        id: task.id,
        schedulerClaimToken: task.claimToken,
        schedulerClaimEpoch: task.claimEpoch
      },
      data: {
        controlStatus: "disabled",
        nextRunAt: null,
        disabledAt: now,
        retryAfterAt: null,
        lastErrorMessage:
          "assistant scheduled_action is retired by ADR-077; use assistant_background_tasks.",
        lastErrorAt: now,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      }
    });
    this.logger.warn({
      event: "retired_assistant_scheduled_action_disabled",
      taskId: task.id,
      externalRef: task.externalRef,
      assistantId: task.assistantId
    });
  }

  // ADR-074 F1: bump attemptCount + persist last error breadcrumb +
  // exponential backoff retry. All failure paths now go through this method.
  private async deferRetryWithBackoff(
    id: string,
    claimToken: string,
    claimEpoch: number,
    backoffMs: number,
    nextAttempt: number,
    lastErrorMessage: string
  ): Promise<void> {
    const now = new Date();
    await this.prisma.assistantTaskRegistryItem.updateMany({
      where: { id, schedulerClaimToken: claimToken, schedulerClaimEpoch: claimEpoch },
      data: {
        retryAfterAt: new Date(now.getTime() + backoffMs),
        attemptCount: nextAttempt,
        lastErrorMessage,
        lastErrorAt: now,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      }
    });
  }

  private async disableAfterExhaustedRetries(
    id: string,
    claimToken: string,
    claimEpoch: number,
    lastErrorMessage: string
  ): Promise<void> {
    const now = new Date();
    await this.prisma.assistantTaskRegistryItem.updateMany({
      where: { id, schedulerClaimToken: claimToken, schedulerClaimEpoch: claimEpoch },
      data: {
        controlStatus: "disabled",
        nextRunAt: null,
        disabledAt: now,
        cancelledAt: null,
        retryAfterAt: null,
        attemptCount: SCHEDULED_ACTION_MAX_ATTEMPTS,
        lastErrorMessage,
        lastErrorAt: now,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      }
    });
  }

  private async evaluateProactivePushForUserTask(
    task: ClaimedScheduledAction
  ): Promise<ReturnType<ProactivePushPolicyService["evaluateProactivePush"]>> {
    // Reuse the existing M3.2 cross-thread `lastUserMessageAt` data path
    // (hard constraint #6): direct read against `assistant_chat_messages`
    // for the most recent message authored by `user` for this assistant.
    // `Assistant` is owned by a single user (the relation is keyed on
    // `(id, userId)`), so filtering by `assistantId` alone already scopes
    // the lookup to `task.userId`'s messages. NO new repository method,
    // mirrors the runtime presence renderer's "anywhere" query exactly.
    const latest = await this.prisma.assistantChatMessage.findFirst({
      where: {
        assistantId: task.assistantId,
        author: "user"
      },
      select: { createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    return this.proactivePushPolicyService.evaluateProactivePush({
      now: new Date(),
      audience: "user",
      timezone: task.workspaceTimezone,
      lastFiredAt: task.lastFiredAt,
      lastAnsweredCheckAt: task.lastAnsweredCheckAt,
      consecutiveUnanswered: task.consecutiveUnanswered,
      latestUserMessageAt: latest?.createdAt ?? null
    });
  }

  private async deferUserTaskByPolicy(
    id: string,
    claimToken: string,
    claimEpoch: number,
    update: {
      deferUntil: Date;
      consecutiveUnansweredAfter: number;
      lastAnsweredCheckAtAfter: Date | null;
    }
  ): Promise<void> {
    await this.prisma.assistantTaskRegistryItem.updateMany({
      where: { id, schedulerClaimToken: claimToken, schedulerClaimEpoch: claimEpoch },
      data: {
        nextRunAt: update.deferUntil,
        retryAfterAt: null,
        consecutiveUnanswered: update.consecutiveUnansweredAfter,
        lastAnsweredCheckAt: update.lastAnsweredCheckAtAfter,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      }
    });
  }

  private async completeUserActionRun(
    id: string,
    claimToken: string,
    claimEpoch: number,
    nextRunAtMs: number | undefined,
    update: {
      firedAt: Date;
      consecutiveUnansweredAfter: number;
      lastAnsweredCheckAtAfter: Date | null;
    }
  ): Promise<void> {
    if (nextRunAtMs === undefined) {
      // One-shot user push completed: delete the row, mirroring the
      // assistant-side path. `lastFiredAt` is irrelevant for a deleted row.
      await this.prisma.assistantTaskRegistryItem.deleteMany({
        where: { id, schedulerClaimToken: claimToken, schedulerClaimEpoch: claimEpoch }
      });
      return;
    }
    await this.prisma.assistantTaskRegistryItem.updateMany({
      where: { id, schedulerClaimToken: claimToken, schedulerClaimEpoch: claimEpoch },
      data: {
        controlStatus: "active",
        nextRunAt: new Date(nextRunAtMs),
        disabledAt: null,
        cancelledAt: null,
        retryAfterAt: null,
        lastFiredAt: update.firedAt,
        consecutiveUnanswered: update.consecutiveUnansweredAfter,
        lastAnsweredCheckAt: update.lastAnsweredCheckAtAfter,
        // ADR-074 F1: success resets the F1 attempt-counter / error breadcrumb.
        attemptCount: 0,
        lastErrorMessage: null,
        lastErrorAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      }
    });
  }
}

// ADR-074 F1: exponential backoff with a 1 h ceiling. Attempt 1 → 30 s, 2 → 1 m,
// 3 → 2 m, 4 → 4 m, 5 → 8 m (capped at 60 m). Anchored on `nextAttempt` (the
// counter value AFTER bumping for the just-failed attempt); see
// `processClaimedTask`'s catch branch.
export function computeRetryBackoffMs(nextAttempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(nextAttempt));
  const exponential = SCHEDULED_ACTION_RETRY_BASE_DELAY_MS * 2 ** (safeAttempt - 1);
  return Math.min(SCHEDULED_ACTION_RETRY_MAX_DELAY_MS, exponential);
}

function truncateForLastError(message: string): string {
  if (message.length <= SCHEDULED_ACTION_LAST_ERROR_MESSAGE_MAX_CHARS) {
    return message;
  }
  return `${message.slice(0, SCHEDULED_ACTION_LAST_ERROR_MESSAGE_MAX_CHARS - 1)}…`;
}
