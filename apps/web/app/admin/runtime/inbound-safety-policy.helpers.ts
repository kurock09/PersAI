import type {
  SafetyHeuristicPack,
  SafetyHeuristicRuleState,
  SafetyHeuristicRuleUpsertInput
} from "@persai/contracts";

export const SAFETY_HEURISTIC_PACKS: SafetyHeuristicPack[] = [
  "violence_extremism_explicit",
  "hack_abuse_request",
  "unsolicited_adult_spam",
  "structural_abuse_signal"
];

export function safetyPackLabel(pack: SafetyHeuristicPack): string {
  switch (pack) {
    case "violence_extremism_explicit":
      return "Violence / extremism";
    case "hack_abuse_request":
      return "Hack abuse";
    case "unsolicited_adult_spam":
      return "Unsolicited adult spam";
    case "structural_abuse_signal":
      return "Structural abuse";
    default:
      return pack;
  }
}

export function filterRulesByPack(
  rules: SafetyHeuristicRuleState[],
  pack: SafetyHeuristicPack
): SafetyHeuristicRuleState[] {
  return rules.filter((rule) => rule.pack === pack);
}

export function replacePackRules(
  allRules: SafetyHeuristicRuleState[],
  pack: SafetyHeuristicPack,
  packRules: SafetyHeuristicRuleState[]
): SafetyHeuristicRuleState[] {
  const otherPacks = allRules.filter((rule) => rule.pack !== pack);
  return [...otherPacks, ...packRules.map((rule) => ({ ...rule, pack }))];
}

export function toHeuristicRuleUpsertInput(
  rule: SafetyHeuristicRuleState
): SafetyHeuristicRuleUpsertInput {
  return {
    signalId: rule.signalId,
    pack: rule.pack,
    locale: rule.locale,
    patternType: rule.patternType,
    pattern: rule.pattern,
    weight: rule.weight,
    enabled: rule.enabled
  };
}

export function toHeuristicRuleUpsertPayload(
  rules: SafetyHeuristicRuleState[]
): SafetyHeuristicRuleUpsertInput[] {
  return rules.map(toHeuristicRuleUpsertInput);
}

export function createDraftHeuristicRule(pack: SafetyHeuristicPack): SafetyHeuristicRuleState {
  const stamp = Date.now().toString(36);
  return {
    id: `draft-${pack}-${stamp}`,
    signalId: `manual_${pack}_${stamp}`,
    pack,
    locale: "any",
    patternType: "literal",
    pattern: "",
    weight: 3,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function parseBoundedIntegerField(
  value: string,
  label: string,
  bounds: { min: number; max: number }
): number {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be a whole number.`);
  }
  const parsed = Number.parseInt(normalized, 10);
  if (parsed < bounds.min || parsed > bounds.max) {
    throw new Error(`${label} must be between ${String(bounds.min)} and ${String(bounds.max)}.`);
  }
  return parsed;
}
