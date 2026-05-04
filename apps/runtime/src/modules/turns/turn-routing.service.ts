import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayTextGenerateRequest,
  RuntimeAutoSkillRoutingState,
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
type RoutingRetrievalPlanConfidence = "low" | "medium" | "high";

export const ORDINARY_SOURCE_PRIORITY_MODES = [
  "personal_first",
  "product_first",
  "web_first",
  "mixed_ambiguous",
  "not_applicable"
] as const;
export type OrdinarySourcePriorityMode = (typeof ORDINARY_SOURCE_PRIORITY_MODES)[number];
type EnabledSkillSummary = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  tags: string[];
  iconEmoji: string | null;
  routingExamples: string[];
};

export type TurnRetrievalPlan = {
  useSkills: boolean;
  selectedSkillIds: string[];
  useUserKnowledge: boolean;
  useProductKnowledge: boolean;
  useWeb: boolean;
  ordinarySourcePriorityMode: OrdinarySourcePriorityMode;
  confidence: RoutingRetrievalPlanConfidence;
  reasonCode: string;
};

type RouterPolicy = {
  enabled: boolean;
  mode: RoutingMode;
  classifierFailureFallbackMode: RoutingExecutionMode;
  clarifyOnMissingContext: boolean;
  precheckRuleOverrides: {
    continueTerms: string[];
    retrievalTerms: string[];
    reasoningTerms: string[];
    premiumTerms: string[];
    toolTerms: string[];
    productPriorityTerms: string[];
    webPriorityTerms: string[];
    personalPriorityTerms: string[];
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
  retrievalPlan: TurnRetrievalPlan;
  source: "default" | "precheck" | "classifier" | "fallback";
  mode: RoutingMode;
  usage: RuntimeUsageSnapshot | null;
  autoSkillState: RuntimeAutoSkillRoutingState | null;
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
      "reasonCode",
      "retrievalPlan"
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
      },
      retrievalPlan: {
        type: "object",
        additionalProperties: false,
        required: [
          "useSkills",
          "selectedSkillIds",
          "useUserKnowledge",
          "useProductKnowledge",
          "useWeb",
          "ordinarySourcePriorityMode",
          "confidence",
          "reasonCode"
        ],
        properties: {
          useSkills: { type: "boolean" },
          selectedSkillIds: {
            type: "array",
            items: { type: "string" },
            maxItems: 3
          },
          useUserKnowledge: { type: "boolean" },
          useProductKnowledge: { type: "boolean" },
          useWeb: { type: "boolean" },
          ordinarySourcePriorityMode: {
            type: "string",
            enum: [...ORDINARY_SOURCE_PRIORITY_MODES]
          },
          confidence: {
            type: "string",
            enum: ["low", "medium", "high"]
          },
          reasonCode: { type: "string" }
        }
      }
    }
  }
} as const;

const ROUTER_MAX_OUTPUT_TOKENS = 700;
const ROUTER_MAX_ENABLED_SKILLS_IN_PROMPT = 5;
const ROUTER_MAX_ENABLED_SKILL_LINE_CHARS = 120;
const ROUTER_MAX_RECENT_ROUTING_MESSAGES_IN_PROMPT = 6;
const ROUTER_MAX_RECENT_ROUTING_MESSAGE_CHARS = 120;
const ROUTER_MAX_AUTO_SKILL_NAME_CHARS = 48;
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
const DEFAULT_PREMIUM_WRITING_TERMS = [
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

const DEFAULT_PRODUCT_PRIORITY_TERMS = [
  "tariff",
  "plan",
  "subscription",
  "billing",
  "quota",
  "limit",
  "upgrade",
  "downgrade",
  "trial",
  "free plan",
  "pricing",
  "тариф",
  "план",
  "подписк",
  "биллинг",
  "лимит",
  "квота",
  "оплат",
  "стоимость",
  "цена тариф",
  "продл",
  "пробный"
];

const DEFAULT_WEB_PRIORITY_TERMS = [
  "today",
  "latest",
  "current",
  "news",
  "weather",
  "exchange rate",
  "stock price",
  "score",
  "schedule",
  "release",
  "сегодня",
  "сейчас",
  "последн",
  "новост",
  "погод",
  "курс валют",
  "котировк",
  "афиш",
  "расписан",
  "релиз"
];

const DEFAULT_PERSONAL_PRIORITY_TERMS = [
  "i ",
  "my ",
  "we ",
  "our ",
  "remember",
  "note",
  "what did i",
  "last time",
  "yesterday",
  "что я",
  "мой ",
  "моя ",
  "мне ",
  "мы ",
  "наш",
  "напомн",
  "вчера",
  "позавчера",
  "помнишь"
];

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
    const enabledSkills = this.resolveEnabledSkillSummaries(input.bundle);
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
      retrievalPlan: this.createEmptyRetrievalPlan("default_no_retrieval"),
      source: "default",
      mode: policy.mode,
      usage: null,
      autoSkillState: input.request.skillRoutingContext?.state ?? null
    });
    const allowStandaloneSkillRouting =
      enabledSkills.length > 0 && input.request.skillRoutingContext !== undefined;
    if (!policy.enabled && !allowStandaloneSkillRouting) {
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
      return this.applyGroundedSkillPremiumFloor(precheck, input.request);
    }
    const allowClassifier =
      policy.enabled || precheck.reasonCode === "skill_routing_classifier_candidate";
    if (!allowClassifier) {
      return this.applyGroundedSkillPremiumFloor(precheck, input.request);
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
      return this.applyGroundedSkillPremiumFloor(precheck, input.request);
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
          retrievalPlan: this.createEmptyRetrievalPlan("classifier_invalid_output"),
          source: "fallback",
          mode: policy.mode,
          usage: result.usage,
          autoSkillState: this.createAutoSkillStateOnClassifierFailure(input.request)
        });
      }
      const sanitizedRetrievalPlan = this.sanitizeClassifierRetrievalPlan(
        parsed.retrievalPlan,
        input.bundle
      );
      const guardedDecision = this.applyGroundedSkillPremiumFloor(
        this.createDecision({
          ...parsed,
          retrievalPlan: sanitizedRetrievalPlan,
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
          usage: result.usage,
          autoSkillState: this.createAutoSkillStateFromPlan({
            bundle: input.bundle,
            request: input.request,
            plan: sanitizedRetrievalPlan
          })
        }),
        input.request
      );
      return guardedDecision;
    } catch (error) {
      this.logger.warn(
        `Router classifier failed for assistant ${input.bundle.metadata.assistantId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return this.applyGroundedSkillPremiumFloor(
        this.createDecision({
          executionMode: fallbackMode,
          retrievalHint: precheck.retrievalHint,
          toolHints: precheck.toolHints,
          confidence: "low",
          clarifyNeeded: precheck.clarifyNeeded,
          fallbackMode,
          reasonCode: "classifier_failure",
          retrievalPlan: precheck.retrievalPlan,
          source: "fallback",
          mode: policy.mode,
          usage: null,
          autoSkillState:
            precheck.autoSkillState ?? this.createAutoSkillStateOnClassifierFailure(input.request)
        }),
        input.request
      );
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
    const premiumTerms = this.mergeTerms(
      DEFAULT_PREMIUM_WRITING_TERMS,
      input.policy.precheckRuleOverrides?.premiumTerms
    );
    const toolTerms = this.mergeTerms(
      DEFAULT_TOOL_TERMS,
      input.policy.precheckRuleOverrides?.toolTerms
    );
    const productPriorityTerms = this.mergeTerms(
      DEFAULT_PRODUCT_PRIORITY_TERMS,
      input.policy.precheckRuleOverrides?.productPriorityTerms
    );
    const webPriorityTerms = this.mergeTerms(
      DEFAULT_WEB_PRIORITY_TERMS,
      input.policy.precheckRuleOverrides?.webPriorityTerms
    );
    const personalPriorityTerms = this.mergeTerms(
      DEFAULT_PERSONAL_PRIORITY_TERMS,
      input.policy.precheckRuleOverrides?.personalPriorityTerms
    );
    const ordinaryPriorityMode = this.resolveOrdinarySourcePriorityMode(lowerText, {
      productTerms: productPriorityTerms,
      webTerms: webPriorityTerms,
      personalTerms: personalPriorityTerms
    });
    const enabledSkills = this.resolveEnabledSkillSummaries(input.bundle);
    const activeAutoSkill = this.resolveActiveAutoSkill(input.request, enabledSkills);
    const shouldUseClassifierForSkillRouting = this.shouldUseClassifierForAutoSkillRouting({
      request: input.request,
      lowerText,
      enabledSkills,
      enabledSkillCount: enabledSkills.length,
      hasActiveAutoSkill: activeAutoSkill !== null,
      retrievalTerms,
      toolTerms,
      availableHints
    });
    const retrievalIntent = this.matchesAny(lowerText, retrievalTerms);

    if (this.isContinueTurn(lowerText, continueTerms)) {
      return this.createDecision({
        executionMode: input.request.deepMode === true ? "premium" : "normal",
        retrievalHint: false,
        toolHints: "none",
        confidence: "high",
        clarifyNeeded: false,
        fallbackMode: input.fallbackMode,
        reasonCode: "continue_term",
        retrievalPlan: this.createEmptyRetrievalPlan("continue_term"),
        source: "precheck",
        mode: input.policy.mode,
        usage: null,
        autoSkillState: activeAutoSkill
          ? this.incrementAutoSkillState(activeAutoSkill.state, input.request)
          : this.carryForwardAutoSkillState(input.request)
      });
    }

    if (activeAutoSkill && !shouldUseClassifierForSkillRouting) {
      const state = this.incrementAutoSkillState(activeAutoSkill.state, input.request);
      return this.createDecision({
        executionMode: input.request.deepMode === true ? "premium" : "normal",
        retrievalHint: true,
        toolHints: availableHints.has("knowledge") ? "knowledge" : "none",
        confidence: "high",
        clarifyNeeded: false,
        fallbackMode: input.fallbackMode,
        reasonCode: "sticky_skill_reuse",
        retrievalPlan: this.createRetrievalPlan({
          useSkills: true,
          selectedSkillIds: [activeAutoSkill.skill.id],
          confidence: state.confidence,
          reasonCode: "sticky_skill_reuse"
        }),
        source: "precheck",
        mode: input.policy.mode,
        usage: null,
        autoSkillState: state
      });
    }

    if (shouldUseClassifierForSkillRouting) {
      return this.createDecision({
        executionMode: input.request.deepMode === true ? "premium" : input.fallbackMode,
        retrievalHint: retrievalIntent,
        toolHints: retrievalIntent && availableHints.has("knowledge") ? "knowledge" : "none",
        confidence: "low",
        clarifyNeeded: false,
        fallbackMode: input.fallbackMode,
        reasonCode: "skill_routing_classifier_candidate",
        retrievalPlan: this.createEmptyRetrievalPlan("skill_routing_classifier_candidate"),
        source: "precheck",
        mode: input.policy.mode,
        usage: null,
        autoSkillState: activeAutoSkill?.state ?? input.request.skillRoutingContext?.state ?? null
      });
    }

    if (retrievalIntent && !shouldUseClassifierForSkillRouting) {
      return this.createDecision({
        executionMode: input.request.deepMode === true ? "premium" : "normal",
        retrievalHint: true,
        toolHints: availableHints.has("knowledge") ? "knowledge" : "none",
        confidence: "high",
        clarifyNeeded: false,
        fallbackMode: input.fallbackMode,
        reasonCode: "knowledge_retrieval",
        retrievalPlan: this.createRetrievalPlan({
          useUserKnowledge: availableHints.has("knowledge"),
          useProductKnowledge: availableHints.has("knowledge"),
          ordinarySourcePriorityMode: ordinaryPriorityMode,
          confidence: "high",
          reasonCode: "knowledge_retrieval"
        }),
        source: "precheck",
        mode: input.policy.mode,
        usage: null,
        autoSkillState: this.carryForwardAutoSkillState(input.request)
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
        retrievalPlan: this.createEmptyRetrievalPlan("reasoning_request"),
        source: "precheck",
        mode: input.policy.mode,
        usage: null,
        autoSkillState: this.carryForwardAutoSkillState(input.request)
      });
    }

    if (this.matchesAny(lowerText, premiumTerms)) {
      return this.createDecision({
        executionMode: input.request.deepMode === true ? "premium" : "premium",
        retrievalHint: false,
        toolHints: "none",
        confidence: "high",
        clarifyNeeded: false,
        fallbackMode: input.fallbackMode,
        reasonCode: "premium_writing",
        retrievalPlan: this.createEmptyRetrievalPlan("premium_writing"),
        source: "precheck",
        mode: input.policy.mode,
        usage: null,
        autoSkillState: this.carryForwardAutoSkillState(input.request)
      });
    }

    const hintedTool = this.resolveToolHint(lowerText, {
      availableHints,
      toolTerms
    });
    const shouldDeferKnowledgeToolToClassifier =
      hintedTool === "knowledge" && shouldUseClassifierForSkillRouting;
    if (hintedTool !== "none" && !shouldDeferKnowledgeToolToClassifier) {
      const toolHintPriorityMode: OrdinarySourcePriorityMode =
        hintedTool === "web"
          ? "web_first"
          : hintedTool === "knowledge"
            ? ordinaryPriorityMode
            : "not_applicable";
      return this.createDecision({
        executionMode: input.request.deepMode === true ? "premium" : "normal",
        retrievalHint: hintedTool === "knowledge",
        toolHints: hintedTool,
        confidence: "high",
        clarifyNeeded: false,
        fallbackMode: input.fallbackMode,
        reasonCode: `tool_hint_${hintedTool}`,
        retrievalPlan: this.createRetrievalPlan({
          useUserKnowledge: hintedTool === "knowledge",
          useProductKnowledge: hintedTool === "knowledge",
          useWeb: hintedTool === "web",
          ordinarySourcePriorityMode: toolHintPriorityMode,
          confidence: "high",
          reasonCode: `tool_hint_${hintedTool}`
        }),
        source: "precheck",
        mode: input.policy.mode,
        usage: null,
        autoSkillState: this.carryForwardAutoSkillState(input.request)
      });
    }

    if (
      normalizedText.length <= 140 &&
      !normalizedText.includes("\n") &&
      !(shouldUseClassifierForSkillRouting && retrievalIntent) &&
      !shouldDeferKnowledgeToolToClassifier
    ) {
      return this.createDecision({
        executionMode: input.request.deepMode === true ? "premium" : "normal",
        retrievalHint: false,
        toolHints: "none",
        confidence: "high",
        clarifyNeeded: false,
        fallbackMode: input.fallbackMode,
        reasonCode: "simple_turn",
        retrievalPlan: this.createEmptyRetrievalPlan("simple_turn"),
        source: "precheck",
        mode: input.policy.mode,
        usage: null,
        autoSkillState: this.carryForwardAutoSkillState(input.request)
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
      retrievalPlan: this.createEmptyRetrievalPlan("ambiguous_turn"),
      source: "precheck",
      mode: input.policy.mode,
      usage: null,
      autoSkillState: this.carryForwardAutoSkillState(input.request)
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
      systemPrompt: `${input.prompt.trim()}\n\nReturn only compact JSON matching the provided schema. Keep every string short. reasonCode must be brief snake_case, not a sentence or explanation.`,
      messages: [
        {
          role: "user",
          content: this.buildClassifierContextBlock(input)
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
    retrievalPlan: TurnRetrievalPlan;
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
      const retrievalPlan = this.asRetrievalPlan(row.retrievalPlan);
      if (
        executionMode === null ||
        toolHints === null ||
        confidence === null ||
        clarifyNeeded === null ||
        retrievalHint === null ||
        fallbackMode === null ||
        reasonCode === null ||
        retrievalPlan === null
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
        reasonCode,
        retrievalPlan
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

  private summarizeEnabledSkills(bundle: AssistantRuntimeBundle): string {
    const skills = this.resolveEnabledSkillSummaries(bundle);
    if (skills.length === 0) {
      return "none";
    }
    return skills
      .slice(0, ROUTER_MAX_ENABLED_SKILLS_IN_PROMPT)
      .map((skill) => {
        const tags = skill.tags.slice(0, 2).join(", ");
        const compact = [
          `id=${skill.id}`,
          `name=${this.normalizeMessageText(skill.name).slice(0, 40)}`,
          `category=${this.normalizeMessageText(skill.category).slice(0, 24)}`,
          tags.length === 0 ? null : `tags=${this.normalizeMessageText(tags).slice(0, 32)}`
        ]
          .filter((part): part is string => part !== null)
          .join("; ");
        return compact.slice(0, ROUTER_MAX_ENABLED_SKILL_LINE_CHARS);
      })
      .concat(
        skills.length > ROUTER_MAX_ENABLED_SKILLS_IN_PROMPT
          ? [`+${skills.length - ROUTER_MAX_ENABLED_SKILLS_IN_PROMPT} more enabled skills`]
          : []
      )
      .join("\n");
  }

  private summarizeKnowledgeState(input: {
    bundle: AssistantRuntimeBundle;
    projectedTools: RuntimeNativeToolProjection;
  }): string {
    const availableHints = this.resolveAvailableToolHints(input.projectedTools);
    const sourceNames = new Set(
      input.bundle.runtime.knowledgeAccess.sources.map((row) => row.source)
    );
    return [
      `skills=${this.resolveEnabledSkillSummaries(input.bundle).length > 0 ? "available" : "none"}`,
      `userKnowledge=${
        availableHints.has("knowledge") &&
        (sourceNames.has("document") || sourceNames.has("chat") || sourceNames.has("memory"))
          ? "available"
          : "none"
      }`,
      `productKnowledge=${
        availableHints.has("knowledge") &&
        (sourceNames.has("global") || sourceNames.has("subscription"))
          ? "available"
          : "none"
      }`,
      `web=${availableHints.has("web") ? "available" : "none"}`
    ].join("; ");
  }

  private summarizeRecentSkillRoutingMessages(request: RuntimeTurnRequest): string {
    const messages = request.skillRoutingContext?.recentMessages ?? [];
    if (messages.length === 0) {
      return "none";
    }
    return messages
      .slice(-ROUTER_MAX_RECENT_ROUTING_MESSAGES_IN_PROMPT)
      .map((message, index) => {
        const text = this.normalizeMessageText(message.text).slice(
          0,
          ROUTER_MAX_RECENT_ROUTING_MESSAGE_CHARS
        );
        return `${index + 1}. ${message.role}: ${text}`;
      })
      .join("\n");
  }

  private summarizeAutoSkillState(request: RuntimeTurnRequest): string {
    const state = request.skillRoutingContext?.state ?? null;
    if (state === null) {
      return "none";
    }
    return [
      `status=${state.status}`,
      `activeSkillId=${state.activeSkillId ?? "none"}`,
      `activeSkillName=${this.normalizeMessageText(state.activeSkillName ?? "none").slice(0, ROUTER_MAX_AUTO_SKILL_NAME_CHARS)}`,
      `confidence=${state.confidence}`,
      `checkedAtMessageIndex=${state.checkedAtMessageIndex}`,
      `messageCountSinceCheck=${state.messageCountSinceCheck}`
    ].join("; ");
  }

  private buildClassifierContextBlock(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeTurnRequest;
    projectedTools: RuntimeNativeToolProjection;
    fallbackMode: RoutingExecutionMode;
  }): string {
    return [
      `Channel: ${input.request.conversation.channel}`,
      `Conversation mode: ${input.request.conversation.mode}`,
      `Deep mode: ${input.request.deepMode === true ? "enabled" : "disabled"}`,
      `Locale: ${input.request.message.locale ?? input.bundle.userContext.locale}`,
      `Attachment summary: ${this.summarizeAttachments(input.request)}`,
      `Projected tool hints available: ${
        Array.from(this.resolveAvailableToolHints(input.projectedTools)).join(", ") || "none"
      }`,
      `Enabled Skills summary: ${this.summarizeEnabledSkills(input.bundle)}`,
      `Recent chat window: ${this.summarizeRecentSkillRoutingMessages(input.request)}`,
      `Current auto Skill state: ${this.summarizeAutoSkillState(input.request)}`,
      `Available knowledge state: ${this.summarizeKnowledgeState({
        bundle: input.bundle,
        projectedTools: input.projectedTools
      })}`,
      `Fallback mode: ${input.fallbackMode}`,
      "",
      "Current user message:",
      input.request.message.text.trim()
    ].join("\n");
  }

  private resolveActiveAutoSkill(
    request: RuntimeTurnRequest,
    enabledSkills: EnabledSkillSummary[]
  ): { state: RuntimeAutoSkillRoutingState; skill: EnabledSkillSummary } | null {
    const state = request.skillRoutingContext?.state ?? null;
    if (state === null || state.status !== "active" || state.activeSkillId === null) {
      return null;
    }
    const skill = enabledSkills.find((row) => row.id === state.activeSkillId) ?? null;
    return skill === null ? null : { state, skill };
  }

  private shouldUseClassifierForAutoSkillRouting(input: {
    request: RuntimeTurnRequest;
    lowerText: string;
    enabledSkills: EnabledSkillSummary[];
    enabledSkillCount: number;
    hasActiveAutoSkill: boolean;
    retrievalTerms: string[];
    toolTerms: string[];
    availableHints: Set<RoutingToolHint>;
  }): boolean {
    if (input.enabledSkillCount === 0) {
      return false;
    }
    if (input.request.skillRoutingContext?.forceCheck === true) {
      return true;
    }
    if (input.hasActiveAutoSkill) {
      return false;
    }
    return false;
  }

  private carryForwardAutoSkillState(
    request: RuntimeTurnRequest
  ): RuntimeAutoSkillRoutingState | null {
    const state = request.skillRoutingContext?.state ?? null;
    if (state === null) {
      return null;
    }
    if (state.status === "active") {
      return this.incrementAutoSkillState(
        {
          ...state,
          status: "inactive",
          activeSkillId: null,
          activeSkillName: null
        },
        request
      );
    }
    return this.incrementAutoSkillState(state, request);
  }

  private buildSkillRoutingMatchText(request: RuntimeTurnRequest, lowerText: string): string {
    const recentMessages = request.skillRoutingContext?.recentMessages ?? [];
    const recentText = recentMessages
      .slice(-8)
      .map((message) => this.normalizeMessageText(message.text).toLowerCase())
      .filter((text) => text.length > 0)
      .join("\n");
    return [recentText, lowerText]
      .filter((part) => part.length > 0)
      .join("\n")
      .slice(-4_000);
  }

  private hasEnabledSkillLexicalMatch(
    lowerText: string,
    enabledSkills: EnabledSkillSummary[]
  ): boolean {
    if (lowerText.length < 4) {
      return false;
    }
    return enabledSkills.some((skill) =>
      this.buildSkillRoutingTerms(skill).some((term) => lowerText.includes(term))
    );
  }

  private buildSkillRoutingTerms(skill: EnabledSkillSummary): string[] {
    const terms = new Set<string>();
    const values = [skill.name, skill.description, ...skill.tags, ...skill.routingExamples].filter(
      (value): value is string => value !== null && value.trim().length > 0
    );

    for (const value of values) {
      const tokens = this.tokenizeForSkillRouting(value);
      for (const token of tokens) {
        if (token.length >= 4) {
          terms.add(token);
        }
        for (const stem of this.skillRoutingStems(token)) {
          terms.add(stem);
        }
      }
    }
    return Array.from(terms).filter((term) => term.length >= 4);
  }

  private tokenizeForSkillRouting(value: string): string[] {
    return Array.from(value.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu), (match) => match[0]);
  }

  private skillRoutingStems(token: string): string[] {
    if (!/^\p{L}+$/u.test(token) || token.length < 6) {
      return [];
    }
    return token.length >= 8 ? [token.slice(0, 4), token.slice(0, 5)] : [token.slice(0, 4)];
  }

  private isHighSignalGroundingTurn(input: {
    request: RuntimeTurnRequest;
    lowerText: string;
    retrievalTerms: string[];
    toolTerms: string[];
    availableHints: Set<RoutingToolHint>;
  }): boolean {
    if (input.request.message.attachments.length > 0) {
      return true;
    }
    if (this.matchesAny(input.lowerText, input.retrievalTerms)) {
      return true;
    }
    return (
      input.availableHints.has("knowledge") && this.matchesAny(input.lowerText, input.toolTerms)
    );
  }

  private incrementAutoSkillState(
    state: RuntimeAutoSkillRoutingState,
    request: RuntimeTurnRequest
  ): RuntimeAutoSkillRoutingState {
    return {
      ...state,
      messageCountSinceCheck: Math.max(0, state.messageCountSinceCheck + 1),
      backgroundCheckQueuedAtMessageIndex: state.backgroundCheckQueuedAtMessageIndex ?? null,
      checkedAtMessageIndex: Math.max(
        0,
        Math.min(
          state.checkedAtMessageIndex,
          request.skillRoutingContext?.currentUserMessageIndex ?? 0
        )
      )
    };
  }

  private createAutoSkillStateFromPlan(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeTurnRequest;
    plan: TurnRetrievalPlan;
  }): RuntimeAutoSkillRoutingState | null {
    const currentUserMessageIndex = input.request.skillRoutingContext?.currentUserMessageIndex ?? 0;
    if (!input.plan.useSkills || input.plan.selectedSkillIds.length === 0) {
      return {
        status: "inactive",
        activeSkillId: null,
        activeSkillName: null,
        topicSummary: this.buildTopicSummary(input.request),
        confidence: input.plan.confidence,
        checkedAtMessageIndex: currentUserMessageIndex,
        messageCountSinceCheck: 0,
        backgroundCheckQueuedAtMessageIndex: null
      };
    }
    const skillId = input.plan.selectedSkillIds[0] ?? null;
    const skill = this.resolveEnabledSkillSummaries(input.bundle).find((row) => row.id === skillId);
    if (skill === undefined) {
      return null;
    }
    return {
      status: "active",
      activeSkillId: skill.id,
      activeSkillName: skill.name,
      topicSummary: this.buildTopicSummary(input.request),
      confidence: input.plan.confidence,
      checkedAtMessageIndex: currentUserMessageIndex,
      messageCountSinceCheck: 0,
      backgroundCheckQueuedAtMessageIndex: null
    };
  }

  private createAutoSkillStateOnClassifierFailure(
    request: RuntimeTurnRequest
  ): RuntimeAutoSkillRoutingState | null {
    if (request.skillRoutingContext?.forceCheck !== true) {
      return request.skillRoutingContext?.state ?? null;
    }
    const currentUserMessageIndex = request.skillRoutingContext?.currentUserMessageIndex ?? 0;
    return {
      status: "inactive",
      activeSkillId: null,
      activeSkillName: null,
      topicSummary: this.buildTopicSummary(request),
      confidence: "low",
      checkedAtMessageIndex: currentUserMessageIndex,
      messageCountSinceCheck: 0,
      backgroundCheckQueuedAtMessageIndex: null
    };
  }

  private buildTopicSummary(request: RuntimeTurnRequest): string | null {
    const messages = request.skillRoutingContext?.recentMessages ?? [];
    const conversationTexts = messages
      .slice(-6)
      .map((message) => ({
        role: message.role,
        text: this.normalizeMessageText(message.text)
      }))
      .filter((message) => message.text.length > 0)
      .map((message) => `${message.role}: ${message.text}`);
    const summary = conversationTexts.join(" / ").slice(0, 240).trim();
    return summary.length === 0 ? null : summary;
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
      premiumTerms: this.asStringArray(row.premiumTerms),
      toolTerms: this.asStringArray(row.toolTerms),
      productPriorityTerms: this.asStringArray(row.productPriorityTerms),
      webPriorityTerms: this.asStringArray(row.webPriorityTerms),
      personalPriorityTerms: this.asStringArray(row.personalPriorityTerms)
    };
  }

  private createDecision(input: TurnRouteDecision): TurnRouteDecision {
    return input;
  }

  private applyGroundedSkillPremiumFloor(
    decision: TurnRouteDecision,
    request: RuntimeTurnRequest
  ): TurnRouteDecision {
    if (decision.executionMode !== "normal") {
      return decision;
    }
    if (!this.isGroundedSkillTurn(decision.retrievalPlan, request)) {
      return decision;
    }
    return {
      ...decision,
      executionMode: "premium",
      reasonCode:
        decision.reasonCode === "grounded_skill_retrieval_premium_floor"
          ? decision.reasonCode
          : `${decision.reasonCode}:grounded_skill_retrieval_premium_floor`
    };
  }

  private isGroundedSkillTurn(plan: TurnRetrievalPlan, request: RuntimeTurnRequest): boolean {
    return (
      plan.useSkills &&
      (plan.useUserKnowledge ||
        request.message.attachments.some((attachment) => attachment.kind === "file"))
    );
  }

  private createEmptyRetrievalPlan(reasonCode: string): TurnRetrievalPlan {
    return this.createRetrievalPlan({ reasonCode });
  }

  private createRetrievalPlan(input: {
    useSkills?: boolean;
    selectedSkillIds?: string[];
    useUserKnowledge?: boolean;
    useProductKnowledge?: boolean;
    useWeb?: boolean;
    ordinarySourcePriorityMode?: OrdinarySourcePriorityMode;
    confidence?: RoutingRetrievalPlanConfidence;
    reasonCode: string;
  }): TurnRetrievalPlan {
    const useSkills = input.useSkills === true;
    return {
      useSkills,
      selectedSkillIds: input.selectedSkillIds ?? [],
      useUserKnowledge: input.useUserKnowledge === true,
      useProductKnowledge: input.useProductKnowledge === true,
      useWeb: input.useWeb === true,
      ordinarySourcePriorityMode: useSkills
        ? "not_applicable"
        : (input.ordinarySourcePriorityMode ?? "not_applicable"),
      confidence: input.confidence ?? "low",
      reasonCode: input.reasonCode
    };
  }

  private sanitizeClassifierRetrievalPlan(
    plan: TurnRetrievalPlan,
    bundle: AssistantRuntimeBundle
  ): TurnRetrievalPlan {
    const enabledSkillIds = new Set(
      this.resolveEnabledSkillSummaries(bundle).map((skill) => skill.id)
    );
    const selectedSkillIds = plan.selectedSkillIds
      .filter(
        (skillId, index, list) => enabledSkillIds.has(skillId) && list.indexOf(skillId) === index
      )
      .slice(0, 3);
    const useSkills = plan.useSkills && selectedSkillIds.length > 0;
    const ordinarySourcePriorityMode: OrdinarySourcePriorityMode = useSkills
      ? "not_applicable"
      : plan.ordinarySourcePriorityMode === "not_applicable"
        ? "mixed_ambiguous"
        : plan.ordinarySourcePriorityMode;
    return {
      ...plan,
      useSkills,
      selectedSkillIds,
      ordinarySourcePriorityMode,
      reasonCode: this.asNonEmptyString(plan.reasonCode) ?? "classifier_retrieval_plan"
    };
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

  private countMatches(lowerText: string, patterns: string[]): number {
    let total = 0;
    for (const pattern of patterns) {
      if (pattern.length > 0 && lowerText.includes(pattern)) {
        total += 1;
      }
    }
    return total;
  }

  private resolveOrdinarySourcePriorityMode(
    lowerText: string,
    terms: { productTerms: string[]; webTerms: string[]; personalTerms: string[] }
  ): OrdinarySourcePriorityMode {
    const productScore = this.countMatches(lowerText, terms.productTerms);
    const webScore = this.countMatches(lowerText, terms.webTerms);
    const personalScore = this.countMatches(lowerText, terms.personalTerms);
    const max = Math.max(productScore, webScore, personalScore);
    if (max === 0) {
      return "personal_first";
    }
    const tied = [productScore, webScore, personalScore].filter((value) => value === max).length;
    if (tied > 1) {
      return "mixed_ambiguous";
    }
    if (max === productScore) {
      return "product_first";
    }
    if (max === webScore) {
      return "web_first";
    }
    return "personal_first";
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

  private asIdentifierStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const deduped: string[] = [];
    for (const entry of value) {
      if (typeof entry !== "string") {
        continue;
      }
      const trimmed = entry.trim();
      if (trimmed.length > 0 && !deduped.includes(trimmed)) {
        deduped.push(trimmed);
      }
    }
    return deduped;
  }

  private resolveEnabledSkillSummaries(bundle: AssistantRuntimeBundle): EnabledSkillSummary[] {
    const skills =
      bundle.skills !== undefined &&
      bundle.skills !== null &&
      typeof bundle.skills === "object" &&
      !Array.isArray(bundle.skills) &&
      Array.isArray(bundle.skills.enabled)
        ? bundle.skills.enabled
        : [];
    return skills
      .map((skill) => ({
        id: this.asNonEmptyString(skill.id),
        name: this.asNonEmptyString(skill.name),
        description: this.asNonEmptyString(skill.description),
        category: this.asNonEmptyString(skill.category),
        tags: this.asStringArray(skill.tags),
        iconEmoji: this.asNonEmptyString(skill.iconEmoji),
        routingExamples: this.asStringArray(skill.routingExamples).slice(0, 2)
      }))
      .filter(
        (skill): skill is EnabledSkillSummary =>
          skill.id !== null && skill.name !== null && skill.category !== null
      );
  }

  private asRetrievalPlan(value: unknown): TurnRetrievalPlan | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    const confidence = this.asRetrievalPlanConfidence(row.confidence);
    const reasonCode = this.asNonEmptyString(row.reasonCode);
    if (
      typeof row.useSkills !== "boolean" ||
      !Array.isArray(row.selectedSkillIds) ||
      typeof row.useUserKnowledge !== "boolean" ||
      typeof row.useProductKnowledge !== "boolean" ||
      typeof row.useWeb !== "boolean" ||
      confidence === null ||
      reasonCode === null
    ) {
      return null;
    }
    const ordinarySourcePriorityMode =
      this.asOrdinarySourcePriorityMode(row.ordinarySourcePriorityMode) ??
      (row.useSkills ? "not_applicable" : "personal_first");
    return {
      useSkills: row.useSkills,
      selectedSkillIds: this.asIdentifierStringArray(row.selectedSkillIds).slice(0, 3),
      useUserKnowledge: row.useUserKnowledge,
      useProductKnowledge: row.useProductKnowledge,
      useWeb: row.useWeb,
      ordinarySourcePriorityMode: row.useSkills ? "not_applicable" : ordinarySourcePriorityMode,
      confidence,
      reasonCode
    };
  }

  private asOrdinarySourcePriorityMode(value: unknown): OrdinarySourcePriorityMode | null {
    if (typeof value !== "string") {
      return null;
    }
    return (ORDINARY_SOURCE_PRIORITY_MODES as readonly string[]).includes(value)
      ? (value as OrdinarySourcePriorityMode)
      : null;
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

  private asRetrievalPlanConfidence(value: unknown): RoutingRetrievalPlanConfidence | null {
    return value === "low" || value === "medium" || value === "high" ? value : null;
  }
}
