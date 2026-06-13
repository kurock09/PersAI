import type { InboundSafetyPrecheckOutcome } from "../domain/safety-policy.types";
import { PACK_REASON_CODES } from "../domain/safety-policy.types";

export type ModerationCategoryScores = Record<string, number>;

export type OpenAiModerationResult = {
  flagged: boolean;
  categories: Record<string, boolean>;
  categoryScores: ModerationCategoryScores;
};

export type SafetyModerationDecision = "allow" | "warn" | "block_user";

export type SafetyModerationDecisionInput = {
  moderation: OpenAiModerationResult;
  precheck: InboundSafetyPrecheckOutcome;
  blockScoreThreshold: number;
};

export type SafetyModerationDecisionOutcome = {
  decision: SafetyModerationDecision;
  reasonCode: string;
  maxCategoryScore: number;
  topCategory: string | null;
};

const MODERATION_CATEGORY_REASON_CODES: Record<string, string> = {
  harassment: "structural_abuse_signal",
  "harassment/threatening": "violence_extremism",
  hate: "violence_extremism",
  "hate/threatening": "violence_extremism",
  illicit: "hack_abuse",
  "illicit/violent": "violence_extremism",
  "self-harm": "violence_extremism",
  "self-harm/intent": "violence_extremism",
  "self-harm/instructions": "violence_extremism",
  sexual: "unsolicited_adult_spam",
  "sexual/minors": "unsolicited_adult_spam",
  violence: "violence_extremism",
  "violence/graphic": "violence_extremism"
};

export function resolveTopModerationCategory(
  categoryScores: ModerationCategoryScores
): { category: string; score: number } | null {
  let topCategory: string | null = null;
  let topScore = -1;
  for (const [category, score] of Object.entries(categoryScores)) {
    if (typeof score !== "number" || !Number.isFinite(score)) {
      continue;
    }
    if (score > topScore) {
      topScore = score;
      topCategory = category;
    }
  }
  if (topCategory === null || topScore < 0) {
    return null;
  }
  return { category: topCategory, score: topScore };
}

export function resolveModerationReasonCode(input: {
  precheck: InboundSafetyPrecheckOutcome;
  topCategory: string | null;
}): string {
  if (input.precheck.rulePack !== null) {
    return PACK_REASON_CODES[input.precheck.rulePack];
  }
  if (input.precheck.reasonCode !== "none") {
    return input.precheck.reasonCode;
  }
  if (input.topCategory !== null) {
    return MODERATION_CATEGORY_REASON_CODES[input.topCategory] ?? "structural_abuse_signal";
  }
  return "structural_abuse_signal";
}

export function decideSafetyModerationOutcome(
  input: SafetyModerationDecisionInput
): SafetyModerationDecisionOutcome {
  const top = resolveTopModerationCategory(input.moderation.categoryScores);
  const maxCategoryScore = top?.score ?? 0;
  const topCategory = top?.category ?? null;
  const reasonCode = resolveModerationReasonCode({
    precheck: input.precheck,
    topCategory
  });
  const shouldBlock =
    input.moderation.flagged === true || maxCategoryScore >= input.blockScoreThreshold;
  if (shouldBlock) {
    return {
      decision: "block_user",
      reasonCode,
      maxCategoryScore,
      topCategory
    };
  }
  if (
    input.precheck.route === "defer_contour_2" &&
    (input.precheck.confidence === "medium" || input.precheck.confidence === "high")
  ) {
    return {
      decision: "warn",
      reasonCode,
      maxCategoryScore,
      topCategory
    };
  }
  return {
    decision: "allow",
    reasonCode,
    maxCategoryScore,
    topCategory
  };
}
