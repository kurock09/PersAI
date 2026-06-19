import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  RoutingLevel,
  RuntimeSkillDecisionState,
  RuntimeTurnRequest,
  RuntimeUsageSnapshot
} from "@persai/runtime-contract";
import type { RuntimeNativeToolProjection } from "./native-tool-projection";
import {
  resolveExecutionProfile,
  type ThinkingBudgetOverrides
} from "./execution-profile-resolver";
import { buildProjectModePrecheckDecision, isProjectChatMode } from "./project-execution-profile";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import {
  isRetryableRuntimeTextFailure,
  resolveRuntimeTextFallbackSelection,
  sameProviderSelection
} from "./runtime-text-fallback";

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
  level: RoutingLevel;
  executionMode: RoutingExecutionMode;
  thinkingBudget: number;
  retrievalHint: boolean;
  toolHints: RoutingToolHint;
  confidence: "high" | "low";
  clarifyNeeded: boolean;
  fallbackMode: RoutingExecutionMode;
  reasonCode: string;
  retrievalPlan: TurnRetrievalPlan;
  source: "default" | "precheck" | "llm" | "fallback";
  mode: RoutingMode;
  usage: RuntimeUsageSnapshot | null;
  skillState: RuntimeSkillDecisionState | null;
};

export type CreateDecisionInput = Omit<TurnRouteDecision, "executionMode" | "thinkingBudget">;

const ROUTER_OUTPUT_SCHEMA = {
  name: "turn_route_decision",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "level",
      "retrievalHint",
      "toolHints",
      "confidence",
      "clarifyNeeded",
      "fallbackMode",
      "reasonCode",
      "retrievalPlan"
    ],
    properties: {
      level: {
        type: "string",
        enum: ["light", "medium", "heavy", "deep"]
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
          "useUserKnowledge",
          "useProductKnowledge",
          "useWeb",
          "ordinarySourcePriorityMode",
          "confidence",
          "reasonCode"
        ],
        properties: {
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

const ROUTER_MAX_OUTPUT_TOKENS = 1200;
const ROUTER_MAX_ATTEMPTS = 2;
const ROUTER_MAX_ENABLED_SKILLS_IN_PROMPT = 5;
const ROUTER_MAX_ENABLED_SKILL_LINE_CHARS = 120;
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

const DEFAULT_DEEP_CUE_TERMS = [
  "think hard",
  "think carefully",
  "think step by step",
  "reason carefully",
  "проанализируй",
  "разбери подробно",
  "разбери детально",
  "глубоко разбери",
  "продумай"
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
    const overrides = this.readThinkingBudgetOverrides(input.bundle);
    const fallbackLevel = this.applyDeepModeNudge(
      this.executionModeToLevel(policy.classifierFailureFallbackMode),
      input.request.deepMode === true
    );
    const fallbackMode = resolveExecutionProfile(fallbackLevel, overrides).executionMode;
    const precheck = this.runPrecheck({
      bundle: input.bundle,
      request: input.request,
      projectedTools: input.projectedTools,
      policy,
      fallbackMode,
      overrides
    });
    if (precheck.confidence === "high") {
      return this.applyGroundedSkillLevelFloor(precheck, input.request, overrides);
    }
    if (!policy.enabled) {
      return this.applyGroundedSkillLevelFloor(precheck, input.request, overrides);
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
      return this.applyGroundedSkillLevelFloor(precheck, input.request, overrides);
    }

    try {
      let result: Awaited<ReturnType<ProviderGatewayClientService["generateText"]>> | null = null;
      let parsed: ReturnType<TurnRoutingService["parseClassifierDecision"]> | null = null;
      for (let attempt = 1; attempt <= ROUTER_MAX_ATTEMPTS; attempt += 1) {
        const classifierRequest = this.buildClassifierRequest({
          bundle: input.bundle,
          request: input.request,
          projectedTools: input.projectedTools,
          provider: classifierSelection.provider,
          model: routingFastModelKey,
          prompt: classifierPrompt,
          fallbackMode,
          retryInvalidJson: attempt > 1
        });
        result = await this.generateClassifierTextWithFallback(input.bundle, classifierRequest);
        parsed = this.parseClassifierDecision(result?.text ?? null);
        if (parsed !== null) {
          break;
        }
        this.logger.warn(
          `[ordinary-router] Invalid classifier output assistant=${input.bundle.metadata.assistantId} ` +
            `attempt=${String(attempt)}/${String(ROUTER_MAX_ATTEMPTS)} chars=${String(
              result?.text?.length ?? 0
            )}`
        );
      }
      if (result === null || parsed === null) {
        if (result?.text) {
          this.logger.warn(
            `[ordinary-router] Final invalid classifier output assistant=${input.bundle.metadata.assistantId} raw=${JSON.stringify(result.text)}`
          );
        }
        return this.createDecision(
          {
            level: fallbackLevel,
            retrievalHint: false,
            toolHints: "none",
            confidence: "low",
            clarifyNeeded: false,
            fallbackMode,
            reasonCode: "classifier_invalid_output",
            retrievalPlan: this.createEmptyRetrievalPlan("classifier_invalid_output"),
            source: "fallback",
            mode: policy.mode,
            usage: result?.usage ?? null,
            skillState: input.request.skillStateContext?.decision ?? null
          },
          overrides
        );
      }
      const sanitizedRetrievalPlan = this.sanitizeClassifierRetrievalPlan(
        parsed.retrievalPlan,
        input.bundle,
        input.request,
        policy
      );
      const guardedDecision = this.applyGroundedSkillLevelFloor(
        this.createDecision(
          {
            ...parsed,
            level: this.applyDeepModeNudge(parsed.level, input.request.deepMode === true),
            retrievalPlan: sanitizedRetrievalPlan,
            fallbackMode,
            source: "llm",
            mode: policy.mode,
            usage: result.usage,
            skillState: input.request.skillStateContext?.decision ?? null
          },
          overrides
        ),
        input.request,
        overrides
      );
      return guardedDecision;
    } catch (error) {
      this.logger.warn(
        `Router classifier failed for assistant ${input.bundle.metadata.assistantId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return this.applyGroundedSkillLevelFloor(
        this.createDecision(
          {
            level: fallbackLevel,
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
            skillState: precheck.skillState ?? input.request.skillStateContext?.decision ?? null
          },
          overrides
        ),
        input.request,
        overrides
      );
    }
  }

  private runPrecheck(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeTurnRequest;
    projectedTools: RuntimeNativeToolProjection;
    policy: RouterPolicy;
    fallbackMode: RoutingExecutionMode;
    overrides?: ThinkingBudgetOverrides;
  }): TurnRouteDecision {
    const normalizedText = this.normalizeMessageText(input.request.message.text);
    const lowerText = normalizedText.toLowerCase();
    const availableHints = this.resolveAvailableToolHints(input.projectedTools);
    const continueTerms = this.resolvePrecheckTerms(
      DEFAULT_CONTINUE_TERMS,
      input.policy.precheckRuleOverrides?.continueTerms
    );
    const retrievalTerms = this.resolvePrecheckTerms(
      DEFAULT_RETRIEVAL_TERMS,
      input.policy.precheckRuleOverrides?.retrievalTerms
    );
    const reasoningTerms = this.resolvePrecheckTerms(
      DEFAULT_REASONING_TERMS,
      input.policy.precheckRuleOverrides?.reasoningTerms
    );
    const premiumTerms = this.resolvePrecheckTerms(
      DEFAULT_PREMIUM_WRITING_TERMS,
      input.policy.precheckRuleOverrides?.premiumTerms
    );
    const toolTerms = this.resolvePrecheckTerms(
      DEFAULT_TOOL_TERMS,
      input.policy.precheckRuleOverrides?.toolTerms
    );
    const productPriorityTerms = this.resolvePrecheckTerms(
      DEFAULT_PRODUCT_PRIORITY_TERMS,
      input.policy.precheckRuleOverrides?.productPriorityTerms
    );
    const webPriorityTerms = this.resolvePrecheckTerms(
      DEFAULT_WEB_PRIORITY_TERMS,
      input.policy.precheckRuleOverrides?.webPriorityTerms
    );
    const personalPriorityTerms = this.resolvePrecheckTerms(
      DEFAULT_PERSONAL_PRIORITY_TERMS,
      input.policy.precheckRuleOverrides?.personalPriorityTerms
    );
    const ordinaryPriorityMode = this.resolveOrdinarySourcePriorityMode(lowerText, {
      productTerms: productPriorityTerms,
      webTerms: webPriorityTerms,
      personalTerms: personalPriorityTerms
    });
    const enabledSkills = this.resolveEnabledSkillSummaries(input.bundle);
    const currentSkillDecision = input.request.skillStateContext?.decision ?? null;
    const resolvedSkillEntry =
      currentSkillDecision !== null &&
      currentSkillDecision.status === "active" &&
      currentSkillDecision.activeSkillId !== null
        ? (enabledSkills.find((s) => s.id === currentSkillDecision.activeSkillId) ?? null)
        : null;
    const activeAutoSkill =
      resolvedSkillEntry !== null && currentSkillDecision !== null
        ? { state: currentSkillDecision, skill: resolvedSkillEntry }
        : null;
    const retrievalIntent = this.matchesAny(lowerText, retrievalTerms);
    const recallRetrievalIntent = this.isRecallRetrievalIntent(lowerText, {
      retrievalTerms,
      personalPriorityTerms
    });
    const productKnowledgeIntent = this.isProductKnowledgeIntent(lowerText, productPriorityTerms);

    if (this.isContinueTurn(lowerText, continueTerms)) {
      return this.createDecision(
        {
          level: this.applyDeepModeNudge("light", input.request.deepMode === true),
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
          skillState: activeAutoSkill?.state ?? currentSkillDecision
        },
        input.overrides
      );
    }

    const hintedTool = this.resolveToolHint(lowerText, {
      availableHints,
      toolTerms
    });
    if (activeAutoSkill) {
      const state = activeAutoSkill.state;
      return this.createDecision(
        {
          level: this.applyDeepModeNudge("light", input.request.deepMode === true),
          retrievalHint: true,
          toolHints: availableHints.has("knowledge") ? "knowledge" : "none",
          confidence: "high",
          clarifyNeeded: false,
          fallbackMode: input.fallbackMode,
          reasonCode: "sticky_skill_reuse",
          retrievalPlan: this.createRetrievalPlan({
            useSkills: true,
            selectedSkillIds: [activeAutoSkill.skill.id],
            confidence: "high",
            reasonCode: "sticky_skill_reuse"
          }),
          source: "precheck",
          mode: input.policy.mode,
          usage: null,
          skillState: state
        },
        input.overrides
      );
    }

    if (retrievalIntent) {
      return this.createDecision(
        {
          level: this.applyDeepModeNudge("light", input.request.deepMode === true),
          retrievalHint: true,
          toolHints: availableHints.has("knowledge") ? "knowledge" : "none",
          confidence: "high",
          clarifyNeeded: false,
          fallbackMode: input.fallbackMode,
          reasonCode: "knowledge_retrieval",
          retrievalPlan: this.createRetrievalPlan({
            useUserKnowledge: availableHints.has("knowledge"),
            useProductKnowledge: availableHints.has("knowledge") && productKnowledgeIntent,
            ordinarySourcePriorityMode: ordinaryPriorityMode,
            confidence: "high",
            reasonCode: recallRetrievalIntent ? "knowledge_retrieval_recall" : "knowledge_retrieval"
          }),
          source: "precheck",
          mode: input.policy.mode,
          usage: null,
          skillState: currentSkillDecision
        },
        input.overrides
      );
    }

    if (isProjectChatMode(input.request)) {
      return this.createDecision(
        buildProjectModePrecheckDecision({
          request: input.request,
          fallbackMode: input.fallbackMode,
          policyMode: input.policy.mode,
          availableKnowledge: availableHints.has("knowledge"),
          availableWeb: availableHints.has("web"),
          ordinarySourcePriorityMode: ordinaryPriorityMode,
          productKnowledgeIntent,
          skillState: currentSkillDecision,
          selectedSkillIds: []
        }),
        input.overrides
      );
    }

    if (productKnowledgeIntent && availableHints.has("knowledge")) {
      return this.createDecision(
        {
          level: this.applyDeepModeNudge("light", input.request.deepMode === true),
          retrievalHint: true,
          toolHints: "knowledge",
          confidence: "high",
          clarifyNeeded: false,
          fallbackMode: input.fallbackMode,
          reasonCode: "product_knowledge_intent",
          retrievalPlan: this.createRetrievalPlan({
            useProductKnowledge: true,
            ordinarySourcePriorityMode: ordinaryPriorityMode,
            confidence: "high",
            reasonCode: "product_knowledge_intent"
          }),
          source: "precheck",
          mode: input.policy.mode,
          usage: null,
          skillState: currentSkillDecision
        },
        input.overrides
      );
    }

    if (
      this.matchesAny(lowerText, reasoningTerms) ||
      this.matchesAny(lowerText, DEFAULT_DEEP_CUE_TERMS) ||
      this.looksCodeHeavy(normalizedText) ||
      input.request.message.attachments.some(
        (attachment) =>
          attachment.kind === "file" && attachment.mimeType.toLowerCase() === "application/pdf"
      )
    ) {
      const isDeepCue = this.matchesAny(lowerText, DEFAULT_DEEP_CUE_TERMS);
      const baseLevel: RoutingLevel = isDeepCue ? "deep" : "heavy";
      return this.createDecision(
        {
          level: this.applyDeepModeNudge(baseLevel, input.request.deepMode === true),
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
          skillState: currentSkillDecision
        },
        input.overrides
      );
    }

    if (this.matchesAny(lowerText, premiumTerms)) {
      return this.createDecision(
        {
          level: this.applyDeepModeNudge("medium", input.request.deepMode === true),
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
          skillState: currentSkillDecision
        },
        input.overrides
      );
    }

    const shouldDeferKnowledgeToolToClassifier = false;
    if (hintedTool !== "none" && !shouldDeferKnowledgeToolToClassifier) {
      const toolHintPriorityMode: OrdinarySourcePriorityMode =
        hintedTool === "web"
          ? "web_first"
          : hintedTool === "knowledge"
            ? ordinaryPriorityMode
            : "not_applicable";
      return this.createDecision(
        {
          level: this.applyDeepModeNudge("light", input.request.deepMode === true),
          retrievalHint: hintedTool === "knowledge",
          toolHints: hintedTool,
          confidence: "high",
          clarifyNeeded: false,
          fallbackMode: input.fallbackMode,
          reasonCode: `tool_hint_${hintedTool}`,
          retrievalPlan: this.createRetrievalPlan({
            useUserKnowledge: hintedTool === "knowledge",
            useProductKnowledge: hintedTool === "knowledge" && productKnowledgeIntent,
            useWeb: hintedTool === "web",
            ordinarySourcePriorityMode: toolHintPriorityMode,
            confidence: "high",
            reasonCode: `tool_hint_${hintedTool}`
          }),
          source: "precheck",
          mode: input.policy.mode,
          usage: null,
          skillState: currentSkillDecision
        },
        input.overrides
      );
    }

    if (
      normalizedText.length <= 140 &&
      !normalizedText.includes("\n") &&
      !shouldDeferKnowledgeToolToClassifier
    ) {
      return this.createDecision(
        {
          level: this.applyDeepModeNudge("light", input.request.deepMode === true),
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
          skillState: currentSkillDecision
        },
        input.overrides
      );
    }

    return this.createDecision(
      {
        level: this.applyDeepModeNudge("light", input.request.deepMode === true),
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
        skillState: currentSkillDecision
      },
      input.overrides
    );
  }

  private buildClassifierRequest(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeTurnRequest;
    projectedTools: RuntimeNativeToolProjection;
    provider: NativeManagedProvider;
    model: string;
    prompt: string;
    fallbackMode: RoutingExecutionMode;
    retryInvalidJson: boolean;
  }): ProviderGatewayTextGenerateRequest {
    const retryInstruction =
      input.retryInvalidJson === true
        ? "Previous output was rejected because it was not valid JSON for the required schema. Return only the JSON object with no leading or trailing text."
        : "";
    return {
      provider: input.provider,
      model: input.model,
      systemPrompt: `${input.prompt.trim()}\n\nReturn only compact JSON matching the provided schema. Keep every string short. reasonCode must be brief snake_case, not a sentence or explanation.${retryInstruction.length > 0 ? `\n\n${retryInstruction}` : ""}`,
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
    level: RoutingLevel;
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
      const level = this.asLevel(row.level);
      const toolHints = this.asToolHint(row.toolHints);
      const confidence =
        row.confidence === "high" || row.confidence === "low" ? row.confidence : null;
      const clarifyNeeded = typeof row.clarifyNeeded === "boolean" ? row.clarifyNeeded : null;
      const retrievalHint = typeof row.retrievalHint === "boolean" ? row.retrievalHint : null;
      const fallbackMode = this.asExecutionMode(row.fallbackMode);
      const reasonCode = this.asNonEmptyString(row.reasonCode);
      const retrievalPlan = this.asRetrievalPlan(row.retrievalPlan);
      if (
        level === null ||
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
        level,
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

  private readThinkingBudgetOverrides(bundle: AssistantRuntimeBundle): ThinkingBudgetOverrides {
    const runtime = bundle.runtime;
    if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
      return {};
    }
    const raw = (runtime as unknown as Record<string, unknown>).thinkingBudgetByLevel;
    if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }
    const byLevel = (raw as Record<string, unknown>).byLevel;
    if (
      byLevel === null ||
      byLevel === undefined ||
      typeof byLevel !== "object" ||
      Array.isArray(byLevel)
    ) {
      return {};
    }
    const levels = byLevel as Record<string, unknown>;
    const overrides: ThinkingBudgetOverrides = {};
    for (const level of ["light", "medium", "heavy", "deep"] as const) {
      const v = levels[level];
      if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0) {
        overrides[level] = v;
      }
    }
    return overrides;
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

  private createDecision(
    input: CreateDecisionInput,
    overrides?: ThinkingBudgetOverrides
  ): TurnRouteDecision {
    const profile = resolveExecutionProfile(input.level, overrides);
    return {
      ...input,
      executionMode: profile.executionMode,
      thinkingBudget: profile.thinkingBudget
    };
  }

  private applyGroundedSkillLevelFloor(
    decision: TurnRouteDecision,
    request: RuntimeTurnRequest,
    overrides?: ThinkingBudgetOverrides
  ): TurnRouteDecision {
    if (decision.level !== "light") {
      return decision;
    }
    if (!this.isGroundedSkillTurn(decision.retrievalPlan, request)) {
      return decision;
    }
    const profile = resolveExecutionProfile("medium", overrides);
    return {
      ...decision,
      level: "medium",
      executionMode: profile.executionMode,
      thinkingBudget: profile.thinkingBudget,
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
      selectedSkillIds: useSkills ? (input.selectedSkillIds ?? []) : [],
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
    bundle: AssistantRuntimeBundle,
    request: RuntimeTurnRequest,
    policy: RouterPolicy
  ): TurnRetrievalPlan {
    void bundle;
    const productPriorityTerms = this.resolvePrecheckTerms(
      DEFAULT_PRODUCT_PRIORITY_TERMS,
      policy.precheckRuleOverrides?.productPriorityTerms
    );
    const productKnowledgeIntent = this.isProductKnowledgeIntent(
      this.normalizeMessageText(request.message.text).toLowerCase(),
      productPriorityTerms
    );
    const recallRetrievalIntent = this.isRecallRetrievalIntent(
      this.normalizeMessageText(request.message.text).toLowerCase(),
      {
        retrievalTerms: this.resolvePrecheckTerms(
          DEFAULT_RETRIEVAL_TERMS,
          policy.precheckRuleOverrides?.retrievalTerms
        ),
        personalPriorityTerms: this.resolvePrecheckTerms(
          DEFAULT_PERSONAL_PRIORITY_TERMS,
          policy.precheckRuleOverrides?.personalPriorityTerms
        )
      }
    );
    const ordinarySourcePriorityMode: OrdinarySourcePriorityMode =
      plan.ordinarySourcePriorityMode === "not_applicable"
        ? "mixed_ambiguous"
        : plan.ordinarySourcePriorityMode;
    return {
      ...plan,
      useSkills: false,
      selectedSkillIds: [],
      useProductKnowledge: plan.useProductKnowledge && productKnowledgeIntent,
      ordinarySourcePriorityMode,
      reasonCode: this.appendRecallReasonCode(
        this.asNonEmptyString(plan.reasonCode) ?? "classifier_retrieval_plan",
        recallRetrievalIntent
      )
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

  private async generateClassifierTextWithFallback(
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
      this.logger.warn(
        `[runtime-text-fallback-primary-failed] surface=turn_routing requestId=${request.requestMetadata?.runtimeRequestId ?? "unknown"} classification=${request.requestMetadata?.classification ?? "unknown"} attempt=classifier role=system_tool provider=${request.provider} model=${request.model} fallbackProvider=${fallbackSelection.provider} fallbackModel=${fallbackSelection.model} error=${
          error instanceof Error ? error.message : String(error)
        }`
      );
      try {
        const result = await this.providerGatewayClientService.generateText({
          ...request,
          provider: fallbackSelection.provider,
          model: fallbackSelection.model
        });
        this.logger.log(
          `[runtime-text-fallback-succeeded] surface=turn_routing requestId=${request.requestMetadata?.runtimeRequestId ?? "unknown"} classification=${request.requestMetadata?.classification ?? "unknown"} attempt=classifier role=system_tool primaryProvider=${request.provider} primaryModel=${request.model} fallbackProvider=${result.provider} fallbackModel=${result.model}`
        );
        return result;
      } catch (fallbackError) {
        this.logger.warn(
          `[runtime-text-fallback-failed] surface=turn_routing requestId=${request.requestMetadata?.runtimeRequestId ?? "unknown"} classification=${request.requestMetadata?.classification ?? "unknown"} attempt=classifier role=system_tool primaryProvider=${request.provider} primaryModel=${request.model} fallbackProvider=${fallbackSelection.provider} fallbackModel=${fallbackSelection.model} error=${
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          }`
        );
        throw fallbackError;
      }
    }
  }

  private executionModeToLevel(mode: RoutingExecutionMode): RoutingLevel {
    if (mode === "reasoning") return "deep";
    if (mode === "premium") return "medium";
    return "light";
  }

  private applyDeepModeNudge(level: RoutingLevel, deepMode: boolean): RoutingLevel {
    if (!deepMode) return level;
    if (level === "light") return "medium";
    if (level === "medium") return "heavy";
    if (level === "heavy") return "deep";
    return "deep";
  }

  private asLevel(value: unknown): RoutingLevel | null {
    return value === "light" || value === "medium" || value === "heavy" || value === "deep"
      ? value
      : null;
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

  private isProductKnowledgeIntent(lowerText: string, productPriorityTerms: string[]): boolean {
    return this.matchesAny(lowerText, productPriorityTerms);
  }

  private isRecallRetrievalIntent(
    lowerText: string,
    terms: { retrievalTerms: string[]; personalPriorityTerms: string[] }
  ): boolean {
    const personalRecall = terms.personalPriorityTerms
      .filter((term) => term.trim().length >= 5)
      .some((term) => lowerText.includes(term));
    if (personalRecall) {
      return true;
    }
    return [
      DEFAULT_RETRIEVAL_TERMS[4],
      DEFAULT_RETRIEVAL_TERMS[5],
      DEFAULT_RETRIEVAL_TERMS[7],
      DEFAULT_RETRIEVAL_TERMS[10]
    ].some(
      (term) =>
        typeof term === "string" && terms.retrievalTerms.includes(term) && lowerText.includes(term)
    );
  }

  private appendRecallReasonCode(reasonCode: string, recallIntent: boolean): string {
    if (!recallIntent || reasonCode.includes("recall")) {
      return reasonCode;
    }
    return `${reasonCode}:recall`;
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

  private resolvePrecheckTerms(defaults: string[], overrides: string[] | undefined): string[] {
    const normalizedOverrides = this.normalizeTermList(overrides ?? []);
    if (normalizedOverrides.length > 0) {
      return normalizedOverrides;
    }
    return this.normalizeTermList(defaults);
  }

  private normalizeTermList(values: string[]): string[] {
    return Array.from(
      new Set(values.map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0))
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
        iconEmoji: this.asNonEmptyString(skill.iconEmoji)
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
      typeof row.useUserKnowledge !== "boolean" ||
      typeof row.useProductKnowledge !== "boolean" ||
      typeof row.useWeb !== "boolean" ||
      confidence === null ||
      reasonCode === null
    ) {
      return null;
    }
    const ordinarySourcePriorityMode =
      this.asOrdinarySourcePriorityMode(row.ordinarySourcePriorityMode) ?? "personal_first";
    return {
      useSkills: false,
      selectedSkillIds: [],
      useUserKnowledge: row.useUserKnowledge,
      useProductKnowledge: row.useProductKnowledge,
      useWeb: row.useWeb,
      ordinarySourcePriorityMode,
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
