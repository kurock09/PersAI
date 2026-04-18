import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayTextGenerateRequest,
  RuntimeTurnRequest,
  RuntimeUsageSnapshot
} from "@persai/runtime-contract";
import type { RuntimeNativeToolProjection } from "./native-tool-projection";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";

type NativeManagedProvider = "openai" | "anthropic";

type ProviderSelection = {
  provider: NativeManagedProvider;
  model: string;
};

type RoutingMode = "shadow" | "active";
type RoutingExecutionMode = "normal" | "premium" | "reasoning";
type RoutingToolHint = "knowledge" | "web" | "browser" | "media" | "none";

type RouterPolicy = {
  enabled: boolean;
  mode: RoutingMode;
  classifierFailureFallbackMode: RoutingExecutionMode;
  clarifyOnMissingContext: boolean;
  precheckRuleOverrides: {
    continueTerms: string[];
    retrievalTerms: string[];
    reasoningTerms: string[];
    toolTerms: string[];
  } | null;
};

export type TurnRouteDecision = {
  executionMode: RoutingExecutionMode;
  retrievalHint: boolean;
  toolHints: RoutingToolHint;
  confidence: "high" | "low";
  clarifyNeeded: boolean;
  fallbackMode: RoutingExecutionMode;
  reasonCode: string;
  source: "default" | "precheck" | "classifier" | "fallback";
  mode: RoutingMode;
  usage: RuntimeUsageSnapshot | null;
};

const ROUTER_OUTPUT_SCHEMA = {
  name: "turn_route_decision",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "executionMode",
      "retrievalHint",
      "toolHints",
      "confidence",
      "clarifyNeeded",
      "fallbackMode",
      "reasonCode"
    ],
    properties: {
      executionMode: {
        type: "string",
        enum: ["normal", "premium", "reasoning"]
      },
      retrievalHint: {
        type: "boolean"
      },
      toolHints: {
        type: "string",
        enum: ["knowledge", "web", "browser", "media", "none"]
      },
      confidence: {
        type: "string",
        enum: ["high", "low"]
      },
      clarifyNeeded: {
        type: "boolean"
      },
      fallbackMode: {
        type: "string",
        enum: ["normal", "premium", "reasoning"]
      },
      reasonCode: {
        type: "string"
      }
    }
  }
} as const;

const ROUTER_MAX_OUTPUT_TOKENS = 180;
const DEFAULT_CONTINUE_TERMS = [
  "ok",
  "okay",
  "yes",
  "yep",
  "sure",
  "continue",
  "go on",
  "go ahead",
  "do it",
  "keep going",
  "done",
  "ага",
  "да",
  "угу",
  "ок",
  "окей",
  "продолжай",
  "продолжим",
  "делай",
  "погнали"
];
const DEFAULT_RETRIEVAL_TERMS = [
  "find in docs",
  "find in knowledge",
  "search docs",
  "search knowledge",
  "look in memory",
  "look in chat history",
  "найди в документах",
  "найди в памяти",
  "поиск по чату",
  "посмотри в знаниях",
  "что у нас было",
  "uploaded file",
  "source document"
];
const DEFAULT_REASONING_TERMS = [
  "architecture",
  "trade-off",
  "debug",
  "bug",
  "error",
  "stack trace",
  "traceback",
  "analyze",
  "plan",
  "refactor",
  "root cause",
  "scientific",
  "experiment",
  "contract",
  "schema",
  "why does",
  "почему",
  "архитектура",
  "дебаг",
  "ошибка",
  "разбери",
  "спланируй",
  "рефакторинг",
  "контракт"
];
const DEFAULT_TOOL_TERMS = [
  "browse",
  "browser",
  "visit site",
  "open website",
  "search the web",
  "latest news",
  "current info",
  "generate image",
  "edit image",
  "video",
  "voice note",
  "tts",
  "браузер",
  "сайт",
  "веб",
  "интернет",
  "актуальная информация",
  "картинка",
  "изображение",
  "видео",
  "голосом"
];
const PREMIUM_WRITING_TERMS = [
  "rewrite",
  "polish",
  "tone",
  "email",
  "message",
  "letter",
  "copy",
  "landing page",
  "sales",
  "pitch",
  "перепиши",
  "улучши",
  "сделай красиво",
  "тон",
  "письмо",
  "сообщение"
];
const WEB_HINT_TERMS = ["latest", "today", "current", "news", "pricing", "recent", "сегодня"];
const BROWSER_HINT_TERMS = ["browser", "browse", "open", "website", "site", "в браузере", "сайт"];
const MEDIA_HINT_TERMS = ["image", "photo", "video", "voice", "audio", "картин", "видео", "аудио"];

@Injectable()
export class TurnRoutingService {
  private readonly logger = new Logger(TurnRoutingService.name);

  constructor(private readonly providerGatewayClientService: ProviderGatewayClientService) {}

  async decide(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeTurnRequest;
    projectedTools: RuntimeNativeToolProjection;
  }): Promise<TurnRouteDecision> {
    const policy = this.readRouterPolicy(input.bundle);
    const fallbackMode = this.coerceExecutionMode(
      policy.classifierFailureFallbackMode,
      input.request.deepMode === true
    );
    const defaultDecision = this.createDecision({
      executionMode: input.request.deepMode === true ? "premium" : "normal",
      retrievalHint: false,
      toolHints: "none",
      confidence: "high",
      clarifyNeeded: false,
      fallbackMode,
      reasonCode: input.request.deepMode === true ? "deep_mode_default" : "default_normal",
      source: "default",
      mode: policy.mode,
      usage: null
    });
    if (!policy.enabled) {
      return defaultDecision;
    }

    const precheck = this.runPrecheck({
      bundle: input.bundle,
      request: input.request,
      projectedTools: input.projectedTools,
      policy,
      fallbackMode
    });
    if (precheck.confidence === "high") {
      return precheck;
    }

    const classifierSelection = this.resolveClassifierProviderSelection(input.bundle);
    const classifierPrompt = this.normalizeOptionalText(
      input.bundle.promptDocuments.routerClassifier
    );
    const routingFastModelKey = this.asNonEmptyString(input.bundle.runtime.routingFastModelKey);
    if (
      classifierSelection === null ||
      routingFastModelKey === null ||
      classifierPrompt === null ||
      !this.providerGatewayClientService.isConfigured()
    ) {
      return precheck;
    }

    try {
      const result = await this.providerGatewayClientService.generateText(
        this.buildClassifierRequest({
          bundle: input.bundle,
          request: input.request,
          projectedTools: input.projectedTools,
          provider: classifierSelection.provider,
          model: routingFastModelKey,
          prompt: classifierPrompt,
          fallbackMode
        })
      );
      const parsed = this.parseClassifierDecision(result.text);
      if (parsed === null) {
        return this.createDecision({
          executionMode: fallbackMode,
          retrievalHint: false,
          toolHints: "none",
          confidence: "low",
          clarifyNeeded: false,
          fallbackMode,
          reasonCode: "classifier_invalid_output",
          source: "fallback",
          mode: policy.mode,
          usage: result.usage
        });
      }
      return this.createDecision({
        ...parsed,
        executionMode: this.coerceExecutionMode(
          parsed.executionMode,
          input.request.deepMode === true
        ),
        fallbackMode: this.coerceExecutionMode(
          parsed.fallbackMode,
          input.request.deepMode === true
        ),
        source: "classifier",
        mode: policy.mode,
        usage: result.usage
      });
    } catch (error) {
      this.logger.warn(
        `Router classifier failed for assistant ${input.bundle.metadata.assistantId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return this.createDecision({
        executionMode: fallbackMode,
        retrievalHint: precheck.retrievalHint,
        toolHints: precheck.toolHints,
        confidence: "low",
        clarifyNeeded: precheck.clarifyNeeded,
        fallbackMode,
        reasonCode: "classifier_failure",
        source: "fallback",
        mode: policy.mode,
        usage: null
      });
    }
  }

  private runPrecheck(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeTurnRequest;
    projectedTools: RuntimeNativeToolProjection;
    policy: RouterPolicy;
    fallbackMode: RoutingExecutionMode;
  }): TurnRouteDecision {
    const normalizedText = this.normalizeMessageText(input.request.message.text);
    const lowerText = normalizedText.toLowerCase();
    const availableHints = this.resolveAvailableToolHints(input.projectedTools);
    const continueTerms = this.mergeTerms(
      DEFAULT_CONTINUE_TERMS,
      input.policy.precheckRuleOverrides?.continueTerms
    );
    const retrievalTerms = this.mergeTerms(
      DEFAULT_RETRIEVAL_TERMS,
      input.policy.precheckRuleOverrides?.retrievalTerms
    );
    const reasoningTerms = this.mergeTerms(
      DEFAULT_REASONING_TERMS,
      input.policy.precheckRuleOverrides?.reasoningTerms
    );
    const toolTerms = this.mergeTerms(
      DEFAULT_TOOL_TERMS,
      input.policy.precheckRuleOverrides?.toolTerms
    );

    if (this.isContinueTurn(lowerText, continueTerms)) {
      return this.createDecision({
        executionMode: input.request.deepMode === true ? "premium" : "normal",
        retrievalHint: false,
        toolHints: "none",
        confidence: "high",
        clarifyNeeded: false,
        fallbackMode: input.fallbackMode,
        reasonCode: "continue_term",
        source: "precheck",
        mode: input.policy.mode,
        usage: null
      });
    }

    if (this.matchesAny(lowerText, retrievalTerms)) {
      return this.createDecision({
        executionMode: input.request.deepMode === true ? "premium" : "normal",
        retrievalHint: true,
        toolHints: availableHints.has("knowledge") ? "knowledge" : "none",
        confidence: "high",
        clarifyNeeded: false,
        fallbackMode: input.fallbackMode,
        reasonCode: "knowledge_retrieval",
        source: "precheck",
        mode: input.policy.mode,
        usage: null
      });
    }

    if (
      this.matchesAny(lowerText, reasoningTerms) ||
      this.looksCodeHeavy(normalizedText) ||
      input.request.message.attachments.some(
        (attachment) =>
          attachment.kind === "file" && attachment.mimeType.toLowerCase() === "application/pdf"
      )
    ) {
      return this.createDecision({
        executionMode: "reasoning",
        retrievalHint: false,
        toolHints: "none",
        confidence: "high",
        clarifyNeeded: false,
        fallbackMode: input.fallbackMode,
        reasonCode: "reasoning_request",
        source: "precheck",
        mode: input.policy.mode,
        usage: null
      });
    }

    if (this.matchesAny(lowerText, PREMIUM_WRITING_TERMS)) {
      return this.createDecision({
        executionMode: input.request.deepMode === true ? "premium" : "premium",
        retrievalHint: false,
        toolHints: "none",
        confidence: "high",
        clarifyNeeded: false,
        fallbackMode: input.fallbackMode,
        reasonCode: "premium_writing",
        source: "precheck",
        mode: input.policy.mode,
        usage: null
      });
    }

    const hintedTool = this.resolveToolHint(lowerText, {
      availableHints,
      toolTerms
    });
    if (hintedTool !== "none") {
      return this.createDecision({
        executionMode: input.request.deepMode === true ? "premium" : "normal",
        retrievalHint: hintedTool === "knowledge",
        toolHints: hintedTool,
        confidence: "high",
        clarifyNeeded: false,
        fallbackMode: input.fallbackMode,
        reasonCode: `tool_hint_${hintedTool}`,
        source: "precheck",
        mode: input.policy.mode,
        usage: null
      });
    }

    if (normalizedText.length <= 140 && !normalizedText.includes("\n")) {
      return this.createDecision({
        executionMode: input.request.deepMode === true ? "premium" : "normal",
        retrievalHint: false,
        toolHints: "none",
        confidence: "high",
        clarifyNeeded: false,
        fallbackMode: input.fallbackMode,
        reasonCode: "simple_turn",
        source: "precheck",
        mode: input.policy.mode,
        usage: null
      });
    }

    return this.createDecision({
      executionMode: input.request.deepMode === true ? "premium" : "normal",
      retrievalHint: false,
      toolHints: "none",
      confidence: "low",
      clarifyNeeded: input.policy.clarifyOnMissingContext && normalizedText.length <= 24,
      fallbackMode: input.fallbackMode,
      reasonCode: "ambiguous_turn",
      source: "precheck",
      mode: input.policy.mode,
      usage: null
    });
  }

  private buildClassifierRequest(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeTurnRequest;
    projectedTools: RuntimeNativeToolProjection;
    provider: NativeManagedProvider;
    model: string;
    prompt: string;
    fallbackMode: RoutingExecutionMode;
  }): ProviderGatewayTextGenerateRequest {
    return {
      provider: input.provider,
      model: input.model,
      systemPrompt: `${input.prompt.trim()}\n\nReturn only JSON matching the provided schema.`,
      messages: [
        {
          role: "user",
          content: [
            `Channel: ${input.request.conversation.channel}`,
            `Conversation mode: ${input.request.conversation.mode}`,
            `Deep mode: ${input.request.deepMode === true ? "enabled" : "disabled"}`,
            `Locale: ${input.request.message.locale ?? input.bundle.userContext.locale}`,
            `Attachment summary: ${this.summarizeAttachments(input.request)}`,
            `Projected tool hints available: ${
              Array.from(this.resolveAvailableToolHints(input.projectedTools)).join(", ") || "none"
            }`,
            `Fallback mode: ${input.fallbackMode}`,
            "",
            "Current user message:",
            input.request.message.text.trim()
          ].join("\n")
        }
      ],
      maxOutputTokens: ROUTER_MAX_OUTPUT_TOKENS,
      outputSchema: ROUTER_OUTPUT_SCHEMA,
      requestMetadata: {
        classification: "turn_routing",
        runtimeRequestId: input.request.requestId,
        runtimeSessionId: null,
        toolLoopIteration: null,
        compactionToolCode: null
      }
    };
  }

  private parseClassifierDecision(text: string | null): {
    executionMode: RoutingExecutionMode;
    retrievalHint: boolean;
    toolHints: RoutingToolHint;
    confidence: "high" | "low";
    clarifyNeeded: boolean;
    fallbackMode: RoutingExecutionMode;
    reasonCode: string;
  } | null {
    if (text === null || text.trim().length === 0) {
      return null;
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      const row = parsed as Record<string, unknown>;
      const executionMode = this.asExecutionMode(row.executionMode);
      const toolHints = this.asToolHint(row.toolHints);
      const confidence =
        row.confidence === "high" || row.confidence === "low" ? row.confidence : null;
      const clarifyNeeded = typeof row.clarifyNeeded === "boolean" ? row.clarifyNeeded : null;
      const retrievalHint = typeof row.retrievalHint === "boolean" ? row.retrievalHint : null;
      const fallbackMode = this.asExecutionMode(row.fallbackMode);
      const reasonCode = this.asNonEmptyString(row.reasonCode);
      if (
        executionMode === null ||
        toolHints === null ||
        confidence === null ||
        clarifyNeeded === null ||
        retrievalHint === null ||
        fallbackMode === null ||
        reasonCode === null
      ) {
        return null;
      }
      return {
        executionMode,
        retrievalHint,
        toolHints,
        confidence,
        clarifyNeeded,
        fallbackMode,
        reasonCode
      };
    } catch {
      return null;
    }
  }

  private resolveToolHint(
    lowerText: string,
    input: {
      availableHints: Set<RoutingToolHint>;
      toolTerms: string[];
    }
  ): RoutingToolHint {
    if (input.availableHints.has("browser") && this.matchesAny(lowerText, BROWSER_HINT_TERMS)) {
      return "browser";
    }
    if (input.availableHints.has("web") && this.matchesAny(lowerText, WEB_HINT_TERMS)) {
      return "web";
    }
    if (input.availableHints.has("media") && this.matchesAny(lowerText, MEDIA_HINT_TERMS)) {
      return "media";
    }
    if (input.availableHints.has("knowledge") && this.matchesAny(lowerText, input.toolTerms)) {
      return "knowledge";
    }
    if (input.availableHints.has("web") && this.matchesAny(lowerText, input.toolTerms)) {
      return "web";
    }
    if (input.availableHints.has("browser") && this.matchesAny(lowerText, input.toolTerms)) {
      return "browser";
    }
    if (input.availableHints.has("media") && this.matchesAny(lowerText, input.toolTerms)) {
      return "media";
    }
    return "none";
  }

  private resolveAvailableToolHints(
    projectedTools: RuntimeNativeToolProjection
  ): Set<RoutingToolHint> {
    const toolNames = new Set(projectedTools.tools.map((tool) => tool.name));
    const hints = new Set<RoutingToolHint>(["none"]);
    if (toolNames.has("knowledge_search") || toolNames.has("knowledge_fetch")) {
      hints.add("knowledge");
    }
    if (toolNames.has("web_search") || toolNames.has("web_fetch")) {
      hints.add("web");
    }
    if (toolNames.has("browser")) {
      hints.add("browser");
    }
    if (
      toolNames.has("image_generate") ||
      toolNames.has("image_edit") ||
      toolNames.has("video_generate") ||
      toolNames.has("tts")
    ) {
      hints.add("media");
    }
    return hints;
  }

  private summarizeAttachments(request: RuntimeTurnRequest): string {
    if (request.message.attachments.length === 0) {
      return "none";
    }
    return request.message.attachments
      .map((attachment) => `${attachment.kind}:${attachment.filename ?? attachment.attachmentId}`)
      .join(", ");
  }

  private readRouterPolicy(bundle: AssistantRuntimeBundle): RouterPolicy {
    const row =
      bundle.runtime.routerPolicy !== null &&
      typeof bundle.runtime.routerPolicy === "object" &&
      !Array.isArray(bundle.runtime.routerPolicy)
        ? (bundle.runtime.routerPolicy as Record<string, unknown>)
        : null;
    return {
      enabled: row?.enabled === true,
      mode: row?.mode === "active" ? "active" : "shadow",
      classifierFailureFallbackMode:
        this.asExecutionMode(row?.classifierFailureFallbackMode) ?? "normal",
      clarifyOnMissingContext: row?.clarifyOnMissingContext !== false,
      precheckRuleOverrides: this.readPrecheckRuleOverrides(row?.precheckRuleOverrides)
    };
  }

  private readPrecheckRuleOverrides(value: unknown): RouterPolicy["precheckRuleOverrides"] {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    return {
      continueTerms: this.asStringArray(row.continueTerms),
      retrievalTerms: this.asStringArray(row.retrievalTerms),
      reasoningTerms: this.asStringArray(row.reasoningTerms),
      toolTerms: this.asStringArray(row.toolTerms)
    };
  }

  private createDecision(input: TurnRouteDecision): TurnRouteDecision {
    return input;
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

  private coerceExecutionMode(
    executionMode: RoutingExecutionMode,
    deepModeEnabled: boolean
  ): RoutingExecutionMode {
    if (deepModeEnabled && executionMode === "normal") {
      return "premium";
    }
    return executionMode;
  }

  private normalizeMessageText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  private isContinueTurn(lowerText: string, terms: string[]): boolean {
    if (lowerText.length === 0 || lowerText.length > 32) {
      return false;
    }
    return terms.includes(lowerText.replace(/[.!?]+$/g, "").trim());
  }

  private looksCodeHeavy(text: string): boolean {
    return (
      text.includes("```") ||
      /[{}()[\];]/.test(text) ||
      /\b(function|class|const|let|var|interface|type|stack trace|traceback|exception)\b/i.test(
        text
      )
    );
  }

  private matchesAny(lowerText: string, patterns: string[]): boolean {
    return patterns.some((pattern) => lowerText.includes(pattern));
  }

  private mergeTerms(defaults: string[], overrides: string[] | undefined): string[] {
    return Array.from(
      new Set(
        [...defaults, ...(overrides ?? [])]
          .map((entry) => entry.trim().toLowerCase())
          .filter((entry) => entry.length > 0)
      )
    );
  }

  private asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry, index, list) => entry.length > 0 && list.indexOf(entry) === index);
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private normalizeOptionalText(value: string | null | undefined): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private asProvider(value: unknown): NativeManagedProvider | null {
    return value === "openai" || value === "anthropic" ? value : null;
  }

  private asExecutionMode(value: unknown): RoutingExecutionMode | null {
    return value === "normal" || value === "premium" || value === "reasoning" ? value : null;
  }

  private asToolHint(value: unknown): RoutingToolHint | null {
    return value === "knowledge" ||
      value === "web" ||
      value === "browser" ||
      value === "media" ||
      value === "none"
      ? value
      : null;
  }
}
