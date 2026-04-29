import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { createAssistantInboundConflict } from "./assistant-inbound-error";
import type { AssistantNotificationDeliveryTarget } from "./assistant-notification-delivery.service";
import { AssistantNotificationOutboxService } from "./assistant-notification-outbox.service";

export interface InternalCronFireRequest {
  assistantId: string;
  jobId: string;
  action: "finished";
  status: "ok" | "error" | "skipped";
  summary?: string;
  error?: string;
  runAtMs?: number;
  sessionId?: string;
  nextRunAtMs?: number;
}

const REMINDER_REPLAY_PROVIDER_KEY = "system_notifications";
const REMINDER_REPLAY_SURFACE_TYPE = "system_notification";
const REMINDER_REPLAY_CLAIM_STALE_MS = 120_000;
const REMINDER_REPLAY_WAIT_MS = 8_000;
const REMINDER_REPLAY_POLL_MS = 250;

function normalizeOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBindingMetadata(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function buildReminderReplayKey(input: InternalCronFireRequest): string {
  if (input.sessionId) {
    return `session:${input.sessionId}`;
  }
  return `job:${input.jobId}:run:${typeof input.runAtMs === "number" ? input.runAtMs : "na"}:status:${input.status}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class HandleInternalCronFireService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly bindingRepository: AssistantChannelSurfaceBindingRepository,
    private readonly assistantNotificationOutboxService: AssistantNotificationOutboxService
  ) {}

  parseInput(assistantId: string, payload: unknown): InternalCronFireRequest {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("Cron fire payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    const jobId = normalizeOptionalTrimmedString(body.jobId);
    const action = body.action;
    const status = body.status;
    const runAtMs = body.runAtMs;
    const sessionId = normalizeOptionalTrimmedString(body.sessionId);
    const nextRunAtMs = body.nextRunAtMs;

    if (!assistantId.trim()) {
      throw new BadRequestException("assistantId is required.");
    }
    if (!jobId) {
      throw new BadRequestException("jobId is required.");
    }
    if (action !== "finished") {
      throw new BadRequestException("Only cron finished webhook events are supported.");
    }
    if (status !== "ok" && status !== "error" && status !== "skipped") {
      throw new BadRequestException("status must be ok, error, or skipped.");
    }
    if (
      runAtMs !== undefined &&
      runAtMs !== null &&
      (typeof runAtMs !== "number" || !Number.isFinite(runAtMs))
    ) {
      throw new BadRequestException("runAtMs must be a finite number, null, or omitted.");
    }
    if (
      nextRunAtMs !== undefined &&
      nextRunAtMs !== null &&
      (typeof nextRunAtMs !== "number" || !Number.isFinite(nextRunAtMs))
    ) {
      throw new BadRequestException("nextRunAtMs must be a finite number, null, or omitted.");
    }

    const summary = normalizeOptionalTrimmedString(body.summary);
    const error = normalizeOptionalTrimmedString(body.error);

    return {
      assistantId: assistantId.trim(),
      jobId,
      action,
      status,
      ...(summary ? { summary } : {}),
      ...(error ? { error } : {}),
      ...(typeof runAtMs === "number" ? { runAtMs } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(typeof nextRunAtMs === "number" ? { nextRunAtMs } : {})
    };
  }

  async execute(
    input: InternalCronFireRequest
  ): Promise<{ ok: true; deliveredTo: AssistantNotificationDeliveryTarget }> {
    const replayKey = buildReminderReplayKey(input);
    const replayed = await this.claimOrReplayReminderDelivery(input.assistantId, replayKey);
    if (replayed !== null) {
      return { ok: true, deliveredTo: replayed.deliveredTo };
    }

    try {
      await this.syncTaskRegistryFromCronRun(input);
      await this.assistantNotificationOutboxService.enqueue({
        assistantId: input.assistantId,
        source: "user_reminder",
        sourceId: input.jobId,
        status: input.status,
        dedupeKey: replayKey,
        ...(input.summary === undefined ? {} : { text: input.summary })
      });
      const deliveredTo: AssistantNotificationDeliveryTarget = "none";
      await this.bindingRepository.completeReminderDeliveryProcessing(
        input.assistantId,
        REMINDER_REPLAY_PROVIDER_KEY,
        REMINDER_REPLAY_SURFACE_TYPE,
        {
          replayKey,
          deliveredTo,
          completedAt: new Date().toISOString()
        }
      );

      return { ok: true, deliveredTo };
    } catch (error) {
      await this.bindingRepository.releaseReminderDeliveryProcessing(
        input.assistantId,
        REMINDER_REPLAY_PROVIDER_KEY,
        REMINDER_REPLAY_SURFACE_TYPE,
        replayKey
      );
      throw error;
    }
  }

  private async claimOrReplayReminderDelivery(
    assistantId: string,
    replayKey: string
  ): Promise<{
    deliveredTo: AssistantNotificationDeliveryTarget;
  } | null> {
    const claim = await this.bindingRepository.claimReminderDeliveryProcessing(
      assistantId,
      REMINDER_REPLAY_PROVIDER_KEY,
      REMINDER_REPLAY_SURFACE_TYPE,
      replayKey,
      new Date(),
      REMINDER_REPLAY_CLAIM_STALE_MS
    );
    if (claim === "claimed") {
      return null;
    }
    if (claim === "duplicate_handled") {
      const completed = await this.bindingRepository.getCompletedReminderDeliveryProcessing(
        assistantId,
        REMINDER_REPLAY_PROVIDER_KEY,
        REMINDER_REPLAY_SURFACE_TYPE,
        replayKey
      );
      return completed ? { deliveredTo: completed.deliveredTo } : null;
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < REMINDER_REPLAY_WAIT_MS) {
      const completed = await this.bindingRepository.getCompletedReminderDeliveryProcessing(
        assistantId,
        REMINDER_REPLAY_PROVIDER_KEY,
        REMINDER_REPLAY_SURFACE_TYPE,
        replayKey
      );
      if (completed !== null) {
        return { deliveredTo: completed.deliveredTo };
      }
      await delay(REMINDER_REPLAY_POLL_MS);
    }

    throw createAssistantInboundConflict(
      "reminder_delivery_inflight",
      "This reminder delivery is already being processed."
    );
  }

  private async syncTaskRegistryFromCronRun(input: InternalCronFireRequest): Promise<void> {
    const nextRunAtMs =
      typeof input.nextRunAtMs === "number" && Number.isFinite(input.nextRunAtMs)
        ? input.nextRunAtMs
        : undefined;
    const completedOneShot =
      input.status === "ok" && (nextRunAtMs === undefined || nextRunAtMs <= Date.now());

    if (completedOneShot) {
      await this.prisma.assistantTaskRegistryItem.deleteMany({
        where: {
          assistantId: input.assistantId,
          externalRef: input.jobId
        }
      });
      await this.deleteTelegramReminderTarget(input.assistantId, input.jobId);
      return;
    }

    if (nextRunAtMs !== undefined) {
      await this.prisma.assistantTaskRegistryItem.updateMany({
        where: {
          assistantId: input.assistantId,
          externalRef: input.jobId
        },
        data: {
          nextRunAt: new Date(nextRunAtMs),
          ...(input.status === "error"
            ? {}
            : { controlStatus: "active", disabledAt: null, cancelledAt: null })
        }
      });
    }
  }

  private async deleteTelegramReminderTarget(
    assistantId: string,
    externalRef: string
  ): Promise<void> {
    const binding = await this.prisma.assistantChannelSurfaceBinding.findFirst({
      where: {
        assistantId,
        providerKey: "telegram",
        surfaceType: "telegram_bot",
        bindingState: "active"
      },
      select: { id: true, metadata: true }
    });
    if (binding === null) {
      return;
    }

    const metadata = normalizeBindingMetadata(binding.metadata);
    const reminderTaskTargets = isRecord(metadata.reminderTaskTargets)
      ? { ...metadata.reminderTaskTargets }
      : null;
    if (reminderTaskTargets === null || !(externalRef in reminderTaskTargets)) {
      return;
    }

    delete reminderTaskTargets[externalRef];
    await this.prisma.assistantChannelSurfaceBinding.update({
      where: { id: binding.id },
      data: {
        metadata: { ...metadata, reminderTaskTargets } as Prisma.InputJsonValue
      }
    });
  }
}
