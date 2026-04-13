import { Injectable } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  PERSAI_RUNTIME_REMINDER_TASK_ACTIONS,
  type ProviderGatewayToolCall,
  type RuntimeConversationAddress,
  type RuntimeReminderTaskItem,
  type RuntimeReminderTaskRequest,
  type RuntimeReminderTaskToolResult,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";
import {
  PersaiInternalApiClientService,
  type InternalReminderTaskItem
} from "./persai-internal-api.client.service";

const REMINDER_CONTEXT_MESSAGES_MAX = 10;

class ReminderTaskResolutionError extends Error {
  constructor(
    readonly code: "target_required" | "task_not_found" | "multiple_task_matches",
    message: string
  ) {
    super(message);
  }
}

export interface RuntimeReminderTaskToolExecutionResult {
  payload: RuntimeReminderTaskToolResult;
  isError: boolean;
}

@Injectable()
export class RuntimeReminderTaskToolService {
  constructor(private readonly persaiInternalApiClientService: PersaiInternalApiClientService) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    conversation: RuntimeConversationAddress;
  }): Promise<RuntimeReminderTaskToolExecutionResult> {
    const request = this.readReminderTaskArguments(params.toolCall.arguments);
    if (request instanceof Error) {
      return {
        payload: this.createSkippedResult(null, "invalid_arguments", request.message),
        isError: true
      };
    }

    const policy = this.resolveAllowedWorkerToolPolicy(params.bundle, "reminder_task");
    if (policy === null) {
      return {
        payload: this.createSkippedResult(request.action, "tool_unavailable", null),
        isError: false
      };
    }

    try {
      if (policy.dailyCallLimit !== null) {
        const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
          assistantId: params.bundle.metadata.assistantId,
          toolCode: "reminder_task",
          dailyCallLimit: policy.dailyCallLimit
        });
        if (!quotaOutcome.allowed) {
          return {
            payload: this.createSkippedResult(
              request.action,
              quotaOutcome.code,
              quotaOutcome.message
            ),
            isError: false
          };
        }
      }

      switch (request.action) {
        case "list": {
          const items = await this.persaiInternalApiClientService.listReminderTasks(
            params.bundle.metadata.assistantId
          );
          return {
            payload: {
              toolCode: "reminder_task",
              executionMode: "worker",
              requestedAction: "list",
              action: "listed",
              reason: null,
              warning: null,
              task: null,
              items: items.map((item) => this.toRuntimeTaskItem(item))
            },
            isError: false
          };
        }
        case "create": {
          const title = request.title ?? "";
          const response = await this.persaiInternalApiClientService.controlReminderTask({
            assistantId: params.bundle.metadata.assistantId,
            action: "create",
            title,
            reminderText: request.reminderText ?? title,
            ...(request.runAt === undefined ? {} : { runAt: request.runAt }),
            ...(request.delayMs === undefined ? {} : { delayMs: request.delayMs }),
            ...(request.everyMs === undefined ? {} : { everyMs: request.everyMs }),
            ...(request.anchorAt === undefined ? {} : { anchorAt: request.anchorAt }),
            ...(request.cronExpr === undefined ? {} : { cronExpr: request.cronExpr }),
            ...(request.timezone === undefined ? {} : { timezone: request.timezone }),
            ...(request.contextMessages === undefined
              ? {}
              : { contextMessages: request.contextMessages }),
            conversationContext: {
              channel: params.conversation.channel,
              externalThreadKey: params.conversation.externalThreadKey
            }
          });
          const task = this.normalizeTaskFromControlResponse(response) ?? {
            id: null,
            title,
            controlStatus: "active",
            nextRunAt: null
          };
          return {
            payload: {
              toolCode: "reminder_task",
              executionMode: "worker",
              requestedAction: "create",
              action: "created",
              reason: null,
              warning: null,
              task,
              items: null
            },
            isError: false
          };
        }
        case "pause":
        case "resume":
        case "cancel": {
          const target = await this.resolveTaskTarget({
            assistantId: params.bundle.metadata.assistantId,
            ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
            ...(request.titleMatch === undefined ? {} : { titleMatch: request.titleMatch })
          });
          await this.persaiInternalApiClientService.controlReminderTask({
            assistantId: params.bundle.metadata.assistantId,
            action: request.action,
            taskId: target.id
          });
          return {
            payload: {
              toolCode: "reminder_task",
              executionMode: "worker",
              requestedAction: request.action,
              action:
                request.action === "pause"
                  ? "paused"
                  : request.action === "resume"
                    ? "resumed"
                    : "cancelled",
              reason: null,
              warning: null,
              task: {
                id: target.id,
                title: target.title,
                controlStatus:
                  request.action === "pause"
                    ? "disabled"
                    : request.action === "resume"
                      ? "active"
                      : "cancelled",
                nextRunAt: request.action === "cancel" ? null : target.nextRunAt
              },
              items: null
            },
            isError: false
          };
        }
      }
    } catch (error) {
      if (error instanceof ReminderTaskResolutionError) {
        return {
          payload: this.createSkippedResult(errorAction(request), error.code, error.message),
          isError: true
        };
      }
      return {
        payload: this.createSkippedResult(
          request.action,
          request.action === "list" ? "task_list_failed" : "task_control_failed",
          error instanceof Error ? error.message : "Reminder task request failed."
        ),
        isError: true
      };
    }
  }

  private readReminderTaskArguments(
    args: Record<string, unknown>
  ): RuntimeReminderTaskRequest | Error {
    const action =
      typeof args.action === "string" &&
      PERSAI_RUNTIME_REMINDER_TASK_ACTIONS.includes(
        args.action as (typeof PERSAI_RUNTIME_REMINDER_TASK_ACTIONS)[number]
      )
        ? (args.action as RuntimeReminderTaskRequest["action"])
        : null;
    if (action === null) {
      return new Error(
        "reminder_task action must be one of create, list, pause, resume, or cancel."
      );
    }

    const title = this.asNonEmptyString(args.title);
    const reminderText = this.asNonEmptyString(args.reminderText) ?? undefined;
    const taskId = this.asNonEmptyString(args.taskId) ?? undefined;
    const titleMatch = this.asNonEmptyString(args.titleMatch) ?? undefined;
    const runAt = this.asNonEmptyString(args.runAt) ?? undefined;
    const delayMs = this.asPositiveNumber(args.delayMs);
    const everyMs = this.asPositiveNumber(args.everyMs);
    const anchorAt = this.asNonEmptyString(args.anchorAt) ?? undefined;
    const cronExpr = this.asNonEmptyString(args.cronExpr) ?? undefined;
    const timezone = this.asNonEmptyString(args.timezone) ?? undefined;
    const contextMessages = this.asContextMessages(args.contextMessages);

    if (action === "create") {
      if (title === null) {
        return new Error("reminder_task create requires title.");
      }
      const scheduleCount =
        Number(runAt !== undefined) +
        Number(delayMs !== undefined) +
        Number(everyMs !== undefined) +
        Number(cronExpr !== undefined);
      if (scheduleCount !== 1) {
        return new Error(
          "reminder_task create requires exactly one schedule: runAt, delayMs, everyMs, or cronExpr."
        );
      }
      if ("contextMessages" in args && contextMessages === null) {
        return new Error(
          `reminder_task contextMessages must be an integer between 0 and ${String(REMINDER_CONTEXT_MESSAGES_MAX)}.`
        );
      }
      if ("delayMs" in args && delayMs === null) {
        return new Error("reminder_task delayMs must be a positive number.");
      }
      if ("everyMs" in args && everyMs === null) {
        return new Error("reminder_task everyMs must be a positive number.");
      }
      const createRequest: RuntimeReminderTaskRequest = {
        toolCode: "reminder_task",
        action,
        title
      };
      if (reminderText !== undefined) {
        createRequest.reminderText = reminderText;
      }
      if (runAt !== undefined) {
        createRequest.runAt = runAt;
      }
      if (delayMs !== undefined && delayMs !== null) {
        createRequest.delayMs = delayMs;
      }
      if (everyMs !== undefined && everyMs !== null) {
        createRequest.everyMs = everyMs;
      }
      if (anchorAt !== undefined) {
        createRequest.anchorAt = anchorAt;
      }
      if (cronExpr !== undefined) {
        createRequest.cronExpr = cronExpr;
      }
      if (timezone !== undefined) {
        createRequest.timezone = timezone;
      }
      if (contextMessages !== undefined && contextMessages !== null) {
        createRequest.contextMessages = contextMessages;
      }
      return createRequest;
    }

    if (action === "pause" || action === "resume" || action === "cancel") {
      if (taskId === undefined && titleMatch === undefined) {
        return new Error("reminder_task pause/resume/cancel requires taskId or titleMatch.");
      }
      return {
        toolCode: "reminder_task",
        action,
        ...(taskId === undefined ? {} : { taskId }),
        ...(titleMatch === undefined ? {} : { titleMatch })
      };
    }

    return {
      toolCode: "reminder_task",
      action
    };
  }

  private async resolveTaskTarget(params: {
    assistantId: string;
    taskId?: string;
    titleMatch?: string;
  }): Promise<InternalReminderTaskItem> {
    const items = await this.persaiInternalApiClientService.listReminderTasks(params.assistantId);
    if (params.taskId) {
      const match = items.find((item) => item.id === params.taskId);
      if (match === undefined) {
        throw new ReminderTaskResolutionError(
          "task_not_found",
          `Task "${params.taskId}" was not found.`
        );
      }
      return match;
    }

    const titleMatch = params.titleMatch?.toLowerCase();
    if (!titleMatch) {
      throw new ReminderTaskResolutionError("target_required", "taskId or titleMatch is required.");
    }

    const matches = items.filter((item) => item.title.toLowerCase().includes(titleMatch));
    if (matches.length === 0) {
      throw new ReminderTaskResolutionError(
        "task_not_found",
        `No current task matched "${params.titleMatch}".`
      );
    }
    if (matches.length > 1) {
      throw new ReminderTaskResolutionError(
        "multiple_task_matches",
        `Multiple current tasks matched "${params.titleMatch}". Use taskId.`
      );
    }
    return matches[0]!;
  }

  private resolveAllowedWorkerToolPolicy(
    bundle: AssistantRuntimeBundle,
    toolCode: string
  ): RuntimeToolPolicy | null {
    const policy =
      bundle.governance.toolPolicies.find((entry) => entry.toolCode === toolCode) ?? null;
    if (
      policy === null ||
      policy.visibleToModel !== true ||
      policy.enabled !== true ||
      policy.usageRule !== "allowed" ||
      policy.executionMode !== "worker"
    ) {
      return null;
    }
    return policy;
  }

  private normalizeTaskFromControlResponse(value: unknown): RuntimeReminderTaskItem | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const task = (value as Record<string, unknown>).task;
    if (task === null || typeof task !== "object" || Array.isArray(task)) {
      return null;
    }
    const row = task as Record<string, unknown>;
    const title = this.asNonEmptyString(row.title);
    const controlStatus = this.asTaskControlStatus(row.controlStatus);
    const nextRunAt =
      row.nextRunAt === null
        ? null
        : typeof row.nextRunAt === "string" && row.nextRunAt.trim().length > 0
          ? row.nextRunAt
          : null;
    if (title === null || controlStatus === null) {
      return null;
    }
    return {
      id: row.id === null ? null : this.asNonEmptyString(row.id),
      title,
      controlStatus,
      nextRunAt
    };
  }

  private toRuntimeTaskItem(item: InternalReminderTaskItem): RuntimeReminderTaskItem {
    return {
      id: item.id,
      title: item.title,
      controlStatus: item.controlStatus,
      nextRunAt: item.nextRunAt
    };
  }

  private createSkippedResult(
    requestedAction: RuntimeReminderTaskToolResult["requestedAction"],
    reason: string,
    warning: string | null
  ): RuntimeReminderTaskToolResult {
    return {
      toolCode: "reminder_task",
      executionMode: "worker",
      requestedAction,
      action: "skipped",
      reason,
      warning,
      task: null,
      items: null
    };
  }

  private asTaskControlStatus(value: unknown): RuntimeReminderTaskItem["controlStatus"] | null {
    return value === "active" || value === "disabled" || value === "cancelled" ? value : null;
  }

  private asContextMessages(value: unknown): number | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (
      Number.isInteger(value) &&
      Number(value) >= 0 &&
      Number(value) <= REMINDER_CONTEXT_MESSAGES_MAX
    ) {
      return Number(value);
    }
    return null;
  }

  private asPositiveNumber(value: unknown): number | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }
}

function errorAction(
  request: RuntimeReminderTaskRequest
): RuntimeReminderTaskToolResult["requestedAction"] {
  return request.action;
}
