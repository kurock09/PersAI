import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  PERSAI_RUNTIME_TODO_WRITE_ACTIONS,
  PERSAI_RUNTIME_TODO_WRITE_STATUSES,
  type PersaiRuntimeTodoWriteAction,
  type PersaiRuntimeTodoWriteStatus,
  type ProviderGatewayToolCall,
  type RuntimeTodoItem,
  type RuntimeTodoWriteToolResult,
  type RuntimeTurnRequest
} from "@persai/runtime-contract";
import {
  PersaiInternalApiClientService,
  type InternalApplyTodoWriteAction
} from "./persai-internal-api.client.service";

export interface RuntimeTodoWriteToolExecutionResult {
  payload: RuntimeTodoWriteToolResult;
  isError: boolean;
}

type ParsedAddItem = {
  content: string;
  parentId: string | null;
  status?: PersaiRuntimeTodoWriteStatus;
};

type ParsedAction =
  | { kind: "add"; items: ParsedAddItem[] }
  | {
      kind: "update";
      id: string;
      content?: string;
      status?: PersaiRuntimeTodoWriteStatus;
      parentId?: string | null;
    }
  | { kind: "complete"; id: string }
  | { kind: "remove"; id: string }
  | { kind: "clear" };

const ARGUMENT_KEYS = new Set(["action", "items", "id", "content", "status", "parentId"]);

const MAX_CONTENT_LENGTH = 240;

@Injectable()
export class RuntimeTodoWriteToolService {
  private readonly logger = new Logger(RuntimeTodoWriteToolService.name);

  constructor(private readonly persaiInternalApiClientService: PersaiInternalApiClientService) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    conversation: RuntimeTurnRequest["conversation"];
  }): Promise<RuntimeTodoWriteToolExecutionResult> {
    const parsed = this.readArguments(params.toolCall.arguments);
    if (parsed instanceof Error) {
      return {
        payload: this.skipped("invalid_arguments", parsed.message),
        isError: true
      };
    }

    const channel = this.resolveChannel(params.conversation.channel);
    if (channel === null) {
      return {
        payload: this.skipped(
          "surface_unavailable",
          `Chat todos are not available on channel "${params.conversation.channel}".`
        ),
        isError: false
      };
    }

    const policy = this.resolveAllowedInlineToolPolicy(params.bundle);
    if (policy === null) {
      return {
        payload: this.skipped("tool_disabled", "todo_write is not enabled for this assistant."),
        isError: false
      };
    }
    if (policy.dailyCallLimit !== null) {
      const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
        assistantId: params.bundle.metadata.assistantId,
        toolCode: "todo_write",
        dailyCallLimit: policy.dailyCallLimit
      });
      if (!quotaOutcome.allowed) {
        return {
          payload: this.skipped(quotaOutcome.code, quotaOutcome.message),
          isError: false
        };
      }
    }

    const internalAction = this.toInternalAction(parsed);
    if (internalAction instanceof Error) {
      return {
        payload: this.skipped("invalid_arguments", internalAction.message),
        isError: true
      };
    }

    const surfaceThreadKey = this.resolveSurfaceThreadKey(params.conversation);
    if (surfaceThreadKey === null) {
      return {
        payload: this.skipped(
          "missing_surface_thread_key",
          "Conversation does not carry a surface thread key."
        ),
        isError: true
      };
    }

    try {
      const outcome = await this.persaiInternalApiClientService.applyTodoWriteAction({
        assistantId: params.bundle.metadata.assistantId,
        channel,
        surfaceThreadKey,
        action: internalAction
      });
      return {
        payload: {
          toolCode: "todo_write",
          executionMode: "inline",
          action: outcome.action,
          reason: outcome.reason,
          warning: outcome.warning,
          todos: outcome.todos,
          windowed: outcome.windowed
        },
        isError: false
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Chat todos request failed.";
      this.logger.warn(
        `[todo_write] action=${parsed.kind} failed for assistant=${params.bundle.metadata.assistantId}: ${message}`
      );
      return {
        payload: this.skipped("todo_write_failed", message),
        isError: true
      };
    }
  }

  private readArguments(args: Record<string, unknown>): ParsedAction | Error {
    const unknownKeys = Object.keys(args).filter((key) => !ARGUMENT_KEYS.has(key));
    if (unknownKeys.length > 0) {
      return new Error(`Unknown argument keys: ${unknownKeys.join(", ")}.`);
    }
    const action = this.asAction(args.action);
    if (action === null) {
      return new Error(`action must be one of ${PERSAI_RUNTIME_TODO_WRITE_ACTIONS.join(", ")}.`);
    }

    switch (action) {
      case "add":
        return this.parseAdd(args);
      case "update":
        return this.parseUpdate(args);
      case "complete":
        return this.parseSimpleIdAction("complete", args);
      case "remove":
        return this.parseSimpleIdAction("remove", args);
      case "clear":
        return this.parseClear(args);
    }
  }

  private parseAdd(args: Record<string, unknown>): ParsedAction | Error {
    if (args.id !== undefined || args.content !== undefined || args.status !== undefined) {
      return new Error(
        "action=add accepts only `items`; do not supply top-level id/content/status."
      );
    }
    if (!Array.isArray(args.items) || args.items.length === 0) {
      return new Error("action=add requires a non-empty `items` array.");
    }
    const items: ParsedAddItem[] = [];
    for (let index = 0; index < args.items.length; index += 1) {
      const entry = args.items[index];
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        return new Error(`items[${index}] must be an object.`);
      }
      const row = entry as Record<string, unknown>;
      const allowed = new Set(["content", "parentId", "status"]);
      const unknown = Object.keys(row).filter((key) => !allowed.has(key));
      if (unknown.length > 0) {
        return new Error(`items[${index}] has unknown keys: ${unknown.join(", ")}.`);
      }
      const content = this.normalizeContent(row.content);
      if (content instanceof Error) {
        return new Error(`items[${index}].content: ${content.message}`);
      }
      const parentId = this.normalizeOptionalParentId(row.parentId);
      if (parentId instanceof Error) {
        return new Error(`items[${index}].parentId: ${parentId.message}`);
      }
      let status: PersaiRuntimeTodoWriteStatus | undefined;
      if (row.status !== undefined) {
        if (
          typeof row.status !== "string" ||
          !PERSAI_RUNTIME_TODO_WRITE_STATUSES.includes(row.status as PersaiRuntimeTodoWriteStatus)
        ) {
          return new Error(
            `items[${index}].status must be one of ${PERSAI_RUNTIME_TODO_WRITE_STATUSES.join(
              ", "
            )}.`
          );
        }
        if (row.status === "completed") {
          return new Error(`items[${index}].status: cannot start a new todo as completed.`);
        }
        status = row.status as PersaiRuntimeTodoWriteStatus;
      }
      const parsed: ParsedAddItem = { content, parentId };
      if (status !== undefined) parsed.status = status;
      items.push(parsed);
    }
    return { kind: "add", items };
  }

  private parseUpdate(args: Record<string, unknown>): ParsedAction | Error {
    if (args.items !== undefined) {
      return new Error("action=update does not accept `items`.");
    }
    const id = this.normalizeId(args.id);
    if (id instanceof Error) return id;
    const hasContent = args.content !== undefined;
    const hasStatus = args.status !== undefined;
    const hasParent = args.parentId !== undefined;
    if (!hasContent && !hasStatus && !hasParent) {
      return new Error("action=update requires at least one of content, status, parentId.");
    }
    const update: ParsedAction = { kind: "update", id };
    if (hasContent) {
      const content = this.normalizeContent(args.content);
      if (content instanceof Error) return content;
      update.content = content;
    }
    if (hasStatus) {
      if (
        typeof args.status !== "string" ||
        !PERSAI_RUNTIME_TODO_WRITE_STATUSES.includes(args.status as PersaiRuntimeTodoWriteStatus)
      ) {
        return new Error(`status must be one of ${PERSAI_RUNTIME_TODO_WRITE_STATUSES.join(", ")}.`);
      }
      update.status = args.status as PersaiRuntimeTodoWriteStatus;
    }
    if (hasParent) {
      const parentId = this.normalizeOptionalParentId(args.parentId);
      if (parentId instanceof Error) return parentId;
      update.parentId = parentId;
    }
    return update;
  }

  private parseSimpleIdAction(
    kind: "complete" | "remove",
    args: Record<string, unknown>
  ): ParsedAction | Error {
    if (
      args.items !== undefined ||
      args.content !== undefined ||
      args.status !== undefined ||
      args.parentId !== undefined
    ) {
      return new Error(`action=${kind} accepts only \`id\`.`);
    }
    const id = this.normalizeId(args.id);
    if (id instanceof Error) return id;
    return { kind, id };
  }

  private parseClear(args: Record<string, unknown>): ParsedAction | Error {
    if (
      args.items !== undefined ||
      args.id !== undefined ||
      args.content !== undefined ||
      args.status !== undefined ||
      args.parentId !== undefined
    ) {
      return new Error("action=clear does not accept any other fields.");
    }
    return { kind: "clear" };
  }

  private toInternalAction(parsed: ParsedAction): InternalApplyTodoWriteAction | Error {
    switch (parsed.kind) {
      case "add": {
        const items: Array<{
          content: string;
          parentId?: string | null;
          status?: PersaiRuntimeTodoWriteStatus;
        }> = parsed.items.map((item) => {
          const row: {
            content: string;
            parentId?: string | null;
            status?: PersaiRuntimeTodoWriteStatus;
          } = { content: item.content, parentId: item.parentId };
          if (item.status !== undefined) row.status = item.status;
          return row;
        });
        return { kind: "add", items };
      }
      case "update": {
        const action: InternalApplyTodoWriteAction & { kind: "update" } = {
          kind: "update",
          id: parsed.id
        };
        if (parsed.content !== undefined) action.content = parsed.content;
        if (parsed.status !== undefined) action.status = parsed.status;
        if (parsed.parentId !== undefined) action.parentId = parsed.parentId;
        return action;
      }
      case "complete":
        return { kind: "complete", id: parsed.id };
      case "remove":
        return { kind: "remove", id: parsed.id };
      case "clear":
        return { kind: "clear" };
    }
  }

  private resolveAllowedInlineToolPolicy(bundle: AssistantRuntimeBundle) {
    const policy =
      bundle.governance.toolPolicies.find((entry) => entry.toolCode === "todo_write") ?? null;
    if (
      policy === null ||
      policy.enabled !== true ||
      policy.usageRule !== "allowed" ||
      policy.executionMode !== "inline"
    ) {
      return null;
    }
    return policy;
  }

  private resolveChannel(channel: string): "web" | "telegram" | null {
    if (channel === "web" || channel === "telegram") return channel;
    return null;
  }

  private resolveSurfaceThreadKey(conversation: RuntimeTurnRequest["conversation"]): string | null {
    const key = conversation.externalThreadKey;
    if (typeof key !== "string") return null;
    const trimmed = key.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private asAction(value: unknown): PersaiRuntimeTodoWriteAction | null {
    if (
      typeof value === "string" &&
      PERSAI_RUNTIME_TODO_WRITE_ACTIONS.includes(value as PersaiRuntimeTodoWriteAction)
    ) {
      return value as PersaiRuntimeTodoWriteAction;
    }
    return null;
  }

  private normalizeContent(value: unknown): string | Error {
    if (typeof value !== "string") {
      return new Error("content must be a string.");
    }
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (trimmed.length === 0) {
      return new Error("content must be a non-empty string.");
    }
    if (trimmed.length > MAX_CONTENT_LENGTH) {
      return new Error(`content exceeds the ${MAX_CONTENT_LENGTH}-char limit.`);
    }
    return trimmed;
  }

  private normalizeId(value: unknown): string | Error {
    if (typeof value !== "string") {
      return new Error("id must be a string.");
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return new Error("id must be a non-empty string.");
    }
    return trimmed;
  }

  private normalizeOptionalParentId(value: unknown): string | null | Error {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value !== "string") {
      return new Error("parentId must be a string or null.");
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private skipped(reason: string, warning: string | null): RuntimeTodoWriteToolResult {
    const todos: RuntimeTodoItem[] = [];
    return {
      toolCode: "todo_write",
      executionMode: "inline",
      action: "skipped",
      reason,
      warning,
      todos,
      windowed: false
    };
  }
}
