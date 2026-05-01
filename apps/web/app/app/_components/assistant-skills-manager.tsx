"use client";

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, GraduationCap, Loader2 } from "lucide-react";
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
};

type SkillReadiness = "ready" | "processing" | "needs_review" | "failed" | "empty";

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
  disabled = false
}: AssistantSkillsManagerProps) {
  const t = useTranslations("skills");
  const locale = useLocale();
  const sortedSkills = useMemo(() => state?.skills ?? [], [state?.skills]);
  const enabledCount = getEnabledSkillCount(selectedSkillIds);
  const limit = state?.limit ?? null;
  const overLimit = isSkillSelectionOverLimit(selectedSkillIds, limit);

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-surface p-4">
        <div>
          <p className="text-sm font-semibold text-text">
            {limit === null
              ? t("counterUnlimited", { count: enabledCount })
              : t("counterLimited", { count: enabledCount, limit })}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            {mode === "setup" ? t("setupHelp") : t("settingsHelp")}
          </p>
        </div>
        {saving ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("saving")}
          </span>
        ) : (
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
              overLimit
                ? "border-warning/30 bg-warning/10 text-warning"
                : "border-success/25 bg-success/10 text-success"
            )}
          >
            {overLimit ? (
              <AlertTriangle className="h-3 w-3" />
            ) : (
              <CheckCircle2 className="h-3 w-3" />
            )}
            {overLimit ? t("overLimit") : t("withinLimit")}
          </span>
        )}
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="grid gap-3 md:grid-cols-2">
        {sortedSkills.map((item) => {
          const checked = selectedSkillIds.includes(item.skill.id);
          const disabledReason = getSkillDisabledReason(item, selectedSkillIds, limit);
          const cardDisabled = disabled || saving || (!checked && disabledReason !== null);
          const readiness = summarizeSkillReadiness(item);
          return (
            <label
              key={item.skill.id}
              className={cn(
                "group flex cursor-pointer gap-3 rounded-2xl border p-4 text-left transition-all",
                checked
                  ? "border-accent/70 bg-accent/10 shadow-[0_0_24px_var(--accent-glow)]"
                  : "border-border bg-surface hover:border-border-strong hover:bg-surface-hover",
                cardDisabled && "cursor-not-allowed opacity-65"
              )}
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 accent-accent"
                checked={checked}
                disabled={cardDisabled}
                onChange={(event) =>
                  onChange(
                    toggleSkillSelection(selectedSkillIds, item.skill.id, event.target.checked)
                  )
                }
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text">
                      {item.skill.iconEmoji ? `${item.skill.iconEmoji} ` : ""}
                      {resolveLocalizedText(item.skill.name, locale, "Untitled Skill")}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-muted">
                      {resolveLocalizedText(item.skill.description, locale, "") ||
                        item.skill.category}
                    </p>
                  </div>
                  <GraduationCap className="h-4 w-4 shrink-0 text-text-subtle" />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-medium uppercase tracking-wide">
                  <span className="rounded-full bg-surface-raised px-2 py-0.5 text-text-subtle">
                    {item.skill.category}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5",
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
                {disabledReason ? (
                  <p className="mt-3 text-[11px] leading-relaxed text-text-subtle">
                    {t(`disabledReason.${disabledReason}`)}
                  </p>
                ) : null}
              </div>
            </label>
          );
        })}
      </div>
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
