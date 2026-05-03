"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Archive,
  BookOpen,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload
} from "lucide-react";
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
    <div className="mx-auto max-w-7xl space-y-3 pb-24">
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
