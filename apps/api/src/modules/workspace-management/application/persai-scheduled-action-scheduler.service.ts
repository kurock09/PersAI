import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { HandleInternalCronFireService } from "./handle-internal-cron-fire.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
import { RunScheduledAssistantActionService } from "./run-scheduled-assistant-action.service";
import {
  computeReminderNextRunAtMs,
  parseReminderSchedule,
  type ReminderSchedule
} from "./reminder-schedule";

const SCHEDULED_ACTION_POLL_INTERVAL_MS = 5_000;
const SCHEDULED_ACTION_BATCH_SIZE = 8;
const SCHEDULED_ACTION_CLAIM_TTL_MS = 120_000;
const SCHEDULED_ACTION_RETRY_DELAY_MS = 30_000;

type ClaimedScheduledAction = {
  id: string;
  assistantId: string;
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
    private readonly runScheduledAssistantActionService: RunScheduledAssistantActionService
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
          externalRef: string;
          title: string;
          audience: "user" | "assistant";
          actionType: string | null;
          actionPayloadJson: Prisma.JsonValue;
          nextRunAt: Date;
          payloadText: string;
          scheduleJson: Prisma.JsonValue;
        }>
      >(Prisma.sql`
        SELECT
          "id",
          "assistant_id" AS "assistantId",
          "external_ref" AS "externalRef",
          "title",
          "audience",
          "action_type" AS "actionType",
          "action_payload_json" AS "actionPayloadJson",
          "next_run_at" AS "nextRunAt",
          "reminder_payload_text" AS "payloadText",
          "schedule_json" AS "scheduleJson"
        FROM "assistant_task_registry_items"
        WHERE "control_status" = CAST('active' AS "AssistantTaskRegistryControlStatus")
          AND "external_ref" IS NOT NULL
          AND "next_run_at" IS NOT NULL
          AND "reminder_payload_text" IS NOT NULL
          AND "schedule_json" IS NOT NULL
          AND "next_run_at" <= NOW()
          AND ("retry_after_at" IS NULL OR "retry_after_at" <= NOW())
          AND (
            "scheduler_claim_expires_at" IS NULL
            OR "scheduler_claim_expires_at" <= NOW()
            OR COALESCE("scheduler_claim_epoch", 0) < ${currentEpoch}
          )
        ORDER BY "next_run_at" ASC, "created_at" ASC
        FOR UPDATE SKIP LOCKED
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
          externalRef: row.externalRef,
          title: row.title,
          audience: row.audience,
          actionType: row.actionType,
          actionPayload: isRecord(row.actionPayloadJson) ? row.actionPayloadJson : null,
          nextRunAt: row.nextRunAt,
          payloadText: row.payloadText,
          schedule,
          claimToken,
          claimEpoch: currentEpoch
        });
      }
      return claimed;
    });
  }

  private async processClaimedTask(task: ClaimedScheduledAction): Promise<void> {
    try {
      const currentEpoch = await this.bumpConfigGenerationService.currentReminderSchedulerEpoch();
      if (currentEpoch !== task.claimEpoch) {
        await this.clearClaim(task.id, task.claimToken, task.claimEpoch);
        return;
      }
      const dueAtMs = task.nextRunAt.getTime();
      const nextRunAtMs = computeReminderNextRunAtMs(task.schedule, dueAtMs);
      if (task.audience === "assistant") {
        if (!task.actionType) {
          throw new Error("Assistant scheduled action is missing actionType.");
        }
        await this.runScheduledAssistantActionService.execute({
          assistantId: task.assistantId,
          externalRef: task.externalRef,
          title: task.title,
          actionType: task.actionType,
          actionPayload: task.actionPayload,
          payloadText: task.payloadText,
          runAtMs: dueAtMs
        });
        await this.completeAssistantActionRun(
          task.id,
          task.claimToken,
          task.claimEpoch,
          nextRunAtMs
        );
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
      await this.clearClaim(task.id, task.claimToken, task.claimEpoch);
    } catch (error) {
      await this.deferRetry(task.id, task.claimToken, task.claimEpoch);
      this.logger.error(
        `Scheduled action ${task.id} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

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

  private async deferRetry(id: string, claimToken: string, claimEpoch: number): Promise<void> {
    await this.prisma.assistantTaskRegistryItem.updateMany({
      where: { id, schedulerClaimToken: claimToken, schedulerClaimEpoch: claimEpoch },
      data: {
        retryAfterAt: new Date(Date.now() + SCHEDULED_ACTION_RETRY_DELAY_MS),
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      }
    });
  }

  private async completeAssistantActionRun(
    id: string,
    claimToken: string,
    claimEpoch: number,
    nextRunAtMs: number | undefined
  ): Promise<void> {
    if (nextRunAtMs === undefined) {
      await this.prisma.assistantTaskRegistryItem.deleteMany({
        where: {
          id,
          schedulerClaimToken: claimToken,
          schedulerClaimEpoch: claimEpoch
        }
      });
      return;
    }
    await this.prisma.assistantTaskRegistryItem.updateMany({
      where: {
        id,
        schedulerClaimToken: claimToken,
        schedulerClaimEpoch: claimEpoch
      },
      data: {
        controlStatus: "active",
        nextRunAt: new Date(nextRunAtMs),
        disabledAt: null,
        cancelledAt: null,
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      }
    });
  }
}
