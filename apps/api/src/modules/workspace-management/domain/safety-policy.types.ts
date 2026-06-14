export type SafetyHeuristicPack =
  | "violence_extremism_explicit"
  | "hack_abuse_request"
  | "unsolicited_adult_spam"
  | "structural_abuse_signal";

export type SafetyHeuristicLocale = "any" | "ru" | "en";

export type SafetyHeuristicPatternType = "literal" | "regex";

export type SafetyHeuristicRule = {
  id: string;
  signalId: string;
  pack: SafetyHeuristicPack;
  locale: SafetyHeuristicLocale;
  patternType: SafetyHeuristicPatternType;
  pattern: string;
  weight: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SafetyPolicySettings = {
  id: string;
  syncHoldTimeoutMs: number;
  instantBlockPackAllowlist: SafetyHeuristicPack[];
  moderationModelId: string;
  contour2Enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type InboundSafetyPrecheckRoute =
  | "allow"
  | "defer_contour_2"
  | "block_obvious"
  | "hold_and_defer_contour_2_sync";

export type InboundSafetyPrecheckConfidence = "none" | "low" | "medium" | "high";

export type InboundSafetyPrecheckOutcome = {
  route: InboundSafetyPrecheckRoute;
  confidence: InboundSafetyPrecheckConfidence;
  reasonCode: string;
  rulePack: SafetyHeuristicPack | null;
  matchedSignals: string[];
};

export const SAFETY_POLICY_SETTINGS_ID = "platform";

export const SAFETY_INBOUND_RESTRICTED_PLACEHOLDER_MESSAGE =
  "This message could not be processed because inbound access is restricted by platform safety policy.";

export const PACK_REASON_CODES: Record<SafetyHeuristicPack, string> = {
  violence_extremism_explicit: "violence_extremism",
  hack_abuse_request: "hack_abuse",
  unsolicited_adult_spam: "unsolicited_adult_spam",
  structural_abuse_signal: "structural_abuse_signal"
};
