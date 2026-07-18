"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useLocale, useTranslations } from "next-intl";
import { Archive, CheckCircle2, Loader2, Plus, Rocket, Save } from "lucide-react";
import {
  archiveAdminScript,
  createAdminScript,
  createAdminScriptVersion,
  getAdminScripts,
  getAdminScriptVersions,
  getAdminSkillScripts,
  getAdminSkills,
  publishAdminScriptVersion,
  replaceAdminSkillScripts,
  updateAdminScript,
  updateAdminScriptVersion,
  validateAdminScriptVersion,
  type AdminScriptCreateRequest,
  type AdminScriptUpdateRequest,
  type AdminScriptVersionCreateRequest,
  type AdminSkillState,
  type ScriptState,
  type ScriptVersionState
} from "@/app/app/assistant-api-client";
import { ContractsApiError } from "@persai/contracts";
import { getAdminSessionToken } from "@/app/admin/admin-session";
import {
  assertScriptVersionAuthoringContract,
  isExactScriptBrowserCapability,
  SCRIPT_BROWSER_CAPABILITY
} from "./script-authoring-validation";

type UiLocale = "en" | "ru";

type ScriptDraft = {
  id: string | null;
  key: string;
  status: "draft" | "published" | "archived";
  nameEn: string;
  nameRu: string;
  descriptionEn: string;
  descriptionRu: string;
  category: string;
  icon: string;
  color: string;
  displayOrder: string;
  currentPublishedVersionId: string | null;
};

type VersionDraft = {
  id: string | null;
  status: "draft" | "published" | null;
  revision: number | null;
  code: string;
  workingDirectory: string;
  environmentJson: string;
  inputSchemaJson: string;
  outputSchemaJson: string;
  runtime: string;
  entryCommand: string;
  timeoutMs: string;
  maxMemoryMb: string;
  maxCpuMillicores: string;
  maxOutputBytes: string;
  /** When true, save emits exact `{browser:{actions:["snapshot","act"]}}`; otherwise omits capabilities. */
  browserCapabilityEnabled: boolean;
  contentHash: string | null;
  publishedAt: string | null;
};

type ScriptSelectionContext = {
  generation: number;
  scriptId: string | null;
};

type SkillSelectionContext = {
  generation: number;
  skillId: string;
};

const SCRIPT_KEY_REGEX = /^[a-z][a-z0-9_]{1,63}$/;

const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-text outline-none transition-colors placeholder:text-text-subtle focus:border-border-strong disabled:opacity-50";
const CODE_FIELD_CLASS = `${FIELD_CLASS} font-mono`;

const EMPTY_SCRIPT_DRAFT: ScriptDraft = {
  id: null,
  key: "",
  status: "draft",
  nameEn: "",
  nameRu: "",
  descriptionEn: "",
  descriptionRu: "",
  category: "general",
  icon: "",
  color: "",
  displayOrder: "100",
  currentPublishedVersionId: null
};

const EMPTY_VERSION_DRAFT: VersionDraft = {
  id: null,
  status: null,
  revision: null,
  code: 'import json, os\n\nwith open(os.environ["PERSAI_SCRIPT_INPUT_PATH"], "r", encoding="utf-8") as f:\n    script_input = json.load(f)\n\nresult = {}\n\nwith open(os.environ["PERSAI_SCRIPT_OUTPUT_PATH"], "w", encoding="utf-8") as f:\n    json.dump(result, f)\n',
  workingDirectory: "",
  environmentJson: "{}",
  inputSchemaJson:
    '{\n  "type": "object",\n  "properties": {},\n  "additionalProperties": false\n}',
  outputSchemaJson:
    '{\n  "type": "object",\n  "properties": {},\n  "additionalProperties": false\n}',
  runtime: "python3",
  entryCommand: 'python3 "$PERSAI_SCRIPT_ENTRY_PATH"',
  timeoutMs: "30000",
  maxMemoryMb: "512",
  maxCpuMillicores: "1000",
  maxOutputBytes: "1048576",
  browserCapabilityEnabled: false,
  contentHash: null,
  publishedAt: null
};

function preferredText(
  value: { en?: string; ru?: string } | undefined,
  locale: UiLocale,
  fallback = ""
): string {
  const localized = value as Record<string, string> | undefined;
  return (
    localized?.[locale]?.trim() ||
    localized?.en?.trim() ||
    localized?.ru?.trim() ||
    Object.values(localized ?? {})[0] ||
    fallback
  );
}

export function scriptToDraft(script: ScriptState | null): ScriptDraft {
  if (script === null) {
    return { ...EMPTY_SCRIPT_DRAFT };
  }
  return {
    id: script.id,
    key: script.key,
    status: script.status,
    nameEn: script.name.en ?? "",
    nameRu: script.name.ru ?? "",
    descriptionEn: script.description.en ?? "",
    descriptionRu: script.description.ru ?? "",
    category: script.category,
    icon: script.icon ?? "",
    color: script.color ?? "",
    displayOrder: String(script.displayOrder),
    currentPublishedVersionId: script.currentPublishedVersionId
  };
}

export function validateScriptDraft(draft: ScriptDraft, mode: "create" | "update"): string | null {
  if (mode === "create" && !SCRIPT_KEY_REGEX.test(draft.key.trim())) {
    return "invalidKey";
  }
  if (
    draft.nameEn.trim().length < 1 ||
    draft.nameEn.trim().length > 500 ||
    draft.nameRu.trim().length < 1 ||
    draft.nameRu.trim().length > 500
  ) {
    return "localizedName";
  }
  if (
    draft.descriptionEn.trim().length < 1 ||
    draft.descriptionEn.trim().length > 2_000 ||
    draft.descriptionRu.trim().length < 1 ||
    draft.descriptionRu.trim().length > 2_000
  ) {
    return "localizedDescription";
  }
  if (draft.category.trim().length < 1 || draft.category.trim().length > 64) {
    return "category";
  }
  if (draft.icon.trim().length > 64 || (draft.icon.length > 0 && draft.icon.trim().length === 0)) {
    return "icon";
  }
  if (
    draft.color.trim().length > 32 ||
    (draft.color.length > 0 && draft.color.trim().length === 0)
  ) {
    return "color";
  }
  if (!/^-?\d+$/.test(draft.displayOrder.trim())) {
    return "displayOrder";
  }
  const displayOrder = Number(draft.displayOrder.trim());
  if (
    !Number.isSafeInteger(displayOrder) ||
    displayOrder < -1_000_000 ||
    displayOrder > 1_000_000
  ) {
    return "displayOrder";
  }
  return null;
}

export function draftToScriptCreatePayload(draft: ScriptDraft): AdminScriptCreateRequest {
  const error = validateScriptDraft(draft, "create");
  if (error) {
    throw new Error(error);
  }
  return {
    key: draft.key.trim(),
    name: { en: draft.nameEn.trim(), ru: draft.nameRu.trim() },
    description: { en: draft.descriptionEn.trim(), ru: draft.descriptionRu.trim() },
    category: draft.category.trim(),
    icon: draft.icon.trim() || null,
    color: draft.color.trim() || null,
    displayOrder: Number(draft.displayOrder.trim())
  };
}

export function draftToScriptUpdatePayload(draft: ScriptDraft): AdminScriptUpdateRequest {
  const error = validateScriptDraft(draft, "update");
  if (error) {
    throw new Error(error);
  }
  return {
    name: { en: draft.nameEn.trim(), ru: draft.nameRu.trim() },
    description: { en: draft.descriptionEn.trim(), ru: draft.descriptionRu.trim() },
    category: draft.category.trim(),
    icon: draft.icon.trim() || null,
    color: draft.color.trim() || null,
    displayOrder: Number(draft.displayOrder.trim())
  };
}

export function versionToDraft(version: ScriptVersionState | null): VersionDraft {
  if (version === null) {
    return { ...EMPTY_VERSION_DRAFT };
  }
  return {
    id: version.id,
    status: version.status,
    revision: version.revision,
    code: version.code,
    workingDirectory: version.manifest.workingDirectory ?? "",
    environmentJson: JSON.stringify(version.manifest.environment ?? {}, null, 2),
    inputSchemaJson: JSON.stringify(version.inputSchema ?? {}, null, 2),
    outputSchemaJson: JSON.stringify(version.outputSchema ?? {}, null, 2),
    runtime: version.runtime,
    entryCommand: version.entryCommand,
    timeoutMs: String(version.limits.timeoutMs),
    maxMemoryMb: String(version.limits.maxMemoryMb),
    maxCpuMillicores: String(version.limits.maxCpuMillicores),
    maxOutputBytes: String(version.limits.maxOutputBytes),
    browserCapabilityEnabled: isExactScriptBrowserCapability(version.manifest.capabilities),
    contentHash: version.contentHash,
    publishedAt: version.publishedAt
  };
}

/** Prefer the Script's current published pin; otherwise newest published row. */
export function findPublishedScriptVersion(
  versions: readonly ScriptVersionState[],
  currentPublishedVersionId: string | null
): ScriptVersionState | null {
  if (currentPublishedVersionId !== null) {
    const pinned =
      versions.find(
        (version) => version.id === currentPublishedVersionId && version.status === "published"
      ) ?? null;
    if (pinned !== null) {
      return pinned;
    }
  }
  return (
    versions
      .filter((version) => version.status === "published")
      .sort((a, b) => b.version - a.version)[0] ?? null
  );
}

/**
 * Editor seed: existing draft wins; else last published content so the form
 * shows real current code; else empty first-draft boilerplate. Never invents
 * a second draft over an existing one.
 */
export function resolveVersionEditorSeed(
  versions: readonly ScriptVersionState[],
  currentPublishedVersionId: string | null
): VersionDraft {
  const draftRow = versions.find((version) => version.status === "draft") ?? null;
  if (draftRow !== null) {
    return versionToDraft(draftRow);
  }
  const published = findPublishedScriptVersion(versions, currentPublishedVersionId);
  if (published !== null) {
    return versionToDraft(published);
  }
  return { ...EMPTY_VERSION_DRAFT };
}

/** Create-draft payload seed: copy published executable fields, strip identity. */
export function seedDraftCreateFromPublished(
  versions: readonly ScriptVersionState[],
  currentPublishedVersionId: string | null
): VersionDraft {
  const published = findPublishedScriptVersion(versions, currentPublishedVersionId);
  if (published === null) {
    return { ...EMPTY_VERSION_DRAFT };
  }
  return {
    ...versionToDraft(published),
    id: null,
    status: null,
    revision: null,
    contentHash: null,
    publishedAt: null
  };
}

function parseVersionDraftPayload(draft: VersionDraft): AdminScriptVersionCreateRequest {
  if (
    !/^\d+$/.test(draft.timeoutMs.trim()) ||
    !/^\d+$/.test(draft.maxMemoryMb.trim()) ||
    !/^\d+$/.test(draft.maxCpuMillicores.trim()) ||
    !/^\d+$/.test(draft.maxOutputBytes.trim())
  ) {
    throw new Error("invalid limits");
  }
  const environment = JSON.parse(draft.environmentJson) as unknown;
  const inputSchema = JSON.parse(draft.inputSchemaJson) as unknown;
  const outputSchema = JSON.parse(draft.outputSchemaJson) as unknown;
  if (
    typeof environment !== "object" ||
    environment === null ||
    Array.isArray(environment) ||
    typeof inputSchema !== "object" ||
    inputSchema === null ||
    Array.isArray(inputSchema) ||
    typeof outputSchema !== "object" ||
    outputSchema === null ||
    Array.isArray(outputSchema)
  ) {
    throw new Error("invalid object");
  }
  const limits = {
    timeoutMs: Number(draft.timeoutMs.trim()),
    maxMemoryMb: Number(draft.maxMemoryMb.trim()),
    maxCpuMillicores: Number(draft.maxCpuMillicores.trim()),
    maxOutputBytes: Number(draft.maxOutputBytes.trim())
  };
  const runtime = draft.runtime.trim();
  assertScriptVersionAuthoringContract({
    code: draft.code,
    workingDirectory: draft.workingDirectory,
    environment: environment as Record<string, unknown>,
    inputSchema: inputSchema as Record<string, unknown>,
    outputSchema: outputSchema as Record<string, unknown>,
    runtime,
    entryCommand: draft.entryCommand,
    limits,
    browserCapabilityEnabled: draft.browserCapabilityEnabled
  });
  return {
    code: draft.code,
    manifest: {
      schemaVersion: 1,
      workingDirectory: draft.workingDirectory.length === 0 ? null : draft.workingDirectory.trim(),
      environment: environment as Record<string, string>,
      ...(draft.browserCapabilityEnabled
        ? {
            capabilities: {
              browser: { actions: [...SCRIPT_BROWSER_CAPABILITY.browser.actions] }
            }
          }
        : {})
    },
    inputSchema: inputSchema as Record<string, unknown>,
    outputSchema: outputSchema as Record<string, unknown>,
    runtime,
    entryCommand: draft.entryCommand,
    limits
  };
}

export function validateVersionDraftJson(draft: VersionDraft): string | null {
  try {
    parseVersionDraftPayload(draft);
    return null;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("must require a string profile property")
    ) {
      return "browserProfileRequired";
    }
    return "invalidJson";
  }
}

export function draftToVersionWritePayload(draft: VersionDraft): AdminScriptVersionCreateRequest {
  try {
    return parseVersionDraftPayload(draft);
  } catch {
    throw new Error("invalidJson");
  }
}

export function moveScriptId(scriptIds: string[], scriptId: string, direction: -1 | 1): string[] {
  const index = scriptIds.indexOf(scriptId);
  if (index < 0) {
    return scriptIds;
  }
  const next = index + direction;
  if (next < 0 || next >= scriptIds.length) {
    return scriptIds;
  }
  const copy = [...scriptIds];
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item!);
  return copy;
}

function apiErrorCode(error: unknown): string | null {
  return error instanceof ContractsApiError && typeof error.code === "string" ? error.code : null;
}

export default function AdminScriptsPage() {
  const { getToken } = useAuth();
  const locale = useLocale();
  const uiLocale: UiLocale = locale.toLowerCase().startsWith("ru") ? "ru" : "en";
  const t = useTranslations("adminScripts");
  const [scripts, setScripts] = useState<ScriptState[]>([]);
  const [skills, setSkills] = useState<AdminSkillState[]>([]);
  const [draft, setDraft] = useState<ScriptDraft>({ ...EMPTY_SCRIPT_DRAFT });
  const [versions, setVersions] = useState<ScriptVersionState[]>([]);
  const [versionDraft, setVersionDraft] = useState<VersionDraft>({ ...EMPTY_VERSION_DRAFT });
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [versionSaving, setVersionSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [versionFeedback, setVersionFeedback] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string>("");
  const [skillScriptIds, setSkillScriptIds] = useState<string[]>([]);
  const [bindingsLoading, setBindingsLoading] = useState(false);
  const [bindingsSaving, setBindingsSaving] = useState(false);
  const [bindingsFeedback, setBindingsFeedback] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const scriptSelectionGenerationRef = useRef(0);
  const selectedScriptIdRef = useRef<string | null>(null);
  const skillSelectionGenerationRef = useRef(0);

  function captureScriptSelection(): ScriptSelectionContext {
    return {
      generation: scriptSelectionGenerationRef.current,
      scriptId: selectedScriptIdRef.current
    };
  }

  function isCurrentScriptSelection(context: ScriptSelectionContext): boolean {
    return (
      mountedRef.current &&
      context.generation === scriptSelectionGenerationRef.current &&
      context.scriptId === selectedScriptIdRef.current
    );
  }

  function captureSkillSelection(): SkillSelectionContext {
    return {
      generation: skillSelectionGenerationRef.current,
      skillId: selectedSkillId
    };
  }

  function isCurrentSkillSelection(context: SkillSelectionContext): boolean {
    return (
      mountedRef.current &&
      context.generation === skillSelectionGenerationRef.current &&
      context.skillId === selectedSkillId
    );
  }

  const activeSkills = useMemo(() => skills.filter((skill) => skill.status === "active"), [skills]);
  const publishedScripts = useMemo(
    () => scripts.filter((script) => script.status === "published"),
    [scripts]
  );
  const scriptById = useMemo(
    () => new Map(scripts.map((script) => [script.id, script])),
    [scripts]
  );
  const draftVersion = useMemo(
    () => versions.find((version) => version.status === "draft") ?? null,
    [versions]
  );
  const publishedVersions = useMemo(
    () =>
      versions
        .filter((version) => version.status === "published")
        .sort((a, b) => b.version - a.version),
    [versions]
  );

  async function loadAll() {
    setLoading(true);
    setFeedback(null);
    try {
      const token = await getAdminSessionToken(getToken).catch(() => null);
      if (!token) {
        setFeedback(t("errors.notSignedIn"));
        return;
      }
      const [nextScripts, nextSkills] = await Promise.all([
        getAdminScripts(token),
        getAdminSkills(token)
      ]);
      if (!mountedRef.current) {
        return;
      }
      setScripts(nextScripts);
      setSkills(nextSkills);
      if (draft.id) {
        const selected = nextScripts.find((script) => script.id === draft.id) ?? null;
        setDraft(scriptToDraft(selected));
        if (selected) {
          await loadVersions(
            token,
            selected.id,
            scriptSelectionGenerationRef.current,
            selected.currentPublishedVersionId
          );
        }
      }
    } catch (error) {
      if (mountedRef.current) {
        setFeedback(uiLocale === "en" && error instanceof Error ? error.message : t("errors.load"));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }

  async function loadVersions(
    token: string,
    scriptId: string,
    selectionGeneration = scriptSelectionGenerationRef.current,
    currentPublishedVersionId: string | null = null
  ): Promise<boolean> {
    const nextVersions = await getAdminScriptVersions(token, scriptId);
    if (
      !mountedRef.current ||
      selectionGeneration !== scriptSelectionGenerationRef.current ||
      selectedScriptIdRef.current !== scriptId
    ) {
      return false;
    }
    setVersions(nextVersions);
    setVersionDraft(resolveVersionEditorSeed(nextVersions, currentPublishedVersionId));
    return true;
  }

  useEffect(() => {
    mountedRef.current = true;
    void loadAll();
    return () => {
      mountedRef.current = false;
      scriptSelectionGenerationRef.current += 1;
      skillSelectionGenerationRef.current += 1;
    };
    // initial catalog load only; generation refs guard async completion/unmount
  }, []);

  async function selectScript(script: ScriptState | null) {
    const selectionGeneration = ++scriptSelectionGenerationRef.current;
    selectedScriptIdRef.current = script?.id ?? null;
    setSaving(false);
    setVersionSaving(false);
    setFeedback(null);
    setVersionFeedback(null);
    setDraft(scriptToDraft(script));
    setVersions([]);
    setVersionDraft({ ...EMPTY_VERSION_DRAFT });
    setVersionsLoading(script !== null);
    if (script === null) {
      return;
    }
    const token = await getAdminSessionToken(getToken).catch(() => null);
    if (!mountedRef.current || selectionGeneration !== scriptSelectionGenerationRef.current) {
      return;
    }
    if (!token) {
      setFeedback(t("errors.notSignedIn"));
      setVersionsLoading(false);
      return;
    }
    try {
      await loadVersions(token, script.id, selectionGeneration, script.currentPublishedVersionId);
    } catch (error) {
      if (mountedRef.current && selectionGeneration === scriptSelectionGenerationRef.current) {
        setVersionFeedback(
          uiLocale === "en" && error instanceof Error ? error.message : t("versions.errors.save")
        );
      }
    } finally {
      if (
        mountedRef.current &&
        selectionGeneration === scriptSelectionGenerationRef.current &&
        selectedScriptIdRef.current === script.id
      ) {
        setVersionsLoading(false);
      }
    }
  }

  async function handleSaveScript() {
    let mutationContext = captureScriptSelection();
    setSaving(true);
    setFeedback(null);
    try {
      const validation = validateScriptDraft(draft, draft.id === null ? "create" : "update");
      if (validation) {
        setFeedback(t(`validation.${validation}`));
        return;
      }
      const token = await getAdminSessionToken(getToken);
      if (!isCurrentScriptSelection(mutationContext)) {
        return;
      }
      if (!token) {
        setFeedback(t("errors.notSignedIn"));
        return;
      }
      const saved =
        draft.id === null
          ? await createAdminScript(token, draftToScriptCreatePayload(draft))
          : await updateAdminScript(token, draft.id, draftToScriptUpdatePayload(draft));
      if (!isCurrentScriptSelection(mutationContext)) {
        return;
      }
      selectedScriptIdRef.current = saved.id;
      mutationContext = { ...mutationContext, scriptId: saved.id };
      setDraft(scriptToDraft(saved));
      setFeedback(t("saved"));
      const nextScripts = await getAdminScripts(token);
      if (isCurrentScriptSelection(mutationContext)) {
        setScripts(nextScripts);
      }
    } catch (error) {
      if (!isCurrentScriptSelection(mutationContext)) {
        return;
      }
      const code = apiErrorCode(error);
      if (code === "admin_script_key_conflict") {
        setFeedback(t("errors.keyConflict"));
      } else if (code === "admin_script_archived") {
        setFeedback(t("errors.scriptArchived"));
      } else {
        setFeedback(uiLocale === "en" && error instanceof Error ? error.message : t("errors.save"));
      }
    } finally {
      if (isCurrentScriptSelection(mutationContext)) {
        setSaving(false);
      }
    }
  }

  async function handleArchiveScript() {
    if (draft.id === null) {
      return;
    }
    const mutationContext = captureScriptSelection();
    setSaving(true);
    setFeedback(null);
    try {
      const token = await getAdminSessionToken(getToken);
      if (!isCurrentScriptSelection(mutationContext)) {
        return;
      }
      if (!token) {
        setFeedback(t("errors.notSignedIn"));
        return;
      }
      await archiveAdminScript(token, draft.id);
      if (!isCurrentScriptSelection(mutationContext)) {
        return;
      }
      setFeedback(t("archived"));
      selectedScriptIdRef.current = null;
      setDraft({ ...EMPTY_SCRIPT_DRAFT });
      setVersions([]);
      setVersionDraft({ ...EMPTY_VERSION_DRAFT });
      const nextScripts = await getAdminScripts(token);
      if (
        mountedRef.current &&
        mutationContext.generation === scriptSelectionGenerationRef.current &&
        selectedScriptIdRef.current === null
      ) {
        setScripts(nextScripts);
      }
    } catch (error) {
      if (!isCurrentScriptSelection(mutationContext)) {
        return;
      }
      const code = apiErrorCode(error);
      setFeedback(
        code === "admin_script_in_use"
          ? t("errors.inUse")
          : uiLocale === "en" && error instanceof Error
            ? error.message
            : t("errors.archive")
      );
    } finally {
      if (
        mountedRef.current &&
        mutationContext.generation === scriptSelectionGenerationRef.current &&
        (selectedScriptIdRef.current === mutationContext.scriptId ||
          selectedScriptIdRef.current === null)
      ) {
        setSaving(false);
      }
    }
  }

  async function handleCreateDraftVersion() {
    if (draft.id === null) {
      return;
    }
    const mutationContext = captureScriptSelection();
    setVersionSaving(true);
    setVersionFeedback(null);
    try {
      const error = validateVersionDraftJson(versionDraft);
      if (error) {
        setVersionFeedback(t(`versions.errors.${error}`));
        return;
      }
      const token = await getAdminSessionToken(getToken);
      if (!isCurrentScriptSelection(mutationContext)) {
        return;
      }
      if (!token) {
        setFeedback(t("errors.notSignedIn"));
        return;
      }
      // Create-draft is only reachable when no draft row exists; the editor
      // already holds the published seed (or empty first-draft boilerplate),
      // including any operator edits. Strip identity so create never mutates
      // a published row. Fall back to an explicit published copy only if the
      // editor somehow still carries draft identity without a draft row.
      const createSeed =
        versionDraft.status === "draft" && versionDraft.id !== null
          ? seedDraftCreateFromPublished(versions, draft.currentPublishedVersionId)
          : {
              ...versionDraft,
              id: null,
              status: null,
              revision: null,
              contentHash: null,
              publishedAt: null
            };
      const created = await createAdminScriptVersion(
        token,
        draft.id,
        draftToVersionWritePayload(createSeed)
      );
      if (!isCurrentScriptSelection(mutationContext)) {
        return;
      }
      setVersionDraft(versionToDraft(created));
      setVersionFeedback(t("versions.draftCreated"));
      await loadVersions(
        token,
        draft.id,
        mutationContext.generation,
        draft.currentPublishedVersionId
      );
    } catch (error) {
      if (!isCurrentScriptSelection(mutationContext)) {
        return;
      }
      const code = apiErrorCode(error);
      setVersionFeedback(
        code === "admin_script_draft_exists"
          ? t("versions.errors.draftExists")
          : code === "admin_script_archived"
            ? t("versions.errors.archivedScript")
            : uiLocale === "en" && error instanceof Error
              ? error.message
              : t("versions.errors.create")
      );
    } finally {
      if (isCurrentScriptSelection(mutationContext)) {
        setVersionSaving(false);
      }
    }
  }

  function applyDraftVersionState(
    version: ScriptVersionState,
    mutationContext: ScriptSelectionContext
  ): boolean {
    if (!isCurrentScriptSelection(mutationContext)) {
      return false;
    }
    setVersionDraft(versionToDraft(version));
    setVersions((current) => {
      const withoutVersion = current.filter((item) => item.id !== version.id);
      return [...withoutVersion, version].sort((a, b) => b.version - a.version);
    });
    return true;
  }

  async function persistCurrentDraftVersion(
    token: string,
    mutationContext: ScriptSelectionContext
  ): Promise<ScriptVersionState | null> {
    if (draft.id === null || versionDraft.id === null || versionDraft.revision === null) {
      throw new Error("Draft Script version identity is unavailable.");
    }
    const updated = await updateAdminScriptVersion(token, draft.id, versionDraft.id, {
      ...draftToVersionWritePayload(versionDraft),
      expectedRevision: versionDraft.revision
    });
    return applyDraftVersionState(updated, mutationContext) ? updated : null;
  }

  async function handleDraftVersionMutationError(
    error: unknown,
    fallbackMessage: "save" | "validate" | "publish",
    mutationContext: ScriptSelectionContext
  ) {
    if (!isCurrentScriptSelection(mutationContext)) {
      return;
    }
    const code = apiErrorCode(error);
    if (code === "admin_script_version_revision_conflict" && draft.id !== null) {
      const token = await getAdminSessionToken(getToken).catch(() => null);
      if (token) {
        await loadVersions(
          token,
          draft.id,
          mutationContext.generation,
          draft.currentPublishedVersionId
        );
      }
      if (!isCurrentScriptSelection(mutationContext)) {
        return;
      }
      setVersionFeedback(t("versions.errors.revisionConflict"));
    } else if (code === "admin_script_version_immutable") {
      setVersionFeedback(t("versions.errors.immutable"));
    } else if (code === "admin_script_archived") {
      setVersionFeedback(t("versions.errors.archivedScript"));
    } else {
      setVersionFeedback(
        uiLocale === "en" && error instanceof Error
          ? error.message
          : t(`versions.errors.${fallbackMessage}`)
      );
    }
  }

  async function handleSaveDraftVersion() {
    if (draft.id === null || versionDraft.id === null || versionDraft.revision === null) {
      return;
    }
    const mutationContext = captureScriptSelection();
    setVersionSaving(true);
    setVersionFeedback(null);
    try {
      const error = validateVersionDraftJson(versionDraft);
      if (error) {
        setVersionFeedback(t(`versions.errors.${error}`));
        return;
      }
      const token = await getAdminSessionToken(getToken);
      if (!isCurrentScriptSelection(mutationContext)) {
        return;
      }
      if (!token) {
        setFeedback(t("errors.notSignedIn"));
        return;
      }
      const updated = await persistCurrentDraftVersion(token, mutationContext);
      if (updated === null) {
        return;
      }
      setVersionFeedback(t("versions.draftSaved"));
    } catch (error) {
      await handleDraftVersionMutationError(error, "save", mutationContext);
    } finally {
      if (isCurrentScriptSelection(mutationContext)) {
        setVersionSaving(false);
      }
    }
  }

  async function handleValidateDraftVersion() {
    if (draft.id === null || versionDraft.id === null || versionDraft.revision === null) {
      return;
    }
    const mutationContext = captureScriptSelection();
    setVersionSaving(true);
    setVersionFeedback(null);
    try {
      const validationError = validateVersionDraftJson(versionDraft);
      if (validationError) {
        setVersionFeedback(t(`versions.errors.${validationError}`));
        return;
      }
      const token = await getAdminSessionToken(getToken);
      if (!isCurrentScriptSelection(mutationContext)) {
        return;
      }
      if (!token) {
        setFeedback(t("errors.notSignedIn"));
        return;
      }
      const updated = await persistCurrentDraftVersion(token, mutationContext);
      if (updated === null) {
        return;
      }
      const validated = await validateAdminScriptVersion(token, draft.id, updated.id);
      if (!applyDraftVersionState(validated, mutationContext)) {
        return;
      }
      setVersionFeedback(t("versions.validated"));
    } catch (error) {
      await handleDraftVersionMutationError(error, "validate", mutationContext);
    } finally {
      if (isCurrentScriptSelection(mutationContext)) {
        setVersionSaving(false);
      }
    }
  }

  async function handlePublishDraftVersion() {
    if (draft.id === null || versionDraft.id === null || versionDraft.revision === null) {
      return;
    }
    const mutationContext = captureScriptSelection();
    setVersionSaving(true);
    setVersionFeedback(null);
    try {
      const validationError = validateVersionDraftJson(versionDraft);
      if (validationError) {
        setVersionFeedback(t(`versions.errors.${validationError}`));
        return;
      }
      const token = await getAdminSessionToken(getToken);
      if (!isCurrentScriptSelection(mutationContext)) {
        return;
      }
      if (!token) {
        setFeedback(t("errors.notSignedIn"));
        return;
      }
      const updated = await persistCurrentDraftVersion(token, mutationContext);
      if (updated === null) {
        return;
      }
      const published = await publishAdminScriptVersion(token, draft.id, updated.id, {
        expectedRevision: updated.revision
      });
      if (!isCurrentScriptSelection(mutationContext)) {
        return;
      }
      setDraft(scriptToDraft(published.script));
      setVersionDraft(versionToDraft(published.version));
      setVersions((current) => {
        const withoutDraftOrPublished = current.filter(
          (item) => item.status !== "draft" && item.id !== published.version.id
        );
        return [published.version, ...withoutDraftOrPublished].sort(
          (a, b) => b.version - a.version
        );
      });
      setVersionFeedback(t("versions.published"));
      const nextScripts = await getAdminScripts(token);
      if (isCurrentScriptSelection(mutationContext)) {
        setScripts(nextScripts);
      }
    } catch (error) {
      await handleDraftVersionMutationError(error, "publish", mutationContext);
    } finally {
      if (isCurrentScriptSelection(mutationContext)) {
        setVersionSaving(false);
      }
    }
  }

  async function handleSelectSkill(skillId: string) {
    const selectionGeneration = ++skillSelectionGenerationRef.current;
    setBindingsSaving(false);
    setSelectedSkillId(skillId);
    setBindingsFeedback(null);
    setSkillScriptIds([]);
    setBindingsLoading(false);
    if (!skillId) {
      return;
    }
    setBindingsLoading(true);
    try {
      const token = await getAdminSessionToken(getToken);
      if (!mountedRef.current || selectionGeneration !== skillSelectionGenerationRef.current) {
        return;
      }
      if (!token) {
        setBindingsFeedback(t("errors.notSignedIn"));
        return;
      }
      const links = await getAdminSkillScripts(token, skillId);
      if (!mountedRef.current || selectionGeneration !== skillSelectionGenerationRef.current) {
        return;
      }
      setSkillScriptIds(links.map((link) => link.scriptId));
    } catch (error) {
      if (mountedRef.current && selectionGeneration === skillSelectionGenerationRef.current) {
        setBindingsFeedback(
          uiLocale === "en" && error instanceof Error ? error.message : t("bindings.errors.load")
        );
      }
    } finally {
      if (mountedRef.current && selectionGeneration === skillSelectionGenerationRef.current) {
        setBindingsLoading(false);
      }
    }
  }

  function toggleBoundScript(scriptId: string) {
    setSkillScriptIds((current) =>
      current.includes(scriptId) ? current.filter((id) => id !== scriptId) : [...current, scriptId]
    );
  }

  async function handleSaveBindings() {
    if (!selectedSkillId) {
      return;
    }
    const mutationContext = captureSkillSelection();
    setBindingsSaving(true);
    setBindingsFeedback(null);
    try {
      const token = await getAdminSessionToken(getToken);
      if (!isCurrentSkillSelection(mutationContext)) {
        return;
      }
      if (!token) {
        setBindingsFeedback(t("errors.notSignedIn"));
        return;
      }
      const links = await replaceAdminSkillScripts(token, selectedSkillId, {
        scriptIds: skillScriptIds
      });
      if (!isCurrentSkillSelection(mutationContext)) {
        return;
      }
      setSkillScriptIds(links.map((link) => link.scriptId));
      setBindingsFeedback(t("bindings.saved"));
    } catch (error) {
      if (!isCurrentSkillSelection(mutationContext)) {
        return;
      }
      const code = apiErrorCode(error);
      setBindingsFeedback(
        code === "admin_skill_script_not_published"
          ? t("bindings.errors.notPublished")
          : code === "admin_skill_script_scenario_reference"
            ? t("bindings.errors.scenarioReference")
            : uiLocale === "en" && error instanceof Error
              ? error.message
              : t("bindings.errors.save")
      );
    } finally {
      if (isCurrentSkillSelection(mutationContext)) {
        setBindingsSaving(false);
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-text">{t("title")}</h1>
          <p className="mt-1 max-w-2xl text-xs text-text-muted">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white"
            onClick={() => void selectScript(null)}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("newScript")}
          </button>
        </div>
      </div>

      {feedback ? (
        <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text">
          {feedback}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <section className="min-h-0 overflow-y-auto rounded-xl border border-border bg-surface">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-4 text-xs text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("loading")}
            </div>
          ) : scripts.length === 0 ? (
            <div className="px-3 py-4 text-xs text-text-muted">{t("empty")}</div>
          ) : (
            <ul className="divide-y divide-border">
              {scripts.map((script) => {
                const selected = draft.id === script.id;
                return (
                  <li key={script.id}>
                    <button
                      type="button"
                      onClick={() => void selectScript(script)}
                      className={`flex w-full items-start gap-2 px-3 py-3 text-left transition-colors ${
                        selected ? "bg-accent/10" : "hover:bg-background"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="truncate text-xs font-medium text-text">
                          {preferredText(script.name, uiLocale, t("untitled"))}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                          {script.key} · {t(`statuses.${script.status}`)} · {script.category}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="min-h-0 overflow-y-auto rounded-xl border border-border bg-surface p-4">
          {draft.id === null && !draft.key && scripts.length > 0 && !feedback ? (
            <p className="text-xs text-text-muted">{t("selectScript")}</p>
          ) : null}

          <fieldset disabled={saving} className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-[11px] text-text-muted">
              {t("key")}
              <input
                className={FIELD_CLASS}
                value={draft.key}
                disabled={draft.id !== null}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, key: event.target.value }))
                }
                placeholder="persai_example"
              />
              <span className="text-[10px]">{t("keyHint")}</span>
            </label>
            <div className="grid gap-1 text-[11px] text-text-muted">
              {t("status")}
              <div className={`${FIELD_CLASS} flex items-center bg-background text-text`}>
                {t(`statuses.${draft.status}`)}
              </div>
            </div>
            <label className="grid gap-1 text-[11px] text-text-muted">
              {t("nameEn")}
              <input
                className={FIELD_CLASS}
                value={draft.nameEn}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, nameEn: event.target.value }))
                }
              />
            </label>
            <label className="grid gap-1 text-[11px] text-text-muted">
              {t("nameRu")}
              <input
                className={FIELD_CLASS}
                value={draft.nameRu}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, nameRu: event.target.value }))
                }
              />
            </label>
            <label className="grid gap-1 text-[11px] text-text-muted md:col-span-2">
              {t("descriptionEn")}
              <textarea
                className={`${FIELD_CLASS} min-h-[64px]`}
                value={draft.descriptionEn}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, descriptionEn: event.target.value }))
                }
              />
            </label>
            <label className="grid gap-1 text-[11px] text-text-muted md:col-span-2">
              {t("descriptionRu")}
              <textarea
                className={`${FIELD_CLASS} min-h-[64px]`}
                value={draft.descriptionRu}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, descriptionRu: event.target.value }))
                }
              />
            </label>
            <label className="grid gap-1 text-[11px] text-text-muted">
              {t("category")}
              <input
                className={FIELD_CLASS}
                value={draft.category}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, category: event.target.value }))
                }
              />
            </label>
            <label className="grid gap-1 text-[11px] text-text-muted">
              {t("order")}
              <input
                className={FIELD_CLASS}
                value={draft.displayOrder}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, displayOrder: event.target.value }))
                }
              />
            </label>
            <label className="grid gap-1 text-[11px] text-text-muted">
              {t("icon")}
              <input
                className={FIELD_CLASS}
                value={draft.icon}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, icon: event.target.value }))
                }
              />
            </label>
            <label className="grid gap-1 text-[11px] text-text-muted">
              {t("color")}
              <input
                className={FIELD_CLASS}
                value={draft.color}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, color: event.target.value }))
                }
              />
            </label>
          </fieldset>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              disabled={saving}
              onClick={() => void handleSaveScript()}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {t("save")}
            </button>
            {draft.id !== null && draft.status !== "archived" ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-text disabled:opacity-50"
                disabled={saving}
                onClick={() => void handleArchiveScript()}
              >
                <Archive className="h-3.5 w-3.5" />
                {t("archive")}
              </button>
            ) : null}
          </div>

          {draft.id !== null ? (
            <div className="mt-6 rounded-lg border border-border bg-background p-3">
              <h2 className="text-xs font-semibold text-text">{t("versions.title")}</h2>
              <p className="mt-1 text-[11px] text-text-muted">{t("versions.hint")}</p>

              <p className="mt-2 text-[11px] text-text-muted">
                {draft.currentPublishedVersionId ? t("currentVersion") : t("noCurrentVersion")}
              </p>

              {versionFeedback ? (
                <div className="mt-2 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] text-text">
                  {versionFeedback}
                </div>
              ) : null}

              {versionsLoading ? (
                <div className="mt-3 flex items-center gap-2 text-[11px] text-text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("versions.loading")}
                </div>
              ) : null}

              {!versionsLoading ? (
                <fieldset disabled={versionSaving} className="contents">
                  {draftVersion === null ? (
                    <div className="mt-3">
                      <p className="text-[11px] text-text-muted">{t("versions.noDraft")}</p>
                      <button
                        type="button"
                        className="mt-2 inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-text disabled:opacity-50"
                        disabled={versionSaving || draft.status === "archived"}
                        onClick={() => void handleCreateDraftVersion()}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {t("versions.newDraft")}
                      </button>
                    </div>
                  ) : null}

                  <div className="mt-3 grid gap-3">
                    <label className="grid gap-1 text-[11px] text-text-muted">
                      {t("versions.code")}
                      <textarea
                        className={`${CODE_FIELD_CLASS} min-h-[140px]`}
                        value={versionDraft.code}
                        onChange={(event) =>
                          setVersionDraft((current) => ({ ...current, code: event.target.value }))
                        }
                      />
                    </label>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="grid gap-1 text-[11px] text-text-muted">
                        {t("versions.runtime")}
                        <input
                          className={FIELD_CLASS}
                          value={versionDraft.runtime}
                          onChange={(event) =>
                            setVersionDraft((current) => ({
                              ...current,
                              runtime: event.target.value
                            }))
                          }
                        />
                      </label>
                      <label className="grid gap-1 text-[11px] text-text-muted">
                        {t("versions.entryCommand")}
                        <input
                          className={CODE_FIELD_CLASS}
                          value={versionDraft.entryCommand}
                          onChange={(event) =>
                            setVersionDraft((current) => ({
                              ...current,
                              entryCommand: event.target.value
                            }))
                          }
                        />
                        <span className="text-[10px]">{t("versions.entryCommandHint")}</span>
                      </label>
                      <label className="grid gap-1 text-[11px] text-text-muted md:col-span-2">
                        {t("versions.workingDirectory")}
                        <input
                          className={FIELD_CLASS}
                          value={versionDraft.workingDirectory}
                          onChange={(event) =>
                            setVersionDraft((current) => ({
                              ...current,
                              workingDirectory: event.target.value
                            }))
                          }
                        />
                        <span className="text-[10px]">{t("versions.workingDirectoryHint")}</span>
                      </label>
                    </div>
                    <label className="grid gap-1 text-[11px] text-text-muted">
                      {t("versions.environment")}
                      <textarea
                        className={`${CODE_FIELD_CLASS} min-h-[64px]`}
                        value={versionDraft.environmentJson}
                        onChange={(event) =>
                          setVersionDraft((current) => ({
                            ...current,
                            environmentJson: event.target.value
                          }))
                        }
                      />
                      <span className="text-[10px]">{t("versions.environmentHint")}</span>
                    </label>
                    <label className="flex items-start gap-2 text-[11px] text-text-muted">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={versionDraft.browserCapabilityEnabled}
                        onChange={(event) =>
                          setVersionDraft((current) => ({
                            ...current,
                            browserCapabilityEnabled: event.target.checked
                          }))
                        }
                      />
                      <span className="grid gap-0.5">
                        <span className="text-text">{t("versions.browserCapability")}</span>
                        <span className="text-[10px]">{t("versions.browserCapabilityHint")}</span>
                      </span>
                    </label>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="grid gap-1 text-[11px] text-text-muted">
                        {t("versions.inputSchema")}
                        <textarea
                          className={`${CODE_FIELD_CLASS} min-h-[100px]`}
                          value={versionDraft.inputSchemaJson}
                          onChange={(event) =>
                            setVersionDraft((current) => ({
                              ...current,
                              inputSchemaJson: event.target.value
                            }))
                          }
                        />
                      </label>
                      <label className="grid gap-1 text-[11px] text-text-muted">
                        {t("versions.outputSchema")}
                        <textarea
                          className={`${CODE_FIELD_CLASS} min-h-[100px]`}
                          value={versionDraft.outputSchemaJson}
                          onChange={(event) =>
                            setVersionDraft((current) => ({
                              ...current,
                              outputSchemaJson: event.target.value
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div>
                      <h3 className="text-[11px] font-semibold text-text-muted">
                        {t("versions.limits")}
                      </h3>
                      <div className="mt-1 grid gap-3 md:grid-cols-4">
                        <label className="grid gap-1 text-[11px] text-text-muted">
                          {t("versions.timeoutMs")}
                          <input
                            className={FIELD_CLASS}
                            value={versionDraft.timeoutMs}
                            onChange={(event) =>
                              setVersionDraft((current) => ({
                                ...current,
                                timeoutMs: event.target.value
                              }))
                            }
                          />
                        </label>
                        <label className="grid gap-1 text-[11px] text-text-muted">
                          {t("versions.maxMemoryMb")}
                          <input
                            className={FIELD_CLASS}
                            value={versionDraft.maxMemoryMb}
                            onChange={(event) =>
                              setVersionDraft((current) => ({
                                ...current,
                                maxMemoryMb: event.target.value
                              }))
                            }
                          />
                        </label>
                        <label className="grid gap-1 text-[11px] text-text-muted">
                          {t("versions.maxCpuMillicores")}
                          <input
                            className={FIELD_CLASS}
                            value={versionDraft.maxCpuMillicores}
                            onChange={(event) =>
                              setVersionDraft((current) => ({
                                ...current,
                                maxCpuMillicores: event.target.value
                              }))
                            }
                          />
                        </label>
                        <label className="grid gap-1 text-[11px] text-text-muted">
                          {t("versions.maxOutputBytes")}
                          <input
                            className={FIELD_CLASS}
                            value={versionDraft.maxOutputBytes}
                            onChange={(event) =>
                              setVersionDraft((current) => ({
                                ...current,
                                maxOutputBytes: event.target.value
                              }))
                            }
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  {draftVersion !== null ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-text-muted">
                        {t("versions.revision", { revision: draftVersion.revision })}
                      </span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                        disabled={versionSaving}
                        onClick={() => void handleSaveDraftVersion()}
                      >
                        {versionSaving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="h-3.5 w-3.5" />
                        )}
                        {t("versions.saveDraft")}
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-text disabled:opacity-50"
                        disabled={versionSaving}
                        onClick={() => void handleValidateDraftVersion()}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {t("versions.validate")}
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-text disabled:opacity-50"
                        disabled={versionSaving}
                        onClick={() => void handlePublishDraftVersion()}
                      >
                        <Rocket className="h-3.5 w-3.5" />
                        {t("versions.publish")}
                      </button>
                    </div>
                  ) : null}

                  <div className="mt-4">
                    <h3 className="text-[11px] font-semibold text-text-muted">
                      {t("versions.history")}
                    </h3>
                    {publishedVersions.length === 0 ? (
                      <p className="mt-1 text-[11px] text-text-muted">
                        {t("versions.historyEmpty")}
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {publishedVersions.map((version) => (
                          <li
                            key={version.id}
                            className="rounded border border-border bg-surface px-2 py-1 text-[11px] text-text-muted"
                          >
                            v{version.version} · {t("statuses.published")}
                            {version.publishedAt
                              ? ` · ${t("versions.publishedAt", { date: version.publishedAt })}`
                              : ""}
                            {version.contentHash
                              ? ` · ${t("versions.contentHash")} ${version.contentHash.slice(0, 12)}`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </fieldset>
              ) : null}
            </div>
          ) : null}

          <div className="mt-6 rounded-lg border border-border bg-background p-3">
            <h2 className="text-xs font-semibold text-text">{t("bindings.title")}</h2>
            <p className="mt-1 text-[11px] text-text-muted">{t("bindings.hint")}</p>

            <label className="mt-2 grid gap-1 text-[11px] text-text-muted">
              {t("bindings.selectSkill")}
              <select
                className={FIELD_CLASS}
                value={selectedSkillId}
                onChange={(event) => void handleSelectSkill(event.target.value)}
              >
                <option value="">{t("bindings.selectSkillPlaceholder")}</option>
                {activeSkills.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {preferredText(skill.name, uiLocale, t("untitled"))}
                  </option>
                ))}
              </select>
            </label>

            {bindingsFeedback ? (
              <div className="mt-2 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] text-text">
                {bindingsFeedback}
              </div>
            ) : null}

            {!selectedSkillId ? (
              <p className="mt-3 text-[11px] text-text-muted">{t("bindings.noSkillSelected")}</p>
            ) : bindingsLoading ? (
              <div className="mt-3 flex items-center gap-2 text-[11px] text-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("bindings.loading")}
              </div>
            ) : (
              <fieldset disabled={bindingsSaving} className="contents">
                {publishedScripts.length === 0 ? (
                  <p className="mt-3 text-[11px] text-text-muted">
                    {t("bindings.noPublishedScripts")}
                  </p>
                ) : (
                  <>
                    <p className="mt-3 text-[10px] text-text-subtle">
                      {t("bindings.onlyPublished")}
                    </p>
                    <ul className="mt-1 space-y-2">
                      {publishedScripts.map((script) => {
                        const selected = skillScriptIds.includes(script.id);
                        const orderIndex = skillScriptIds.indexOf(script.id);
                        return (
                          <li
                            key={script.id}
                            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                          >
                            <input
                              type="checkbox"
                              aria-label={t("bindings.toggleScript", {
                                name: preferredText(script.name, uiLocale, t("untitled"))
                              })}
                              checked={selected}
                              disabled={bindingsSaving}
                              onChange={() => toggleBoundScript(script.id)}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs text-text">
                                {preferredText(script.name, uiLocale, t("untitled"))}
                              </div>
                              <div className="truncate text-[10px] text-text-muted">
                                {script.key}
                              </div>
                            </div>
                            {selected ? (
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-text-muted">
                                  {orderIndex + 1}
                                </span>
                                <button
                                  type="button"
                                  className="rounded border border-border px-1.5 text-[10px]"
                                  onClick={() =>
                                    setSkillScriptIds((current) =>
                                      moveScriptId(current, script.id, -1)
                                    )
                                  }
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  className="rounded border border-border px-1.5 text-[10px]"
                                  onClick={() =>
                                    setSkillScriptIds((current) =>
                                      moveScriptId(current, script.id, 1)
                                    )
                                  }
                                >
                                  ↓
                                </button>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
                {skillScriptIds
                  .filter((scriptId) => !scriptById.has(scriptId))
                  .map((scriptId) => (
                    <p key={scriptId} className="mt-2 text-[11px] text-text-muted">
                      {t("bindings.linkedUnavailable", { scriptId })}
                    </p>
                  ))}
                <button
                  type="button"
                  className="mt-3 inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  disabled={bindingsSaving}
                  onClick={() => void handleSaveBindings()}
                >
                  {bindingsSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {t("bindings.save")}
                </button>
              </fieldset>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
