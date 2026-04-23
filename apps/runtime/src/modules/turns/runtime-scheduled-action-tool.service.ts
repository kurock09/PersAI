import { Injectable } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  PERSAI_RUNTIME_SCHEDULED_ACTION_ACTIONS,
  type PersaiRuntimeScheduledActionAudience,
  type ProviderGatewayToolCall,
  type RuntimeConversationAddress,
  type RuntimeScheduledActionItem,
  type RuntimeScheduledActionRequest,
  type RuntimeScheduledActionToolResult,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";
import {
  PersaiInternalApiClientService,
  type InternalScheduledActionItem
} from "./persai-internal-api.client.service";

const SCHEDULED_ACTION_CONTEXT_MESSAGES_MAX = 10;
const SCHEDULED_ACTION_THREAD_PREFIX = "system:scheduled-action:";

class ScheduledActionResolutionError extends Error {
  constructor(
    readonly code:
      | "target_required"
      | "task_not_found"
      | "multiple_task_matches"
      | "self_target_not_allowed",
    message: string
  ) {
    super(message);
  }
}

export interface RuntimeScheduledActionToolExecutionResult {
  payload: RuntimeScheduledActionToolResult;
  isError: boolean;
}

@Injectable()
export class RuntimeScheduledActionToolService {
  constructor(private readonly persaiInternalApiClientService: PersaiInternalApiClientService) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    conversation: RuntimeConversationAddress;
  }): Promise<RuntimeScheduledActionToolExecutionResult> {
    const request = this.readScheduledActionArguments(params.toolCall.arguments);
    if (request instanceof Error) {
      return {
        payload: this.createSkippedResult(null, "invalid_arguments", request.message),
        isError: true
      };
    }

    const policy = this.resolveAllowedWorkerToolPolicy(params.bundle, "scheduled_action");
    if (policy === null) {
      return {
        payload: this.createSkippedResult(request.action, "tool_unavailable", null),
        isError: false
      };
    }

    try {
      // ADR-074 L1.1 — always count for observability.
      const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
        assistantId: params.bundle.metadata.assistantId,
        toolCode: "scheduled_action",
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
          const items = this.filterCurrentBackgroundTask(
            await this.persaiInternalApiClientService.listScheduledActions(
              params.bundle.metadata.assistantId
            ),
            params.conversation
          );
          return {
            payload: {
              toolCode: "scheduled_action",
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
          const sharedCreateInput = {
            assistantId: params.bundle.metadata.assistantId,
            action: "create" as const,
            title,
            contextSessionKey: params.conversation.externalThreadKey,
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
          };
          const response = await this.persaiInternalApiClientService.controlScheduledAction(
            request.kind === "user_reminder"
              ? {
                  ...sharedCreateInput,
                  kind: "user_reminder",
                  reminderText: request.reminderText
                }
              : {
                  ...sharedCreateInput,
                  kind: "assistant_check",
                  actionType: request.actionType,
                  actionPayload: request.actionPayload
                }
          );
          const task = this.normalizeTaskFromControlResponse(response) ?? {
            id: null,
            title,
            audience: request.kind === "assistant_check" ? "assistant" : "user",
            actionType: request.kind === "assistant_check" ? request.actionType : null,
            controlStatus: "active",
            nextRunAt: null
          };
          return {
            payload: {
              toolCode: "scheduled_action",
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
            conversation: params.conversation,
            ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
            ...(request.titleMatch === undefined ? {} : { titleMatch: request.titleMatch })
          });
          await this.persaiInternalApiClientService.controlScheduledAction({
            assistantId: params.bundle.metadata.assistantId,
            action: request.action,
            taskId: target.id
          });
          return {
            payload: {
              toolCode: "scheduled_action",
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
                audience: target.audience,
                actionType: target.actionType,
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
      if (error instanceof ScheduledActionResolutionError) {
        return {
          payload: this.createSkippedResult(errorAction(request), error.code, error.message),
          isError: error.code !== "self_target_not_allowed"
        };
      }
      return {
        payload: this.createSkippedResult(
          request.action,
          request.action === "list" ? "task_list_failed" : "task_control_failed",
          error instanceof Error ? error.message : "Scheduled action request failed."
        ),
        isError: true
      };
    }
  }

  private readScheduledActionArguments(
    args: Record<string, unknown>
  ): RuntimeScheduledActionRequest | Error {
    const action =
      typeof args.action === "string" &&
      PERSAI_RUNTIME_SCHEDULED_ACTION_ACTIONS.includes(
        args.action as (typeof PERSAI_RUNTIME_SCHEDULED_ACTION_ACTIONS)[number]
      )
        ? (args.action as RuntimeScheduledActionRequest["action"])
        : null;
    if (action === null) {
      return new Error(
        "scheduled_action action must be one of create, list, pause, resume, or cancel."
      );
    }

    const kind = this.asCreateKind(args.kind);
    const title = this.asNonEmptyString(args.title);
    const reminderText = this.asNonEmptyString(args.reminderText) ?? undefined;
    const actionType = this.asNonEmptyString(args.actionType) ?? undefined;
    const actionPayload = this.asJsonObject(args.actionPayload);
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
        return new Error("scheduled_action create requires title.");
      }
      if (kind === null) {
        return new Error(
          'scheduled_action create requires kind="user_reminder" or kind="assistant_check".'
        );
      }
      const scheduleCount =
        Number(runAt !== undefined) +
        Number(delayMs !== undefined) +
        Number(everyMs !== undefined) +
        Number(cronExpr !== undefined);
      if (scheduleCount !== 1) {
        return new Error(
          "scheduled_action create requires exactly one schedule: runAt, delayMs, everyMs, or cronExpr."
        );
      }
      if ("contextMessages" in args && contextMessages === null) {
        return new Error(
          `scheduled_action contextMessages must be an integer between 0 and ${String(SCHEDULED_ACTION_CONTEXT_MESSAGES_MAX)}.`
        );
      }
      if ("delayMs" in args && delayMs === null) {
        return new Error("scheduled_action delayMs must be a positive number.");
      }
      if ("everyMs" in args && everyMs === null) {
        return new Error("scheduled_action everyMs must be a positive number.");
      }
      if ("actionPayload" in args && actionPayload === null) {
        return new Error("scheduled_action actionPayload must be a JSON object when provided.");
      }
      if ("audience" in args) {
        return new Error(
          'scheduled_action create no longer accepts audience. Use kind="user_reminder" or kind="assistant_check".'
        );
      }
      if (kind === "user_reminder" && reminderText === undefined) {
        return new Error(
          'scheduled_action create with kind="user_reminder" requires reminderText.'
        );
      }
      if (kind === "user_reminder" && (actionType !== undefined || actionPayload !== undefined)) {
        return new Error(
          'scheduled_action create with kind="user_reminder" does not accept actionType or actionPayload.'
        );
      }
      if (kind === "assistant_check" && actionType === undefined) {
        return new Error(
          'scheduled_action create with kind="assistant_check" requires actionType.'
        );
      }
      if (
        kind === "assistant_check" &&
        (actionPayload === undefined ||
          actionPayload === null ||
          Object.keys(actionPayload).length === 0)
      ) {
        return new Error(
          'scheduled_action create with kind="assistant_check" requires a non-empty actionPayload.'
        );
      }
      if (kind === "assistant_check" && reminderText !== undefined) {
        return new Error(
          'scheduled_action create with kind="assistant_check" does not accept reminderText.'
        );
      }
      const createRequest: RuntimeScheduledActionRequest =
        kind === "user_reminder"
          ? {
              toolCode: "scheduled_action",
              action,
              kind,
              title,
              reminderText: reminderText!
            }
          : {
              toolCode: "scheduled_action",
              action,
              kind,
              title,
              actionType: actionType!,
              actionPayload: actionPayload!
            };
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
        return new Error("scheduled_action pause/resume/cancel requires taskId or titleMatch.");
      }
      return {
        toolCode: "scheduled_action",
        action,
        ...(taskId === undefined ? {} : { taskId }),
        ...(titleMatch === undefined ? {} : { titleMatch })
      };
    }

    return {
      toolCode: "scheduled_action",
      action
    };
  }

  private async resolveTaskTarget(params: {
    assistantId: string;
    conversation: RuntimeConversationAddress;
    taskId?: string;
    titleMatch?: string;
  }): Promise<InternalScheduledActionItem> {
    const items = await this.persaiInternalApiClientService.listScheduledActions(
      params.assistantId
    );
    const currentBackgroundTask = this.resolveCurrentBackgroundTask(items, params.conversation);
    const visibleItems = this.filterCurrentBackgroundTask(items, params.conversation);
    if (params.taskId) {
      const match = visibleItems.find((item) => item.id === params.taskId);
      if (match === undefined) {
        if (currentBackgroundTask?.id === params.taskId) {
          throw new ScheduledActionResolutionError(
            "self_target_not_allowed",
            "The currently running assistant background task cannot pause, resume, or cancel itself during its own run."
          );
        }
        throw new ScheduledActionResolutionError(
          "task_not_found",
          `Task "${params.taskId}" was not found.`
        );
      }
      return match;
    }

    const titleMatch = params.titleMatch?.toLowerCase();
    if (!titleMatch) {
      throw new ScheduledActionResolutionError(
        "target_required",
        "taskId or titleMatch is required."
      );
    }

    const matches = visibleItems.filter((item) => item.title.toLowerCase().includes(titleMatch));
    if (matches.length === 0) {
      if (currentBackgroundTask?.title.toLowerCase().includes(titleMatch)) {
        throw new ScheduledActionResolutionError(
          "self_target_not_allowed",
          "The currently running assistant background task cannot pause, resume, or cancel itself during its own run."
        );
      }
      throw new ScheduledActionResolutionError(
        "task_not_found",
        `No current task matched "${params.titleMatch}".`
      );
    }
    if (matches.length > 1) {
      throw new ScheduledActionResolutionError(
        "multiple_task_matches",
        `Multiple current tasks matched "${params.titleMatch}". Use taskId.`
      );
    }
    return matches[0]!;
  }

  private filterCurrentBackgroundTask(
    items: InternalScheduledActionItem[],
    conversation: RuntimeConversationAddress
  ): InternalScheduledActionItem[] {
    const currentExternalRef = this.readCurrentScheduledActionExternalRef(conversation);
    if (currentExternalRef === null) {
      return items;
    }
    return items.filter((item) => item.externalRef !== currentExternalRef);
  }

  private resolveCurrentBackgroundTask(
    items: InternalScheduledActionItem[],
    conversation: RuntimeConversationAddress
  ): InternalScheduledActionItem | null {
    const currentExternalRef = this.readCurrentScheduledActionExternalRef(conversation);
    if (currentExternalRef === null) {
      return null;
    }
    return items.find((item) => item.externalRef === currentExternalRef) ?? null;
  }

  private readCurrentScheduledActionExternalRef(
    conversation: RuntimeConversationAddress
  ): string | null {
    const externalThreadKey = conversation.externalThreadKey.trim();
    if (!externalThreadKey.startsWith(SCHEDULED_ACTION_THREAD_PREFIX)) {
      return null;
    }
    const externalRef = externalThreadKey.slice(SCHEDULED_ACTION_THREAD_PREFIX.length).trim();
    return externalRef.length > 0 ? externalRef : null;
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

  private normalizeTaskFromControlResponse(value: unknown): RuntimeScheduledActionItem | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const task = (value as Record<string, unknown>).task;
    if (task === null || typeof task !== "object" || Array.isArray(task)) {
      return null;
    }
    const row = task as Record<string, unknown>;
    const title = this.asNonEmptyString(row.title);
    const audience = this.asAudience(row.audience);
    const actionType = row.actionType === null ? null : this.asNonEmptyString(row.actionType);
    const controlStatus = this.asTaskControlStatus(row.controlStatus);
    const nextRunAt =
      row.nextRunAt === null
        ? null
        : typeof row.nextRunAt === "string" && row.nextRunAt.trim().length > 0
          ? row.nextRunAt
          : null;
    if (title === null || audience === null || controlStatus === null) {
      return null;
    }
    return {
      id: row.id === null ? null : this.asNonEmptyString(row.id),
      title,
      audience,
      actionType,
      controlStatus,
      nextRunAt
    };
  }

  private toRuntimeTaskItem(item: InternalScheduledActionItem): RuntimeScheduledActionItem {
    return {
      id: item.id,
      title: item.title,
      audience: item.audience,
      actionType: item.actionType,
      controlStatus: item.controlStatus,
      nextRunAt: item.nextRunAt
    };
  }

  private createSkippedResult(
    requestedAction: RuntimeScheduledActionToolResult["requestedAction"],
    reason: string,
    warning: string | null
  ): RuntimeScheduledActionToolResult {
    return {
      toolCode: "scheduled_action",
      executionMode: "worker",
      requestedAction,
      action: "skipped",
      reason,
      warning,
      task: null,
      items: null
    };
  }

  private asTaskControlStatus(value: unknown): RuntimeScheduledActionItem["controlStatus"] | null {
    return value === "active" || value === "disabled" || value === "cancelled" ? value : null;
  }

  private asAudience(value: unknown): PersaiRuntimeScheduledActionAudience | null {
    return value === "user" || value === "assistant" ? value : null;
  }

  private asCreateKind(value: unknown): "user_reminder" | "assistant_check" | null {
    return value === "user_reminder" || value === "assistant_check" ? value : null;
  }

  private asJsonObject(value: unknown): Record<string, unknown> | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private asContextMessages(value: unknown): number | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (
      Number.isInteger(value) &&
      Number(value) >= 0 &&
      Number(value) <= SCHEDULED_ACTION_CONTEXT_MESSAGES_MAX
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
  request: RuntimeScheduledActionRequest
): RuntimeScheduledActionToolResult["requestedAction"] {
  return request.action;
}
