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
  Trash2,
  Upload
} from "lucide-react";
import {
  archiveAdminSkill,
  createAdminSkill,
  deleteAdminSkillDocument,
  getAdminSkills,
  reindexAdminSkillDocument,
  updateAdminSkill,
  uploadAdminSkillDocument,
  type AdminSkillState,
  type AdminSkillUpsertRequest,
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === selectedSkillId) ?? null,
    [selectedSkillId, skills]
  );
  const validationErrors = useMemo(() => validateSkillDraft(draft), [draft]);

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
  }, [selectedSkill]);

  const startCreate = useCallback(() => {
    setSelectedSkillId(null);
    setDraft(skillToDraft(null));
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
      setFeedback(draft.id === null ? "Skill created." : "Skill saved.");
      await load();
      setSelectedSkillId(saved.id);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Save failed.");
    }
    setSaving(false);
  }, [draft, getToken, load]);

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

  const readySkills = skills.filter((skill) => skill.status === "active").length;
  const documentCount = skills.reduce((sum, skill) => sum + skill.documents.length, 0);

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
          detail="Queued and processed by indexing jobs"
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

      <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
        <div className="rounded-xl border border-border/70 bg-surface">
          <div className="flex items-center justify-between gap-2 border-b border-border/70 p-3">
            <div>
              <h2 className="text-xs font-semibold text-text">Skills catalog</h2>
              <p className="text-[11px] text-text-muted">No demo Skills are seeded.</p>
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
          <div className="max-h-[680px] space-y-2 overflow-y-auto p-3">
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
