import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_RUNTIME_ADAPTER,
  type AssistantRuntimeAdapter
} from "./assistant-runtime-adapter.types";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  ASSISTANT_TASK_REGISTRY_REPOSITORY,
  type AssistantTaskRegistryRepository
} from "../domain/assistant-task-registry.repository";
import { SyncAssistantTaskRegistryService } from "./sync-assistant-task-registry.service";

type ReminderTaskControlAction = "create" | "pause" | "resume" | "cancel";

type CreateReminderTaskControlRequest = {
  assistantId: string;
  action: "create";
  title: string;
  reminderText: string;
  callbackBaseUrl: string;
  sessionKey?: string;
  runAt?: string;
  everyMs?: number;
  anchorAt?: string;
  cronExpr?: string;
  timezone?: string;
  contextMessages?: number;
};

type UpdateReminderTaskControlRequest = {
  assistantId: string;
  action: "pause" | "resume" | "cancel";
  taskId: string;
};

export type InternalReminderTaskControlRequest =
  | CreateReminderTaskControlRequest
  | UpdateReminderTaskControlRequest;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function buildTaskRegistrySyncPayload(params: { assistantId: string; job: unknown }) {
  if (!isRecord(params.job)) {
    return null;
  }
  const externalRef = typeof params.job.id === "string" ? params.job.id.trim() : "";
  const title = typeof params.job.name === "string" ? params.job.name.trim() : "";
  if (!externalRef || !title) {
    return null;
  }
  const enabled = params.job.enabled !== false;
  const state = isRecord(params.job.state) ? params.job.state : undefined;
  const nextRunAtMs =
    typeof state?.nextRunAtMs === "number" && Number.isFinite(state.nextRunAtMs)
      ? state.nextRunAtMs
      : null;

  return {
    operation: "upsert" as const,
    assistantId: params.assistantId,
    externalRef,
    title,
    sourceSurface: "web" as const,
    sourceLabel: "Assistant reminders",
    controlStatus: enabled ? ("active" as const) : ("disabled" as const),
    nextRunAt: nextRunAtMs === null ? null : new Date(nextRunAtMs).toISOString()
  };
}

function buildSchedule(input: CreateReminderTaskControlRequest) {
  const definedCount =
    Number(Boolean(input.runAt)) +
    Number(input.everyMs !== undefined) +
    Number(Boolean(input.cronExpr));
  if (definedCount !== 1) {
    throw new BadRequestException("Exactly one of runAt, everyMs, or cronExpr is required.");
  }
  if (input.runAt) {
    return { kind: "at" as const, at: input.runAt };
  }
  if (input.everyMs !== undefined) {
    return {
      kind: "every" as const,
      everyMs: Math.max(1, Math.floor(input.everyMs)),
      ...(input.anchorAt ? { anchorMs: new Date(input.anchorAt).getTime() } : {})
    };
  }
  return {
    kind: "cron" as const,
    expr: input.cronExpr!,
    ...(input.timezone ? { tz: input.timezone } : {})
  };
}

function buildCronWebhookUrl(callbackBaseUrl: string, assistantId: string): string {
  const base = callbackBaseUrl.replace(/\/+$/, "");
  return `${base}/api/v1/internal/cron-fire?assistantId=${encodeURIComponent(assistantId)}`;
}

@Injectable()
export class ControlInternalAssistantReminderTaskService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_TASK_REGISTRY_REPOSITORY)
    private readonly assistantTaskRegistryRepository: AssistantTaskRegistryRepository,
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly runtimeAdapter: AssistantRuntimeAdapter,
    private readonly syncAssistantTaskRegistryService: SyncAssistantTaskRegistryService
  ) {}

  parseInput(body: unknown): InternalReminderTaskControlRequest {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Body must be an object.");
    }

    const row = body as Record<string, unknown>;
    const assistantId = normalizeRequiredString(row.assistantId, "assistantId");
    const action = normalizeRequiredString(row.action, "action") as ReminderTaskControlAction;
    if (action !== "create" && action !== "pause" && action !== "resume" && action !== "cancel") {
      throw new BadRequestException("action must be create, pause, resume, or cancel.");
    }

    if (action === "create") {
      const everyMsRaw = row.everyMs;
      if (
        everyMsRaw !== undefined &&
        (typeof everyMsRaw !== "number" || !Number.isFinite(everyMsRaw) || everyMsRaw < 1)
      ) {
        throw new BadRequestException("everyMs must be a positive number.");
      }
      const contextMessagesRaw = row.contextMessages;
      if (
        contextMessagesRaw !== undefined &&
        (typeof contextMessagesRaw !== "number" ||
          !Number.isFinite(contextMessagesRaw) ||
          contextMessagesRaw < 0 ||
          contextMessagesRaw > 10)
      ) {
        throw new BadRequestException("contextMessages must be a number between 0 and 10.");
      }
      const callbackBaseUrl = normalizeRequiredString(row.callbackBaseUrl, "callbackBaseUrl");
      try {
        new URL(callbackBaseUrl);
      } catch {
        throw new BadRequestException("callbackBaseUrl must be a valid URL.");
      }
      return {
        assistantId,
        action,
        title: normalizeRequiredString(row.title, "title"),
        reminderText:
          normalizeOptionalString(row.reminderText) ?? normalizeRequiredString(row.title, "title"),
        callbackBaseUrl,
        ...(normalizeOptionalString(row.sessionKey)
          ? { sessionKey: normalizeOptionalString(row.sessionKey)! }
          : {}),
        ...(normalizeOptionalString(row.runAt)
          ? { runAt: normalizeOptionalString(row.runAt)! }
          : {}),
        ...(everyMsRaw !== undefined ? { everyMs: everyMsRaw as number } : {}),
        ...(normalizeOptionalString(row.anchorAt)
          ? { anchorAt: normalizeOptionalString(row.anchorAt)! }
          : {}),
        ...(normalizeOptionalString(row.cronExpr)
          ? { cronExpr: normalizeOptionalString(row.cronExpr)! }
          : {}),
        ...(normalizeOptionalString(row.timezone)
          ? { timezone: normalizeOptionalString(row.timezone)! }
          : {}),
        ...(contextMessagesRaw !== undefined
          ? { contextMessages: contextMessagesRaw as number }
          : {})
      };
    }

    return {
      assistantId,
      action,
      taskId: normalizeRequiredString(row.taskId, "taskId")
    };
  }

  async execute(input: InternalReminderTaskControlRequest): Promise<unknown> {
    const assistant = await this.assistantRepository.findById(input.assistantId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }

    if (input.action === "create") {
      return this.createReminderTask(input);
    }

    const task = await this.assistantTaskRegistryRepository.findByIdAndAssistantId(
      input.taskId,
      assistant.id
    );
    if (task === null) {
      throw new NotFoundException("Task not found.");
    }
    if (!task.externalRef) {
      throw new BadRequestException("Task is missing runtime externalRef.");
    }

    if (input.action === "cancel") {
      try {
        await this.runtimeAdapter.controlCronJob({
          action: "remove",
          args: { id: task.externalRef }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.toLowerCase().includes("unknown cron job id")) {
          throw error;
        }
      }
      await this.deleteTaskRegistryRow(assistant.id, task.externalRef);
      return {
        ok: true,
        cancelled: true,
        taskId: task.id,
        title: task.title
      };
    }

    const updatedJob = await this.runtimeAdapter.controlCronJob({
      action: "update",
      args: {
        id: task.externalRef,
        patch: {
          enabled: input.action === "resume"
        }
      }
    });

    const syncPayload = buildTaskRegistrySyncPayload({
      assistantId: assistant.id,
      job: this.unwrapToolDetails(updatedJob)
    });
    if (syncPayload !== null) {
      await this.syncAssistantTaskRegistryService.execute(syncPayload);
    }

    return {
      ok: true,
      [input.action === "pause" ? "paused" : "resumed"]: true,
      taskId: task.id,
      title: task.title
    };
  }

  private async createReminderTask(input: CreateReminderTaskControlRequest): Promise<unknown> {
    const createdJob = await this.runtimeAdapter.controlCronJob({
      action: "add",
      ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
      args: {
        job: {
          name: input.title,
          schedule: buildSchedule(input),
          payload: {
            kind: "systemEvent",
            text: input.reminderText
          },
          enabled: true,
          delivery: {
            mode: "webhook",
            to: buildCronWebhookUrl(input.callbackBaseUrl, input.assistantId)
          }
        },
        ...(input.contextMessages !== undefined ? { contextMessages: input.contextMessages } : {})
      }
    });

    const normalizedJob = this.unwrapToolDetails(createdJob);
    const syncPayload = buildTaskRegistrySyncPayload({
      assistantId: input.assistantId,
      job: normalizedJob
    });
    if (syncPayload === null) {
      throw new BadRequestException("Runtime create response is missing reminder metadata.");
    }
    await this.syncAssistantTaskRegistryService.execute(syncPayload);

    const taskRow = await this.findTaskByExternalRef(input.assistantId, syncPayload.externalRef);
    return {
      ok: true,
      created: true,
      task: taskRow
        ? {
            id: taskRow.id,
            title: taskRow.title,
            controlStatus: taskRow.controlStatus,
            nextRunAt: taskRow.nextRunAt?.toISOString() ?? null
          }
        : {
            id: null,
            title: syncPayload.title,
            controlStatus: syncPayload.controlStatus,
            nextRunAt: syncPayload.nextRunAt
          }
    };
  }

  private unwrapToolDetails(value: unknown): unknown {
    if (!isRecord(value)) {
      return value;
    }
    if ("details" in value) {
      return value.details;
    }
    return value;
  }

  private async findTaskByExternalRef(assistantId: string, externalRef: string) {
    const items = await this.assistantTaskRegistryRepository.listByAssistantId(assistantId, 80);
    return items.find((item) => item.externalRef === externalRef) ?? null;
  }

  private async deleteTaskRegistryRow(assistantId: string, externalRef: string): Promise<void> {
    await this.syncAssistantTaskRegistryService.execute({
      operation: "delete",
      assistantId,
      externalRef
    });
  }
}
