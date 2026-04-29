import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RuntimeOutputArtifact } from "@persai/runtime-contract";
import { randomUUID } from "node:crypto";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  AssistantNotificationDeliveryService,
  type AssistantNotificationDeliveryStatus,
  type AssistantNotificationSource
} from "./assistant-notification-delivery.service";

const OUTBOX_POLL_INTERVAL_MS = 5_000;
const OUTBOX_BATCH_SIZE = 12;
const OUTBOX_CLAIM_TTL_MS = 90_000;
const OUTBOX_RETRY_BASE_DELAY_MS = 30_000;
const OUTBOX_RETRY_MAX_DELAY_MS = 60 * 60 * 1000;
const OUTBOX_MAX_ATTEMPTS = 5;
const OUTBOX_LAST_ERROR_MAX_CHARS = 1_000;

type ClaimedOutboxItem = {
  id: string;
  assistantId: string;
  source: AssistantNotificationSource;
  sourceId: string;
  deliveryStatus: AssistantNotificationDeliveryStatus;
  text: string | null;
  artifactsJson: unknown;
  metadataJson: unknown;
  attemptCount: number;
  claimToken: string;
};

function computeOutboxRetryBackoffMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(OUTBOX_RETRY_MAX_DELAY_MS, OUTBOX_RETRY_BASE_DELAY_MS * 2 ** (safeAttempt - 1));
}

function truncateLastError(message: string): string {
  if (message.length <= OUTBOX_LAST_ERROR_MAX_CHARS) {
    return message;
  }
  return `${message.slice(0, OUTBOX_LAST_ERROR_MAX_CHARS - 1)}...`;
}

@Injectable()
export class AssistantNotificationOutboxSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssistantNotificationOutboxSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly assistantNotificationDeliveryService: AssistantNotificationDeliveryService
  ) {}

  onModuleInit(): void {
    this.scheduleNext(OUTBOX_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async processDueNotificationsBatch(limit = OUTBOX_BATCH_SIZE): Promise<number> {
    const claimed = await this.claimDueNotifications(limit);
    for (const item of claimed) {
      await this.processClaimedNotification(item);
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
      this.scheduleNext(OUTBOX_POLL_INTERVAL_MS);
      return;
    }
    this.running = true;
    try {
      let processed = 0;
      while (!this.stopped) {
        const count = await this.processDueNotificationsBatch();
        processed += count;
        if (count < OUTBOX_BATCH_SIZE) {
          break;
        }
      }
      if (processed > 0) {
        this.logger.log(`Processed ${processed} assistant notification outbox item(s).`);
      }
    } catch (error) {
      this.logger.error(
        `Assistant notification outbox scheduler tick failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      this.running = false;
      this.scheduleNext(OUTBOX_POLL_INTERVAL_MS);
    }
  }

  private async claimDueNotifications(limit: number): Promise<ClaimedOutboxItem[]> {
    const now = new Date();
    const claimExpiresAt = new Date(now.getTime() + OUTBOX_CLAIM_TTL_MS);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          assistantId: string;
          source: AssistantNotificationSource;
          sourceId: string;
          deliveryStatus: AssistantNotificationDeliveryStatus;
          text: string | null;
          artifactsJson: unknown;
          metadataJson: unknown;
          attemptCount: number;
        }>
      >(Prisma.sql`
        SELECT
          "id",
          "assistant_id"       AS "assistantId",
          "source"::text       AS "source",
          "source_id"          AS "sourceId",
          "delivery_status"    AS "deliveryStatus",
          "text",
          "artifacts_json"     AS "artifactsJson",
          "metadata_json"      AS "metadataJson",
          "attempt_count"      AS "attemptCount"
        FROM "assistant_notification_outbox"
        WHERE (
            "status" = 'pending'
            AND ("retry_after_at" IS NULL OR "retry_after_at" <= NOW())
          )
          OR (
            "status" = 'in_progress'
            AND "scheduler_claim_expires_at" IS NOT NULL
            AND "scheduler_claim_expires_at" <= NOW()
          )
        ORDER BY "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${Math.max(1, Math.floor(limit))}
      `);

      const claimed: ClaimedOutboxItem[] = [];
      for (const row of rows) {
        const claimToken = randomUUID();
        await tx.assistantNotificationOutbox.update({
          where: { id: row.id },
          data: {
            status: "in_progress",
            schedulerClaimToken: claimToken,
            schedulerClaimedAt: now,
            schedulerClaimExpiresAt: claimExpiresAt,
            attemptCount: row.attemptCount + 1
          }
        });
        claimed.push({
          ...row,
          attemptCount: row.attemptCount + 1,
          claimToken
        });
      }
      return claimed;
    });
  }

  private async processClaimedNotification(item: ClaimedOutboxItem): Promise<void> {
    if (item.deliveryStatus !== "ok" || !item.text?.trim()) {
      await this.markSkipped(
        item,
        "notification_skipped",
        "Notification input is not deliverable."
      );
      return;
    }

    try {
      const artifacts = this.parseArtifacts(item.artifactsJson);
      const metadata = this.parseMetadata(item.metadataJson);
      const deliveryResult = await this.assistantNotificationDeliveryService.deliver({
        assistantId: item.assistantId,
        source: item.source,
        sourceId: item.sourceId,
        status: item.deliveryStatus,
        text: item.text,
        ...(artifacts === undefined ? {} : { artifacts }),
        ...(metadata === undefined ? {} : { metadata })
      });

      if (deliveryResult.target === "none") {
        await this.markSkipped(item, "delivery_skipped", "Delivery service skipped notification.", {
          deliveryResult
        });
        return;
      }

      await this.markDelivered(item, deliveryResult);
    } catch (error) {
      await this.handleFailure(
        item,
        "delivery_failed",
        error instanceof Error ? error.message : "Notification delivery failed."
      );
    }
  }

  private parseArtifacts(value: unknown): RuntimeOutputArtifact[] | undefined {
    return Array.isArray(value) ? (value as RuntimeOutputArtifact[]) : undefined;
  }

  private parseMetadata(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private async markDelivered(item: ClaimedOutboxItem, deliveryResult: unknown): Promise<void> {
    const resultJson = this.toJsonValue(deliveryResult);
    const deliveryResultObject = this.parseMetadata(deliveryResult);
    const target =
      deliveryResultObject?.target === undefined ? null : String(deliveryResultObject.target);
    await this.prisma.$transaction(async (tx) => {
      await tx.assistantNotificationOutbox.updateMany({
        where: { id: item.id, schedulerClaimToken: item.claimToken },
        data: {
          status: "delivered",
          deliveredAt: new Date(),
          deliveryTarget: target,
          deliveryResultJson: resultJson,
          schedulerClaimToken: null,
          schedulerClaimedAt: null,
          schedulerClaimExpiresAt: null,
          retryAfterAt: null,
          lastErrorCode: null,
          lastErrorMessage: null
        }
      });
      await this.updateBackgroundTaskRunDelivery(tx, item, target, resultJson);
    });
  }

  private async markSkipped(
    item: ClaimedOutboxItem,
    code: string,
    message: string,
    extra?: { deliveryResult: unknown }
  ): Promise<void> {
    const resultJson = extra === undefined ? undefined : this.toJsonValue(extra.deliveryResult);
    await this.prisma.$transaction(async (tx) => {
      await tx.assistantNotificationOutbox.updateMany({
        where: { id: item.id, schedulerClaimToken: item.claimToken },
        data: {
          status: "skipped",
          skippedAt: new Date(),
          ...(resultJson === undefined ? {} : { deliveryResultJson: resultJson }),
          schedulerClaimToken: null,
          schedulerClaimedAt: null,
          schedulerClaimExpiresAt: null,
          retryAfterAt: null,
          lastErrorCode: code.slice(0, 128),
          lastErrorMessage: truncateLastError(message)
        }
      });
      if (resultJson !== undefined) {
        await this.updateBackgroundTaskRunDelivery(tx, item, "none", resultJson);
      }
    });
  }

  private async updateBackgroundTaskRunDelivery(
    tx: Prisma.TransactionClient,
    item: ClaimedOutboxItem,
    target: string | null,
    resultJson: Prisma.InputJsonValue
  ): Promise<void> {
    if (item.source !== "background_task") {
      return;
    }
    const metadata = this.parseMetadata(item.metadataJson);
    const runId =
      typeof metadata?.backgroundTaskRunId === "string" ? metadata.backgroundTaskRunId : null;
    if (runId === null) {
      return;
    }
    await tx.assistantBackgroundTaskRun.updateMany({
      where: { id: runId, assistantId: item.assistantId },
      data: {
        deliveryTarget: target,
        deliveryResultJson: resultJson
      }
    });
  }

  private async handleFailure(
    item: ClaimedOutboxItem,
    code: string,
    message: string
  ): Promise<void> {
    if (item.attemptCount >= OUTBOX_MAX_ATTEMPTS) {
      await this.prisma.assistantNotificationOutbox.updateMany({
        where: { id: item.id, schedulerClaimToken: item.claimToken },
        data: {
          status: "dead_letter",
          deadLetteredAt: new Date(),
          schedulerClaimToken: null,
          schedulerClaimedAt: null,
          schedulerClaimExpiresAt: null,
          retryAfterAt: null,
          lastErrorCode: code.slice(0, 128),
          lastErrorMessage: truncateLastError(message)
        }
      });
      this.logger.error(
        `Notification outbox item ${item.id} dead-lettered after ${item.attemptCount} attempt(s): ${message}`
      );
      return;
    }

    const delayMs = computeOutboxRetryBackoffMs(item.attemptCount);
    await this.prisma.assistantNotificationOutbox.updateMany({
      where: { id: item.id, schedulerClaimToken: item.claimToken },
      data: {
        status: "pending",
        retryAfterAt: new Date(Date.now() + delayMs),
        schedulerClaimToken: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        lastErrorCode: code.slice(0, 128),
        lastErrorMessage: truncateLastError(message)
      }
    });
    this.logger.warn(
      `Notification outbox item ${item.id} deferred for retry (attempt ${item.attemptCount}, code=${code}): ${message}`
    );
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
