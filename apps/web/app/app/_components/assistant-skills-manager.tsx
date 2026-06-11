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

const SKILL_GROUP_ORDER = ["personal", "work", "engineering", "education"] as const;

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

export function getSkillGroupRank(category: string): number {
  const normalized = category.trim().toLowerCase();
  const index = SKILL_GROUP_ORDER.indexOf(normalized as (typeof SKILL_GROUP_ORDER)[number]);
  return index >= 0 ? index : SKILL_GROUP_ORDER.length;
}

export function orderSkillCatalogItems(
  items: AssistantSkillCatalogItemState[],
  selectedSkillIds: Set<string>,
  locale: string
): AssistantSkillCatalogItemState[] {
  return [...items].sort((left, right) => {
    const groupRankDelta =
      getSkillGroupRank(left.skill.category) - getSkillGroupRank(right.skill.category);
    if (groupRankDelta !== 0) {
      return groupRankDelta;
    }
    const leftSelected = selectedSkillIds.has(left.skill.id);
    const rightSelected = selectedSkillIds.has(right.skill.id);
    if (leftSelected !== rightSelected) {
      return leftSelected ? -1 : 1;
    }
    return resolveLocalizedText(left.skill.name, locale, "").localeCompare(
      resolveLocalizedText(right.skill.name, locale, ""),
      locale
    );
  });
}

export function resolveVisibleSkillCatalogItems(
  items: AssistantSkillCatalogItemState[],
  input: {
    collapsible: boolean;
    expanded: boolean;
    initialVisibleCount: number;
  }
): AssistantSkillCatalogItemState[] {
  if (!input.collapsible || input.expanded) {
    return items;
  }
  return items.slice(0, input.initialVisibleCount);
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
  initialVisibleCount = 4
}: AssistantSkillsManagerProps) {
  const t = useTranslations("skills");
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const selectedSkillIdSet = useMemo(() => new Set(selectedSkillIds), [selectedSkillIds]);
  const sortedSkills = useMemo(
    () => orderSkillCatalogItems(state?.skills ?? [], selectedSkillIdSet, locale),
    [locale, selectedSkillIdSet, state?.skills]
  );
  const enabledCount = getEnabledSkillCount(selectedSkillIds);
  const limit = state?.limit ?? null;
  const overLimit = isSkillSelectionOverLimit(selectedSkillIds, limit);
  const skillsUnavailableByPlan = limit === 0;
  const countLabel =
    limit === null
      ? t("compactCounterUnlimited", { count: enabledCount })
      : t("compactCounterLimited", { count: enabledCount, limit });
  const visibleSkills = resolveVisibleSkillCatalogItems(sortedSkills, {
    collapsible,
    expanded,
    initialVisibleCount
  });
  const hiddenSkillCount = Math.max(0, sortedSkills.length - visibleSkills.length);
  const visibleGroups = useMemo(() => groupSkillCatalogItems(visibleSkills), [visibleSkills]);

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
    <div className="max-w-full space-y-3 overflow-x-hidden">
      <div className="px-1 py-1">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">{t("title")}</p>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-text-muted">
              {mode === "setup" ? t("setupHelp") : t("settingsHelp")}
            </p>
            {skillsUnavailableByPlan ? (
              <p className="mt-2 max-w-xl rounded-xl border border-warning/25 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
                {t("planUnavailableHint")}
              </p>
            ) : null}
          </div>
          <div className="shrink-0 sm:text-right">
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

      <div
        className={
          collapsible
            ? "max-w-full overflow-x-hidden"
            : "max-h-[8.75rem] max-w-full overflow-y-auto overflow-x-hidden pr-1"
        }
      >
        <div className="max-w-full space-y-3">
          {visibleGroups.map((group) => (
            <div key={group.category} className="max-w-full space-y-2.5 overflow-hidden">
              <p className="break-words text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                {resolveSkillGroupLabel(group.category, locale)}
              </p>
              <div
                className={cn(
                  "grid min-w-0 max-w-full gap-2.5",
                  mode === "setup" ? "md:grid-cols-2" : "2xl:grid-cols-2"
                )}
              >
                {group.items.map((item) => {
                  const checked = selectedSkillIds.includes(item.skill.id);
                  const disabledReason = getSkillDisabledReason(item, selectedSkillIds, limit);
                  const cardDisabled = disabled || saving || (!checked && disabledReason !== null);
                  return (
                    <label
                      key={item.skill.id}
                      className={cn(
                        "group flex min-h-[5.1rem] min-w-0 max-w-full cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all",
                        checked
                          ? "border-accent/50 bg-accent/8"
                          : "border-border/45 bg-background/35 hover:border-border/65 hover:bg-surface-hover/55",
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
                            toggleSkillSelection(
                              selectedSkillIds,
                              item.skill.id,
                              event.target.checked
                            )
                          )
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <div className="min-w-0">
                          <p className="break-words text-[15px] font-semibold leading-snug text-text">
                            {item.skill.iconEmoji ? `${item.skill.iconEmoji} ` : ""}
                            {resolveLocalizedText(item.skill.name, locale, "Untitled Skill")}
                          </p>
                        </div>
                        <p className="mt-0.5 line-clamp-2 break-words text-[11px] leading-5 text-text-muted">
                          {resolveLocalizedText(item.skill.description, locale, "") ||
                            item.skill.category}
                        </p>
                        {disabledReason ? (
                          <p className="mt-1.5 text-[11px] leading-relaxed text-text-subtle">
                            {t(`disabledReason.${disabledReason}`)}
                          </p>
                        ) : null}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
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

function groupSkillCatalogItems(
  items: AssistantSkillCatalogItemState[]
): Array<{ category: string; items: AssistantSkillCatalogItemState[] }> {
  const groups: Array<{ category: string; items: AssistantSkillCatalogItemState[] }> = [];
  for (const item of items) {
    const category = item.skill.category;
    const group = groups.find((candidate) => candidate.category === category);
    if (group === undefined) {
      groups.push({ category, items: [item] });
    } else {
      group.items.push(item);
    }
  }
  return groups;
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
