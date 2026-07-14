"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useLocale, useTranslations } from "next-intl";
import { Archive, Loader2, Plus, Save, Shield } from "lucide-react";
import {
  archiveAdminRole,
  createAdminRole,
  getAdminRoles,
  getAdminSkills,
  previewAdminRole,
  replaceAdminRoleSkills,
  updateAdminRole,
  type AdminRoleCreateRequest,
  type AdminRolePreviewState,
  type AdminRoleState,
  type AdminRoleUpdateRequest,
  type AdminSkillState
} from "@/app/app/assistant-api-client";
import { getAdminSessionToken } from "@/app/admin/admin-session";

type UiLocale = "en" | "ru";

type RoleDraft = {
  id: string | null;
  key: string;
  status: "draft" | "active" | "archived";
  nameEn: string;
  nameRu: string;
  descriptionEn: string;
  descriptionRu: string;
  missionEn: string;
  missionRu: string;
  category: string;
  iconEmoji: string;
  color: string;
  displayOrder: string;
  skillIds: string[];
  isDefault: boolean;
  assistantCount: number;
  inUse: boolean;
};

const ROLE_KEY_REGEX = /^[a-z][a-z0-9_]{1,63}$/;

const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-text outline-none transition-colors placeholder:text-text-subtle focus:border-border-strong disabled:opacity-50";

const EMPTY_ROLE_DRAFT: RoleDraft = {
  id: null,
  key: "",
  status: "draft",
  nameEn: "",
  nameRu: "",
  descriptionEn: "",
  descriptionRu: "",
  missionEn: "",
  missionRu: "",
  category: "general",
  iconEmoji: "",
  color: "",
  displayOrder: "100",
  skillIds: [],
  isDefault: false,
  assistantCount: 0,
  inUse: false
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

export function roleToDraft(role: AdminRoleState | null): RoleDraft {
  if (role === null) {
    return { ...EMPTY_ROLE_DRAFT };
  }
  return {
    id: role.id,
    key: role.key,
    status: role.status,
    nameEn: role.name.en ?? "",
    nameRu: role.name.ru ?? "",
    descriptionEn: role.description.en ?? "",
    descriptionRu: role.description.ru ?? "",
    missionEn: role.mission.en ?? "",
    missionRu: role.mission.ru ?? "",
    category: role.category,
    iconEmoji: role.iconEmoji ?? "",
    color: role.color ?? "",
    displayOrder: String(role.displayOrder),
    skillIds: [...role.skillIds],
    isDefault: role.isDefault,
    assistantCount: role.assistantCount,
    inUse: role.inUse
  };
}

export function validateRoleDraft(draft: RoleDraft, mode: "create" | "update"): string | null {
  if (mode === "create" && !ROLE_KEY_REGEX.test(draft.key.trim())) {
    return "invalidKey";
  }
  if (!draft.nameEn.trim() || !draft.nameRu.trim()) {
    return "localizedName";
  }
  if (!draft.descriptionEn.trim() || !draft.descriptionRu.trim()) {
    return "localizedDescription";
  }
  if (!draft.missionEn.trim() || !draft.missionRu.trim()) {
    return "localizedMission";
  }
  if (!draft.category.trim()) {
    return "category";
  }
  if (draft.displayOrder.trim() && !/^-?\d+$/.test(draft.displayOrder.trim())) {
    return "displayOrder";
  }
  if (draft.isDefault && draft.status !== "active") {
    return "defaultStatus";
  }
  if (draft.isDefault && draft.skillIds.length > 0) {
    return "defaultSkills";
  }
  if (draft.inUse && draft.status !== "active") {
    return "inUseStatus";
  }
  return null;
}

export function draftToCreatePayload(draft: RoleDraft): AdminRoleCreateRequest {
  const error = validateRoleDraft(draft, "create");
  if (error) {
    throw new Error(error);
  }
  return {
    key: draft.key.trim(),
    name: { en: draft.nameEn.trim(), ru: draft.nameRu.trim() },
    description: { en: draft.descriptionEn.trim(), ru: draft.descriptionRu.trim() },
    mission: { en: draft.missionEn.trim(), ru: draft.missionRu.trim() },
    category: draft.category.trim(),
    iconEmoji: draft.iconEmoji.trim() || null,
    color: draft.color.trim() || null,
    displayOrder: draft.displayOrder.trim() ? Number(draft.displayOrder.trim()) : null,
    status: draft.status
  };
}

export function draftToUpdatePayload(draft: RoleDraft): AdminRoleUpdateRequest {
  const error = validateRoleDraft(draft, "update");
  if (error) {
    throw new Error(error);
  }
  return {
    name: { en: draft.nameEn.trim(), ru: draft.nameRu.trim() },
    description: { en: draft.descriptionEn.trim(), ru: draft.descriptionRu.trim() },
    mission: { en: draft.missionEn.trim(), ru: draft.missionRu.trim() },
    category: draft.category.trim(),
    iconEmoji: draft.iconEmoji.trim() || null,
    color: draft.color.trim() || null,
    displayOrder: draft.displayOrder.trim() ? Number(draft.displayOrder.trim()) : null,
    status: draft.status
  };
}

function moveSkill(skillIds: string[], skillId: string, direction: -1 | 1): string[] {
  const index = skillIds.indexOf(skillId);
  if (index < 0) {
    return skillIds;
  }
  const next = index + direction;
  if (next < 0 || next >= skillIds.length) {
    return skillIds;
  }
  const copy = [...skillIds];
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item!);
  return copy;
}

export default function AdminRolesPage() {
  const { getToken } = useAuth();
  const locale = useLocale();
  const uiLocale: UiLocale = locale.toLowerCase().startsWith("ru") ? "ru" : "en";
  const t = useTranslations("adminRoles");
  const [roles, setRoles] = useState<AdminRoleState[]>([]);
  const [skills, setSkills] = useState<AdminSkillState[]>([]);
  const [draft, setDraft] = useState<RoleDraft>({ ...EMPTY_ROLE_DRAFT });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [preview, setPreview] = useState<AdminRolePreviewState | null>(null);
  const [previewLocale, setPreviewLocale] = useState<UiLocale>("en");

  const activeSkills = useMemo(() => skills.filter((skill) => skill.status === "active"), [skills]);
  const skillById = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills]);

  async function loadAll() {
    setLoading(true);
    setFeedback(null);
    try {
      const token = await getAdminSessionToken(getToken).catch(() => null);
      if (!token) {
        setFeedback(t("errors.notSignedIn"));
        return;
      }
      const [nextRoles, nextSkills] = await Promise.all([
        getAdminRoles(token),
        getAdminSkills(token)
      ]);
      setRoles(nextRoles);
      setSkills(nextSkills);
      if (draft.id) {
        const selected = nextRoles.find((role) => role.id === draft.id) ?? null;
        setDraft(roleToDraft(selected));
      }
    } catch (error) {
      setFeedback(uiLocale === "en" && error instanceof Error ? error.message : t("errors.load"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // initial catalog load only
  }, []);

  function selectRole(role: AdminRoleState | null) {
    setFeedback(null);
    setPreview(null);
    setDraft(roleToDraft(role));
  }

  async function handleSave() {
    setSaving(true);
    setFeedback(null);
    let coreSaved = false;
    try {
      const validation = validateRoleDraft(draft, draft.id === null ? "create" : "update");
      if (validation) {
        setFeedback(t(`validation.${validation}`));
        return;
      }
      const token = await getAdminSessionToken(getToken);
      if (!token) {
        setFeedback(t("errors.notSignedIn"));
        return;
      }
      const saved =
        draft.id === null
          ? await createAdminRole(token, draftToCreatePayload(draft))
          : await updateAdminRole(token, draft.id, draftToUpdatePayload(draft));
      coreSaved = true;
      if (draft.id !== null) {
        const skillsChanged =
          saved.skillIds.length !== draft.skillIds.length ||
          saved.skillIds.some((skillId, index) => skillId !== draft.skillIds[index]);
        if (skillsChanged && !draft.isDefault) {
          const withSkills = await replaceAdminRoleSkills(token, saved.id, {
            skillIds: draft.skillIds
          });
          setDraft(roleToDraft(withSkills));
          setFeedback(t("skillsSaved"));
        } else {
          setDraft(roleToDraft(saved));
          setFeedback(t("saved"));
        }
      } else if (draft.skillIds.length > 0) {
        const withSkills = await replaceAdminRoleSkills(token, saved.id, {
          skillIds: draft.skillIds
        });
        setDraft(roleToDraft(withSkills));
        setFeedback(t("skillsSaved"));
      } else {
        setDraft(roleToDraft(saved));
        setFeedback(t("saved"));
      }
      const nextRoles = await getAdminRoles(token);
      setRoles(nextRoles);
    } catch (error) {
      const token = await getAdminSessionToken(getToken).catch(() => null);
      if (coreSaved && token) {
        const canonical = await getAdminRoles(token).catch(() => []);
        setRoles(canonical);
        const selected = canonical.find((role) => role.id === draft.id || role.key === draft.key);
        if (selected) {
          setDraft(roleToDraft(selected));
        }
        setFeedback(t("errors.partialSave"));
      } else {
        setFeedback(uiLocale === "en" && error instanceof Error ? error.message : t("errors.save"));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    if (draft.id === null || draft.isDefault || draft.inUse) {
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const token = await getAdminSessionToken(getToken);
      if (!token) {
        setFeedback(t("errors.notSignedIn"));
        return;
      }
      await archiveAdminRole(token, draft.id);
      setFeedback(t("archived"));
      setDraft({ ...EMPTY_ROLE_DRAFT });
      const nextRoles = await getAdminRoles(token);
      setRoles(nextRoles);
    } catch (error) {
      setFeedback(
        uiLocale === "en" && error instanceof Error ? error.message : t("errors.archive")
      );
    } finally {
      setSaving(false);
    }
  }

  async function handlePreview() {
    setPreviewing(true);
    setFeedback(null);
    try {
      if (!draft.missionEn.trim() || !draft.missionRu.trim()) {
        setFeedback(t("validation.localizedMission"));
        return;
      }
      const token = await getAdminSessionToken(getToken);
      if (!token) {
        setFeedback(t("errors.notSignedIn"));
        return;
      }
      const next = await previewAdminRole(token, {
        locale: previewLocale,
        mission: {
          en: draft.missionEn.trim(),
          ru: draft.missionRu.trim()
        },
        skillIds: draft.skillIds
      });
      setPreview(next);
    } catch (error) {
      setFeedback(
        uiLocale === "en" && error instanceof Error ? error.message : t("errors.preview")
      );
    } finally {
      setPreviewing(false);
    }
  }

  function toggleSkill(skillId: string) {
    if (draft.isDefault) {
      return;
    }
    setDraft((current) => {
      if (current.skillIds.includes(skillId)) {
        return { ...current, skillIds: current.skillIds.filter((id) => id !== skillId) };
      }
      return { ...current, skillIds: [...current.skillIds, skillId] };
    });
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
            onClick={() => selectRole(null)}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("newRole")}
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
          ) : roles.length === 0 ? (
            <div className="px-3 py-4 text-xs text-text-muted">{t("empty")}</div>
          ) : (
            <ul className="divide-y divide-border">
              {roles.map((role) => {
                const selected = draft.id === role.id;
                return (
                  <li key={role.id}>
                    <button
                      type="button"
                      onClick={() => selectRole(role)}
                      className={`flex w-full items-start gap-2 px-3 py-3 text-left transition-colors ${
                        selected ? "bg-accent/10" : "hover:bg-background"
                      }`}
                    >
                      <span className="mt-0.5 text-sm">{role.iconEmoji || "◈"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-xs font-medium text-text">
                            {preferredText(role.name, uiLocale, t("untitled"))}
                          </span>
                          {role.isDefault ? (
                            <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
                              {t("defaultBadge")}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                          {role.key} · {t(`statuses.${role.status}`)} · {role.skillIds.length}
                          {role.inUse
                            ? ` · ${t("assistantCount", { count: role.assistantCount })}`
                            : ""}
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
          {draft.id === null && !draft.key && roles.length > 0 && !feedback ? (
            <p className="text-xs text-text-muted">{t("selectRole")}</p>
          ) : null}

          {draft.isDefault ? (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2 text-[11px] text-text-muted">
              <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t("defaultProtected")}</span>
            </div>
          ) : null}
          {draft.inUse ? (
            <div className="mb-4 rounded-lg border border-border bg-background px-3 py-2 text-[11px] text-text-muted">
              {t("inUseProtected", { count: draft.assistantCount })}
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
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
            <label className="grid gap-1 text-[11px] text-text-muted">
              {t("status")}
              <select
                className={FIELD_CLASS}
                value={draft.status}
                disabled={draft.isDefault || draft.inUse}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    status: event.target.value as RoleDraft["status"]
                  }))
                }
              >
                <option value="draft">{t("statuses.draft")}</option>
                <option value="active">{t("statuses.active")}</option>
                <option value="archived">{t("statuses.archived")}</option>
              </select>
            </label>
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
            <label className="grid gap-1 text-[11px] text-text-muted md:col-span-2">
              {t("missionEn")}
              <textarea
                className={`${FIELD_CLASS} min-h-[72px]`}
                value={draft.missionEn}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, missionEn: event.target.value }))
                }
              />
            </label>
            <label className="grid gap-1 text-[11px] text-text-muted md:col-span-2">
              {t("missionRu")}
              <textarea
                className={`${FIELD_CLASS} min-h-[72px]`}
                value={draft.missionRu}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, missionRu: event.target.value }))
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
                value={draft.iconEmoji}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, iconEmoji: event.target.value }))
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
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-semibold text-text">{t("skills")}</h2>
                <p className="text-[11px] text-text-muted">{t("skillsHint")}</p>
              </div>
            </div>
            {activeSkills.length === 0 ? (
              <p className="text-[11px] text-text-muted">{t("noSkills")}</p>
            ) : (
              <ul className="space-y-2">
                {activeSkills.map((skill) => {
                  const selected = draft.skillIds.includes(skill.id);
                  const orderIndex = draft.skillIds.indexOf(skill.id);
                  return (
                    <li
                      key={skill.id}
                      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        aria-label={t("toggleSkill", {
                          name: preferredText(skill.name, uiLocale, t("untitled"))
                        })}
                        checked={selected}
                        disabled={draft.isDefault}
                        onChange={() => toggleSkill(skill.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs text-text">
                          {preferredText(skill.name, uiLocale, t("untitled"))}
                        </div>
                        <div className="truncate text-[10px] text-text-muted">{skill.category}</div>
                      </div>
                      {selected ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-text-muted">{orderIndex + 1}</span>
                          <button
                            type="button"
                            className="rounded border border-border px-1.5 text-[10px]"
                            disabled={draft.isDefault}
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                skillIds: moveSkill(current.skillIds, skill.id, -1)
                              }))
                            }
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="rounded border border-border px-1.5 text-[10px]"
                            disabled={draft.isDefault}
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                skillIds: moveSkill(current.skillIds, skill.id, 1)
                              }))
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
            )}
            {draft.skillIds
              .filter((skillId) => !skillById.has(skillId))
              .map((skillId) => (
                <p key={skillId} className="mt-2 text-[11px] text-text-muted">
                  {t("linkedUnavailable", { skillId })}
                </p>
              ))}
          </div>

          <div className="mt-5 rounded-lg border border-border bg-background p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-xs font-semibold text-text">{t("preview")}</h2>
              <select
                aria-label={t("previewLocale")}
                className="rounded border border-border bg-surface px-2 py-1 text-[11px]"
                value={previewLocale}
                onChange={(event) => setPreviewLocale(event.target.value as UiLocale)}
              >
                <option value="en">EN</option>
                <option value="ru">RU</option>
              </select>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px]"
                disabled={previewing}
                onClick={() => void handlePreview()}
              >
                {previewing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {t("preview")}
              </button>
            </div>
            {preview === null ? (
              <p className="text-[11px] text-text-muted">{t("previewEmpty")}</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-text-muted">
                    {t("missionBlock")}
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-surface p-2 text-[11px] text-text">
                    {preview.missionBlock || "—"}
                  </pre>
                </div>
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-text-muted">
                    {t("enabledSkillsBlock")}
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-surface p-2 text-[11px] text-text">
                    {preview.enabledSkillsBlock || "—"}
                  </pre>
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {t("save")}
            </button>
            {draft.id !== null && !draft.isDefault ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-text disabled:opacity-50"
                disabled={saving || draft.inUse}
                title={draft.inUse ? t("inUseArchiveBlocked") : undefined}
                onClick={() => void handleArchive()}
              >
                <Archive className="h-3.5 w-3.5" />
                {t("archive")}
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
