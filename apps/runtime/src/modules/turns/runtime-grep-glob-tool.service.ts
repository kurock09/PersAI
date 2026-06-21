import { Injectable } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeFileRef,
  RuntimeGlobToolResult,
  RuntimeGrepMatch,
  RuntimeGrepToolResult,
  RuntimeSandboxJobRequest,
  RuntimeSandboxJobResult,
  RuntimeToolPolicy
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { SandboxClientService } from "./sandbox-client.service";

export interface RuntimeGrepToolExecutionResult {
  payload: RuntimeGrepToolResult;
  isError: boolean;
}

export interface RuntimeGlobToolExecutionResult {
  payload: RuntimeGlobToolResult;
  isError: boolean;
}

/**
 * ADR-123 Slice 7 — inline `grep` / `glob` workspace tools.
 *
 * These mirror the `files`-read inline path: even though the model-facing
 * projection is `inline`, the search executes on the sandbox CONTROL PLANE
 * (trusted PersAI-owned `rg`/`fd` subprocesses against the hydrated workspace),
 * reached through the SAME sandbox-job contract that `files` uses. No exec pod
 * is created (see `RuntimeFilesToolService.executeSandboxJob`).
 */
@Injectable()
export class RuntimeGrepGlobToolService {
  constructor(
    private readonly sandboxClientService: SandboxClientService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService
  ) {}

  async executeGrepToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    sessionId: string;
    requestId: string;
    currentFileRefs: RuntimeFileRef[];
  }): Promise<RuntimeGrepToolExecutionResult> {
    const policy = this.resolveAllowedToolPolicy(params.bundle, "grep");
    if (policy === null) {
      return {
        payload: this.createSkippedGrep("tool_unavailable", null),
        isError: false
      };
    }
    if (!this.sandboxClientService.isConfigured()) {
      return {
        payload: this.createSkippedGrep(
          "sandbox_unconfigured",
          "Sandbox service is not configured."
        ),
        isError: true
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
      const job = await this.executeSandboxJob({
        bundle: params.bundle,
        sessionId: params.sessionId,
        requestId: params.requestId,
        toolCode: "grep",
        args: this.asObject(params.toolCall.arguments)
      });
      if (job.status !== "completed") {
        return {
          payload: this.createSkippedGrep(
            job.reason ?? "grep_failed",
            job.warning ?? job.violationMessage
          ),
          isError: true
        };
      }
      const parsed = this.parseGrepContent(job.content);
      return {
        payload: {
          toolCode: "grep",
          executionMode: "inline",
          action: "matched",
          reason: null,
          warning: job.warning,
          matches: parsed.matches,
          matchCount: parsed.matches.length,
          truncated: parsed.truncated
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
    currentFileRefs: RuntimeFileRef[];
  }): Promise<RuntimeGlobToolExecutionResult> {
    const policy = this.resolveAllowedToolPolicy(params.bundle, "glob");
    if (policy === null) {
      return {
        payload: this.createSkippedGlob("tool_unavailable", null),
        isError: false
      };
    }
    if (!this.sandboxClientService.isConfigured()) {
      return {
        payload: this.createSkippedGlob(
          "sandbox_unconfigured",
          "Sandbox service is not configured."
        ),
        isError: true
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
      const job = await this.executeSandboxJob({
        bundle: params.bundle,
        sessionId: params.sessionId,
        requestId: params.requestId,
        toolCode: "glob",
        args: this.asObject(params.toolCall.arguments)
      });
      if (job.status !== "completed") {
        return {
          payload: this.createSkippedGlob(
            job.reason ?? "glob_failed",
            job.warning ?? job.violationMessage
          ),
          isError: true
        };
      }
      const parsed = this.parseGlobContent(job.content);
      return {
        payload: {
          toolCode: "glob",
          executionMode: "inline",
          action: "found",
          reason: null,
          warning: job.warning,
          paths: parsed.paths,
          truncated: parsed.truncated
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

  private async executeSandboxJob(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    toolCode: "grep" | "glob";
    args: Record<string, unknown>;
  }): Promise<RuntimeSandboxJobResult> {
    const policy = input.bundle.runtime.sandbox;
    if (policy === undefined) {
      throw new Error("Sandbox policy is unavailable for grep/glob tool execution.");
    }
    return await this.sandboxClientService.waitForCompletion({
      assistantId: input.bundle.metadata.assistantId,
      workspaceId: input.bundle.metadata.workspaceId,
      runtimeRequestId: input.requestId,
      runtimeSessionId: input.sessionId,
      toolCode: input.toolCode,
      policy,
      mountedFileRefs: [],
      args: input.args
    } satisfies RuntimeSandboxJobRequest);
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
      policy.usageRule !== "allowed" ||
      bundle.runtime.sandbox?.enabled !== true
    ) {
      return null;
    }
    return policy;
  }

  private parseGrepContent(content: string | null): {
    matches: RuntimeGrepMatch[];
    truncated: boolean;
  } {
    if (content === null) {
      return { matches: [], truncated: false };
    }
    try {
      const parsed = JSON.parse(content) as {
        matches?: unknown;
        truncated?: unknown;
      };
      const matches = Array.isArray(parsed.matches)
        ? parsed.matches
            .filter(
              (entry): entry is { file: unknown; line: unknown; text: unknown } =>
                entry !== null && typeof entry === "object"
            )
            .map((entry) => ({
              file: typeof entry.file === "string" ? entry.file : "",
              line: typeof entry.line === "number" ? entry.line : 0,
              text: typeof entry.text === "string" ? entry.text : ""
            }))
        : [];
      return { matches, truncated: parsed.truncated === true };
    } catch {
      return { matches: [], truncated: false };
    }
  }

  private parseGlobContent(content: string | null): { paths: string[]; truncated: boolean } {
    if (content === null) {
      return { paths: [], truncated: false };
    }
    try {
      const parsed = JSON.parse(content) as { paths?: unknown; truncated?: unknown };
      const paths = Array.isArray(parsed.paths)
        ? parsed.paths.filter((entry): entry is string => typeof entry === "string")
        : [];
      return { paths, truncated: parsed.truncated === true };
    } catch {
      return { paths: [], truncated: false };
    }
  }

  private readPattern(value: unknown): string | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const pattern = (value as Record<string, unknown>).pattern;
    return typeof pattern === "string" && pattern.trim().length > 0 ? pattern : null;
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
