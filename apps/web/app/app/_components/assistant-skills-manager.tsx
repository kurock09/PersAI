"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import type { AssistantSkillCatalogItemState, AssistantSkillsState } from "../assistant-api-client";

type AssistantSkillsManagerProps = {
  state: AssistantSkillsState | null;
  selectedSkillIds: string[];
  onChange: (skillIds: string[]) => void;
  loading?: boolean;
  saving?: boolean;
  error?: string | null;
  mode?: "setup" | "settings";
  disabled?: boolean;
  collapsible?: boolean;
  initialVisibleCount?: number;
};

type SkillReadiness = "ready" | "processing" | "needs_review" | "failed" | "empty";

const SKILL_GROUP_LABELS: Record<string, { en: string; ru: string }> = {
  work: { en: "Work", ru: "Работа" },
  engineering: { en: "Engineering", ru: "Профессии / Engineering" },
  personal: { en: "Personal", ru: "Личное" },
  education: { en: "Education", ru: "Образование" }
};

export function getEnabledSkillCount(skillIds: string[]): number {
  return new Set(skillIds).size;
}

export function isSkillSelectionOverLimit(skillIds: string[], limit: number | null): boolean {
  return limit !== null && getEnabledSkillCount(skillIds) > limit;
}

export function resolveSkillDisplayName(
  item: AssistantSkillCatalogItemState,
  locale: string
): string {
  return resolveLocalizedText(item.skill.name, locale, "Untitled Skill");
}

export function resolveSkillDescription(
  item: AssistantSkillCatalogItemState,
  locale: string
): string {
  return resolveLocalizedText(item.skill.description, locale, "");
}

export function resolveSkillGroupLabel(category: string, locale: string): string {
  const group = SKILL_GROUP_LABELS[category.trim().toLowerCase()];
  if (group === undefined) {
    return category;
  }
  return resolveLocalizedText(group, locale, category);
}

export function summarizeSkillReadiness(item: AssistantSkillCatalogItemState): SkillReadiness {
  if (item.skill.documents.length === 0) {
    return "empty";
  }
  if (item.skill.documents.some((document) => document.status === "failed")) {
    return "failed";
  }
  if (item.skill.documents.some((document) => document.status === "needs_review")) {
    return "needs_review";
  }
  if (item.skill.documents.some((document) => document.status === "processing")) {
    return "processing";
  }
  return "ready";
}

export function getSkillDisabledReason(
  item: AssistantSkillCatalogItemState,
  selectedSkillIds: string[],
  limit: number | null
): string | null {
  if (item.disabledReason !== null) {
    return item.disabledReason;
  }
  if (item.skill.status !== "active") {
    return "skill_archived";
  }
  if (
    limit !== null &&
    !selectedSkillIds.includes(item.skill.id) &&
    getEnabledSkillCount(selectedSkillIds) >= limit
  ) {
    return "skill_limit_reached";
  }
  return null;
}

export function toggleSkillSelection(
  selectedSkillIds: string[],
  skillId: string,
  enabled: boolean
): string[] {
  const selected = new Set(selectedSkillIds);
  if (enabled) {
    selected.add(skillId);
  } else {
    selected.delete(skillId);
  }
  return [...selected];
}

export function AssistantSkillsManager({
  state,
  selectedSkillIds,
  onChange,
  loading = false,
  saving = false,
  error = null,
  mode = "settings",
  disabled = false,
  collapsible = false,
  initialVisibleCount = 2
}: AssistantSkillsManagerProps) {
  const t = useTranslations("skills");
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const selectedSkillIdSet = useMemo(() => new Set(selectedSkillIds), [selectedSkillIds]);
  const sortedSkills = useMemo(() => {
    const skills = state?.skills ?? [];
    return [...skills].sort((left, right) => {
      const leftSelected = selectedSkillIdSet.has(left.skill.id);
      const rightSelected = selectedSkillIdSet.has(right.skill.id);
      if (leftSelected !== rightSelected) {
        return leftSelected ? -1 : 1;
      }
      return resolveLocalizedText(left.skill.name, locale, "").localeCompare(
        resolveLocalizedText(right.skill.name, locale, ""),
        locale
      );
    });
  }, [locale, selectedSkillIdSet, state?.skills]);
  const enabledCount = getEnabledSkillCount(selectedSkillIds);
  const limit = state?.limit ?? null;
  const overLimit = isSkillSelectionOverLimit(selectedSkillIds, limit);
  const countLabel =
    limit === null
      ? t("compactCounterUnlimited", { count: enabledCount })
      : t("compactCounterLimited", { count: enabledCount, limit });
  const visibleSkills =
    collapsible && !expanded ? sortedSkills.slice(0, initialVisibleCount) : sortedSkills;
  const hiddenSkillCount = Math.max(0, sortedSkills.length - visibleSkills.length);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface p-4 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin text-accent" />
        {t("loading")}
      </div>
    );
  }

  if (state !== null && sortedSkills.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface p-5 text-sm text-text-muted">
        <p className="font-medium text-text">{t("emptyTitle")}</p>
        <p className="mt-1 text-xs leading-relaxed">{t("emptyBody")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border/70 bg-surface/70 p-4 shadow-[0_18px_44px_rgba(0,0,0,0.16)]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">{t("title")}</p>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-text-muted">
              {mode === "setup" ? t("setupHelp") : t("settingsHelp")}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p
              className={cn(
                "text-sm font-semibold tabular-nums",
                overLimit ? "text-warning" : "text-text"
              )}
            >
              {countLabel}
            </p>
            {saving ? (
              <span className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-accent">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("saving")}
              </span>
            ) : overLimit ? (
              <span className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-warning">
                <AlertTriangle className="h-3 w-3" />
                {t("overLimit")}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className={collapsible ? "" : "max-h-[8.75rem] overflow-y-auto pr-1"}>
        <div className="grid gap-2 sm:grid-cols-2">
          {visibleSkills.map((item) => {
            const checked = selectedSkillIds.includes(item.skill.id);
            const disabledReason = getSkillDisabledReason(item, selectedSkillIds, limit);
            const cardDisabled = disabled || saving || (!checked && disabledReason !== null);
            const readiness = summarizeSkillReadiness(item);
            return (
              <label
                key={item.skill.id}
                className={cn(
                  "group flex min-h-[8rem] cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-left transition-all",
                  checked
                    ? "border-accent/55 bg-accent/8 shadow-[0_0_18px_var(--accent-glow)]"
                    : "border-border/80 bg-surface/70 hover:border-border-strong hover:bg-surface-hover",
                  cardDisabled && "cursor-not-allowed opacity-65"
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  checked={checked}
                  disabled={cardDisabled}
                  onChange={(event) =>
                    onChange(
                      toggleSkillSelection(selectedSkillIds, item.skill.id, event.target.checked)
                    )
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
                      {item.skill.iconEmoji ? `${item.skill.iconEmoji} ` : ""}
                      {resolveLocalizedText(item.skill.name, locale, "Untitled Skill")}
                    </p>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        readiness === "ready" && "bg-success/10 text-success",
                        readiness === "processing" && "bg-accent/10 text-accent",
                        readiness === "needs_review" && "bg-warning/10 text-warning",
                        readiness === "failed" && "bg-destructive/10 text-destructive",
                        readiness === "empty" && "bg-surface-raised text-text-subtle"
                      )}
                    >
                      {t(`readiness.${readiness}`)}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-text-muted">
                    {resolveLocalizedText(item.skill.description, locale, "") ||
                      item.skill.category}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-text-subtle">
                    <span>{resolveSkillGroupLabel(item.skill.category, locale)}</span>
                    {item.skill.tags.slice(0, 2).map((tag) => (
                      <span key={tag} className="text-text-subtle/70">
                        {tag}
                      </span>
                    ))}
                  </div>
                  {disabledReason ? (
                    <p className="mt-2 text-[11px] leading-relaxed text-text-subtle">
                      {t(`disabledReason.${disabledReason}`)}
                    </p>
                  ) : null}
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {collapsible && hiddenSkillCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full rounded-xl border border-border/70 bg-surface/60 px-4 py-2 text-xs font-medium text-text-muted transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-text"
        >
          {t("showAll", { count: hiddenSkillCount })}
        </button>
      ) : collapsible && expanded && sortedSkills.length > initialVisibleCount ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="w-full rounded-xl border border-border/70 bg-surface/60 px-4 py-2 text-xs font-medium text-text-muted transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-text"
        >
          {t("showLess")}
        </button>
      ) : null}
    </div>
  );
}

function resolveLocalizedText(
  value: Record<string, string>,
  locale: string,
  fallback: string
): string {
  const normalizedLocale = locale.toLowerCase();
  if (normalizedLocale.startsWith("ru")) {
    return value.ru?.trim() || value.en?.trim() || Object.values(value)[0]?.trim() || fallback;
  }
  return value.en?.trim() || value.ru?.trim() || Object.values(value)[0]?.trim() || fallback;
}
