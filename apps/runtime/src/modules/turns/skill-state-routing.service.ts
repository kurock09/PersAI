import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayTextGenerateRequest,
  RuntimeSkillDecisionState,
  RuntimeTurnRequest,
  RuntimeUsageSnapshot
} from "@persai/runtime-contract";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";

type NativeManagedProvider = "openai" | "anthropic";

type ProviderSelection = {
  provider: NativeManagedProvider;
  model: string;
};

type EnabledSkillSummary = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  tags: string[];
  routingExamples: string[];
};

type SkillStateClassifierOutput = {
  decision: "activate" | "deactivate" | "no_change";
  skillId: string | null;
  topicSummary: string | null;
  confidence: "low" | "medium" | "high";
  reasonCode: string;
};

const SKILL_STATE_OUTPUT_SCHEMA = {
  name: "skill_state_decision",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["decision", "skillId", "topicSummary", "confidence", "reasonCode"],
    properties: {
      decision: {
        type: "string",
        enum: ["activate", "deactivate", "no_change"]
      },
      skillId: {
        type: ["string", "null"]
      },
      topicSummary: {
        type: ["string", "null"]
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"]
      },
      reasonCode: {
        type: "string"
      }
    }
  }
} as const;

const SKILL_STATE_MAX_OUTPUT_TOKENS = 1200;
const SKILL_STATE_MAX_RECENT_MESSAGES = 6;
const SKILL_STATE_MAX_MESSAGE_CHARS = 160;
const SKILL_STATE_MAX_SKILLS_IN_PROMPT = 5;
const SKILL_STATE_MAX_ATTEMPTS = 2;
const SKILL_STATE_MAX_TOPIC_SUMMARY_CHARS = 160;

@Injectable()
export class SkillStateRoutingService {
  private readonly logger = new Logger(SkillStateRoutingService.name);

  constructor(private readonly providerGatewayClientService: ProviderGatewayClientService) {}

  async checkSkillState(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeTurnRequest;
  }): Promise<{
    skillState: RuntimeSkillDecisionState | null;
    usage: RuntimeUsageSnapshot | null;
  }> {
    return this.evaluate({
      bundle: input.bundle,
      request: input.request,
      mode: "full_check"
    });
  }

  async tryForegroundActivation(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeTurnRequest;
  }): Promise<{
    skillState: RuntimeSkillDecisionState | null;
    usage: RuntimeUsageSnapshot | null;
  }> {
    return this.evaluate({
      bundle: input.bundle,
      request: input.request,
      mode: "foreground_activation"
    });
  }

  shouldTryForegroundActivation(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeTurnRequest;
  }): boolean {
    const currentState = input.request.skillStateContext?.decision ?? null;
    if (currentState?.status === "active") {
      return false;
    }
    const userText = input.request.message.text.trim().toLowerCase();
    if (userText.length === 0) {
      return false;
    }
    const enabledSkills = this.resolveEnabledSkillSummaries(input.bundle);
    if (enabledSkills.length === 0) {
      return false;
    }
    return enabledSkills.some((skill) => this.matchesSkillLexically(skill, userText));
  }

  private async evaluate(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeTurnRequest;
    mode: "full_check" | "foreground_activation";
  }): Promise<{
    skillState: RuntimeSkillDecisionState | null;
    usage: RuntimeUsageSnapshot | null;
  }> {
    const enabledSkills = this.resolveEnabledSkillSummaries(input.bundle);
    if (enabledSkills.length === 0) {
      return { skillState: null, usage: null };
    }
    const classifierSelection = this.resolveClassifierProviderSelection(input.bundle);
    const classifierPrompt = this.asNonEmptyString(
      input.bundle.promptDocuments.skillStateClassifier
    );
    const routingFastModelKey = this.asNonEmptyString(input.bundle.runtime.routingFastModelKey);
    if (
      classifierSelection === null ||
      classifierPrompt === null ||
      routingFastModelKey === null ||
      !this.providerGatewayClientService.isConfigured()
    ) {
      return { skillState: null, usage: null };
    }

    let usage: RuntimeUsageSnapshot | null = null;
    let lastInvalidOutput: string | null = null;
    for (let attempt = 1; attempt <= SKILL_STATE_MAX_ATTEMPTS; attempt += 1) {
      const result = await this.providerGatewayClientService.generateText(
        this.buildProviderRequest({
          bundle: input.bundle,
          request: input.request,
          prompt: classifierPrompt,
          provider: classifierSelection.provider,
          model: routingFastModelKey,
          retryInvalidJson: attempt > 1,
          mode: input.mode
        })
      );
      usage = result.usage ?? usage;
      const parsed = this.parseClassifierOutput(result.text);
      if (parsed !== null) {
        return {
          skillState: this.applyClassifierDecision({
            output: parsed,
            currentState: input.request.skillStateContext?.decision ?? null,
            enabledSkills,
            currentUserMessageIndex: input.request.skillStateContext?.currentUserMessageIndex ?? 0,
            mode: input.mode
          }),
          usage
        };
      }
      lastInvalidOutput = result.text;
      this.logger.warn(
        `[skill-state-classifier] Invalid output assistant=${input.bundle.metadata.assistantId} ` +
          `attempt=${String(attempt)}/${String(SKILL_STATE_MAX_ATTEMPTS)} chars=${String(result.text?.length ?? 0)}`
      );
    }

    if (lastInvalidOutput !== null) {
      this.logger.warn(
        `[skill-state-classifier] Final invalid output assistant=${input.bundle.metadata.assistantId} raw=${JSON.stringify(lastInvalidOutput)}`
      );
    }
    if (input.mode === "foreground_activation") {
      return { skillState: null, usage };
    }
    throw new ServiceUnavailableException("Skill-state classifier returned invalid JSON.");
  }

  private buildProviderRequest(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeTurnRequest;
    prompt: string;
    provider: NativeManagedProvider;
    model: string;
    retryInvalidJson: boolean;
    mode: "full_check" | "foreground_activation";
  }): ProviderGatewayTextGenerateRequest {
    const retryInstruction =
      input.retryInvalidJson === true
        ? "Previous output was rejected because it was not valid JSON for the required schema. Return only the JSON object with no leading or trailing text."
        : null;
    return {
      provider: input.provider,
      model: input.model,
      systemPrompt: input.prompt,
      maxOutputTokens: SKILL_STATE_MAX_OUTPUT_TOKENS,
      outputSchema: SKILL_STATE_OUTPUT_SCHEMA,
      requestMetadata: {
        classification: "skill_state_classifier",
        runtimeRequestId: input.request.requestId,
        runtimeSessionId: null,
        toolLoopIteration: null,
        compactionToolCode: null
      },
      messages: [
        {
          role: "user",
          content: this.buildClassifierContextBlock({
            bundle: input.bundle,
            request: input.request,
            mode: input.mode,
            retryInstruction
          })
        }
      ]
    };
  }

  private buildClassifierContextBlock(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeTurnRequest;
    mode: "full_check" | "foreground_activation";
    retryInstruction: string | null;
  }): string {
    const enabledSkills = this.resolveEnabledSkillSummaries(input.bundle);
    const currentState = input.request.skillStateContext?.decision ?? null;
    const recentMessages = (input.request.skillStateContext?.recentMessages ?? [])
      .slice(-SKILL_STATE_MAX_RECENT_MESSAGES)
      .map((message) => {
        const trimmed = message.text.trim();
        const normalized =
          trimmed.length > SKILL_STATE_MAX_MESSAGE_CHARS
            ? `${trimmed.slice(0, SKILL_STATE_MAX_MESSAGE_CHARS)}...`
            : trimmed;
        return `- ${message.role}: ${normalized}`;
      });
    const skillLines = enabledSkills.slice(0, SKILL_STATE_MAX_SKILLS_IN_PROMPT).map((skill) => {
      const hints = [
        skill.description?.trim() ?? "",
        skill.category,
        skill.tags.join(", "),
        skill.routingExamples.join(" | ")
      ]
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .join(" | ");
      return `- ${skill.id} :: ${skill.name}${hints.length > 0 ? ` :: ${hints}` : ""}`;
    });
    const currentStateLine =
      currentState === null
        ? "none"
        : currentState.status === "active"
          ? `active:${currentState.activeSkillId ?? "none"}:${currentState.activeSkillName ?? "unknown"}`
          : "inactive";
    const checkReason = input.request.skillStateContext?.checkReason ?? null;
    return [
      `Mode: ${input.mode}`,
      `Check reason: ${checkReason ?? "unspecified"}`,
      `Current user message index: ${String(input.request.skillStateContext?.currentUserMessageIndex ?? 0)}`,
      `Current Skill state: ${currentStateLine}`,
      "Enabled Skills summary:",
      skillLines.length === 0 ? "- none" : skillLines.join("\n"),
      "Recent chat window:",
      recentMessages.length === 0 ? "- none" : recentMessages.join("\n"),
      input.retryInstruction
    ]
      .filter((line): line is string => line !== null)
      .join("\n\n");
  }

  private applyClassifierDecision(input: {
    output: SkillStateClassifierOutput;
    currentState: RuntimeSkillDecisionState | null;
    enabledSkills: EnabledSkillSummary[];
    currentUserMessageIndex: number;
    mode: "full_check" | "foreground_activation";
  }): RuntimeSkillDecisionState | null {
    const nextIndex = Math.max(0, input.currentUserMessageIndex);
    const selectedSkill =
      input.output.skillId === null
        ? null
        : (input.enabledSkills.find((skill) => skill.id === input.output.skillId) ?? null);
    if (input.mode === "foreground_activation") {
      if (input.output.decision !== "activate" || selectedSkill === null) {
        return null;
      }
      return {
        status: "active",
        activeSkillId: selectedSkill.id,
        activeSkillName: selectedSkill.name,
        topicSummary: this.normalizeTopicSummary(input.output.topicSummary),
        confidence: input.output.confidence,
        checkedAtMessageIndex: nextIndex
      };
    }
    if (input.output.decision === "activate" && selectedSkill !== null) {
      return {
        status: "active",
        activeSkillId: selectedSkill.id,
        activeSkillName: selectedSkill.name,
        topicSummary: this.normalizeTopicSummary(input.output.topicSummary),
        confidence: input.output.confidence,
        checkedAtMessageIndex: nextIndex
      };
    }
    if (input.output.decision === "no_change" && input.currentState?.status === "active") {
      return {
        ...input.currentState,
        checkedAtMessageIndex: nextIndex
      };
    }
    return {
      status: "inactive",
      activeSkillId: null,
      activeSkillName: null,
      topicSummary: this.normalizeTopicSummary(input.output.topicSummary),
      confidence: input.output.confidence,
      checkedAtMessageIndex: nextIndex
    };
  }

  private parseClassifierOutput(value: string | null): SkillStateClassifierOutput | null {
    if (value === null) {
      return null;
    }
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (
        (parsed.decision !== "activate" &&
          parsed.decision !== "deactivate" &&
          parsed.decision !== "no_change") ||
        (parsed.skillId !== null && typeof parsed.skillId !== "string") ||
        (parsed.topicSummary !== null && typeof parsed.topicSummary !== "string") ||
        (parsed.confidence !== "low" &&
          parsed.confidence !== "medium" &&
          parsed.confidence !== "high") ||
        typeof parsed.reasonCode !== "string"
      ) {
        return null;
      }
      return {
        decision: parsed.decision,
        skillId: parsed.skillId,
        topicSummary: parsed.topicSummary,
        confidence: parsed.confidence,
        reasonCode: parsed.reasonCode
      };
    } catch {
      return null;
    }
  }

  private resolveEnabledSkillSummaries(bundle: AssistantRuntimeBundle): EnabledSkillSummary[] {
    return (bundle.skills?.enabled ?? []).map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      tags: skill.tags ?? [],
      routingExamples: skill.routingExamples ?? []
    }));
  }

  private resolveClassifierProviderSelection(
    bundle: AssistantRuntimeBundle
  ): ProviderSelection | null {
    const routing =
      bundle.runtime.runtimeProviderRouting !== null &&
      typeof bundle.runtime.runtimeProviderRouting === "object" &&
      !Array.isArray(bundle.runtime.runtimeProviderRouting)
        ? (bundle.runtime.runtimeProviderRouting as Record<string, unknown>)
        : null;
    const primaryPath =
      routing?.primaryPath !== null &&
      typeof routing?.primaryPath === "object" &&
      !Array.isArray(routing?.primaryPath)
        ? (routing.primaryPath as Record<string, unknown>)
        : null;
    const provider = this.asProvider(primaryPath?.providerKey);
    if (provider !== null) {
      return {
        provider,
        model: this.asNonEmptyString(primaryPath?.modelKey) ?? ""
      };
    }
    const profile =
      bundle.runtime.runtimeProviderProfile !== null &&
      typeof bundle.runtime.runtimeProviderProfile === "object" &&
      !Array.isArray(bundle.runtime.runtimeProviderProfile)
        ? (bundle.runtime.runtimeProviderProfile as Record<string, unknown>)
        : null;
    const primary =
      profile?.primary !== null &&
      typeof profile?.primary === "object" &&
      !Array.isArray(profile?.primary)
        ? (profile.primary as Record<string, unknown>)
        : null;
    const profileProvider = this.asProvider(primary?.provider);
    return profileProvider === null ? null : { provider: profileProvider, model: "" };
  }

  private matchesSkillLexically(skill: EnabledSkillSummary, lowerText: string): boolean {
    const parts = [
      skill.name,
      skill.description ?? "",
      skill.category,
      ...skill.tags,
      ...skill.routingExamples
    ]
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length >= 4);
    return parts.some((value) => lowerText.includes(value));
  }

  private normalizeTopicSummary(value: string | null): string | null {
    if (value === null) {
      return null;
    }
    const normalized = value.trim();
    if (normalized.length === 0) {
      return null;
    }
    return normalized.length > SKILL_STATE_MAX_TOPIC_SUMMARY_CHARS
      ? normalized.slice(0, SKILL_STATE_MAX_TOPIC_SUMMARY_CHARS)
      : normalized;
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private asProvider(value: unknown): NativeManagedProvider | null {
    return value === "openai" || value === "anthropic" ? value : null;
  }
}
