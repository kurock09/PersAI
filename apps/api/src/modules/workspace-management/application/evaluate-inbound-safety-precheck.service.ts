import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { AssistantInboundSurface } from "./assistant-inbound.types";
import type {
  InboundSafetyPrecheckRoute,
  InboundSafetyPrecheckConfidence,
  InboundSafetyPrecheckOutcome,
  SafetyHeuristicLocale,
  SafetyHeuristicPack,
  SafetyHeuristicRule,
  SafetyPolicySettings
} from "../domain/safety-policy.types";
import { PACK_REASON_CODES } from "../domain/safety-policy.types";
import {
  SAFETY_HEURISTIC_RULE_REPOSITORY,
  SAFETY_POLICY_SETTINGS_REPOSITORY,
  type SafetyHeuristicRuleRepository,
  type SafetyPolicySettingsRepository
} from "../domain/safety-policy.repository";
import { Inject } from "@nestjs/common";

export type EvaluateInboundSafetyPrecheckInput = {
  userId: string;
  assistantId: string;
  workspaceId: string;
  surface: AssistantInboundSurface;
  message: string;
  attachmentCount?: number;
};

type CompiledRule = SafetyHeuristicRule & {
  matcher: (message: string) => boolean;
};

@Injectable()
export class EvaluateInboundSafetyPrecheckService {
  private readonly logger = new Logger(EvaluateInboundSafetyPrecheckService.name);
  private compiledRules: CompiledRule[] = [];
  private settingsCache: SafetyPolicySettings | null = null;

  constructor(
    @Inject(SAFETY_HEURISTIC_RULE_REPOSITORY)
    private readonly safetyHeuristicRuleRepository: SafetyHeuristicRuleRepository,
    @Inject(SAFETY_POLICY_SETTINGS_REPOSITORY)
    private readonly safetyPolicySettingsRepository: SafetyPolicySettingsRepository
  ) {}

  async reloadPolicyCache(): Promise<void> {
    const [rules, settings] = await Promise.all([
      this.safetyHeuristicRuleRepository.listEnabledRules(),
      this.safetyPolicySettingsRepository.getSettings()
    ]);
    this.compiledRules = rules
      .map((rule) => {
        try {
          return {
            ...rule,
            matcher: compileMatcher(rule)
          };
        } catch (error) {
          this.logger.warn(
            `Skipping invalid safety heuristic rule ${rule.signalId}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          return null;
        }
      })
      .filter((rule): rule is CompiledRule => rule !== null);
    this.settingsCache = settings;
  }

  async evaluate(input: EvaluateInboundSafetyPrecheckInput): Promise<InboundSafetyPrecheckOutcome> {
    if (this.compiledRules.length === 0 || this.settingsCache === null) {
      await this.reloadPolicyCache();
    }
    const settings = this.settingsCache;
    if (settings === null) {
      return allowOutcome();
    }

    const normalizedMessage = input.message.trim();
    const structuralOutcome = evaluateStructuralSignals(
      normalizedMessage,
      input.attachmentCount ?? 0
    );
    const ruleOutcome = evaluateRuleMatches(normalizedMessage, this.compiledRules);
    const merged = mergeOutcomes(structuralOutcome, ruleOutcome);
    return {
      ...merged,
      route: resolveRoute(merged.confidence, merged.rulePack, settings)
    };
  }

  getCachedSettings(): SafetyPolicySettings | null {
    return this.settingsCache;
  }
}

function allowOutcome(): InboundSafetyPrecheckOutcome {
  return {
    route: "allow",
    confidence: "none",
    reasonCode: "none",
    rulePack: null,
    matchedSignals: []
  };
}

function compileMatcher(rule: SafetyHeuristicRule): (message: string) => boolean {
  if (rule.patternType === "literal") {
    const needle = rule.pattern.trim().toLowerCase();
    return (message: string) => message.toLowerCase().includes(needle);
  }
  const expression = new RegExp(rule.pattern, "i");
  return (message: string) => expression.test(message);
}

function resolveMessageLocales(message: string): SafetyHeuristicLocale[] {
  const hasCyrillic = /[а-яё]/i.test(message);
  const hasLatin = /[a-z]/i.test(message);
  const locales: SafetyHeuristicLocale[] = ["any"];
  if (hasCyrillic) {
    locales.push("ru");
  }
  if (hasLatin || !hasCyrillic) {
    locales.push("en");
  }
  return locales;
}

function weightToConfidence(weight: number): InboundSafetyPrecheckConfidence {
  if (weight <= 0) {
    return "none";
  }
  if (weight <= 2) {
    return "low";
  }
  if (weight <= 5) {
    return "medium";
  }
  return "high";
}

function confidenceRank(confidence: InboundSafetyPrecheckConfidence): number {
  switch (confidence) {
    case "none":
      return 0;
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
  }
}

function evaluateRuleMatches(message: string, rules: CompiledRule[]): InboundSafetyPrecheckOutcome {
  if (message.length === 0) {
    return allowOutcome();
  }
  const locales = new Set(resolveMessageLocales(message));
  let best: InboundSafetyPrecheckOutcome = allowOutcome();
  let bestWeight = 0;

  for (const rule of rules) {
    if (!locales.has(rule.locale) && rule.locale !== "any") {
      continue;
    }
    if (!rule.matcher(message)) {
      continue;
    }
    if (rule.weight <= bestWeight) {
      continue;
    }
    bestWeight = rule.weight;
    const confidence = weightToConfidence(rule.weight);
    best = {
      route: "defer_contour_2",
      confidence,
      reasonCode: PACK_REASON_CODES[rule.pack],
      rulePack: rule.pack,
      matchedSignals: [rule.signalId]
    };
  }

  return best;
}

function evaluateStructuralSignals(
  message: string,
  attachmentCount: number
): InboundSafetyPrecheckOutcome {
  if (message.length === 0 && attachmentCount === 0) {
    return {
      route: "defer_contour_2",
      confidence: "low",
      reasonCode: PACK_REASON_CODES.structural_abuse_signal,
      rulePack: "structural_abuse_signal",
      matchedSignals: ["structural.empty_message"]
    };
  }
  if (message.length === 0 && attachmentCount > 0) {
    return {
      route: "defer_contour_2",
      confidence: "low",
      reasonCode: PACK_REASON_CODES.structural_abuse_signal,
      rulePack: "structural_abuse_signal",
      matchedSignals: ["structural.attachment_only"]
    };
  }
  return allowOutcome();
}

function mergeOutcomes(
  left: InboundSafetyPrecheckOutcome,
  right: InboundSafetyPrecheckOutcome
): InboundSafetyPrecheckOutcome {
  if (confidenceRank(right.confidence) > confidenceRank(left.confidence)) {
    return right;
  }
  if (confidenceRank(right.confidence) < confidenceRank(left.confidence)) {
    return left;
  }
  if (right.matchedSignals.length === 0) {
    return left;
  }
  if (left.matchedSignals.length === 0) {
    return right;
  }
  return {
    route: right.route,
    confidence: right.confidence,
    reasonCode: right.reasonCode,
    rulePack: right.rulePack,
    matchedSignals: Array.from(new Set([...left.matchedSignals, ...right.matchedSignals]))
  };
}

function resolveRoute(
  confidence: InboundSafetyPrecheckConfidence,
  rulePack: SafetyHeuristicPack | null,
  settings: SafetyPolicySettings
): InboundSafetyPrecheckRoute {
  if (confidence === "none" || rulePack === null) {
    return "allow";
  }
  if (confidence === "high" && settings.instantBlockPackAllowlist.includes(rulePack)) {
    return "block_obvious";
  }
  return "defer_contour_2";
}

export function buildSafetyModerationTriggerKey(input: {
  userId: string;
  assistantId: string;
  surface: string;
  surfaceThreadKey: string | null;
  message: string;
}): string {
  const digest = createHash("sha256")
    .update(
      [
        input.userId,
        input.assistantId,
        input.surface,
        input.surfaceThreadKey ?? "",
        input.message.trim()
      ].join("|")
    )
    .digest("hex")
    .slice(0, 32);
  return `${input.userId}:${input.assistantId}:${digest}`;
}
