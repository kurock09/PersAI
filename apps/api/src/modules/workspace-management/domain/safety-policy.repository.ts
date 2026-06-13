import type {
  SafetyHeuristicLocale,
  SafetyHeuristicPack,
  SafetyHeuristicPatternType,
  SafetyHeuristicRule,
  SafetyPolicySettings
} from "./safety-policy.types";

export const SAFETY_HEURISTIC_RULE_REPOSITORY = Symbol("SAFETY_HEURISTIC_RULE_REPOSITORY");
export const SAFETY_POLICY_SETTINGS_REPOSITORY = Symbol("SAFETY_POLICY_SETTINGS_REPOSITORY");

export type SafetyHeuristicRuleUpsertInput = {
  signalId: string;
  pack: SafetyHeuristicPack;
  locale: SafetyHeuristicLocale;
  patternType: SafetyHeuristicPatternType;
  pattern: string;
  weight: number;
  enabled: boolean;
};

export type SafetyPolicySettingsUpdateInput = {
  syncHoldTimeoutMs: number;
  instantBlockPackAllowlist: SafetyHeuristicPack[];
  moderationModelId: string;
  contour2Enabled: boolean;
};

export interface SafetyHeuristicRuleRepository {
  listEnabledRules(): Promise<SafetyHeuristicRule[]>;
  listRules(filter?: {
    pack?: SafetyHeuristicPack;
    locale?: SafetyHeuristicLocale;
    enabled?: boolean;
  }): Promise<SafetyHeuristicRule[]>;
  replaceAllRules(rules: SafetyHeuristicRuleUpsertInput[]): Promise<SafetyHeuristicRule[]>;
}

export interface SafetyPolicySettingsRepository {
  getSettings(): Promise<SafetyPolicySettings>;
  updateSettings(input: SafetyPolicySettingsUpdateInput): Promise<SafetyPolicySettings>;
}
