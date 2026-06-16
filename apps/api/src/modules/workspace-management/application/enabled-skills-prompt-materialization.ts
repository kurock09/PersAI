import type { RuntimeBundleSkillScenario } from "@persai/runtime-contract";

export type EnabledSkillPromptAssignmentStatus =
  | "active"
  | "disabled"
  | "archived"
  | "plan_disabled";

export type EnabledSkillPromptInstructionCard = {
  title: string;
  body: string;
  guardrails: string[];
  examples: string[];
};

export type EnabledSkillPromptCandidate = {
  id: string;
  name: Record<string, string>;
  description: Record<string, string>;
  category: string;
  tags: string[];
  displayOrder: number;
  status: "draft" | "active" | "archived";
  instructionCard: EnabledSkillPromptInstructionCard;
  iconEmoji: string | null;
  assignmentStatus: EnabledSkillPromptAssignmentStatus;
  assignmentEnabledAt: Date | string | null;
  /** ADR-118 Slice 4 — active scenarios for this skill, pre-resolved to bundle shape. */
  scenarios?: RuntimeBundleSkillScenario[];
};

export type EnabledSkillPromptCard = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  tags: string[];
  iconEmoji: string | null;
  title: string;
  body: string;
  guardrails: string[];
  examples: string[];
  scenarios: RuntimeBundleSkillScenario[];
};

export type EnabledSkillScenarioCandidate = {
  skillId: string;
  key: string;
  displayName: Record<string, string>;
  description: Record<string, string>;
  iconEmoji: string | null;
  intentExamples: string[];
  steps: RuntimeBundleSkillScenario["steps"];
  recommendedTools: string[];
  exitCondition: string;
};

/** ADR-118 Slice 4 — maximum scenarios rendered per skill in the cached prefix. */
export const SCENARIO_CATALOG_RENDER_LIMIT = 8;

const MAX_RENDERED_TAGS = 6;
const MAX_RENDERED_GUARDRAILS = 6;
const MAX_RENDERED_EXAMPLES = 3;
const MAX_RENDERED_BODY_CHARS = 1_200;
const MAX_RENDERED_ITEM_CHARS = 240;

export function resolveEnabledSkillPromptCards(params: {
  candidates: EnabledSkillPromptCandidate[];
  locale: string;
  limit: number | null;
}): EnabledSkillPromptCard[] {
  const enabled = params.candidates
    .filter((candidate) => candidate.status === "active")
    .filter((candidate) => candidate.assignmentStatus === "active")
    .sort(compareEnabledSkillCandidates);
  const withinLimit = params.limit === null ? enabled : enabled.slice(0, Math.max(0, params.limit));

  return withinLimit.map((candidate) => ({
    id: candidate.id,
    name: localize(candidate.name, params.locale) ?? "Skill",
    description: localize(candidate.description, params.locale),
    category: normalizeSingleLine(candidate.category),
    tags: candidate.tags
      .map((tag) => normalizeSingleLine(tag))
      .filter((tag) => tag.length > 0)
      .slice(0, MAX_RENDERED_TAGS),
    iconEmoji: normalizeSingleLine(candidate.iconEmoji ?? "") || null,
    title: normalizeSingleLine(candidate.instructionCard.title) || "Skill instructions",
    body: truncateText(candidate.instructionCard.body, MAX_RENDERED_BODY_CHARS),
    guardrails: normalizeBoundedList(candidate.instructionCard.guardrails, MAX_RENDERED_GUARDRAILS),
    examples: normalizeBoundedList(candidate.instructionCard.examples, MAX_RENDERED_EXAMPLES),
    scenarios: candidate.scenarios ?? []
  }));
}

export function renderEnabledSkillsPromptBlock(cards: EnabledSkillPromptCard[]): string {
  if (cards.length === 0) {
    return "";
  }

  return [
    "# Enabled Skills",
    "",
    "These professional Skill cards are enabled by the user for this assistant. Apply them when relevant, but do not invent document knowledge that is not present in the conversation or retrieved context.",
    "",
    ...cards.flatMap((card, index) => renderSkillCard(card, index + 1))
  ]
    .join("\n")
    .trimEnd();
}

function renderSkillCard(card: EnabledSkillPromptCard, position: number): string[] {
  const lines = [`## ${String(position)}. ${card.title}`, "", `- Skill: ${card.name}`];
  if (card.description !== null) {
    lines.push(`- Summary: ${card.description}`);
  }
  if (card.category.length > 0) {
    lines.push(`- Category: ${card.category}`);
  }
  if (card.tags.length > 0) {
    lines.push(`- Tags: ${card.tags.join(", ")}`);
  }
  lines.push("", card.body);
  if (card.guardrails.length > 0) {
    lines.push("", "Guardrails:");
    for (const guardrail of card.guardrails) {
      lines.push(`- ${guardrail}`);
    }
  }
  if (card.examples.length > 0) {
    lines.push("", "Examples:");
    for (const example of card.examples) {
      lines.push(`- ${example}`);
    }
  }
  if ((card.scenarios ?? []).length > 0) {
    const scenarios = card.scenarios ?? [];
    lines.push("", "Available scenarios:");
    const rendered = scenarios.slice(0, SCENARIO_CATALOG_RENDER_LIMIT);
    const surplus = scenarios.length - rendered.length;
    for (const scenario of rendered) {
      const toolsHint =
        scenario.recommendedTools.length > 0
          ? ` (recommended: ${scenario.recommendedTools.join(", ")})`
          : "";
      lines.push(
        `- ${scenario.key}: ${scenario.displayName} — ${scenario.description}${toolsHint}`
      );
    }
    if (surplus > 0) {
      lines.push(`... +${String(surplus)} more`);
    }
  }
  lines.push("");
  return lines;
}

/**
 * ADR-118 Slice 4 — resolve active scenarios for the runtime bundle (not for the prompt card).
 * Returns a Map<skillId, RuntimeBundleSkillScenario[]> for all provided candidates.
 */
export function resolveEnabledSkillScenariosForBundle(params: {
  candidates: EnabledSkillScenarioCandidate[];
  locale: string;
}): Map<string, RuntimeBundleSkillScenario[]> {
  const result = new Map<string, RuntimeBundleSkillScenario[]>();
  for (const candidate of params.candidates) {
    const displayName = localizeScenarioText(candidate.displayName, params.locale) ?? candidate.key;
    const description = localizeScenarioText(candidate.description, params.locale) ?? "";
    const scenario: RuntimeBundleSkillScenario = {
      key: candidate.key,
      displayName,
      description,
      iconEmoji: candidate.iconEmoji,
      intentExamples: candidate.intentExamples,
      steps: candidate.steps,
      recommendedTools: candidate.recommendedTools,
      exitCondition: candidate.exitCondition
    };
    const existing = result.get(candidate.skillId) ?? [];
    existing.push(scenario);
    result.set(candidate.skillId, existing);
  }
  return result;
}

function localizeScenarioText(value: Record<string, string>, locale: string): string | null {
  return localize(value, locale);
}

function compareEnabledSkillCandidates(
  left: EnabledSkillPromptCandidate,
  right: EnabledSkillPromptCandidate
): number {
  const enabledAtDelta =
    toSortTime(left.assignmentEnabledAt) - toSortTime(right.assignmentEnabledAt);
  if (enabledAtDelta !== 0) {
    return enabledAtDelta;
  }
  const displayOrderDelta = left.displayOrder - right.displayOrder;
  if (displayOrderDelta !== 0) {
    return displayOrderDelta;
  }
  return left.id.localeCompare(right.id);
}

function toSortTime(value: Date | string | null): number {
  if (value === null) {
    return Number.MAX_SAFE_INTEGER;
  }
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function localize(value: Record<string, string>, locale: string): string | null {
  const localeKey = locale.toLowerCase();
  const language = localeKey.split("-")[0] ?? localeKey;
  const direct = normalizeSingleLine(value[localeKey] ?? "");
  if (direct.length > 0) {
    return direct;
  }
  const languageValue = normalizeSingleLine(value[language] ?? "");
  if (languageValue.length > 0) {
    return languageValue;
  }
  for (const fallbackKey of ["en", "ru"]) {
    const fallback = normalizeSingleLine(value[fallbackKey] ?? "");
    if (fallback.length > 0) {
      return fallback;
    }
  }
  for (const text of Object.values(value)) {
    const normalized = normalizeSingleLine(text);
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return null;
}

function normalizeBoundedList(items: string[], maxItems: number): string[] {
  return items
    .map((item) => truncateText(item, MAX_RENDERED_ITEM_CHARS))
    .filter((item) => item.length > 0)
    .slice(0, maxItems);
}

function normalizeSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxChars: number): string {
  const normalized = value
    .split("\n")
    .map((line) => normalizeSingleLine(line))
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}
