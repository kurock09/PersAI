import { Injectable } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  buildAssistantSessionRoot,
  type ProviderGatewayToolCall,
  type RuntimeGlobToolResult,
  type RuntimeGrepMatch,
  type RuntimeGrepToolResult,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";

export interface RuntimeGrepToolExecutionResult {
  payload: RuntimeGrepToolResult;
  isError: boolean;
}

export interface RuntimeGlobToolExecutionResult {
  payload: RuntimeGlobToolResult;
  isError: boolean;
}

/**
 * ADR-137 S4 — inline `grep` / `glob` over committed storage-plane bytes.
 */
@Injectable()
export class RuntimeGrepGlobToolService {
  constructor(private readonly persaiInternalApiClientService: PersaiInternalApiClientService) {}

  async executeGrepToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    sessionId: string;
    requestId: string;
  }): Promise<RuntimeGrepToolExecutionResult> {
    const policy = this.resolveAllowedToolPolicy(params.bundle, "grep");
    if (policy === null) {
      return {
        payload: this.createSkippedGrep("tool_unavailable", null),
        isError: false
      };
    }
    const pattern = this.readPattern(params.toolCall.arguments);
    if (pattern === null) {
      return {
        payload: this.createSkippedGrep("invalid_arguments", "grep requires a non-empty pattern."),
        isError: true
      };
    }
    try {
      const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
        assistantId: params.bundle.metadata.assistantId,
        toolCode: "grep",
        dailyCallLimit: policy.dailyCallLimit
      });
      if (!quotaOutcome.allowed) {
        return {
          payload: this.createSkippedGrep(quotaOutcome.code, quotaOutcome.message),
          isError: false
        };
      }
      const args = this.asObject(params.toolCall.arguments);
      const outcome = await this.persaiInternalApiClientService.grepWorkspaceFiles({
        workspaceId: params.bundle.metadata.workspaceId,
        assistantId: params.bundle.metadata.assistantId,
        sessionId: params.sessionId,
        pattern,
        path: this.readOptionalString(args.path) ?? this.defaultSearchPath(params),
        glob: this.readOptionalString(args.glob),
        type: this.readOptionalString(args.type),
        caseInsensitive: args.caseInsensitive === true
      });
      if (outcome.reason !== null && outcome.matches.length === 0) {
        return {
          payload: this.createSkippedGrep(outcome.reason, outcome.warning),
          isError: true
        };
      }
      const matches: RuntimeGrepMatch[] = outcome.matches;
      return {
        payload: {
          toolCode: "grep",
          executionMode: "inline",
          action: "matched",
          reason: null,
          warning: outcome.warning,
          matches,
          matchCount: matches.length,
          truncated: outcome.truncated
        },
        isError: false
      };
    } catch (error) {
      return {
        payload: this.createSkippedGrep(
          "grep_failed",
          error instanceof Error ? error.message : "Grep tool execution failed."
        ),
        isError: true
      };
    }
  }

  async executeGlobToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    sessionId: string;
    requestId: string;
  }): Promise<RuntimeGlobToolExecutionResult> {
    const policy = this.resolveAllowedToolPolicy(params.bundle, "glob");
    if (policy === null) {
      return {
        payload: this.createSkippedGlob("tool_unavailable", null),
        isError: false
      };
    }
    const pattern = this.readPattern(params.toolCall.arguments);
    if (pattern === null) {
      return {
        payload: this.createSkippedGlob("invalid_arguments", "glob requires a non-empty pattern."),
        isError: true
      };
    }
    try {
      const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
        assistantId: params.bundle.metadata.assistantId,
        toolCode: "glob",
        dailyCallLimit: policy.dailyCallLimit
      });
      if (!quotaOutcome.allowed) {
        return {
          payload: this.createSkippedGlob(quotaOutcome.code, quotaOutcome.message),
          isError: false
        };
      }
      const args = this.asObject(params.toolCall.arguments);
      const outcome = await this.persaiInternalApiClientService.globWorkspaceFiles({
        workspaceId: params.bundle.metadata.workspaceId,
        assistantId: params.bundle.metadata.assistantId,
        sessionId: params.sessionId,
        pattern,
        path: this.readOptionalString(args.path) ?? this.defaultSearchPath(params)
      });
      if (outcome.reason !== null && outcome.paths.length === 0) {
        return {
          payload: this.createSkippedGlob(outcome.reason, outcome.warning),
          isError: true
        };
      }
      return {
        payload: {
          toolCode: "glob",
          executionMode: "inline",
          action: "found",
          reason: null,
          warning: outcome.warning,
          paths: outcome.paths,
          truncated: outcome.truncated
        },
        isError: false
      };
    } catch (error) {
      return {
        payload: this.createSkippedGlob(
          "glob_failed",
          error instanceof Error ? error.message : "Glob tool execution failed."
        ),
        isError: true
      };
    }
  }

  private defaultSearchPath(params: { bundle: AssistantRuntimeBundle; sessionId: string }): string {
    const assistantId = params.bundle.metadata.assistantId;
    if (assistantId.length === 0) {
      return "/workspace";
    }
    return buildAssistantSessionRoot(assistantId, params.sessionId);
  }

  private resolveAllowedToolPolicy(
    bundle: AssistantRuntimeBundle,
    toolCode: "grep" | "glob"
  ): RuntimeToolPolicy | null {
    const policy =
      bundle.governance.toolPolicies.find((entry) => entry.toolCode === toolCode) ?? null;
    if (
      policy === null ||
      policy.executionMode !== "inline" ||
      policy.enabled !== true ||
      policy.visibleToModel !== true ||
      policy.usageRule !== "allowed"
    ) {
      return null;
    }
    return policy;
  }

  private readPattern(value: unknown): string | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const pattern = (value as Record<string, unknown>).pattern;
    return typeof pattern === "string" && pattern.trim().length > 0 ? pattern : null;
  }

  private readOptionalString(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private asObject(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private createSkippedGrep(reason: string, warning: string | null): RuntimeGrepToolResult {
    return {
      toolCode: "grep",
      executionMode: "inline",
      action: "skipped",
      reason,
      warning,
      matches: [],
      matchCount: 0,
      truncated: false
    };
  }

  private createSkippedGlob(reason: string, warning: string | null): RuntimeGlobToolResult {
    return {
      toolCode: "glob",
      executionMode: "inline",
      action: "skipped",
      reason,
      warning,
      paths: [],
      truncated: false
    };
  }
}
