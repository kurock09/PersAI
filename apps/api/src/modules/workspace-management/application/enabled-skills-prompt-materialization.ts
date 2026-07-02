import {
  ENABLED_SKILLS_BUDGET_CHARS,
  ENABLED_SKILLS_SCENARIO_ROW_CAP,
  SKILL_SUMMARY_CAP,
  SKILL_WHEN_TO_USE_CAP,
  type RuntimeBundleSkillScenario
} from "@persai/runtime-contract";

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
  /** ADR-119 Slice 3 — optional field; empty string if not yet authored by Skill creator. */
  whenToUse?: string;
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
  /** ADR-119 Slice 3 — kept in prefix as compact XML hint; empty string if not authored. */
  whenToUse: string;
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
  guardrails?: string[];
  examples?: string[];
  /** ADR-119 Slice 10 — optional override for the catalog <first_step_preview> tag; null = auto-derive. */
  firstStepPreview?: string | null;
};

const MAX_RENDERED_TAGS = 4;
const MAX_RENDERED_GUARDRAILS = 6;
const MAX_RENDERED_EXAMPLES = 3;
const MAX_RENDERED_ITEM_CHARS = 240;
const MAX_RENDERED_TAG_CHARS = 40;
const ENABLED_SKILLS_TAIL_LINE =
  "  <catalog_note>More skills or scenarios available via skill.list / skill.describe.</catalog_note>";

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
    description: truncateOptionalSingleLine(
      localize(candidate.description, params.locale),
      SKILL_SUMMARY_CAP
    ),
    category: normalizeSingleLine(candidate.category),
    tags: candidate.tags
      .map((tag) => truncateSingleLine(tag, MAX_RENDERED_TAG_CHARS))
      .filter((tag) => tag.length > 0)
      .slice(0, MAX_RENDERED_TAGS),
    iconEmoji: normalizeSingleLine(candidate.iconEmoji ?? "") || null,
    title: normalizeSingleLine(candidate.instructionCard.title) || "Skill instructions",
    body: normalizeMultiline(candidate.instructionCard.body),
    guardrails: normalizeBoundedList(candidate.instructionCard.guardrails, MAX_RENDERED_GUARDRAILS),
    examples: normalizeBoundedList(candidate.instructionCard.examples, MAX_RENDERED_EXAMPLES),
    whenToUse: truncateSingleLine(candidate.instructionCard.whenToUse ?? "", SKILL_WHEN_TO_USE_CAP),
    scenarios: candidate.scenarios ?? []
  }));
}

export function renderEnabledSkillsPromptBlock(cards: EnabledSkillPromptCard[]): string {
  if (cards.length === 0) {
    return "";
  }

  const header =
    '<!-- Enabled Skills catalog. Pass <skill id="..."> verbatim as skillId to skill({action:"engage"}). Read extra Skill detail with skill({action:"list"}) or skill({action:"describe"}). -->';
  const renderedBlocks: string[][] = [];
  let remainingScenarioRows = ENABLED_SKILLS_SCENARIO_ROW_CAP;
  let truncated = false;

  for (const card of cards) {
    const rendered = renderSkillCard(card, remainingScenarioRows);
    const candidateText = buildEnabledSkillsPromptText(
      header,
      [...renderedBlocks, rendered.lines],
      truncated || rendered.truncated
    );
    if (candidateText.length > ENABLED_SKILLS_BUDGET_CHARS) {
      truncated = true;
      break;
    }
    renderedBlocks.push(rendered.lines);
    remainingScenarioRows -= rendered.scenarioRowsUsed;
    truncated ||= rendered.truncated;
  }

  if (renderedBlocks.length < cards.length) {
    truncated = true;
  }

  let renderedText = buildEnabledSkillsPromptText(header, renderedBlocks, truncated);
  while (renderedText.length > ENABLED_SKILLS_BUDGET_CHARS && renderedBlocks.length > 0) {
    renderedBlocks.pop();
    truncated = true;
    renderedText = buildEnabledSkillsPromptText(header, renderedBlocks, truncated);
  }

  return renderedText.length <= ENABLED_SKILLS_BUDGET_CHARS ? renderedText : header;
}

function renderSkillCard(
  card: EnabledSkillPromptCard,
  remainingScenarioRows: number
): { lines: string[]; scenarioRowsUsed: number; truncated: boolean } {
  const lines: string[] = [];
  // key attribute: no slug on Skill model, fall back to id
  lines.push(`<skill id="${escapeXml(card.id)}" key="${escapeXml(card.id)}">`);
  lines.push(`  <display_name>${escapeXml(card.name)}</display_name>`);
  if (card.description !== null && card.description.length > 0) {
    lines.push(`  <summary>${escapeXml(card.description)}</summary>`);
  }
  const whenToUse = card.whenToUse ?? "";
  if (whenToUse.length > 0) {
    lines.push(`  <when_to_use>${escapeXml(whenToUse)}</when_to_use>`);
  }
  if (card.category.length > 0) {
    lines.push(`  <category>${escapeXml(card.category)}</category>`);
  }
  if (card.tags.length > 0) {
    lines.push(`  <tags>${escapeXml(card.tags.join(", "))}</tags>`);
  }

  const scenarios = card.scenarios ?? [];
  let scenarioRowsUsed = 0;
  let truncated = false;
  if (scenarios.length > 0) {
    lines.push("  <available_scenarios>");
    const rendered = scenarios.slice(0, Math.max(0, remainingScenarioRows));
    for (const scenario of rendered) {
      lines.push(`    <scenario key="${escapeXml(scenario.key)}">`);
      lines.push(`      <name>${escapeXml(scenario.displayName)}</name>`);
      lines.push("    </scenario>");
    }
    scenarioRowsUsed = rendered.length;
    truncated = scenarios.length > rendered.length;
    lines.push("  </available_scenarios>");
  } else {
    lines.push("  <available_scenarios />");
  }

  lines.push("</skill>");
  return { lines, scenarioRowsUsed, truncated };
}

/**
 * ADR-119 Slice 4 — resolve active scenarios for the runtime bundle (not for the prompt card).
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
      exitCondition: candidate.exitCondition,
      guardrails: normalizeBoundedList(candidate.guardrails ?? [], MAX_RENDERED_GUARDRAILS),
      examples: normalizeBoundedList(candidate.examples ?? [], MAX_RENDERED_EXAMPLES),
      firstStepPreview: candidate.firstStepPreview ?? null
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
  for (const fallbackKey of ["ru", "en"]) {
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

function normalizeMultiline(value: string): string {
  return value
    .split("\n")
    .map((line) => normalizeSingleLine(line))
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

function normalizeSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxChars: number): string {
  const normalized = normalizeMultiline(value);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

/** Strip newlines, truncate to ≤maxChars, append … if truncated. */
function truncateSingleLine(value: string, maxChars: number): string {
  const flat = normalizeSingleLine(value);
  if (flat.length <= maxChars) {
    return flat;
  }
  return `${flat.slice(0, Math.max(0, maxChars - 1)).trimEnd()}\u2026`;
}

function truncateOptionalSingleLine(value: string | null, maxChars: number): string | null {
  if (value === null) {
    return null;
  }
  const truncated = truncateSingleLine(value, maxChars);
  return truncated.length > 0 ? truncated : null;
}

function buildEnabledSkillsPromptText(
  header: string,
  renderedBlocks: string[][],
  truncated: boolean
): string {
  const lines = [header, ...renderedBlocks.flat()];
  if (truncated) {
    lines.push(ENABLED_SKILLS_TAIL_LINE);
  }
  return lines.join("\n");
}

/** Escape XML special characters for attribute values and text content. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
