import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import Ajv2020 from "ajv/dist/2020.js";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  DEFAULT_RUNTIME_SANDBOX_POLICY,
  type ProviderGatewayToolCall,
  type RuntimeScriptInputSource,
  type RuntimeScriptToolResult
} from "@persai/runtime-contract";
import type { ResolvedActiveScenarioStep } from "./build-active-scenario-block.service";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { SandboxClientService } from "./sandbox-client.service";
import type { TurnToolProgressSink } from "./tool-progress-sink";

export interface RuntimeScriptToolExecutionResult {
  payload: RuntimeScriptToolResult;
  isError: boolean;
}

const AJV_ERROR_MESSAGE_MAX_COUNT = 5;
const AJV_ERROR_MESSAGE_MAX_CHARS = 600;
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const ajv = new Ajv2020({
  strict: true,
  strictSchema: true,
  allErrors: true,
  validateSchema: true
});

/**
 * ADR-151 — dispatch for the provider-facing `script` tool's `execute`
 * action. Projection (`native-tool-projection.ts`) is not authorization: this
 * service re-resolves the exact current active Scenario step from live
 * decision state immediately before doing anything, re-fetches the pinned
 * `ScriptVersion` artifact through the internal API's live authorization
 * gate, maps inputs from exactly the three authored sources, validates the
 * mapped object against the published input JSON Schema, derives a
 * server-only idempotency key, and executes through the exact existing warm
 * session sandbox path (`SandboxClientService` → `script.execute`).
 */
@Injectable()
export class RuntimeScriptToolService {
  private readonly logger = new Logger(RuntimeScriptToolService.name);

  constructor(
    private readonly sandboxClientService: SandboxClientService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService
  ) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    activeScenarioStep: ResolvedActiveScenarioStep | null;
    sessionId: string;
    requestId: string;
    currentUserMessageText: string | null;
    abortSignal?: AbortSignal;
    toolProgressSink?: TurnToolProgressSink;
  }): Promise<RuntimeScriptToolExecutionResult> {
    const scriptRef = params.activeScenarioStep?.step.scriptRef ?? null;
    if (params.activeScenarioStep === null || scriptRef === null) {
      return this.skipped("script_not_active", "No Script is bound to the current Scenario step.");
    }
    if (
      !this.sandboxClientService.isConfigured() ||
      params.bundle.runtime.sandbox?.enabled !== true
    ) {
      return this.skipped("sandbox_unconfigured", "Sandbox service is not configured.");
    }
    if (params.abortSignal?.aborted) {
      return this.skipped(
        "user_stopped",
        "Script execution was cancelled because the turn was stopped."
      );
    }

    const artifactInput = this.parseToolCallArguments(params.toolCall);
    if (artifactInput === null) {
      return this.skipped(
        "invalid_arguments",
        'The "script" tool requires {action:"execute", input: object}.'
      );
    }

    const artifact = await this.persaiInternalApiClientService.fetchScriptVersionArtifact({
      assistantId: params.bundle.metadata.assistantId,
      skillId: params.activeScenarioStep.skillId,
      scriptKey: scriptRef.scriptKey,
      scriptVersionId: scriptRef.scriptVersionId,
      contentHash: scriptRef.contentHash
    });
    if (!artifact.ok) {
      return this.skipped(artifact.code, artifact.message);
    }
    if (
      Object.entries(scriptRef.inputMapping).some(
        ([fieldName, source]) =>
          FORBIDDEN_OBJECT_KEYS.has(fieldName) ||
          (source.source === "tool_input" && FORBIDDEN_OBJECT_KEYS.has(source.name))
      )
    ) {
      return this.skipped("script_input_mapping_invalid", "The Script input mapping is invalid.");
    }

    const mappedInput = this.buildMappedInput(
      scriptRef.inputMapping,
      artifactInput,
      params.currentUserMessageText
    );
    const inputValidation = this.validateAgainstSchema(artifact.inputSchema, mappedInput);
    if (!inputValidation.ok) {
      return this.skipped("script_input_invalid", inputValidation.message);
    }

    const scriptInvocationKey = this.deriveScriptInvocationKey({
      requestId: params.requestId,
      toolCallId: params.toolCall.id,
      scriptVersionId: artifact.scriptVersionId
    });

    try {
      const job = await this.sandboxClientService.waitForCompletion(
        {
          assistantId: params.bundle.metadata.assistantId,
          assistantHandle: params.bundle.metadata.assistantHandle,
          siblingHandles: params.bundle.metadata.siblingAssistantHandles,
          workspaceId: params.bundle.metadata.workspaceId,
          runtimeRequestId: params.requestId,
          runtimeSessionId: params.sessionId,
          toolCode: "script.execute",
          policy: params.bundle.runtime.sandbox ?? DEFAULT_RUNTIME_SANDBOX_POLICY,
          args: { input: mappedInput },
          scriptVersionId: artifact.scriptVersionId,
          scriptSkillId: params.activeScenarioStep.skillId,
          scriptContentHash: artifact.contentHash,
          scriptInvocationKey
        },
        {
          ...(params.abortSignal === undefined ? {} : { signal: params.abortSignal }),
          ...(params.toolProgressSink === undefined
            ? {}
            : {
                onPoll: (polledJob) => {
                  params.toolProgressSink?.trackSandboxPoll({
                    toolCallId: params.toolCall.id,
                    toolName: params.toolCall.name,
                    job: polledJob
                  });
                }
              })
        }
      );

      if (job.status !== "completed") {
        const reason = job.reason ?? job.violationCode ?? "script_execution_failed";
        const warning = job.warning ?? job.violationMessage ?? "Script execution did not complete.";
        return job.status === "blocked"
          ? this.blocked(reason, warning, artifact.scriptKey, artifact.versionNumber, job.jobId)
          : this.skipped(reason, warning, artifact.scriptKey, artifact.versionNumber, job.jobId);
      }
      if (job.reason !== null) {
        return this.skipped(
          job.reason,
          job.warning ?? "Script execution did not produce a valid result.",
          artifact.scriptKey,
          artifact.versionNumber,
          job.jobId
        );
      }

      const rawOutput = this.parseJobContent(job.content);
      if (rawOutput === undefined) {
        return this.skipped(
          "script_output_not_json",
          "The Script result was not valid JSON.",
          artifact.scriptKey,
          artifact.versionNumber,
          job.jobId
        );
      }
      const outputValidation = this.validateAgainstSchema(artifact.outputSchema, rawOutput);
      if (!outputValidation.ok) {
        this.logger.warn(
          `[script-tool] output schema mismatch scriptKey=${artifact.scriptKey} versionNumber=${String(artifact.versionNumber)} message=${outputValidation.message}`
        );
        return this.skipped(
          "script_output_schema_invalid",
          outputValidation.message,
          artifact.scriptKey,
          artifact.versionNumber,
          job.jobId
        );
      }

      return {
        payload: {
          toolCode: "script.execute",
          executionMode: "sandbox",
          action: "completed",
          reason: null,
          warning: job.warning,
          scriptKey: artifact.scriptKey,
          versionNumber: artifact.versionNumber,
          jobId: job.jobId,
          output: rawOutput
        },
        isError: false
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return this.skipped(
          "user_stopped",
          "Script execution was cancelled because the turn was stopped."
        );
      }
      return this.skipped("script_execution_failed", "Script execution failed.");
    }
  }

  private blocked(
    reason: string,
    warning: string,
    scriptKey: string | null = null,
    versionNumber: number | null = null,
    jobId: string | null = null
  ): RuntimeScriptToolExecutionResult {
    return this.buildFailure("blocked", reason, warning, scriptKey, versionNumber, jobId);
  }

  private skipped(
    reason: string,
    warning: string,
    scriptKey: string | null = null,
    versionNumber: number | null = null,
    jobId: string | null = null
  ): RuntimeScriptToolExecutionResult {
    return this.buildFailure("skipped", reason, warning, scriptKey, versionNumber, jobId);
  }

  private buildFailure(
    action: "blocked" | "skipped",
    reason: string,
    warning: string,
    scriptKey: string | null,
    versionNumber: number | null,
    jobId: string | null
  ): RuntimeScriptToolExecutionResult {
    const safeReason = reason.slice(0, 128);
    const safeWarning = warning.slice(0, AJV_ERROR_MESSAGE_MAX_CHARS);
    return {
      payload: {
        toolCode: "script.execute",
        executionMode: "sandbox",
        action,
        reason: safeReason,
        warning: safeWarning,
        scriptKey,
        versionNumber,
        jobId,
        output: null
      },
      isError: true
    };
  }

  /**
   * ADR-151 — the model must supply exactly `{action, input}`.
   */
  private parseToolCallArguments(
    toolCall: ProviderGatewayToolCall
  ): Record<string, unknown> | null {
    const argumentKeys = Object.keys(toolCall.arguments);
    if (
      argumentKeys.length !== 2 ||
      !Object.prototype.hasOwnProperty.call(toolCall.arguments, "action") ||
      !Object.prototype.hasOwnProperty.call(toolCall.arguments, "input")
    ) {
      return null;
    }
    if (toolCall.arguments.action !== "execute") {
      return null;
    }
    const input = toolCall.arguments.input;
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return null;
    }
    return input as Record<string, unknown>;
  }

  /**
   * ADR-151 — maps exactly the three authored sources. `tool_input` fields
   * the model omitted are left absent (not defaulted to `null`) so a
   * missing required field surfaces as a normal Ajv `required` failure
   * rather than a silently coerced value.
   */
  private buildMappedInput(
    inputMapping: Record<string, RuntimeScriptInputSource>,
    modelInput: Record<string, unknown>,
    currentUserMessageText: string | null
  ): Record<string, unknown> {
    const mapped = Object.create(null) as Record<string, unknown>;
    for (const [fieldName, source] of Object.entries(inputMapping)) {
      if (source.source === "literal") {
        mapped[fieldName] = source.value;
      } else if (source.source === "current_user_message") {
        mapped[fieldName] = currentUserMessageText ?? "";
      } else if (Object.prototype.hasOwnProperty.call(modelInput, source.name)) {
        mapped[fieldName] = modelInput[source.name];
      }
    }
    return mapped;
  }

  private validateAgainstSchema(
    schema: Record<string, unknown>,
    value: unknown
  ): { ok: true } | { ok: false; message: string } {
    let validate: ReturnType<typeof ajv.compile>;
    try {
      validate = ajv.compile(schema);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Invalid JSON Schema."
      };
    }
    if (validate(value)) {
      return { ok: true };
    }
    const message = (validate.errors ?? [])
      .slice(0, AJV_ERROR_MESSAGE_MAX_COUNT)
      .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
      .join("; ");
    return {
      ok: false,
      message:
        message.length > AJV_ERROR_MESSAGE_MAX_CHARS
          ? `${message.slice(0, AJV_ERROR_MESSAGE_MAX_CHARS)}…`
          : message
    };
  }

  private parseJobContent(content: string | null): unknown {
    if (content === null) {
      return undefined;
    }
    try {
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }

  /**
   * ADR-151 — server-derived, never model-supplied. Bound to the exact
   * accepted turn/runtime request identity, the provider's own tool-call id
   * (unique per call within that request), and the pinned `ScriptVersion`,
   * so a same-request retry of the exact same tool call reproduces the exact
   * same key while a different tool call (even for the same Script in the
   * same turn) gets a distinct one.
   */
  private deriveScriptInvocationKey(input: {
    requestId: string;
    toolCallId: string;
    scriptVersionId: string;
  }): string {
    return createHash("sha256")
      .update(`${input.requestId}:${input.toolCallId}:${input.scriptVersionId}`)
      .digest("hex")
      .slice(0, 48);
  }
}
