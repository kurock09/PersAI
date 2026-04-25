import { BadGatewayException, BadRequestException, Injectable } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  PersaiRuntimeModelRole,
  ProviderGatewayTextGenerateRequest,
  RuntimeBackgroundTaskEvaluationRequest,
  RuntimeBackgroundTaskEvaluationResult
} from "@persai/runtime-contract";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";

type NativeManagedProvider = "openai" | "anthropic";
type ProviderSelection = { provider: NativeManagedProvider; model: string };

const EVALUATION_MAX_OUTPUT_TOKENS = 700;

@Injectable()
export class RuntimeBackgroundTaskEvaluationService {
  constructor(private readonly providerGatewayClientService: ProviderGatewayClientService) {}

  async evaluate(
    input: RuntimeBackgroundTaskEvaluationRequest
  ): Promise<RuntimeBackgroundTaskEvaluationResult> {
    const bundle = this.parseBundle(input.runtimeBundleDocument);
    if (bundle.metadata.assistantId !== input.assistantId) {
      throw new BadRequestException("runtimeBundleDocument assistantId does not match request.");
    }
    if (bundle.metadata.workspaceId !== input.workspaceId) {
      throw new BadRequestException("runtimeBundleDocument workspaceId does not match request.");
    }

    const providerSelection = this.resolveProviderSelection(bundle, "system_tool");
    const request = this.buildProviderRequest(input, bundle, providerSelection);
    const result = await this.providerGatewayClientService.generateText(request);
    const parsed = this.parseEvaluationJson(result.text);
    return {
      ...parsed,
      usage: result.usage,
      rawText: result.text
    };
  }

  private buildProviderRequest(
    input: RuntimeBackgroundTaskEvaluationRequest,
    bundle: AssistantRuntimeBundle,
    providerSelection: ProviderSelection
  ): ProviderGatewayTextGenerateRequest {
    const systemPrompt = [
      bundle.promptConstructor.ordinary.systemPrompt,
      "",
      "You are the PersAI background-task evaluator. You run outside a user chat turn.",
      "Return only the requested structured JSON. Do not call tools, do not create reminders, and do not write conversational prose.",
      "Decision rules:",
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
      developerInstructions: bundle.promptConstructor.ordinary.sections.heartbeat,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
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
            }
          ]
        }
      ],
      maxOutputTokens: EVALUATION_MAX_OUTPUT_TOKENS,
      outputSchema: {
        name: "background_task_evaluation",
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
        runtimeRequestId: `background-task:${input.task.id}:${input.task.scheduledRunAt}`,
        toolLoopIteration: null,
        compactionToolCode: null,
        classification: "background_task_evaluation"
      }
    };
  }

  private parseEvaluationJson(
    text: string | null
  ): Omit<RuntimeBackgroundTaskEvaluationResult, "usage" | "rawText"> {
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

  private asNativeManagedProvider(value: unknown): NativeManagedProvider | null {
    return value === "openai" || value === "anthropic" ? value : null;
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }
}
