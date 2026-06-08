import { createHash } from "node:crypto";
import { BadGatewayException, BadRequestException, Injectable } from "@nestjs/common";
import {
  hashAssistantRuntimeBundleDocument,
  type AssistantRuntimeBundle
} from "@persai/runtime-bundle";
import type {
  PersaiRuntimeModelRole,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  RuntimeBackgroundTaskEvaluationRequest,
  RuntimeBackgroundTaskEvaluationResult,
  RuntimeTurnRequest,
  RuntimeTurnResult
} from "@persai/runtime-contract";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import { RuntimeExecutionAdmissionService } from "./runtime-execution-admission.service";
import {
  isRetryableRuntimeTextFailure,
  resolveRuntimeTextFallbackSelection,
  sameProviderSelection,
  type ProviderSelection
} from "./runtime-text-fallback";
import { TurnExecutionService } from "./turn-execution.service";

const EVALUATION_MAX_OUTPUT_TOKENS = 700;
const BACKGROUND_TASK_RUN_KEY_PREFIX = "background-task-tool-run";

@Injectable()
export class RuntimeBackgroundTaskEvaluationService {
  constructor(
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly turnExecutionService: TurnExecutionService,
    private readonly runtimeExecutionAdmissionService: RuntimeExecutionAdmissionService
  ) {}

  async evaluate(
    input: RuntimeBackgroundTaskEvaluationRequest
  ): Promise<RuntimeBackgroundTaskEvaluationResult> {
    return this.runtimeExecutionAdmissionService.runWithAdmission("background", async () => {
      const bundle = this.parseBundle(input.runtimeBundleDocument);
      if (bundle.metadata.assistantId !== input.assistantId) {
        throw new BadRequestException("runtimeBundleDocument assistantId does not match request.");
      }
      if (bundle.metadata.workspaceId !== input.workspaceId) {
        throw new BadRequestException("runtimeBundleDocument workspaceId does not match request.");
      }

      const toolRun = await this.turnExecutionService.createBackgroundTaskToolRun(
        this.buildToolRunRequest(input, bundle)
      );
      const providerSelection = this.resolveProviderSelection(bundle, "system_tool");
      const request = this.buildProviderRequest(input, bundle, providerSelection, toolRun);
      const result = await this.generateEvaluationTextWithFallback(bundle, request);
      const parsed = this.parseEvaluationJson(result.text);
      return {
        ...parsed,
        toolRunText: toolRun.assistantText.trim() || null,
        artifacts: toolRun.artifacts,
        usage: result.usage,
        rawText: result.text
      };
    });
  }

  private buildToolRunRequest(
    input: RuntimeBackgroundTaskEvaluationRequest,
    bundle: AssistantRuntimeBundle
  ): RuntimeTurnRequest {
    const bundleHash = hashAssistantRuntimeBundleDocument(input.runtimeBundleDocument);
    const toolRunKey = this.buildBackgroundTaskRunKey(input);
    const prompt = [
      "You are running a PersAI background task outside the visible user chat.",
      "Use the available tools when needed to gather facts, search knowledge/chat/memory, browse the web, run generation tools, or create artifacts requested by the task.",
      "Do not create or modify scheduled reminders or background tasks from this synthetic run.",
      "Do not send a final push yourself. After this run, a separate evaluator will decide push/no_push/complete.",
      "Return a concise evidence report for that evaluator. Include exact values, sources, timestamps, and mention every generated artifact.",
      "",
      JSON.stringify(
        {
          currentTimeIso: new Date().toISOString(),
          task: input.task,
          assistant: {
            name: bundle.persona.displayName,
            userLocale: bundle.userContext.locale,
            userTimezone: bundle.userContext.timezone
          }
        },
        null,
        2
      )
    ].join("\n");

    return {
      requestId: toolRunKey,
      idempotencyKey: toolRunKey,
      runtimeTier: input.runtimeTier,
      bundle: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        bundleId: `background-task:${input.task.id}:${bundle.metadata.publishedVersionId}`,
        publishedVersionId: bundle.metadata.publishedVersionId,
        bundleHash,
        compiledAt: new Date().toISOString()
      },
      conversation: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        channel: "web",
        externalThreadKey: this.buildExternalThreadKey(input.task),
        externalUserKey: null,
        mode: "direct"
      },
      message: {
        text: prompt,
        attachments: [],
        locale: bundle.userContext.locale,
        timezone: bundle.userContext.timezone,
        receivedAt: new Date().toISOString()
      },
      modelRoleOverride: "system_tool"
    };
  }

  private buildProviderRequest(
    input: RuntimeBackgroundTaskEvaluationRequest,
    bundle: AssistantRuntimeBundle,
    providerSelection: ProviderSelection,
    toolRun: RuntimeTurnResult
  ): ProviderGatewayTextGenerateRequest {
    const configuredEvaluatorGuidance = this.resolveBackgroundTaskEvaluationPrompt(bundle);
    const classification = this.resolveEvaluationClassification(input);
    const systemPrompt = [
      "You are the PersAI background-task evaluator. You run outside a user chat turn.",
      "Return only the requested structured JSON. Do not call tools, do not create reminders, and do not write conversational prose.",
      "You already received the complete output of a separate tool-enabled background run. Base your decision on that evidence.",
      configuredEvaluatorGuidance === null
        ? null
        : `Configured evaluator guidance:\n${configuredEvaluatorGuidance}`,
      "Decision rules:",
      "The platform calls you only after task.scheduledRunAt is due. Never return no_push because scheduledRunAt has not been reached.",
      '- decision="push" only when the brief condition is met and the user should receive pushText now.',
      '- decision="no_push" when the condition is not met and the task should continue according to its schedule.',
      '- decision="complete" when the task is finished without a push or should be closed now.',
      "pushText must be the final user-facing message and must be null unless decision is push."
    ]
      .filter((part) => typeof part === "string" && part.trim().length > 0)
      .join("\n");

    return {
      provider: providerSelection.provider,
      model: providerSelection.model,
      systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  currentTimeIso: new Date().toISOString(),
                  task: input.task,
                  toolRun: {
                    assistantText: toolRun.assistantText,
                    artifacts: toolRun.artifacts,
                    toolInvocations: toolRun.toolInvocations ?? []
                  },
                  assistant: {
                    name: bundle.persona.displayName,
                    userLocale: bundle.userContext.locale,
                    userTimezone: bundle.userContext.timezone
                  }
                },
                null,
                2
              )
            }
          ]
        }
      ],
      maxOutputTokens: EVALUATION_MAX_OUTPUT_TOKENS,
      outputSchema: {
        name: classification,
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["decision", "pushText", "rationale", "confidence"],
          properties: {
            decision: { type: "string", enum: ["push", "no_push", "complete"] },
            pushText: { type: ["string", "null"] },
            rationale: { type: ["string", "null"] },
            confidence: { type: "string", enum: ["low", "medium", "high"] }
          }
        }
      },
      requestMetadata: {
        runtimeSessionId: null,
        runtimeRequestId: this.buildBackgroundTaskRunKey(input),
        toolLoopIteration: null,
        compactionToolCode: null,
        classification
      }
    };
  }

  private parseEvaluationJson(
    text: string | null
  ): Omit<
    RuntimeBackgroundTaskEvaluationResult,
    "toolRunText" | "artifacts" | "usage" | "rawText"
  > {
    if (text === null || text.trim().length === 0) {
      throw new BadGatewayException("Background-task evaluator returned empty output.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        throw new BadGatewayException("Background-task evaluator returned non-JSON output.");
      }
      parsed = JSON.parse(match[0]);
    }
    const row = this.asObject(parsed);
    const decision = row?.decision;
    const confidence = row?.confidence;
    const pushText = typeof row?.pushText === "string" ? row.pushText.trim() : null;
    if (decision !== "push" && decision !== "no_push" && decision !== "complete") {
      throw new BadGatewayException("Background-task evaluator returned invalid decision.");
    }
    if (confidence !== "low" && confidence !== "medium" && confidence !== "high") {
      throw new BadGatewayException("Background-task evaluator returned invalid confidence.");
    }
    if (decision === "push" && (!pushText || pushText.length === 0)) {
      throw new BadGatewayException("Background-task evaluator chose push without pushText.");
    }
    return {
      decision,
      pushText: decision === "push" ? pushText : null,
      rationale: typeof row?.rationale === "string" ? row.rationale.trim() || null : null,
      confidence
    };
  }

  private parseBundle(document: string): AssistantRuntimeBundle {
    let parsed: unknown;
    try {
      parsed = JSON.parse(document);
    } catch {
      throw new BadRequestException("runtimeBundleDocument must be valid JSON.");
    }
    const row = this.asObject(parsed);
    if (
      row === null ||
      this.asObject(row.metadata) === null ||
      this.asObject(row.runtime) === null ||
      this.asObject(row.promptConstructor) === null
    ) {
      throw new BadRequestException("runtimeBundleDocument has an invalid runtime bundle shape.");
    }
    return parsed as AssistantRuntimeBundle;
  }

  private resolveProviderSelection(
    bundle: AssistantRuntimeBundle,
    modelRole: PersaiRuntimeModelRole
  ): ProviderSelection {
    const direct = this.resolveModelSlotSelection(bundle, modelRole);
    if (direct !== null) {
      return direct;
    }
    const normal = this.resolveModelSlotSelection(bundle, "normal_reply");
    if (normal !== null) {
      return normal;
    }
    const primaryPath = this.asObject(
      this.asObject(bundle.runtime.runtimeProviderRouting)?.primaryPath
    );
    if (primaryPath?.active === false) {
      throw new BadRequestException("Runtime provider path is inactive.");
    }
    const primaryProvider = this.asNativeManagedProvider(primaryPath?.providerKey);
    const primaryModel = this.asNonEmptyString(primaryPath?.modelKey);
    if (primaryProvider !== null && primaryModel !== null) {
      return { provider: primaryProvider, model: primaryModel };
    }
    const profilePrimary = this.asObject(
      this.asObject(bundle.runtime.runtimeProviderProfile)?.primary
    );
    const profileProvider = this.asNativeManagedProvider(profilePrimary?.provider);
    const profileModel = this.asNonEmptyString(profilePrimary?.model);
    if (profileProvider !== null && profileModel !== null) {
      return { provider: profileProvider, model: profileModel };
    }
    throw new BadRequestException(
      "Runtime bundle does not declare a provider/model for evaluation."
    );
  }

  private resolveEvaluationClassification(
    input: RuntimeBackgroundTaskEvaluationRequest
  ): "background_task_evaluation" | "quota_advisory_evaluation" {
    return input.evaluationKind === "quota_advisory"
      ? "quota_advisory_evaluation"
      : "background_task_evaluation";
  }

  private normalizeOptionalText(value: string | null | undefined): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private resolveBackgroundTaskEvaluationPrompt(bundle: AssistantRuntimeBundle): string | null {
    const documents = this.asObject((bundle as unknown as Record<string, unknown>).promptDocuments);
    const promptDocument = this.normalizeOptionalText(
      documents?.["backgroundTaskEvaluation"] as string | null | undefined
    );
    if (promptDocument !== null) {
      return promptDocument;
    }
    const legacyPromptDocument = this.normalizeOptionalText(
      documents?.["heartbeat"] as string | null | undefined
    );
    if (legacyPromptDocument !== null) {
      return legacyPromptDocument;
    }
    const promptConstructor = this.asObject(
      (bundle as unknown as Record<string, unknown>).promptConstructor
    );
    const ordinary = this.asObject(promptConstructor?.["ordinary"]);
    const sections = this.asObject(ordinary?.["sections"]);
    return (
      this.normalizeOptionalText(
        sections?.["backgroundTaskEvaluation"] as string | null | undefined
      ) ?? this.normalizeOptionalText(sections?.["heartbeat"] as string | null | undefined)
    );
  }

  private async generateEvaluationTextWithFallback(
    bundle: AssistantRuntimeBundle,
    request: ProviderGatewayTextGenerateRequest
  ): Promise<ProviderGatewayTextGenerateResult> {
    try {
      return await this.providerGatewayClientService.generateText(request);
    } catch (error) {
      const fallbackSelection = resolveRuntimeTextFallbackSelection(bundle);
      if (
        !isRetryableRuntimeTextFailure(error) ||
        fallbackSelection === null ||
        sameProviderSelection(
          { provider: request.provider, model: request.model },
          fallbackSelection
        )
      ) {
        throw error;
      }
      return this.providerGatewayClientService.generateText({
        ...request,
        provider: fallbackSelection.provider,
        model: fallbackSelection.model
      });
    }
  }

  private resolveModelSlotSelection(
    bundle: AssistantRuntimeBundle,
    modelRole: PersaiRuntimeModelRole
  ): ProviderSelection | null {
    const routing = this.asObject(bundle.runtime.runtimeProviderRouting);
    const modelSlots = this.asObject(routing?.modelSlots);
    const slotKey =
      modelRole === "premium_reply"
        ? "premiumReply"
        : modelRole === "reasoning"
          ? "reasoning"
          : modelRole === "system_tool"
            ? "systemTool"
            : modelRole === "retrieval"
              ? "retrieval"
              : "normalReply";
    const slot = this.asObject(modelSlots?.[slotKey]);
    const provider = this.asNativeManagedProvider(slot?.providerKey);
    const model = this.asNonEmptyString(slot?.modelKey);
    return provider !== null && model !== null ? { provider, model } : null;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private asNativeManagedProvider(value: unknown): ProviderSelection["provider"] | null {
    return value === "openai" || value === "anthropic" ? value : null;
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  // ADR-090: Per-evaluation unique synthetic-runtime-session key. When the
  // scheduler provides a non-empty evaluationAttemptId, the synthetic session
  // gets its own externalThreadKey so parallel evaluations can never clash on
  // the same runtime session lease. Empty / whitespace-only strings are not
  // accepted (defensive: caller bug or buggy/malicious input must not silently
  // collapse to the legacy stable key).
  private buildExternalThreadKey(task: RuntimeBackgroundTaskEvaluationRequest["task"]): string {
    const attemptId =
      typeof task.evaluationAttemptId === "string" ? task.evaluationAttemptId.trim() : "";
    if (attemptId.length > 0) {
      return `system:background-task:${task.id}:${attemptId}`;
    }
    return `system:background-task:${task.id}`;
  }

  private buildBackgroundTaskRunKey(input: RuntimeBackgroundTaskEvaluationRequest): string {
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          taskId: input.task.id,
          scheduledRunAt: input.task.scheduledRunAt
        })
      )
      .digest("hex")
      .slice(0, 40);
    return `${BACKGROUND_TASK_RUN_KEY_PREFIX}:${digest}`;
  }
}
