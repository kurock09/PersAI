import type { AdminSkillUpsertInput } from "./skill-management.types";

export const SKILL_AUTHORING_DRAFT_PROPOSAL_SCHEMA = "persai.skillAuthoringDraftProposal.v1";

export type SkillAuthoringDraftRequest = {
  prompt: string | null;
  currentDraft: Partial<AdminSkillUpsertInput> | null;
};

export type SkillAuthoringDraftKnowledgeCardProposal = {
  title: string;
  body: string;
  locale: string | null;
  tags: string[];
  lifecycleStatus: "draft";
  provenanceKind: "assistant_generated";
};

export type SkillAuthoringDraftProposalState = {
  schema: typeof SKILL_AUTHORING_DRAFT_PROPOSAL_SCHEMA;
  providerKey: "openai" | "anthropic";
  modelKey: string;
  generatedAt: string;
  skillDraft: Partial<AdminSkillUpsertInput>;
  knowledgeCards: SkillAuthoringDraftKnowledgeCardProposal[];
  warnings: string[];
};

const MAX_PROMPT_CHARS = 2_000;
const MAX_TEXT_CHARS = 12_000;
const MAX_TAGS = 12;
const MAX_TAG_CHARS = 40;

export function parseSkillAuthoringDraftRequest(body: unknown): SkillAuthoringDraftRequest {
  const row = asObject(body);
  return {
    prompt: normalizeOptionalText(row.prompt, "prompt", MAX_PROMPT_CHARS),
    currentDraft: normalizeCurrentDraft(row.currentDraft)
  };
}

export function normalizeSkillAuthoringDraftProposal(input: {
  providerKey: "openai" | "anthropic";
  modelKey: string;
  generatedAt: Date;
  rawProposal: unknown;
}): SkillAuthoringDraftProposalState {
  const row = asObject(input.rawProposal);
  const skillDraft = normalizeSkillDraft(asOptionalObject(row.skillDraft));
  const knowledgeCards = normalizeKnowledgeCards(row.knowledgeCards);
  const warnings = normalizeStringArray(row.warnings, 8, 300);
  if (Object.keys(skillDraft).length === 0 && knowledgeCards.length === 0) {
    warnings.push("The authoring model returned no usable Skill draft fields or knowledge cards.");
  }
  return {
    schema: SKILL_AUTHORING_DRAFT_PROPOSAL_SCHEMA,
    providerKey: input.providerKey,
    modelKey: input.modelKey,
    generatedAt: input.generatedAt.toISOString(),
    skillDraft,
    knowledgeCards,
    warnings
  };
}

function normalizeCurrentDraft(value: unknown): Partial<AdminSkillUpsertInput> | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeSkillDraft(asObject(value));
}

function normalizeSkillDraft(row: Record<string, unknown> | null): Partial<AdminSkillUpsertInput> {
  if (row === null) {
    return {};
  }
  const draft: Partial<AdminSkillUpsertInput> = {};
  const name = normalizeLocalizedText(row.name);
  if (name !== null) {
    draft.name = name;
  }
  const description = normalizeLocalizedText(row.description);
  if (description !== null) {
    draft.description = description;
  }
  const category = normalizeOptionalText(row.category, "category", 80);
  if (category !== null) {
    draft.category = category;
  }
  const tags = normalizeStringArray(row.tags, MAX_TAGS, MAX_TAG_CHARS);
  if (tags.length > 0) {
    draft.tags = tags;
  }
  const instructionCard = normalizeInstructionCard(row.instructionCard);
  if (instructionCard !== null) {
    draft.instructionCard = instructionCard;
  }
  const iconEmoji = normalizeOptionalText(row.iconEmoji, "iconEmoji", 16);
  if (iconEmoji !== null) {
    draft.iconEmoji = iconEmoji;
  }
  const color = normalizeOptionalText(row.color, "color", 64);
  if (color !== null) {
    draft.color = color;
  }
  return draft;
}

function normalizeInstructionCard(value: unknown): AdminSkillUpsertInput["instructionCard"] | null {
  const row = asOptionalObject(value);
  if (row === null) {
    return null;
  }
  const title = normalizeOptionalText(row.title, "instructionCard.title", 120);
  const body = normalizeOptionalText(row.body, "instructionCard.body", 1_200);
  if (title === null || body === null) {
    return null;
  }
  return {
    title,
    body,
    guardrails: normalizeStringArray(row.guardrails, 8, 180),
    examples: normalizeStringArray(row.examples, 8, 220)
  };
}

function normalizeKnowledgeCards(value: unknown): SkillAuthoringDraftKnowledgeCardProposal[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const cards: SkillAuthoringDraftKnowledgeCardProposal[] = [];
  for (const item of value.slice(0, 5)) {
    const row = asOptionalObject(item);
    if (row === null) {
      continue;
    }
    const title = normalizeOptionalText(row.title, "knowledgeCards.title", 255);
    const body = normalizeOptionalText(row.body, "knowledgeCards.body", 4_000);
    if (title === null || body === null || body.length < 20) {
      continue;
    }
    cards.push({
      title,
      body,
      locale: normalizeOptionalText(row.locale, "knowledgeCards.locale", 16),
      tags: normalizeStringArray(row.tags, 8, MAX_TAG_CHARS),
      lifecycleStatus: "draft",
      provenanceKind: "assistant_generated"
    });
  }
  return cards;
}

function normalizeLocalizedText(value: unknown): Record<string, string> | null {
  const row = asOptionalObject(value);
  if (row === null) {
    return null;
  }
  const result: Record<string, string> = {};
  for (const [locale, text] of Object.entries(row)) {
    const normalizedLocale = locale.trim().slice(0, 16);
    const normalizedText = normalizeOptionalText(text, locale, MAX_TEXT_CHARS);
    if (normalizedLocale.length > 0 && normalizedText !== null) {
      result[normalizedLocale] = normalizedText;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function normalizeStringArray(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = normalizeOptionalText(item, "list item", maxChars);
    if (normalized === null) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
    if (result.length >= maxItems) {
      break;
    }
  }
  return result;
}

function normalizeOptionalText(value: unknown, path: string, maxChars: number): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.length > maxChars) {
    return normalized.slice(0, maxChars).trim();
  }
  return normalized;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be an object.");
  }
  return value as Record<string, unknown>;
}

function asOptionalObject(value: unknown): Record<string, unknown> | null {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
