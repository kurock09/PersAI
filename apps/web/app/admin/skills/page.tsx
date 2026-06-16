"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Archive,
  BookOpen,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X
} from "lucide-react";
import type {
  AdminCreateSkillScenarioRequest,
  AdminSkillScenario,
  AdminUpdateSkillScenarioRequest,
  SkillScenarioStatus
} from "@persai/contracts";
import {
  deleteAdminSkillScenario,
  getAdminSkillScenarios,
  patchAdminSkillScenario,
  postAdminSkillScenario
} from "@persai/contracts";
import {
  archiveAdminSkill,
  archiveAdminSkillKnowledgeCard,
  createAdminSkill,
  createAdminSkillKnowledgeCard,
  deleteAdminSkillDocument,
  generateAdminSkillAuthoringDraft,
  getAdminSkills,
  reindexAdminSkillKnowledgeCard,
  reindexAdminSkillDocument,
  updateAdminSkill,
  updateAdminSkillKnowledgeCard,
  uploadAdminSkillDocument,
  type AdminSkillState,
  type AdminSkillUpsertRequest,
  type SkillKnowledgeCardInput,
  type SkillKnowledgeCardState,
  type SkillAuthoringDraftKnowledgeCardProposal,
  type SkillAuthoringDraftProposalState,
  type SkillDocumentState
} from "@/app/app/assistant-api-client";

type SkillDraft = {
  id: string | null;
  status: "draft" | "active" | "archived";
  nameEn: string;
  nameRu: string;
  descriptionEn: string;
  descriptionRu: string;
  category: string;
  tagsText: string;
  instructionTitle: string;
  instructionBody: string;
  guardrailsText: string;
  examplesText: string;
  iconEmoji: string;
  color: string;
  displayOrder: string;
};

type SkillReadinessSummary = {
  ready: number;
  processing: number;
  failed: number;
  needsReview: number;
  label: string;
  tone: "muted" | "ready" | "processing" | "warning" | "failed";
};

type DocumentUploadDraft = {
  displayName: string;
  description: string;
};

type SkillKnowledgeCardDraft = {
  id: string | null;
  title: string;
  body: string;
  locale: string;
  tagsText: string;
  lifecycleStatus: "draft" | "active" | "stale" | "archived";
  provenanceKind: "manual" | "assistant_generated";
};

type ScenarioStepDraft = {
  directive: string;
  recommendedToolCall: string;
  mayBeSkippedIf: string;
  negativeGuards: string[];
};

type ScenarioDraft = {
  key: string;
  displayNameRu: string;
  displayNameEn: string;
  descriptionRu: string;
  descriptionEn: string;
  iconEmoji: string;
  displayOrder: string;
  status: SkillScenarioStatus;
  intentExamples: string[];
  recommendedTools: string[];
  exitCondition: string;
  steps: ScenarioStepDraft[];
};

export const KNOWLEDGE_LOCALE_OPTIONS = [
  { value: "", label: "Any locale" },
  { value: "en", label: "English (en)" },
  { value: "en-US", label: "English US (en-US)" },
  { value: "ru", label: "Russian (ru)" },
  { value: "ru-RU", label: "Russian RU (ru-RU)" }
] as const;

const SKILL_GROUP_OPTIONS = [
  { value: "work", label: "Работа" },
  { value: "engineering", label: "Профессии / Engineering" },
  { value: "personal", label: "Личное" },
  { value: "education", label: "Образование" }
] as const;

const EMPTY_SKILL_DRAFT: SkillDraft = {
  id: null,
  status: "draft",
  nameEn: "",
  nameRu: "",
  descriptionEn: "",
  descriptionRu: "",
  category: "work",
  tagsText: "",
  instructionTitle: "Professional guidance",
  instructionBody:
    "Use this Skill when the user asks for domain-specific professional support. Ground answers in enabled Skill documents when they are ready, explain uncertainty clearly, and avoid claiming regulated guarantees.",
  guardrailsText: "Do not invent source-backed facts\nState limits and assumptions",
  examplesText:
    "Explain the relevant rule from the uploaded document\nSummarize a practical checklist",
  iconEmoji: "",
  color: "",
  displayOrder: "100"
};

const EMPTY_KNOWLEDGE_CARD_DRAFT: SkillKnowledgeCardDraft = {
  id: null,
  title: "",
  body: "",
  locale: "",
  tagsText: "",
  lifecycleStatus: "draft",
  provenanceKind: "manual"
};

export const SCENARIO_KEY_REGEX = /^[a-z][a-z0-9_]{1,63}$/;

/**
 * Native tool keys available as recommended-tool hints in scenario steps.
 * No such constant exists in the web codebase; hardcoded here from tool-catalog-data.ts codes
 * (prompt-constructor-tool-metadata.ts also uses knowledge_search and memory_write as the
 * model-visible names). This is a UI-only hint list — not a runtime constraint.
 */
export const NATIVE_SCENARIO_TOOL_KEYS = [
  "image_generate",
  "image_edit",
  "video_generate",
  "knowledge_search",
  "memory_write",
  "files",
  "scheduled_action",
  "background_task",
  "skill"
] as const;

const EMPTY_SCENARIO_STEP_DRAFT: ScenarioStepDraft = {
  directive: "",
  recommendedToolCall: "",
  mayBeSkippedIf: "",
  negativeGuards: []
};

const EMPTY_SCENARIO_DRAFT: ScenarioDraft = {
  key: "",
  displayNameRu: "",
  displayNameEn: "",
  descriptionRu: "",
  descriptionEn: "",
  iconEmoji: "",
  displayOrder: "100",
  status: "draft",
  intentExamples: [],
  recommendedTools: [],
  exitCondition: "",
  steps: [{ ...EMPTY_SCENARIO_STEP_DRAFT }]
};

const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-text outline-none transition-colors placeholder:text-text-subtle focus:border-border-strong disabled:opacity-50";

function formatWhen(value: string | null): string {
  if (!value) {
    return "Not yet";
  }
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function normalizeLines(value: string): string[] {
  return value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function localizedFromDraft(primary: string, secondary: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (primary.trim()) {
    result.en = primary.trim();
  }
  if (secondary.trim()) {
    result.ru = secondary.trim();
  }
  return result;
}

function preferredText(value: Record<string, string> | undefined, fallback = "Untitled"): string {
  return value?.en?.trim() || value?.ru?.trim() || Object.values(value ?? {})[0] || fallback;
}

export function skillToDraft(skill: AdminSkillState | null): SkillDraft {
  if (skill === null) {
    return { ...EMPTY_SKILL_DRAFT };
  }
  return {
    id: skill.id,
    status: skill.status,
    nameEn: skill.name.en ?? "",
    nameRu: skill.name.ru ?? "",
    descriptionEn: skill.description.en ?? "",
    descriptionRu: skill.description.ru ?? "",
    category: skill.category,
    tagsText: skill.tags.join(", "),
    instructionTitle: skill.instructionCard.title,
    instructionBody: skill.instructionCard.body,
    guardrailsText: skill.instructionCard.guardrails.join("\n"),
    examplesText: skill.instructionCard.examples.join("\n"),
    iconEmoji: skill.iconEmoji ?? "",
    color: skill.color ?? "",
    displayOrder: String(skill.displayOrder)
  };
}

export function validateSkillDraft(draft: SkillDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.nameEn.trim() && !draft.nameRu.trim()) {
    errors.name = "Add at least one Skill name.";
  }
  if (!draft.descriptionEn.trim() && !draft.descriptionRu.trim()) {
    errors.description = "Add at least one short description.";
  }
  if (!draft.category.trim()) {
    errors.category = "Category is required.";
  }
  if (!draft.instructionTitle.trim()) {
    errors.instructionTitle = "Instruction title is required.";
  }
  const instructionBody = draft.instructionBody.trim();
  if (instructionBody.length < 20) {
    errors.instructionBody = "Instruction card body is too short.";
  }
  if (instructionBody.length > 1200) {
    errors.instructionBody = "Instruction card body must stay within 1200 characters.";
  }
  if (draft.displayOrder.trim() && !/^-?\d+$/.test(draft.displayOrder.trim())) {
    errors.displayOrder = "Display order must be a whole number.";
  }
  return errors;
}

export function draftToSkillPayload(draft: SkillDraft): AdminSkillUpsertRequest {
  const errors = validateSkillDraft(draft);
  const firstError = Object.values(errors)[0];
  if (firstError) {
    throw new Error(firstError);
  }
  return {
    name: localizedFromDraft(draft.nameEn, draft.nameRu),
    description: localizedFromDraft(draft.descriptionEn, draft.descriptionRu),
    category: draft.category.trim(),
    tags: draft.tagsText
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    instructionCard: {
      title: draft.instructionTitle.trim(),
      body: draft.instructionBody.trim(),
      guardrails: normalizeLines(draft.guardrailsText),
      examples: normalizeLines(draft.examplesText)
    },
    iconEmoji: draft.iconEmoji.trim() || null,
    color: draft.color.trim() || null,
    displayOrder: draft.displayOrder.trim() ? Number(draft.displayOrder.trim()) : null,
    status: draft.status
  };
}

function draftToAuthoringContext(draft: SkillDraft): Partial<AdminSkillUpsertRequest> {
  const context: Partial<AdminSkillUpsertRequest> = {
    name: localizedFromDraft(draft.nameEn, draft.nameRu),
    description: localizedFromDraft(draft.descriptionEn, draft.descriptionRu),
    tags: draft.tagsText
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    instructionCard: {
      title: draft.instructionTitle.trim(),
      body: draft.instructionBody.trim(),
      guardrails: normalizeLines(draft.guardrailsText),
      examples: normalizeLines(draft.examplesText)
    },
    iconEmoji: draft.iconEmoji.trim() || null,
    color: draft.color.trim() || null
  };
  if (draft.category.trim()) {
    context.category = draft.category.trim();
  }
  return context;
}

function mergeAuthoringProposalIntoDraft(
  current: SkillDraft,
  proposal: SkillAuthoringDraftProposalState
): SkillDraft {
  const proposed = proposal.skillDraft;
  return {
    ...current,
    nameEn: proposed.name?.en ?? current.nameEn,
    nameRu: proposed.name?.ru ?? current.nameRu,
    descriptionEn: proposed.description?.en ?? current.descriptionEn,
    descriptionRu: proposed.description?.ru ?? current.descriptionRu,
    category: proposed.category ?? current.category,
    tagsText: proposed.tags?.length ? proposed.tags.join(", ") : current.tagsText,
    instructionTitle: proposed.instructionCard?.title ?? current.instructionTitle,
    instructionBody: proposed.instructionCard?.body ?? current.instructionBody,
    guardrailsText: proposed.instructionCard?.guardrails?.join("\n") ?? current.guardrailsText,
    examplesText: proposed.instructionCard?.examples?.join("\n") ?? current.examplesText,
    iconEmoji: proposed.iconEmoji ?? current.iconEmoji,
    color: proposed.color ?? current.color,
    status: "draft"
  };
}

function proposedKnowledgeCardToDraft(
  card: SkillAuthoringDraftKnowledgeCardProposal
): SkillKnowledgeCardDraft {
  return {
    id: null,
    title: card.title,
    body: card.body,
    locale: card.locale ?? "",
    tagsText: card.tags.join(", "),
    lifecycleStatus: "draft",
    provenanceKind: "assistant_generated"
  };
}

function normalizeKnowledgeCardIdentity(input: {
  title: string;
  body: string;
  locale: string | null;
}): string {
  return JSON.stringify({
    title: input.title.trim().toLowerCase(),
    body: input.body.trim().toLowerCase(),
    locale: input.locale?.trim().toLowerCase() || null
  });
}

export function filterUnsavedProposedKnowledgeCards(
  proposedCards: SkillAuthoringDraftKnowledgeCardProposal[],
  existingCards: SkillKnowledgeCardState[]
): SkillAuthoringDraftKnowledgeCardProposal[] {
  const seen = new Set(
    existingCards.map((card) =>
      normalizeKnowledgeCardIdentity({
        title: card.title,
        body: card.body,
        locale: card.locale
      })
    )
  );
  const unsaved: SkillAuthoringDraftKnowledgeCardProposal[] = [];
  for (const card of proposedCards) {
    const key = normalizeKnowledgeCardIdentity(card);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unsaved.push(card);
  }
  return unsaved;
}

export function knowledgeCardToDraft(
  card: SkillKnowledgeCardState | null
): SkillKnowledgeCardDraft {
  if (card === null) {
    return { ...EMPTY_KNOWLEDGE_CARD_DRAFT };
  }
  return {
    id: card.id,
    title: card.title,
    body: card.body,
    locale: card.locale ?? "",
    tagsText: card.tags.join(", "),
    lifecycleStatus: card.lifecycleStatus,
    provenanceKind: card.provenanceKind === "assistant_generated" ? "assistant_generated" : "manual"
  };
}

export function validateKnowledgeCardDraft(draft: SkillKnowledgeCardDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.title.trim()) {
    errors.title = "Title is required.";
  }
  if (draft.title.trim().length > 255) {
    errors.title = "Title must stay within 255 characters.";
  }
  if (draft.body.trim().length < 20) {
    errors.body = "Body should contain at least 20 characters.";
  }
  return errors;
}

export function knowledgeCardDraftToPayload(
  draft: SkillKnowledgeCardDraft
): SkillKnowledgeCardInput {
  const firstError = Object.values(validateKnowledgeCardDraft(draft))[0];
  if (firstError) {
    throw new Error(firstError);
  }
  return {
    title: draft.title.trim(),
    body: draft.body.trim(),
    locale: draft.locale.trim() || null,
    tags: draft.tagsText
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    lifecycleStatus: draft.lifecycleStatus,
    provenanceKind: draft.provenanceKind,
    provenanceMetadata: null
  };
}

export function summarizeKnowledgeCards(cards: SkillKnowledgeCardState[]): {
  active: number;
  draft: number;
  stale: number;
  total: number;
} {
  return {
    total: cards.length,
    active: cards.filter((card) => card.lifecycleStatus === "active").length,
    draft: cards.filter((card) => card.lifecycleStatus === "draft").length,
    stale: cards.filter((card) => card.lifecycleStatus === "stale").length
  };
}

export function summarizeSkillReadiness(documents: SkillDocumentState[]): SkillReadinessSummary {
  const ready = documents.filter((document) => document.status === "ready").length;
  const processing = documents.filter((document) => document.status === "processing").length;
  const failed = documents.filter((document) => document.status === "failed").length;
  const needsReview = documents.filter((document) => document.status === "needs_review").length;
  if (documents.length === 0) {
    return { ready, processing, failed, needsReview, label: "instruction-only", tone: "muted" };
  }
  if (failed > 0) {
    return { ready, processing, failed, needsReview, label: `${failed} failed`, tone: "failed" };
  }
  if (needsReview > 0) {
    return {
      ready,
      processing,
      failed,
      needsReview,
      label: `${needsReview} needs review`,
      tone: "warning"
    };
  }
  if (processing > 0) {
    return {
      ready,
      processing,
      failed,
      needsReview,
      label: `${processing} processing`,
      tone: "processing"
    };
  }
  return { ready, processing, failed, needsReview, label: `${ready} ready`, tone: "ready" };
}

export function scenarioToDraft(scenario: AdminSkillScenario | null): ScenarioDraft {
  if (scenario === null) {
    return { ...EMPTY_SCENARIO_DRAFT, steps: [{ ...EMPTY_SCENARIO_STEP_DRAFT }] };
  }
  return {
    key: scenario.key,
    displayNameRu: scenario.displayName.ru ?? "",
    displayNameEn: scenario.displayName.en ?? "",
    descriptionRu: scenario.description.ru ?? "",
    descriptionEn: scenario.description.en ?? "",
    iconEmoji: scenario.iconEmoji ?? "",
    displayOrder: String(scenario.displayOrder),
    status: scenario.status,
    intentExamples: scenario.intentExamples.length > 0 ? scenario.intentExamples : [],
    recommendedTools: scenario.recommendedTools,
    exitCondition: scenario.exitCondition,
    steps: scenario.steps.map((step) => ({
      directive: step.directive,
      recommendedToolCall: step.recommendedToolCall ?? "",
      mayBeSkippedIf: step.mayBeSkippedIf ?? "",
      negativeGuards: step.negativeGuards
    }))
  };
}

export function validateScenarioDraft(draft: ScenarioDraft): {
  errors: Record<string, string>;
  warnings: string[];
} {
  const errors: Record<string, string> = {};
  const warnings: string[] = [];

  if (!SCENARIO_KEY_REGEX.test(draft.key.trim())) {
    errors.key = "Ключ: строчные латинские буквы/цифры/_, начинается с буквы, 2–64 символа.";
  }
  if (!draft.displayNameRu.trim() && !draft.displayNameEn.trim()) {
    errors.displayName = "Добавьте хотя бы одно название (RU или EN).";
  }
  if (!draft.descriptionRu.trim() && !draft.descriptionEn.trim()) {
    errors.description = "Добавьте хотя бы одно описание (RU или EN).";
  }
  if (draft.steps.length === 0) {
    errors.steps = "Необходим хотя бы один шаг.";
  }
  draft.steps.forEach((step, i) => {
    if (!step.directive.trim()) {
      errors[`step_${String(i)}_directive`] =
        `Шаг ${String(i + 1)}: директива не может быть пустой.`;
    }
  });

  const lastStep = draft.steps[draft.steps.length - 1];
  if (
    lastStep !== undefined &&
    !lastStep.directive.includes("skill({") &&
    !lastStep.directive.includes("release")
  ) {
    warnings.push(
      "Рекомендация: последний шаг обычно завершается вызовом skill({ release }) для освобождения сценария."
    );
  }

  return { errors, warnings };
}

export function scenarioDraftToCreatePayload(
  draft: ScenarioDraft
): AdminCreateSkillScenarioRequest {
  const { errors } = validateScenarioDraft(draft);
  const firstError = Object.values(errors)[0];
  if (firstError !== undefined) {
    throw new Error(firstError);
  }
  return {
    key: draft.key.trim(),
    displayName: {
      ...(draft.displayNameRu.trim() ? { ru: draft.displayNameRu.trim() } : {}),
      ...(draft.displayNameEn.trim() ? { en: draft.displayNameEn.trim() } : {})
    },
    description: {
      ...(draft.descriptionRu.trim() ? { ru: draft.descriptionRu.trim() } : {}),
      ...(draft.descriptionEn.trim() ? { en: draft.descriptionEn.trim() } : {})
    },
    iconEmoji: draft.iconEmoji.trim() || null,
    intentExamples: draft.intentExamples.filter(Boolean),
    steps: draft.steps.map((step, index) => ({
      number: index + 1,
      directive: step.directive.trim(),
      recommendedToolCall: step.recommendedToolCall.trim() || null,
      mayBeSkippedIf: step.mayBeSkippedIf.trim() || null,
      negativeGuards: step.negativeGuards.filter(Boolean)
    })),
    recommendedTools: draft.recommendedTools,
    exitCondition: draft.exitCondition.trim(),
    status: draft.status,
    displayOrder: draft.displayOrder.trim() ? Number(draft.displayOrder.trim()) : null
  };
}

export function scenarioDraftToUpdatePayload(
  draft: ScenarioDraft
): AdminUpdateSkillScenarioRequest {
  const { errors } = validateScenarioDraft(draft);
  const firstError = Object.values(errors)[0];
  if (firstError !== undefined) {
    throw new Error(firstError);
  }
  return {
    displayName: {
      ...(draft.displayNameRu.trim() ? { ru: draft.displayNameRu.trim() } : {}),
      ...(draft.displayNameEn.trim() ? { en: draft.displayNameEn.trim() } : {})
    },
    description: {
      ...(draft.descriptionRu.trim() ? { ru: draft.descriptionRu.trim() } : {}),
      ...(draft.descriptionEn.trim() ? { en: draft.descriptionEn.trim() } : {})
    },
    iconEmoji: draft.iconEmoji.trim() || null,
    intentExamples: draft.intentExamples.filter(Boolean),
    steps: draft.steps.map((step, index) => ({
      number: index + 1,
      directive: step.directive.trim(),
      recommendedToolCall: step.recommendedToolCall.trim() || null,
      mayBeSkippedIf: step.mayBeSkippedIf.trim() || null,
      negativeGuards: step.negativeGuards.filter(Boolean)
    })),
    recommendedTools: draft.recommendedTools,
    exitCondition: draft.exitCondition.trim(),
    status: draft.status,
    ...(draft.displayOrder.trim() ? { displayOrder: Number(draft.displayOrder.trim()) } : {})
  };
}

/**
 * Renders the catalog line for a scenario as it appears in the Enabled Skills prompt block.
 * Format mirrors enabled-skills-prompt-materialization.ts renderSkillCard scenario rendering.
 */
export function renderScenarioCatalogLine(draft: ScenarioDraft, locale: "ru" | "en"): string {
  const primary = locale === "ru" ? draft.displayNameRu : draft.displayNameEn;
  const fallback = locale === "ru" ? draft.displayNameEn : draft.displayNameRu;
  const displayName = primary.trim() || fallback.trim() || "(без названия)";

  const primaryDesc = locale === "ru" ? draft.descriptionRu : draft.descriptionEn;
  const fallbackDesc = locale === "ru" ? draft.descriptionEn : draft.descriptionRu;
  const description = primaryDesc.trim() || fallbackDesc.trim() || "";

  const toolsHint =
    draft.recommendedTools.length > 0 ? ` (recommended: ${draft.recommendedTools.join(", ")})` : "";
  const key = draft.key.trim() || "(no-key)";
  return `- ${key}: ${displayName} — ${description}${toolsHint}`;
}

/**
 * Renders the active scenario developer block preview.
 * Intentional duplicate of renderActiveScenarioBlock in
 * apps/runtime/src/modules/turns/build-active-scenario-block.service.ts
 * (private function, not exported). Must stay byte-for-byte identical in format.
 */
export function renderActiveScenarioBlockPreview(
  draft: ScenarioDraft,
  skillDisplayName: string
): string {
  const displayName = draft.displayNameEn.trim() || draft.displayNameRu.trim() || "(без названия)";
  const lines: string[] = [
    `## Active Scenario: ${displayName} (Skill: ${skillDisplayName})`,
    "",
    "Follow steps in order. Do not skip, do not combine, do not respond to the user without making progress on a step.",
    "",
    "Steps:"
  ];

  draft.steps.forEach((step, i) => {
    lines.push(`${String(i + 1)}. ${step.directive.trim() || "(пустая директива)"}`);
    if (step.recommendedToolCall.trim()) {
      lines.push(`   Recommended tool: ${step.recommendedToolCall.trim()}`);
    }
    const guards = step.negativeGuards.filter(Boolean);
    if (guards.length > 0) {
      lines.push(`   Guards: ${guards.map((g) => `Do NOT ${g}`).join(". ")}.`);
    }
  });

  lines.push("", `Exit condition: ${draft.exitCondition.trim() || "(не задано)"}`);
  return lines.join("\n");
}

function statusTone(status: string): string {
  switch (status) {
    case "active":
    case "ready":
      return "border-success/40 bg-success/10 text-success";
    case "processing":
    case "draft":
    case "stale":
      return "border-warning/40 bg-warning/10 text-warning";
    case "needs_review":
      return "border-warning/40 bg-warning/10 text-warning";
    case "failed":
    case "archived":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    default:
      return "border-border bg-background text-text-muted";
  }
}

function readinessTone(tone: SkillReadinessSummary["tone"]): string {
  switch (tone) {
    case "ready":
      return "text-success";
    case "processing":
    case "warning":
      return "text-warning";
    case "failed":
      return "text-destructive";
    default:
      return "text-text-muted";
  }
}

export default function AdminSkillsPage() {
  const { getToken } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scenarioPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [skills, setSkills] = useState<AdminSkillState[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SkillDraft>(() => skillToDraft(null));
  const [documentDraft, setDocumentDraft] = useState<DocumentUploadDraft>({
    displayName: "",
    description: ""
  });
  const [selectedKnowledgeCardId, setSelectedKnowledgeCardId] = useState<string | null>(null);
  const [knowledgeCardDraft, setKnowledgeCardDraft] = useState<SkillKnowledgeCardDraft>(() =>
    knowledgeCardToDraft(null)
  );
  const [authoringPrompt, setAuthoringPrompt] = useState("");
  const [authoringProposal, setAuthoringProposal] =
    useState<SkillAuthoringDraftProposalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingAuthoringDraft, setGeneratingAuthoringDraft] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingKnowledgeCard, setSavingKnowledgeCard] = useState(false);
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);
  const [busyKnowledgeCardId, setBusyKnowledgeCardId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Scenarios state
  const [scenarios, setScenarios] = useState<AdminSkillScenario[]>([]);
  const [loadingScenarios, setLoadingScenarios] = useState(false);
  const [showArchivedScenarios, setShowArchivedScenarios] = useState(false);
  const [selectedScenarioKey, setSelectedScenarioKey] = useState<string | null>(null);
  const [scenarioDraft, setScenarioDraft] = useState<ScenarioDraft>(() => scenarioToDraft(null));
  const [scenarioEditorOpen, setScenarioEditorOpen] = useState(false);
  const [savingScenario, setSavingScenario] = useState(false);
  const [busyScenarioKey, setBusyScenarioKey] = useState<string | null>(null);
  const [scenarioFeedback, setScenarioFeedback] = useState<string | null>(null);
  const [previewLocale, setPreviewLocale] = useState<"ru" | "en">("ru");
  const [debouncedScenarioDraft, setDebouncedScenarioDraft] = useState<ScenarioDraft>(() =>
    scenarioToDraft(null)
  );

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === selectedSkillId) ?? null,
    [selectedSkillId, skills]
  );
  const validationErrors = useMemo(() => validateSkillDraft(draft), [draft]);
  const selectedKnowledgeCard = useMemo(
    () => selectedSkill?.knowledgeCards.find((card) => card.id === selectedKnowledgeCardId) ?? null,
    [selectedKnowledgeCardId, selectedSkill]
  );
  const knowledgeCardValidationErrors = useMemo(
    () => validateKnowledgeCardDraft(knowledgeCardDraft),
    [knowledgeCardDraft]
  );
  const knowledgeCardSummary = useMemo(
    () => summarizeKnowledgeCards(selectedSkill?.knowledgeCards ?? []),
    [selectedSkill]
  );
  const unsavedProposedKnowledgeCards = useMemo(
    () =>
      authoringProposal === null
        ? []
        : filterUnsavedProposedKnowledgeCards(
            authoringProposal.knowledgeCards,
            selectedSkill?.knowledgeCards ?? []
          ),
    [authoringProposal, selectedSkill]
  );

  const scenarioValidation = useMemo(() => validateScenarioDraft(scenarioDraft), [scenarioDraft]);
  const visibleScenarios = useMemo(
    () => (showArchivedScenarios ? scenarios : scenarios.filter((s) => s.status !== "archived")),
    [scenarios, showArchivedScenarios]
  );

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setFeedback("Session expired. Please sign in again.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setFeedback(null);
    try {
      const nextSkills = await getAdminSkills(token);
      setSkills(nextSkills);
      setSelectedSkillId((current) => {
        if (current && nextSkills.some((skill) => skill.id === current)) {
          return current;
        }
        return nextSkills[0]?.id ?? null;
      });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to load Skills.");
    }
    setLoading(false);
  }, [getToken]);

  const loadScenarios = useCallback(
    async (skillId: string) => {
      const token = await getToken();
      if (!token) return;
      setLoadingScenarios(true);
      setScenarioFeedback(null);
      try {
        const res = await getAdminSkillScenarios(
          skillId,
          { includeArchived: "true" },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (res.status === 200) {
          setScenarios([...res.data.scenarios].sort((a, b) => a.displayOrder - b.displayOrder));
        }
      } catch (error) {
        setScenarioFeedback(
          error instanceof Error ? error.message : "Не удалось загрузить сценарии."
        );
      }
      setLoadingScenarios(false);
    },
    [getToken]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setDraft(skillToDraft(selectedSkill));
    setDocumentDraft({ displayName: "", description: "" });
    setSelectedKnowledgeCardId(selectedSkill?.knowledgeCards[0]?.id ?? null);
    setAuthoringPrompt("");
    setAuthoringProposal(null);
  }, [selectedSkill]);

  useEffect(() => {
    setKnowledgeCardDraft(knowledgeCardToDraft(selectedKnowledgeCard));
  }, [selectedKnowledgeCard]);

  useEffect(() => {
    setScenarios([]);
    setScenarioEditorOpen(false);
    setSelectedScenarioKey(null);
    setScenarioDraft(scenarioToDraft(null));
    setScenarioFeedback(null);
    if (selectedSkillId !== null) {
      void loadScenarios(selectedSkillId);
    }
  }, [selectedSkillId, loadScenarios]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedScenarioDraft(scenarioDraft);
    }, 300);
    scenarioPreviewTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
    };
  }, [scenarioDraft]);

  const startCreate = useCallback(() => {
    setSelectedSkillId(null);
    setDraft(skillToDraft(null));
    setSelectedKnowledgeCardId(null);
    setKnowledgeCardDraft(knowledgeCardToDraft(null));
    setFeedback(null);
  }, []);

  const startCreateKnowledgeCard = useCallback(() => {
    setSelectedKnowledgeCardId(null);
    setKnowledgeCardDraft(knowledgeCardToDraft(null));
    setFeedback(null);
  }, []);

  const startCreateScenario = useCallback(() => {
    setSelectedScenarioKey(null);
    setScenarioDraft(scenarioToDraft(null));
    setScenarioEditorOpen(true);
    setScenarioFeedback(null);
  }, []);

  const startEditScenario = useCallback((scenario: AdminSkillScenario) => {
    setSelectedScenarioKey(scenario.key);
    setScenarioDraft(scenarioToDraft(scenario));
    setScenarioEditorOpen(true);
    setScenarioFeedback(null);
  }, []);

  const cancelScenarioEdit = useCallback(() => {
    setScenarioEditorOpen(false);
    setSelectedScenarioKey(null);
    setScenarioDraft(scenarioToDraft(null));
    setScenarioFeedback(null);
  }, []);

  const handleSaveScenario = useCallback(async () => {
    if (selectedSkill === null) return;
    const token = await getToken();
    if (!token) return;
    setSavingScenario(true);
    setScenarioFeedback(null);
    try {
      const authOpts = { headers: { Authorization: `Bearer ${token}` } };
      if (selectedScenarioKey === null) {
        const payload = scenarioDraftToCreatePayload(scenarioDraft);
        await postAdminSkillScenario(selectedSkill.id, payload, authOpts);
        setScenarioFeedback("Сценарий создан.");
      } else {
        const payload = scenarioDraftToUpdatePayload(scenarioDraft);
        await patchAdminSkillScenario(selectedSkill.id, selectedScenarioKey, payload, authOpts);
        setScenarioFeedback("Сценарий сохранён.");
      }
      await loadScenarios(selectedSkill.id);
      setScenarioEditorOpen(false);
      setSelectedScenarioKey(null);
      setScenarioDraft(scenarioToDraft(null));
    } catch (error) {
      setScenarioFeedback(
        error instanceof Error ? error.message : "Не удалось сохранить сценарий."
      );
    }
    setSavingScenario(false);
  }, [getToken, loadScenarios, scenarioDraft, selectedScenarioKey, selectedSkill]);

  const handleScenarioStatusChange = useCallback(
    async (scenarioKey: string, newStatus: SkillScenarioStatus) => {
      if (selectedSkill === null) return;
      const token = await getToken();
      if (!token) return;
      setBusyScenarioKey(scenarioKey);
      setScenarioFeedback(null);
      try {
        const authOpts = { headers: { Authorization: `Bearer ${token}` } };
        if (newStatus === "archived") {
          await deleteAdminSkillScenario(selectedSkill.id, scenarioKey, authOpts);
        } else {
          await patchAdminSkillScenario(
            selectedSkill.id,
            scenarioKey,
            { status: newStatus },
            authOpts
          );
        }
        const label =
          newStatus === "active"
            ? "Сценарий активирован."
            : newStatus === "archived"
              ? "Сценарий архивирован."
              : "Статус сценария обновлён.";
        setScenarioFeedback(label);
        await loadScenarios(selectedSkill.id);
      } catch (error) {
        setScenarioFeedback(
          error instanceof Error ? error.message : "Не удалось изменить статус сценария."
        );
      }
      setBusyScenarioKey(null);
    },
    [getToken, loadScenarios, selectedSkill]
  );

  const handleSave = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setSaving(true);
    setFeedback(null);
    try {
      const payload = draftToSkillPayload(draft);
      const saved =
        draft.id === null
          ? await createAdminSkill(token, payload)
          : await updateAdminSkill(token, draft.id, payload);
      let savedProposedCards = 0;
      let lastSavedCardId: string | null = null;
      if (authoringProposal !== null) {
        const unsavedCards = filterUnsavedProposedKnowledgeCards(
          authoringProposal.knowledgeCards,
          saved.knowledgeCards
        );
        for (const card of unsavedCards) {
          const draftCard = proposedKnowledgeCardToDraft(card);
          const result = await createAdminSkillKnowledgeCard(
            token,
            saved.id,
            knowledgeCardDraftToPayload(draftCard)
          );
          savedProposedCards += 1;
          lastSavedCardId = result.card.id;
        }
      }
      setFeedback(
        savedProposedCards > 0
          ? `${draft.id === null ? "Skill created" : "Skill saved"} and ${savedProposedCards} proposed draft card(s) saved.`
          : draft.id === null
            ? "Skill created."
            : "Skill saved."
      );
      await load();
      setSelectedSkillId(saved.id);
      if (lastSavedCardId !== null) {
        setSelectedKnowledgeCardId(lastSavedCardId);
        setAuthoringProposal(null);
        setKnowledgeCardDraft(knowledgeCardToDraft(null));
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Save failed.");
    }
    setSaving(false);
  }, [authoringProposal, draft, getToken, load]);

  const handleGenerateAuthoringDraft = useCallback(async () => {
    if (selectedSkill === null) return;
    const token = await getToken();
    if (!token) return;
    setGeneratingAuthoringDraft(true);
    setFeedback(null);
    try {
      const proposal = await generateAdminSkillAuthoringDraft(token, selectedSkill.id, {
        prompt: authoringPrompt.trim() || null,
        currentDraft: draftToAuthoringContext(draft)
      });
      setDraft((current) => mergeAuthoringProposalIntoDraft(current, proposal));
      setAuthoringProposal(proposal);
      if (proposal.knowledgeCards[0]) {
        setSelectedKnowledgeCardId(null);
        setKnowledgeCardDraft(proposedKnowledgeCardToDraft(proposal.knowledgeCards[0]));
      }
      setFeedback(
        proposal.knowledgeCards.length > 0
          ? `Assistant filled draft fields and proposed ${proposal.knowledgeCards.length} draft knowledge card(s). Review and save manually.`
          : "Assistant filled draft fields. Review and save manually."
      );
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Skill authoring draft generation failed."
      );
    }
    setGeneratingAuthoringDraft(false);
  }, [authoringPrompt, draft, getToken, selectedSkill]);

  const handleArchive = useCallback(async () => {
    if (selectedSkill === null) return;
    const token = await getToken();
    if (!token) return;
    setSaving(true);
    setFeedback(null);
    try {
      await archiveAdminSkill(token, selectedSkill.id);
      setFeedback("Skill archived.");
      await load();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Archive failed.");
    }
    setSaving(false);
  }, [getToken, load, selectedSkill]);

  const handleUploadDocuments = useCallback(
    async (files: FileList | null) => {
      if (selectedSkill === null) return;
      const selected = Array.from(files ?? []);
      if (selected.length === 0) return;
      const token = await getToken();
      if (!token) return;
      setUploading(true);
      setFeedback(null);
      try {
        for (const file of selected) {
          await uploadAdminSkillDocument(token, selectedSkill.id, file, {
            displayName: documentDraft.displayName,
            description: documentDraft.description
          });
        }
        setDocumentDraft({ displayName: "", description: "" });
        setFeedback("Skill document queued for processing.");
        await load();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Upload failed.");
      }
      setUploading(false);
    },
    [documentDraft.description, documentDraft.displayName, getToken, load, selectedSkill]
  );

  const handleDeleteDocument = useCallback(
    async (documentId: string) => {
      if (selectedSkill === null) return;
      const token = await getToken();
      if (!token) return;
      setBusyDocumentId(documentId);
      setFeedback(null);
      try {
        await deleteAdminSkillDocument(token, selectedSkill.id, documentId);
        setFeedback("Skill document deleted.");
        await load();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Delete failed.");
      }
      setBusyDocumentId(null);
    },
    [getToken, load, selectedSkill]
  );

  const handleReindexDocument = useCallback(
    async (documentId: string) => {
      if (selectedSkill === null) return;
      const token = await getToken();
      if (!token) return;
      setBusyDocumentId(documentId);
      setFeedback(null);
      try {
        await reindexAdminSkillDocument(token, selectedSkill.id, documentId);
        setFeedback("Skill document reindex queued.");
        await load();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Reindex failed.");
      }
      setBusyDocumentId(null);
    },
    [getToken, load, selectedSkill]
  );

  const handleSaveKnowledgeCard = useCallback(async () => {
    if (selectedSkill === null) return;
    const token = await getToken();
    if (!token) return;
    setSavingKnowledgeCard(true);
    setFeedback(null);
    try {
      const payload = knowledgeCardDraftToPayload(knowledgeCardDraft);
      const saved =
        knowledgeCardDraft.id === null
          ? await createAdminSkillKnowledgeCard(token, selectedSkill.id, payload)
          : await updateAdminSkillKnowledgeCard(
              token,
              selectedSkill.id,
              knowledgeCardDraft.id,
              payload
            );
      setFeedback(
        saved.indexingJob
          ? "Skill knowledge card saved and queued for indexing."
          : "Skill knowledge card saved as non-runtime draft."
      );
      await load();
      setSelectedKnowledgeCardId(saved.card.id);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Knowledge card save failed.");
    }
    setSavingKnowledgeCard(false);
  }, [getToken, knowledgeCardDraft, load, selectedSkill]);

  const handleSaveProposedKnowledgeCards = useCallback(async () => {
    if (selectedSkill === null || authoringProposal === null) return;
    const token = await getToken();
    if (!token) return;
    const unsavedCards = filterUnsavedProposedKnowledgeCards(
      authoringProposal.knowledgeCards,
      selectedSkill.knowledgeCards
    );
    if (unsavedCards.length === 0) {
      setFeedback("No new proposed cards to save.");
      setAuthoringProposal(null);
      return;
    }
    setSavingKnowledgeCard(true);
    setFeedback(null);
    try {
      let lastSavedCardId: string | null = null;
      for (const card of unsavedCards) {
        const draftCard = proposedKnowledgeCardToDraft(card);
        const result = await createAdminSkillKnowledgeCard(
          token,
          selectedSkill.id,
          knowledgeCardDraftToPayload(draftCard)
        );
        lastSavedCardId = result.card.id;
      }
      setFeedback(`${unsavedCards.length} proposed draft card(s) saved.`);
      await load();
      setAuthoringProposal(null);
      if (lastSavedCardId !== null) {
        setSelectedKnowledgeCardId(lastSavedCardId);
      }
      setKnowledgeCardDraft(knowledgeCardToDraft(null));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Proposed card save failed.");
    }
    setSavingKnowledgeCard(false);
  }, [authoringProposal, getToken, load, selectedSkill]);

  const handleArchiveKnowledgeCard = useCallback(
    async (cardId: string) => {
      if (selectedSkill === null) return;
      const token = await getToken();
      if (!token) return;
      setBusyKnowledgeCardId(cardId);
      setFeedback(null);
      try {
        await archiveAdminSkillKnowledgeCard(token, selectedSkill.id, cardId);
        setFeedback("Skill knowledge card archived.");
        await load();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Knowledge card archive failed.");
      }
      setBusyKnowledgeCardId(null);
    },
    [getToken, load, selectedSkill]
  );

  const handleReindexKnowledgeCard = useCallback(
    async (cardId: string) => {
      if (selectedSkill === null) return;
      const token = await getToken();
      if (!token) return;
      setBusyKnowledgeCardId(cardId);
      setFeedback(null);
      try {
        await reindexAdminSkillKnowledgeCard(token, selectedSkill.id, cardId);
        setFeedback("Skill knowledge card reindex queued.");
        await load();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Knowledge card reindex failed.");
      }
      setBusyKnowledgeCardId(null);
    },
    [getToken, load, selectedSkill]
  );

  const readySkills = skills.filter((skill) => skill.status === "active").length;
  const documentCount = skills.reduce((sum, skill) => sum + skill.documents.length, 0);
  const knowledgeCardCount = skills.reduce((sum, skill) => sum + skill.knowledgeCards.length, 0);

  return (
    <div className="w-full space-y-3 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-accent" />
          <div>
            <h1 className="text-sm font-bold tracking-tight text-text">Skills</h1>
            <p className="text-xs text-text-muted">
              Admin-created professional Skills with instruction cards and indexed documents.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={startCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover"
        >
          <Plus className="h-3.5 w-3.5" />
          New Skill
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard
          label="Total Skills"
          value={String(skills.length)}
          detail={`${readySkills} active`}
        />
        <MetricCard
          label="Skill documents"
          value={String(documentCount)}
          detail={`${knowledgeCardCount} curated cards`}
        />
        <MetricCard
          label="Current editor"
          value={draft.id === null ? "New" : draft.status}
          detail={draft.id === null ? "Draft not saved yet" : "Persisted Skill"}
        />
      </div>

      {feedback && (
        <div className="rounded-xl border border-border bg-surface p-3 text-xs text-text-muted">
          {feedback}
        </div>
      )}

      <div className="grid items-start gap-3 lg:grid-cols-[360px_1fr]">
        <div className="flex max-h-[70vh] min-h-[28rem] w-full min-w-0 flex-col rounded-xl border border-border/70 bg-surface lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)]">
          <div className="flex items-center justify-between gap-2 border-b border-border/70 p-3">
            <div>
              <h2 className="text-xs font-semibold text-text">Skills catalog</h2>
              <p className="text-[11px] text-text-muted">Admin-curated platform catalog.</p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] text-text-muted hover:text-text disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading Skills...
              </div>
            ) : skills.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-4 text-xs text-text-muted">
                No Skills yet. Create the first real Skill manually.
              </div>
            ) : (
              skills.map((skill) => {
                const readiness = summarizeSkillReadiness(skill.documents);
                const selected = skill.id === selectedSkillId;
                return (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => setSelectedSkillId(skill.id)}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      selected
                        ? "border-accent bg-accent/10"
                        : "border-border/70 bg-background hover:border-border-strong"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-text">
                          {skill.iconEmoji ? `${skill.iconEmoji} ` : ""}
                          {preferredText(skill.name)}
                        </p>
                        <p className="mt-1 line-clamp-2 text-[11px] text-text-muted">
                          {preferredText(skill.description, "No description")}
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${statusTone(skill.status)}`}
                      >
                        {skill.status}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-text-subtle">
                      <span>{skill.category}</span>
                      <span>{skill.tags.length} tags</span>
                      <span>{skill.knowledgeCards.length} cards</span>
                      <span className={readinessTone(readiness.tone)}>{readiness.label}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-3">
          <section className="rounded-xl border border-border/70 bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xs font-semibold text-text">
                  {draft.id === null ? "Create Skill" : "Edit Skill"}
                </h2>
                <p className="text-[11px] text-text-muted">
                  Instruction cards stay concise. Long professional material belongs in documents.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedSkill && selectedSkill.status !== "archived" && (
                  <button
                    type="button"
                    onClick={() => void handleArchive()}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive hover:bg-destructive/15 disabled:opacity-50"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    Archive
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || Object.keys(validationErrors).length > 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Save
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-dashed border-accent/30 bg-accent/5 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-xs font-semibold text-text">Собрать с помощью агента</h3>
                  <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-text-muted">
                    Fills editable draft fields and proposes draft cards. Proposed cards are saved
                    as draft Knowledge only when an admin presses Save.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={selectedSkill === null || generatingAuthoringDraft}
                  onClick={() => void handleGenerateAuthoringDraft()}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {generatingAuthoringDraft ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Fill draft
                </button>
              </div>
              <textarea
                value={authoringPrompt}
                onChange={(event) => setAuthoringPrompt(event.target.value)}
                className={`${FIELD_CLASS} mt-3 min-h-20 resize-y`}
                placeholder="Optional admin instructions: target profession, audience, locale, constraints, or facts to preserve."
              />
              <p className="mt-2 text-[11px] text-text-subtle">
                Model is configured in Admin &gt; Knowledge as the Authoring agent model.
              </p>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label="Name EN" error={validationErrors.name}>
                <input
                  value={draft.nameEn}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, nameEn: event.target.value }))
                  }
                  className={FIELD_CLASS}
                  placeholder="Accountant"
                />
              </Field>
              <Field label="Name RU">
                <input
                  value={draft.nameRu}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, nameRu: event.target.value }))
                  }
                  className={FIELD_CLASS}
                  placeholder="Бухгалтер"
                />
              </Field>
              <Field label="Description EN" error={validationErrors.description}>
                <input
                  value={draft.descriptionEn}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, descriptionEn: event.target.value }))
                  }
                  className={FIELD_CLASS}
                  placeholder="Accounting and tax support"
                />
              </Field>
              <Field label="Description RU">
                <input
                  value={draft.descriptionRu}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, descriptionRu: event.target.value }))
                  }
                  className={FIELD_CLASS}
                  placeholder="Помощь с бухгалтерией и налогами"
                />
              </Field>
              <Field label="Group" error={validationErrors.category}>
                <select
                  value={draft.category}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, category: event.target.value }))
                  }
                  className={FIELD_CLASS}
                >
                  {SKILL_GROUP_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tags">
                <input
                  value={draft.tagsText}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, tagsText: event.target.value }))
                  }
                  className={FIELD_CLASS}
                  placeholder="tax, reports, bookkeeping"
                />
              </Field>
              <Field label="Status">
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      status: event.target.value as SkillDraft["status"]
                    }))
                  }
                  className={FIELD_CLASS}
                >
                  <option value="draft">draft</option>
                  <option value="active">active</option>
                  <option value="archived">archived</option>
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Icon">
                  <input
                    value={draft.iconEmoji}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, iconEmoji: event.target.value }))
                    }
                    className={FIELD_CLASS}
                    placeholder="A"
                  />
                </Field>
                <Field label="Order" error={validationErrors.displayOrder}>
                  <input
                    value={draft.displayOrder}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, displayOrder: event.target.value }))
                    }
                    className={FIELD_CLASS}
                    inputMode="numeric"
                  />
                </Field>
              </div>
            </div>

            <div className="mt-3 space-y-3">
              <Field label="Instruction title" error={validationErrors.instructionTitle}>
                <input
                  value={draft.instructionTitle}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, instructionTitle: event.target.value }))
                  }
                  className={FIELD_CLASS}
                />
              </Field>
              <Field
                label={`Instruction body (${draft.instructionBody.trim().length}/1200)`}
                error={validationErrors.instructionBody}
              >
                <textarea
                  value={draft.instructionBody}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, instructionBody: event.target.value }))
                  }
                  rows={6}
                  className={`${FIELD_CLASS} resize-y`}
                />
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Guardrails, one per line">
                  <textarea
                    value={draft.guardrailsText}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, guardrailsText: event.target.value }))
                    }
                    rows={4}
                    className={`${FIELD_CLASS} resize-y`}
                  />
                </Field>
                <Field label="Examples, one per line">
                  <textarea
                    value={draft.examplesText}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, examplesText: event.target.value }))
                    }
                    rows={4}
                    className={`${FIELD_CLASS} resize-y`}
                  />
                </Field>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border/70 bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xs font-semibold text-text">Skill knowledge cards</h2>
                <p className="text-[11px] text-text-muted">
                  Curated short Knowledge attached to this Skill. Active cards index through
                  ADR-079.
                </p>
              </div>
              <button
                type="button"
                disabled={selectedSkill === null}
                onClick={startCreateKnowledgeCard}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-[11px] text-text-muted hover:text-text disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                New card
              </button>
            </div>

            {authoringProposal?.knowledgeCards.length ? (
              <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-semibold text-text">Assistant-proposed cards</h3>
                    <p className="text-[11px] text-text-muted">
                      Draft proposals only. Save all as draft Knowledge, or pick one to edit before
                      saving.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-background px-2 py-0.5 text-[10px] text-text-muted">
                      {authoringProposal.providerKey}:{authoringProposal.modelKey}
                    </span>
                    <button
                      type="button"
                      disabled={
                        selectedSkill === null ||
                        savingKnowledgeCard ||
                        unsavedProposedKnowledgeCards.length === 0
                      }
                      onClick={() => void handleSaveProposedKnowledgeCards()}
                      className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                    >
                      {savingKnowledgeCard ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Save className="h-3 w-3" />
                      )}
                      Save all proposed
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {authoringProposal.knowledgeCards.map((card, index) => (
                    <button
                      key={`${card.title}-${index}`}
                      type="button"
                      onClick={() => {
                        setSelectedKnowledgeCardId(null);
                        setKnowledgeCardDraft(proposedKnowledgeCardToDraft(card));
                      }}
                      className="rounded-xl border border-border/70 bg-background p-3 text-left hover:border-border-strong"
                    >
                      <p className="text-xs font-medium text-text">{card.title}</p>
                      <p className="mt-1 line-clamp-3 text-[11px] text-text-muted">{card.body}</p>
                      <p className="mt-2 text-[10px] text-text-subtle">
                        {card.locale ?? "any locale"} · {card.tags.join(", ") || "no tags"}
                      </p>
                    </button>
                  ))}
                </div>
                {authoringProposal.warnings.length ? (
                  <div className="mt-3 space-y-1 text-[11px] text-warning">
                    {authoringProposal.warnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {selectedSkill === null ? (
              <div className="mt-4 rounded-xl border border-dashed border-border p-4 text-xs text-text-muted">
                Save or select a Skill before adding knowledge cards.
              </div>
            ) : (
              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className="max-h-[26rem] space-y-2 overflow-y-auto rounded-xl border border-border/60 bg-background p-3">
                  <div className="flex flex-wrap gap-2 text-[10px]">
                    <span className="rounded-full bg-surface px-2 py-0.5 text-text-muted">
                      {knowledgeCardSummary.active} active
                    </span>
                    <span className="rounded-full bg-surface px-2 py-0.5 text-text-muted">
                      {knowledgeCardSummary.draft} draft
                    </span>
                    <span className="rounded-full bg-surface px-2 py-0.5 text-text-muted">
                      {knowledgeCardSummary.stale} stale
                    </span>
                  </div>
                  {selectedSkill.knowledgeCards.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-4 text-xs text-text-muted">
                      No cards yet. Add concise approved knowledge that does not need a full file.
                    </div>
                  ) : (
                    selectedSkill.knowledgeCards.map((card) => {
                      const selected = card.id === selectedKnowledgeCardId;
                      const busy = busyKnowledgeCardId === card.id;
                      return (
                        <button
                          key={card.id}
                          type="button"
                          onClick={() => setSelectedKnowledgeCardId(card.id)}
                          className={`w-full rounded-xl border p-3 text-left transition-colors ${
                            selected
                              ? "border-accent bg-accent/10"
                              : "border-border/70 bg-surface hover:border-border-strong"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-text">{card.title}</p>
                              <p className="mt-1 line-clamp-2 text-[11px] text-text-muted">
                                {card.body}
                              </p>
                            </div>
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" />
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                            <span
                              className={`rounded-full border px-2 py-0.5 ${statusTone(card.lifecycleStatus)}`}
                            >
                              {card.lifecycleStatus}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 ${statusTone(card.status)}`}
                            >
                              {card.status}
                            </span>
                            <span className="rounded-full bg-background px-2 py-0.5 text-text-muted">
                              {card.chunkCount} chunks
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
                <div className="rounded-xl border border-border/60 bg-background p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-semibold text-text">
                        {knowledgeCardDraft.id === null ? "Create card" : "Edit card"}
                      </h3>
                      <p className="text-[11px] text-text-muted">
                        Save draft first; activate only after admin review.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {knowledgeCardDraft.id !== null &&
                      selectedKnowledgeCard?.lifecycleStatus === "active" ? (
                        <button
                          type="button"
                          disabled={busyKnowledgeCardId === knowledgeCardDraft.id}
                          onClick={() =>
                            void handleReindexKnowledgeCard(knowledgeCardDraft.id as string)
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] text-text-muted hover:text-text disabled:opacity-50"
                        >
                          {busyKnowledgeCardId === knowledgeCardDraft.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3" />
                          )}
                          Reindex
                        </button>
                      ) : null}
                      {knowledgeCardDraft.id !== null ? (
                        <button
                          type="button"
                          disabled={busyKnowledgeCardId === knowledgeCardDraft.id}
                          onClick={() =>
                            void handleArchiveKnowledgeCard(knowledgeCardDraft.id as string)
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive hover:bg-destructive/15 disabled:opacity-50"
                        >
                          <Archive className="h-3 w-3" />
                          Archive
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={
                          savingKnowledgeCard ||
                          Object.keys(knowledgeCardValidationErrors).length > 0
                        }
                        onClick={() => void handleSaveKnowledgeCard()}
                        className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                      >
                        {savingKnowledgeCard ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Save className="h-3 w-3" />
                        )}
                        Save
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <Field label="Title" error={knowledgeCardValidationErrors.title}>
                      <input
                        value={knowledgeCardDraft.title}
                        onChange={(event) =>
                          setKnowledgeCardDraft((prev) => ({
                            ...prev,
                            title: event.target.value
                          }))
                        }
                        className={FIELD_CLASS}
                        placeholder="Bring-up checklist"
                      />
                    </Field>
                    <Field label="Lifecycle">
                      <select
                        value={knowledgeCardDraft.lifecycleStatus}
                        onChange={(event) =>
                          setKnowledgeCardDraft((prev) => ({
                            ...prev,
                            lifecycleStatus: event.target
                              .value as SkillKnowledgeCardDraft["lifecycleStatus"]
                          }))
                        }
                        className={FIELD_CLASS}
                      >
                        <option value="draft">draft</option>
                        <option value="active">active</option>
                        <option value="stale">stale</option>
                        <option value="archived">archived</option>
                      </select>
                    </Field>
                    <Field label="Locale">
                      <select
                        value={knowledgeCardDraft.locale}
                        onChange={(event) =>
                          setKnowledgeCardDraft((prev) => ({
                            ...prev,
                            locale: event.target.value
                          }))
                        }
                        className={FIELD_CLASS}
                      >
                        {KNOWLEDGE_LOCALE_OPTIONS.map((option) => (
                          <option key={option.value || "any"} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Tags">
                      <input
                        value={knowledgeCardDraft.tagsText}
                        onChange={(event) =>
                          setKnowledgeCardDraft((prev) => ({
                            ...prev,
                            tagsText: event.target.value
                          }))
                        }
                        className={FIELD_CLASS}
                        placeholder="checklist, safety"
                      />
                    </Field>
                    <div className="md:col-span-2">
                      <Field
                        label={`Body (${knowledgeCardDraft.body.trim().length} chars)`}
                        error={knowledgeCardValidationErrors.body}
                      >
                        <textarea
                          value={knowledgeCardDraft.body}
                          onChange={(event) =>
                            setKnowledgeCardDraft((prev) => ({
                              ...prev,
                              body: event.target.value
                            }))
                          }
                          rows={8}
                          className={`${FIELD_CLASS} resize-y`}
                          placeholder="Write concise professional knowledge for this Skill."
                        />
                      </Field>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border/70 bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xs font-semibold text-text">Skill documents</h2>
                <p className="text-[11px] text-text-muted">
                  Uploads are queued through DB-backed indexing jobs.
                </p>
              </div>
              <button
                type="button"
                disabled={selectedSkill === null || uploading}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-[11px] text-text-muted hover:text-text disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                Upload documents
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  void handleUploadDocuments(event.target.files);
                  event.target.value = "";
                }}
              />
            </div>

            {selectedSkill === null ? (
              <div className="mt-4 rounded-xl border border-dashed border-border p-4 text-xs text-text-muted">
                Save or select a Skill before uploading documents.
              </div>
            ) : (
              <>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <Field label="Upload display name">
                    <input
                      value={documentDraft.displayName}
                      onChange={(event) =>
                        setDocumentDraft((prev) => ({
                          ...prev,
                          displayName: event.target.value
                        }))
                      }
                      className={FIELD_CLASS}
                      placeholder="Defaults to file name"
                    />
                  </Field>
                  <Field label="Upload description">
                    <input
                      value={documentDraft.description}
                      onChange={(event) =>
                        setDocumentDraft((prev) => ({
                          ...prev,
                          description: event.target.value
                        }))
                      }
                      className={FIELD_CLASS}
                      placeholder="Optional source note"
                    />
                  </Field>
                </div>
                <div className="mt-4 space-y-2">
                  {selectedSkill.documents.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-4 text-xs text-text-muted">
                      This Skill is instruction-only until documents are uploaded and indexed.
                    </div>
                  ) : (
                    selectedSkill.documents.map((document) => (
                      <SkillDocumentRow
                        key={document.id}
                        document={document}
                        busy={busyDocumentId === document.id}
                        onDelete={() => void handleDeleteDocument(document.id)}
                        onReindex={() => void handleReindexDocument(document.id)}
                      />
                    ))
                  )}
                </div>
              </>
            )}
          </section>

          <section className="rounded-xl border border-border/70 bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xs font-semibold text-text">Сценарии</h2>
                <p className="text-[11px] text-text-muted">
                  Структурированные рабочие процессы для этого Навыка. Только{" "}
                  <span className="font-medium text-success">активные</span> сценарии видны модели.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowArchivedScenarios((prev) => !prev)}
                  className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] text-text-muted hover:text-text"
                >
                  {showArchivedScenarios ? "Скрыть архив" : "Показать архив"}
                </button>
                <button
                  type="button"
                  disabled={selectedSkill === null}
                  onClick={startCreateScenario}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-[11px] text-text-muted hover:text-text disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Создать сценарий
                </button>
              </div>
            </div>

            {scenarioFeedback !== null && (
              <div className="mt-3 rounded-xl border border-border bg-surface p-3 text-xs text-text-muted">
                {scenarioFeedback}
              </div>
            )}

            {selectedSkill === null ? (
              <div className="mt-4 rounded-xl border border-dashed border-border p-4 text-xs text-text-muted">
                Выберите или сохраните Навык перед добавлением сценариев.
              </div>
            ) : loadingScenarios ? (
              <div className="mt-4 flex items-center gap-2 text-xs text-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Загрузка сценариев...
              </div>
            ) : (
              <>
                {visibleScenarios.length === 0 && !scenarioEditorOpen ? (
                  <div className="mt-4 rounded-xl border border-dashed border-border p-4 text-xs text-text-muted">
                    Сценариев пока нет. Создайте первый.
                  </div>
                ) : (
                  <div className="mt-4 space-y-2">
                    {visibleScenarios.map((scenario) => {
                      const busy = busyScenarioKey === scenario.key;
                      const isEditing = selectedScenarioKey === scenario.key && scenarioEditorOpen;
                      const displayName =
                        scenario.displayName.ru ??
                        scenario.displayName.en ??
                        Object.values(scenario.displayName)[0] ??
                        scenario.key;
                      return (
                        <div
                          key={scenario.key}
                          className={`rounded-xl border p-3 transition-colors ${
                            isEditing
                              ? "border-accent bg-accent/10"
                              : "border-border/70 bg-background"
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => startEditScenario(scenario)}
                              className="min-w-0 text-left"
                            >
                              <p className="text-sm font-semibold text-text">
                                {scenario.iconEmoji ? `${scenario.iconEmoji} ` : ""}
                                {displayName}
                              </p>
                              <p className="mt-0.5 text-[11px] text-text-muted">{scenario.key}</p>
                            </button>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] ${statusTone(scenario.status)}`}
                              >
                                {scenario.status}
                              </span>
                              {busy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" />
                              ) : (
                                <>
                                  {scenario.status === "draft" && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleScenarioStatusChange(scenario.key, "active")
                                      }
                                      className="rounded-lg border border-success/40 bg-success/10 px-2 py-1 text-[10px] text-success hover:bg-success/15"
                                    >
                                      Активировать
                                    </button>
                                  )}
                                  {scenario.status === "active" && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleScenarioStatusChange(scenario.key, "archived")
                                      }
                                      className="rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1 text-[10px] text-destructive hover:bg-destructive/15"
                                    >
                                      Архивировать
                                    </button>
                                  )}
                                  {scenario.status === "archived" && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleScenarioStatusChange(scenario.key, "active")
                                      }
                                      className="rounded-lg border border-success/40 bg-success/10 px-2 py-1 text-[10px] text-success hover:bg-success/15"
                                    >
                                      Восстановить
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-text-subtle">
                            <span>{scenario.steps.length} шаг(ов)</span>
                            {scenario.recommendedTools.length > 0 && (
                              <span>{scenario.recommendedTools.join(", ")}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {scenarioEditorOpen && (
                  <div className="mt-4 rounded-xl border border-border/60 bg-background p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-xs font-semibold text-text">
                          {selectedScenarioKey === null
                            ? "Создать сценарий"
                            : "Редактировать сценарий"}
                        </h3>
                        {selectedScenarioKey !== null && (
                          <p className="text-[11px] text-text-muted">
                            Ключ: <span className="font-mono text-text">{selectedScenarioKey}</span>{" "}
                            (неизменяем)
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={cancelScenarioEdit}
                          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[11px] text-text-muted hover:text-text"
                        >
                          Отмена
                        </button>
                        <button
                          type="button"
                          disabled={
                            savingScenario || Object.keys(scenarioValidation.errors).length > 0
                          }
                          onClick={() => void handleSaveScenario()}
                          className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                        >
                          {savingScenario ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          Сохранить
                        </button>
                      </div>
                    </div>

                    {Object.keys(scenarioValidation.errors).length > 0 && (
                      <div className="mt-3 space-y-1">
                        {Object.values(scenarioValidation.errors).map((err) => (
                          <p key={err} className="text-[11px] text-destructive">
                            {err}
                          </p>
                        ))}
                      </div>
                    )}
                    {scenarioValidation.warnings.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {scenarioValidation.warnings.map((w) => (
                          <p key={w} className="text-[11px] text-warning">
                            ⚠ {w}
                          </p>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {selectedScenarioKey === null ? (
                        <Field label="Ключ (slug)" error={scenarioValidation.errors.key}>
                          <input
                            value={scenarioDraft.key}
                            onChange={(e) =>
                              setScenarioDraft((prev) => ({ ...prev, key: e.target.value }))
                            }
                            className={FIELD_CLASS}
                            placeholder="instagram_carousel"
                          />
                          <span className="block text-[10px] text-text-subtle">
                            Строчные буквы, цифры, _, 2–64 символа. Неизменяем после создания.
                          </span>
                        </Field>
                      ) : (
                        <Field label="Ключ">
                          <p className={`${FIELD_CLASS} select-all font-mono opacity-60`}>
                            {selectedScenarioKey}
                          </p>
                        </Field>
                      )}
                      <Field label="Статус">
                        <select
                          value={scenarioDraft.status}
                          onChange={(e) =>
                            setScenarioDraft((prev) => ({
                              ...prev,
                              status: e.target.value as SkillScenarioStatus
                            }))
                          }
                          className={FIELD_CLASS}
                        >
                          <option value="draft">draft</option>
                          <option value="active">active</option>
                          <option value="archived">archived</option>
                        </select>
                      </Field>
                      <Field label="Название RU" error={scenarioValidation.errors.displayName}>
                        <input
                          value={scenarioDraft.displayNameRu}
                          onChange={(e) =>
                            setScenarioDraft((prev) => ({
                              ...prev,
                              displayNameRu: e.target.value
                            }))
                          }
                          className={FIELD_CLASS}
                          placeholder="Карусель Instagram"
                        />
                      </Field>
                      <Field label="Название EN">
                        <input
                          value={scenarioDraft.displayNameEn}
                          onChange={(e) =>
                            setScenarioDraft((prev) => ({
                              ...prev,
                              displayNameEn: e.target.value
                            }))
                          }
                          className={FIELD_CLASS}
                          placeholder="Instagram Carousel"
                        />
                      </Field>
                      <Field
                        label="Описание RU (1–2 предложения)"
                        error={scenarioValidation.errors.description}
                      >
                        <textarea
                          value={scenarioDraft.descriptionRu}
                          onChange={(e) =>
                            setScenarioDraft((prev) => ({
                              ...prev,
                              descriptionRu: e.target.value
                            }))
                          }
                          rows={2}
                          className={`${FIELD_CLASS} resize-y`}
                          placeholder="8 слайдов с изображениями через image_generate series"
                        />
                      </Field>
                      <Field label="Описание EN (1–2 sentences)">
                        <textarea
                          value={scenarioDraft.descriptionEn}
                          onChange={(e) =>
                            setScenarioDraft((prev) => ({
                              ...prev,
                              descriptionEn: e.target.value
                            }))
                          }
                          rows={2}
                          className={`${FIELD_CLASS} resize-y`}
                          placeholder="8-slide carousel via image_generate series"
                        />
                      </Field>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Иконка (эмодзи)">
                          <input
                            value={scenarioDraft.iconEmoji}
                            onChange={(e) =>
                              setScenarioDraft((prev) => ({
                                ...prev,
                                iconEmoji: e.target.value
                              }))
                            }
                            className={FIELD_CLASS}
                            placeholder="🎨"
                          />
                        </Field>
                        <Field label="Порядок">
                          <input
                            value={scenarioDraft.displayOrder}
                            onChange={(e) =>
                              setScenarioDraft((prev) => ({
                                ...prev,
                                displayOrder: e.target.value
                              }))
                            }
                            className={FIELD_CLASS}
                            inputMode="numeric"
                          />
                        </Field>
                      </div>
                    </div>

                    <div className="mt-3">
                      <Field label="Условие выхода (exit condition)">
                        <textarea
                          value={scenarioDraft.exitCondition}
                          onChange={(e) =>
                            setScenarioDraft((prev) => ({
                              ...prev,
                              exitCondition: e.target.value
                            }))
                          }
                          rows={2}
                          className={`${FIELD_CLASS} resize-y`}
                          placeholder="После подтверждения пользователем всех изображений вызовите skill({ release })."
                        />
                      </Field>
                    </div>

                    <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-text-muted">
                          Примеры намерений (intent examples){" "}
                          <span className="text-text-subtle">
                            ({scenarioDraft.intentExamples.length}/10)
                          </span>
                        </span>
                        <button
                          type="button"
                          disabled={scenarioDraft.intentExamples.length >= 10}
                          onClick={() =>
                            setScenarioDraft((prev) => ({
                              ...prev,
                              intentExamples: [...prev.intentExamples, ""]
                            }))
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-[10px] text-text-muted hover:text-text disabled:opacity-50"
                        >
                          <Plus className="h-3 w-3" />
                          Добавить
                        </button>
                      </div>
                      <p className="mb-2 text-[10px] text-text-subtle">
                        Рекомендуется 3–5. Подсказки для модели — не для лексического матчинга.
                      </p>
                      <div className="space-y-1.5">
                        {scenarioDraft.intentExamples.map((example, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input
                              value={example}
                              onChange={(e) =>
                                setScenarioDraft((prev) => {
                                  const next = [...prev.intentExamples];
                                  next[idx] = e.target.value;
                                  return { ...prev, intentExamples: next };
                                })
                              }
                              className={FIELD_CLASS}
                              placeholder={`Пример ${String(idx + 1)}`}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setScenarioDraft((prev) => ({
                                  ...prev,
                                  intentExamples: prev.intentExamples.filter((_, i) => i !== idx)
                                }))
                              }
                              className="rounded-lg border border-destructive/40 bg-destructive/10 p-1.5 text-destructive hover:bg-destructive/15"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4">
                      <span className="text-[11px] font-medium text-text-muted">
                        Рекомендуемые инструменты
                      </span>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {NATIVE_SCENARIO_TOOL_KEYS.map((toolKey) => {
                          const checked = scenarioDraft.recommendedTools.includes(toolKey);
                          return (
                            <label
                              key={toolKey}
                              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[10px] text-text-muted hover:border-border-strong"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setScenarioDraft((prev) => ({
                                    ...prev,
                                    recommendedTools: e.target.checked
                                      ? [...prev.recommendedTools, toolKey]
                                      : prev.recommendedTools.filter((t) => t !== toolKey)
                                  }))
                                }
                                className="h-3 w-3"
                              />
                              {toolKey}
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-text-muted">Шаги</span>
                        {scenarioValidation.errors.steps !== undefined && (
                          <span className="text-[10px] text-destructive">
                            {scenarioValidation.errors.steps}
                          </span>
                        )}
                      </div>
                      <div className="space-y-3">
                        {scenarioDraft.steps.map((step, stepIdx) => {
                          const directiveError =
                            scenarioValidation.errors[`step_${String(stepIdx)}_directive`];
                          return (
                            <div
                              key={stepIdx}
                              className="rounded-xl border border-border/60 bg-surface p-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold text-text">
                                  Шаг {String(stepIdx + 1)}
                                </span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={stepIdx === 0}
                                    onClick={() =>
                                      setScenarioDraft((prev) => ({
                                        ...prev,
                                        steps: prev.steps.map((s, i) => {
                                          if (i === stepIdx - 1) return prev.steps[stepIdx] ?? s;
                                          if (i === stepIdx) return prev.steps[stepIdx - 1] ?? s;
                                          return s;
                                        })
                                      }))
                                    }
                                    className="rounded border border-border bg-background p-1 text-text-muted hover:text-text disabled:opacity-30"
                                  >
                                    <ChevronUp className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={stepIdx === scenarioDraft.steps.length - 1}
                                    onClick={() =>
                                      setScenarioDraft((prev) => ({
                                        ...prev,
                                        steps: prev.steps.map((s, i) => {
                                          if (i === stepIdx) return prev.steps[stepIdx + 1] ?? s;
                                          if (i === stepIdx + 1) return prev.steps[stepIdx] ?? s;
                                          return s;
                                        })
                                      }))
                                    }
                                    className="rounded border border-border bg-background p-1 text-text-muted hover:text-text disabled:opacity-30"
                                  >
                                    <ChevronDown className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={scenarioDraft.steps.length <= 1}
                                    onClick={() =>
                                      setScenarioDraft((prev) => ({
                                        ...prev,
                                        steps: prev.steps.filter((_, i) => i !== stepIdx)
                                      }))
                                    }
                                    className="rounded border border-destructive/40 bg-destructive/10 p-1 text-destructive hover:bg-destructive/15 disabled:opacity-30"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                              <div className="mt-2 space-y-2">
                                <Field label="Директива (imperative)" error={directiveError}>
                                  <textarea
                                    value={step.directive}
                                    onChange={(e) =>
                                      setScenarioDraft((prev) => ({
                                        ...prev,
                                        steps: prev.steps.map((s, i) =>
                                          i === stepIdx ? { ...s, directive: e.target.value } : s
                                        )
                                      }))
                                    }
                                    rows={2}
                                    className={`${FIELD_CLASS} resize-y`}
                                    placeholder="ВЫЗОВИТЕ image_generate с outputMode=series, count=8"
                                  />
                                </Field>
                                <Field label="Рекомендуемый инструмент (или (none))">
                                  <select
                                    value={step.recommendedToolCall}
                                    onChange={(e) =>
                                      setScenarioDraft((prev) => ({
                                        ...prev,
                                        steps: prev.steps.map((s, i) =>
                                          i === stepIdx
                                            ? { ...s, recommendedToolCall: e.target.value }
                                            : s
                                        )
                                      }))
                                    }
                                    className={FIELD_CLASS}
                                  >
                                    <option value="">(none)</option>
                                    {NATIVE_SCENARIO_TOOL_KEYS.map((k) => (
                                      <option key={k} value={k}>
                                        {k}
                                      </option>
                                    ))}
                                  </select>
                                </Field>
                                <Field label="Можно пропустить если (опционально)">
                                  <input
                                    value={step.mayBeSkippedIf}
                                    onChange={(e) =>
                                      setScenarioDraft((prev) => ({
                                        ...prev,
                                        steps: prev.steps.map((s, i) =>
                                          i === stepIdx
                                            ? { ...s, mayBeSkippedIf: e.target.value }
                                            : s
                                        )
                                      }))
                                    }
                                    className={FIELD_CLASS}
                                    placeholder="пользователь уже предоставил все изображения"
                                  />
                                </Field>
                                <div>
                                  <div className="mb-1.5 flex items-center justify-between">
                                    <span className="text-[11px] font-medium text-text-muted">
                                      Негативные условия
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setScenarioDraft((prev) => ({
                                          ...prev,
                                          steps: prev.steps.map((s, i) =>
                                            i === stepIdx
                                              ? { ...s, negativeGuards: [...s.negativeGuards, ""] }
                                              : s
                                          )
                                        }))
                                      }
                                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-[10px] text-text-muted hover:text-text"
                                    >
                                      <Plus className="h-3 w-3" />
                                      Добавить
                                    </button>
                                  </div>
                                  <div className="space-y-1">
                                    {step.negativeGuards.map((guard, guardIdx) => (
                                      <div key={guardIdx} className="flex items-center gap-2">
                                        <input
                                          value={guard}
                                          onChange={(e) =>
                                            setScenarioDraft((prev) => ({
                                              ...prev,
                                              steps: prev.steps.map((s, i) =>
                                                i === stepIdx
                                                  ? {
                                                      ...s,
                                                      negativeGuards: s.negativeGuards.map(
                                                        (g, gi) =>
                                                          gi === guardIdx ? e.target.value : g
                                                      )
                                                    }
                                                  : s
                                              )
                                            }))
                                          }
                                          className={FIELD_CLASS}
                                          placeholder="объединять несколько вызовов в один"
                                        />
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setScenarioDraft((prev) => ({
                                              ...prev,
                                              steps: prev.steps.map((s, i) =>
                                                i === stepIdx
                                                  ? {
                                                      ...s,
                                                      negativeGuards: s.negativeGuards.filter(
                                                        (_, gi) => gi !== guardIdx
                                                      )
                                                    }
                                                  : s
                                              )
                                            }))
                                          }
                                          className="rounded-lg border border-destructive/40 bg-destructive/10 p-1.5 text-destructive hover:bg-destructive/15"
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setScenarioDraft((prev) => ({
                            ...prev,
                            steps: [...prev.steps, { ...EMPTY_SCENARIO_STEP_DRAFT }]
                          }))
                        }
                        className="mt-3 inline-flex items-center gap-2 rounded-lg border border-dashed border-border bg-background px-3 py-2 text-[11px] text-text-muted hover:border-border-strong hover:text-text"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Добавить шаг
                      </button>
                    </div>

                    <div className="mt-6 grid gap-4 lg:grid-cols-2">
                      <div className="rounded-xl border border-border/60 bg-background p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-text">
                            Предпросмотр: каталог (кэшированный префикс)
                          </span>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => setPreviewLocale("ru")}
                              className={`rounded px-2 py-0.5 text-[10px] ${
                                previewLocale === "ru"
                                  ? "bg-accent text-white"
                                  : "text-text-muted hover:text-text"
                              }`}
                            >
                              RU
                            </button>
                            <button
                              type="button"
                              onClick={() => setPreviewLocale("en")}
                              className={`rounded px-2 py-0.5 text-[10px] ${
                                previewLocale === "en"
                                  ? "bg-accent text-white"
                                  : "text-text-muted hover:text-text"
                              }`}
                            >
                              EN
                            </button>
                          </div>
                        </div>
                        <pre className="whitespace-pre-wrap break-all rounded-lg border border-border bg-surface p-3 font-mono text-[10px] text-text-muted">
                          {renderScenarioCatalogLine(debouncedScenarioDraft, previewLocale)}
                        </pre>
                      </div>
                      <div className="rounded-xl border border-border/60 bg-background p-3">
                        <div className="mb-2">
                          <span className="text-[11px] font-semibold text-text">
                            Предпросмотр: активный сценарий (volatile блок, вид модели)
                          </span>
                        </div>
                        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-surface p-3 font-mono text-[10px] text-text-muted">
                          {renderActiveScenarioBlockPreview(
                            debouncedScenarioDraft,
                            selectedSkill
                              ? (selectedSkill.name.en ??
                                  selectedSkill.name.ru ??
                                  Object.values(selectedSkill.name)[0] ??
                                  "Skill")
                              : "Skill"
                          )}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-text-subtle">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-text">{value}</p>
      <p className="mt-1 text-[11px] text-text-muted">{detail}</p>
    </div>
  );
}

function Field({
  label,
  error,
  children
}: {
  label: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-text-muted">{label}</span>
      {children}
      {error && <span className="block text-[10px] text-destructive">{error}</span>}
    </label>
  );
}

function SkillDocumentRow({
  document,
  busy,
  onDelete,
  onReindex
}: {
  document: SkillDocumentState;
  busy: boolean;
  onDelete: () => void;
  onReindex: () => void;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 text-text-subtle" />
            <p className="truncate text-sm font-medium text-text">
              {document.displayName || document.originalFilename}
            </p>
          </div>
          <p className="mt-1 text-[11px] text-text-muted">
            {document.originalFilename} · {formatBytes(document.sizeBytes)} · v
            {document.currentVersion}
          </p>
          {document.description && (
            <p className="mt-1 text-[11px] text-text-muted">{document.description}</p>
          )}
          {document.lastErrorMessage && (
            <p className="mt-1 text-[11px] text-destructive">
              {document.lastErrorCode}: {document.lastErrorMessage}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] ${statusTone(document.status)}`}
          >
            {document.status}
          </span>
          <button
            type="button"
            onClick={onReindex}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-[10px] text-text-muted hover:text-text disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Reindex
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1 text-[10px] text-destructive hover:bg-destructive/15 disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        </div>
      </div>
      <div className="mt-2 grid gap-1 text-[10px] text-text-subtle sm:grid-cols-3">
        <span>Chunks: {document.chunkCount}</span>
        <span>Provider: {document.processorProviderKey ?? "pending"}</span>
        <span>Indexed: {formatWhen(document.lastIndexedAt)}</span>
      </div>
    </div>
  );
}
