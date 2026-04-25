import { Injectable } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  PERSAI_RUNTIME_BACKGROUND_TASK_ACTIONS,
  type ProviderGatewayToolCall,
  type RuntimeBackgroundTaskItem,
  type RuntimeBackgroundTaskRequest,
  type RuntimeBackgroundTaskToolResult,
  type RuntimeConversationAddress,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";
import {
  PersaiInternalApiClientService,
  type InternalBackgroundTaskItem
} from "./persai-internal-api.client.service";

class BackgroundTaskResolutionError extends Error {
  constructor(
    readonly code: "target_required" | "task_not_found" | "multiple_task_matches",
    message: string
  ) {
    super(message);
  }
}

export interface RuntimeBackgroundTaskToolExecutionResult {
  payload: RuntimeBackgroundTaskToolResult;
  isError: boolean;
}

@Injectable()
export class RuntimeBackgroundTaskToolService {
  constructor(private readonly persaiInternalApiClientService: PersaiInternalApiClientService) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    conversation: RuntimeConversationAddress;
  }): Promise<RuntimeBackgroundTaskToolExecutionResult> {
    void params.conversation;
    const request = this.readBackgroundTaskArguments(params.toolCall.arguments);
    if (request instanceof Error) {
      return {
        payload: this.createSkippedResult(null, "invalid_arguments", request.message),
        isError: true
      };
    }
    const policy = this.resolveAllowedWorkerToolPolicy(params.bundle, "background_task");
    if (policy === null) {
      return {
        payload: this.createSkippedResult(request.action, "tool_unavailable", null),
        isError: false
      };
    }
    try {
      const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
        assistantId: params.bundle.metadata.assistantId,
        toolCode: "background_task",
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

      switch (request.action) {
        case "list": {
          const items = await this.persaiInternalApiClientService.listBackgroundTasks(
            params.bundle.metadata.assistantId
          );
          return {
            payload: {
              toolCode: "background_task",
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
          const response = await this.persaiInternalApiClientService.controlBackgroundTask({
            assistantId: params.bundle.metadata.assistantId,
            action: "create",
            title: request.title,
            brief: request.brief,
            ...(request.runAt === undefined ? {} : { runAt: request.runAt }),
            ...(request.delayMs === undefined ? {} : { delayMs: request.delayMs }),
            ...(request.everyMs === undefined ? {} : { everyMs: request.everyMs }),
            ...(request.anchorAt === undefined ? {} : { anchorAt: request.anchorAt }),
            ...(request.cronExpr === undefined ? {} : { cronExpr: request.cronExpr }),
            ...(request.timezone === undefined ? {} : { timezone: request.timezone }),
            ...(request.pushPolicy === undefined ? {} : { pushPolicy: request.pushPolicy })
          });
          const task = this.normalizeTaskFromControlResponse(response) ?? {
            id: null,
            title: request.title,
            brief: request.brief,
            mode: "llm_evaluate",
            controlStatus: "active",
            nextRunAt: null,
            runCount: 0,
            lastRunAt: null,
            lastRunStatus: null,
            lastPushAt: null,
            lastErrorMessage: null,
            recentRuns: []
          };
          return {
            payload: {
              toolCode: "background_task",
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
          await this.persaiInternalApiClientService.controlBackgroundTask({
            assistantId: params.bundle.metadata.assistantId,
            action: request.action,
            taskId: target.id
          });
          return {
            payload: {
              toolCode: "background_task",
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
                ...this.toRuntimeTaskItem(target),
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
      if (error instanceof BackgroundTaskResolutionError) {
        return {
          payload: this.createSkippedResult(request.action, error.code, error.message),
          isError: true
        };
      }
      return {
        payload: this.createSkippedResult(
          request.action,
          request.action === "list" ? "task_list_failed" : "task_control_failed",
          error instanceof Error ? error.message : "Background task request failed."
        ),
        isError: true
      };
    }
  }

  private readBackgroundTaskArguments(
    args: Record<string, unknown>
  ): RuntimeBackgroundTaskRequest | Error {
    const action =
      typeof args.action === "string" &&
      PERSAI_RUNTIME_BACKGROUND_TASK_ACTIONS.includes(
        args.action as (typeof PERSAI_RUNTIME_BACKGROUND_TASK_ACTIONS)[number]
      )
        ? (args.action as RuntimeBackgroundTaskRequest["action"])
        : null;
    if (action === null) {
      return new Error(
        "background_task action must be one of create, list, pause, resume, or cancel."
      );
    }
    if (action === "create") {
      const title = this.asNonEmptyString(args.title);
      const brief = this.asNonEmptyString(args.brief);
      if (title === null) {
        return new Error("background_task create requires title.");
      }
      if (brief === null) {
        return new Error("background_task create requires brief.");
      }
      const runAt = this.asNonEmptyString(args.runAt) ?? undefined;
      const delayMs = this.asPositiveNumber(args.delayMs);
      const everyMs = this.asPositiveNumber(args.everyMs);
      const cronExpr = this.asNonEmptyString(args.cronExpr) ?? undefined;
      const scheduleCount =
        Number(runAt !== undefined) +
        Number(delayMs !== undefined) +
        Number(everyMs !== undefined) +
        Number(cronExpr !== undefined);
      if (scheduleCount !== 1) {
        return new Error(
          "background_task create requires exactly one schedule: runAt, delayMs, everyMs, or cronExpr."
        );
      }
      if ("delayMs" in args && delayMs === null) {
        return new Error("background_task delayMs must be a positive number.");
      }
      if ("everyMs" in args && everyMs === null) {
        return new Error("background_task everyMs must be a positive number.");
      }
      const pushPolicy = this.asJsonObject(args.pushPolicy);
      if ("pushPolicy" in args && pushPolicy === null) {
        return new Error("background_task pushPolicy must be a JSON object when provided.");
      }
      return {
        toolCode: "background_task",
        action,
        title,
        brief,
        ...(runAt === undefined ? {} : { runAt }),
        ...(delayMs === undefined || delayMs === null ? {} : { delayMs }),
        ...(everyMs === undefined || everyMs === null ? {} : { everyMs }),
        ...(this.asNonEmptyString(args.anchorAt) === null
          ? {}
          : { anchorAt: this.asNonEmptyString(args.anchorAt)! }),
        ...(cronExpr === undefined ? {} : { cronExpr }),
        ...(this.asNonEmptyString(args.timezone) === null
          ? {}
          : { timezone: this.asNonEmptyString(args.timezone)! }),
        ...(pushPolicy === undefined || pushPolicy === null ? {} : { pushPolicy })
      };
    }
    if (action === "pause" || action === "resume" || action === "cancel") {
      const taskId = this.asNonEmptyString(args.taskId) ?? undefined;
      const titleMatch = this.asNonEmptyString(args.titleMatch) ?? undefined;
      if (taskId === undefined && titleMatch === undefined) {
        return new Error("background_task pause/resume/cancel requires taskId or titleMatch.");
      }
      return {
        toolCode: "background_task",
        action,
        ...(taskId === undefined ? {} : { taskId }),
        ...(titleMatch === undefined ? {} : { titleMatch })
      };
    }
    return { toolCode: "background_task", action };
  }

  private async resolveTaskTarget(params: {
    assistantId: string;
    taskId?: string;
    titleMatch?: string;
  }): Promise<InternalBackgroundTaskItem> {
    const items = await this.persaiInternalApiClientService.listBackgroundTasks(params.assistantId);
    if (params.taskId) {
      const match = items.find((item) => item.id === params.taskId);
      if (match === undefined) {
        throw new BackgroundTaskResolutionError(
          "task_not_found",
          `Task "${params.taskId}" was not found.`
        );
      }
      return match;
    }
    const titleMatch = params.titleMatch?.toLowerCase();
    if (!titleMatch) {
      throw new BackgroundTaskResolutionError(
        "target_required",
        "taskId or titleMatch is required."
      );
    }
    const matches = items.filter((item) => item.title.toLowerCase().includes(titleMatch));
    if (matches.length === 0) {
      throw new BackgroundTaskResolutionError(
        "task_not_found",
        `No background task matched "${params.titleMatch}".`
      );
    }
    if (matches.length > 1) {
      throw new BackgroundTaskResolutionError(
        "multiple_task_matches",
        `Multiple background tasks matched "${params.titleMatch}". Use taskId.`
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

  private normalizeTaskFromControlResponse(value: unknown): RuntimeBackgroundTaskItem | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const task = (value as Record<string, unknown>).task;
    if (task === null || typeof task !== "object" || Array.isArray(task)) {
      return null;
    }
    const row = task as Record<string, unknown>;
    const title = this.asNonEmptyString(row.title);
    const status = this.asControlStatus(row.status);
    const mode = row.mode === "llm_evaluate" ? "llm_evaluate" : null;
    if (title === null || status === null || mode === null) {
      return null;
    }
    return {
      id: row.id === null ? null : this.asNonEmptyString(row.id),
      title,
      brief: this.asNonEmptyString(row.brief) ?? title,
      mode,
      controlStatus: status,
      nextRunAt: typeof row.nextRunAt === "string" ? row.nextRunAt : null,
      runCount: 0,
      lastRunAt: null,
      lastRunStatus: null,
      lastPushAt: null,
      lastErrorMessage: null,
      recentRuns: []
    };
  }

  private toRuntimeTaskItem(item: InternalBackgroundTaskItem): RuntimeBackgroundTaskItem {
    return {
      id: item.id,
      title: item.title,
      brief: item.brief,
      mode: item.mode,
      controlStatus: item.status,
      nextRunAt: item.nextRunAt,
      runCount: item.runCount,
      lastRunAt: item.lastRunAt,
      lastRunStatus: item.lastRunStatus,
      lastPushAt: item.lastPushAt,
      lastErrorMessage: item.lastErrorMessage,
      recentRuns: item.recentRuns
    };
  }

  private createSkippedResult(
    requestedAction: RuntimeBackgroundTaskToolResult["requestedAction"],
    reason: string,
    warning: string | null
  ): RuntimeBackgroundTaskToolResult {
    return {
      toolCode: "background_task",
      executionMode: "worker",
      requestedAction,
      action: "skipped",
      reason,
      warning,
      task: null,
      items: null
    };
  }

  private asControlStatus(value: unknown): RuntimeBackgroundTaskItem["controlStatus"] | null {
    return value === "active" ||
      value === "disabled" ||
      value === "completed" ||
      value === "failed" ||
      value === "cancelled"
      ? value
      : null;
  }

  private asJsonObject(value: unknown): Record<string, unknown> | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
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
