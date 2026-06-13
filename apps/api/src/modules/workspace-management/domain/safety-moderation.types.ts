import type { ModerationCaseDecision } from "@prisma/client";
import type { InboundSafetyPrecheckOutcome } from "./safety-policy.types";

export type SafetyModerationThreadMessageSnapshot = {
  id: string;
  author: "user" | "assistant";
  contentPreview: string;
  createdAt: string;
};

export type SafetyModerationTriggerSnapshot = {
  triggerKey: string;
  triggerText: string;
  surface: string;
  surfaceThreadKey: string | null;
  precheckOutcome: InboundSafetyPrecheckOutcome;
};

export type OpenAiModerationCategoryScores = Record<string, number>;

export type OpenAiModerationResult = {
  flagged: boolean;
  categoryScores: OpenAiModerationCategoryScores;
  categories: Record<string, boolean>;
};

export type SafetyModerationDecisionInput = {
  moderation: OpenAiModerationResult;
  precheckOutcome: InboundSafetyPrecheckOutcome;
  blockScoreThreshold: number;
};

export type SafetyModerationDecision = {
  decision: ModerationCaseDecision;
  reasonCode: string;
  confidence: "low" | "medium" | "high";
  topCategory: string | null;
  topScore: number;
};

export const SAFETY_MODERATION_THREAD_PREVIEW_MAX_CHARS = 500;
