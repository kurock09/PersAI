import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { computeReminderNextRunAtMs, type ReminderSchedule } from "./reminder-schedule";

type BackgroundTaskControlAction = "create" | "pause" | "resume" | "cancel";

type CreateBackgroundTaskControlRequest = {
  assistantId: string;
  action: "create";
  title: string;
  brief: string;
  runAt?: string;
  delayMs?: number;
  everyMs?: number;
  anchorAt?: string;
  cronExpr?: string;
  timezone?: string;
  pushPolicy?: Record<string, unknown>;
};

type UpdateBackgroundTaskControlRequest = {
  assistantId: string;
  action: "pause" | "resume" | "cancel";
  taskId: string;
};

export type InternalBackgroundTaskControlRequest =
  | CreateBackgroundTaskControlRequest
  | UpdateBackgroundTaskControlRequest;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalPositiveNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new BadRequestException(`${fieldName} must be a positive number.`);
  }
  return value;
}

function buildSchedule(input: CreateBackgroundTaskControlRequest): ReminderSchedule {
  const definedCount =
    Number(Boolean(input.runAt)) +
    Number(input.delayMs !== undefined) +
    Number(input.everyMs !== undefined) +
    Number(Boolean(input.cronExpr));
  if (definedCount !== 1) {
    throw new BadRequestException(
      "Exactly one of runAt, delayMs, everyMs, or cronExpr is required."
    );
  }
  if (input.runAt) {
    const runAtMs = Date.parse(input.runAt);
    if (!Number.isFinite(runAtMs)) {
      throw new BadRequestException("runAt must be a valid ISO datetime.");
    }
    if (runAtMs <= Date.now()) {
      throw new BadRequestException("Background task time must be in the future.");
    }
    return { kind: "at", at: input.runAt };
  }
  if (input.delayMs !== undefined) {
    const delayMs = Math.max(1_000, Math.floor(input.delayMs));
    return { kind: "at", at: new Date(Date.now() + delayMs).toISOString() };
  }
  if (input.everyMs !== undefined) {
    const everyMs = Math.max(60_000, Math.floor(input.everyMs));
    const anchorAtMs = input.anchorAt ? Date.parse(input.anchorAt) : undefined;
    if (input.anchorAt && !Number.isFinite(anchorAtMs)) {
      throw new BadRequestException("anchorAt must be a valid ISO datetime.");
    }
    return {
      kind: "every",
      everyMs,
      ...(anchorAtMs === undefined ? {} : { anchorMs: anchorAtMs })
    };
  }
  return {
    kind: "cron",
    expr: input.cronExpr!,
    ...(input.timezone ? { tz: input.timezone } : {})
  };
}

@Injectable()
export class ControlInternalBackgroundTaskService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  parseInput(body: unknown): InternalBackgroundTaskControlRequest {
    if (!isRecord(body)) {
      throw new BadRequestException("Body must be an object.");
    }
    const assistantId = normalizeRequiredString(body.assistantId, "assistantId");
    const action = normalizeRequiredString(body.action, "action") as BackgroundTaskControlAction;
    if (action !== "create" && action !== "pause" && action !== "resume" && action !== "cancel") {
      throw new BadRequestException("action must be create, pause, resume, or cancel.");
    }
    if (action !== "create") {
      return {
        assistantId,
        action,
        taskId: normalizeRequiredString(body.taskId, "taskId")
      };
    }
    const pushPolicy = body.pushPolicy;
    if (pushPolicy !== undefined && !isRecord(pushPolicy)) {
      throw new BadRequestException("pushPolicy must be a JSON object when provided.");
    }
    return {
      assistantId,
      action,
      title: normalizeRequiredString(body.title, "title"),
      brief: normalizeRequiredString(body.brief, "brief"),
      ...(normalizeOptionalString(body.runAt)
        ? { runAt: normalizeOptionalString(body.runAt)! }
        : {}),
      ...(normalizeOptionalPositiveNumber(body.delayMs, "delayMs") === undefined
        ? {}
        : { delayMs: normalizeOptionalPositiveNumber(body.delayMs, "delayMs")! }),
      ...(normalizeOptionalPositiveNumber(body.everyMs, "everyMs") === undefined
        ? {}
        : { everyMs: normalizeOptionalPositiveNumber(body.everyMs, "everyMs")! }),
      ...(normalizeOptionalString(body.anchorAt)
        ? { anchorAt: normalizeOptionalString(body.anchorAt)! }
        : {}),
      ...(normalizeOptionalString(body.cronExpr)
        ? { cronExpr: normalizeOptionalString(body.cronExpr)! }
        : {}),
      ...(normalizeOptionalString(body.timezone)
        ? { timezone: normalizeOptionalString(body.timezone)! }
        : {}),
      ...(pushPolicy === undefined ? {} : { pushPolicy })
    };
  }

  async execute(input: InternalBackgroundTaskControlRequest): Promise<unknown> {
    const assistant = await this.assistantRepository.findById(input.assistantId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }
    if (input.action === "create") {
      const schedule = buildSchedule(input);
      const nextRunAtMs = computeReminderNextRunAtMs(schedule, Date.now());
      if (nextRunAtMs === undefined) {
        throw new BadRequestException("Background task schedule does not resolve to a future run.");
      }
      const created = await this.prisma.assistantBackgroundTask.create({
        data: {
          assistantId: assistant.id,
          userId: assistant.userId,
          workspaceId: assistant.workspaceId,
          title: input.title,
          brief: input.brief,
          externalRef: randomUUID(),
          scheduleJson: schedule as unknown as Prisma.InputJsonValue,
          pushPolicyJson:
            input.pushPolicy === undefined
              ? Prisma.DbNull
              : (input.pushPolicy as unknown as Prisma.InputJsonValue),
          nextRunAt: new Date(nextRunAtMs)
        },
        select: {
          id: true,
          title: true,
          status: true,
          mode: true,
          nextRunAt: true,
          externalRef: true
        }
      });
      return {
        ok: true,
        created: true,
        task: {
          id: created.id,
          title: created.title,
          status: created.status,
          mode: created.mode,
          nextRunAt: created.nextRunAt?.toISOString() ?? null,
          externalRef: created.externalRef
        }
      };
    }

    const task = await this.prisma.assistantBackgroundTask.findFirst({
      where: { id: input.taskId, assistantId: assistant.id },
      select: { id: true, title: true, scheduleJson: true, nextRunAt: true }
    });
    if (task === null) {
      throw new NotFoundException("Background task not found.");
    }
    if (input.action === "cancel") {
      await this.prisma.assistantBackgroundTask.update({
        where: { id: task.id },
        data: {
          status: "cancelled",
          nextRunAt: null,
          cancelledAt: new Date(),
          schedulerClaimToken: null,
          schedulerClaimEpoch: null,
          schedulerClaimedAt: null,
          schedulerClaimExpiresAt: null
        }
      });
      return { ok: true, cancelled: true, taskId: task.id, title: task.title };
    }
    await this.prisma.assistantBackgroundTask.update({
      where: { id: task.id },
      data: {
        status: input.action === "pause" ? "disabled" : "active",
        disabledAt: input.action === "pause" ? new Date() : null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      }
    });
    return {
      ok: true,
      [input.action === "pause" ? "paused" : "resumed"]: true,
      taskId: task.id,
      title: task.title
    };
  }
}
