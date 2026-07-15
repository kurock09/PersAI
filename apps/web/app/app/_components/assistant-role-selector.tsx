"use client";

import { useState, type ReactNode } from "react";
import { ArrowLeft, Check, RefreshCcw, UserCog } from "lucide-react";
import { useLocale, useMessages, useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import type { AssistantRoleState } from "../assistant-api-client";

type AssistantRoleSelectorProps = {
  roles: AssistantRoleState[] | null;
  selectedRoleKey: string | null;
  onSelect: (roleKey: string) => void;
  title?: string;
  description?: string;
  currentRoleKey?: string | null;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  onRetry?: (() => void) | undefined;
  /** @deprecated Mission prompt is never shown in role selection UIs. */
  showCurrentMission?: boolean;
  embedded?: boolean;
};

type AssistantRoleCardProps = {
  role: AssistantRoleState;
  selected: boolean;
  current?: boolean;
  interactive?: boolean;
  disabled?: boolean;
  onClick?: (() => void) | undefined;
};

type MobilePane = "list" | "detail";

export function resolveLocalizedRoleText(
  value: Record<string, string>,
  locale: string,
  fallback = ""
): string {
  if (locale.toLowerCase().startsWith("ru")) {
    return value.ru || value.en || fallback;
  }
  return value.en || value.ru || fallback;
}

export function resolveRoleCategoryLabel(
  category: string,
  categoryLabels: Record<string, string> | undefined
): string {
  const normalized = category.trim().toLowerCase();
  return categoryLabels?.[normalized] ?? category;
}

export function resolveRoleIconFallback(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    return "?";
  }
  return trimmed.charAt(0).toUpperCase();
}

function normalizeRoleColor(color: string | null): string | null {
  if (typeof color !== "string") {
    return null;
  }
  const trimmed = color.trim();
  if (trimmed.length === 0 || trimmed.length > 32) {
    return null;
  }
  return trimmed;
}

/**
 * Shared role detail for Change Role modal and setup/recreate step 2.
 * Shows description + connected skills; never shows the model mission prompt.
 */
export function AssistantRoleDetailPane({
  role,
  locale,
  categoryLabels,
  skillsTitle,
  skillsEmpty,
  detailFallbackTitle = "Role"
}: {
  role: AssistantRoleState;
  locale: string;
  categoryLabels: Record<string, string> | undefined;
  skillsTitle: string;
  skillsEmpty: string;
  detailFallbackTitle?: string;
}) {
  const title = resolveLocalizedRoleText(role.name, locale, detailFallbackTitle);
  const description = resolveLocalizedRoleText(role.description, locale);
  const categoryLabel = resolveRoleCategoryLabel(role.category, categoryLabels);

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold tracking-[-0.02em] text-text">{title}</h3>
          <span className="rounded-md border border-border/60 px-2 py-0.5 text-[11px] text-text-subtle">
            {categoryLabel}
          </span>
        </div>
        {description ? (
          <p className="mt-2 text-sm leading-relaxed text-text-muted">{description}</p>
        ) : null}
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-subtle">
          {skillsTitle}
        </p>
        {role.skills.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">{skillsEmpty}</p>
        ) : (
          <ul className="mt-2.5 space-y-1.5">
            {role.skills.map((skill) => {
              const skillName = resolveLocalizedRoleText(skill.name, locale, "Skill");
              return (
                <li
                  key={skill.skillId}
                  className="flex items-center gap-2.5 rounded-xl border border-border/50 px-3 py-2"
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-surface text-xs"
                    aria-hidden="true"
                  >
                    {skill.iconEmoji ?? resolveRoleIconFallback(skillName)}
                  </span>
                  <span className="min-w-0 truncate text-sm text-text">{skillName}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Compact list-style card kept for standalone previews; never shows mission prompt. */
export function AssistantRoleCard({
  role,
  selected,
  current = false,
  interactive = false,
  disabled = false,
  onClick
}: AssistantRoleCardProps) {
  const t = useTranslations("assistantRole");
  const locale = useLocale();
  const messages = useMessages() as { assistantRole?: { categories?: Record<string, string> } };
  const color = normalizeRoleColor(role.color);
  const title = resolveLocalizedRoleText(role.name, locale, "Role");
  const description = resolveLocalizedRoleText(role.description, locale);
  const categoryLabel = resolveRoleCategoryLabel(role.category, messages.assistantRole?.categories);
  const cardBody = (
    <div
      className={cn(
        "group rounded-[28px] border bg-background/88 p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_1px_2px_rgba(0,0,0,0.03)] transition-colors",
        interactive && !disabled && "hover:bg-surface-hover/70",
        selected ? "border-accent/45 bg-accent/5" : "border-border/70",
        disabled && interactive && "cursor-not-allowed opacity-70"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-surface-raised text-lg"
            style={color ? { boxShadow: `inset 0 0 0 1px ${color}33` } : undefined}
            aria-hidden="true"
          >
            {role.iconEmoji ?? (
              <span className="text-sm font-semibold text-text-muted">
                {resolveRoleIconFallback(title)}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-text">{title}</p>
              {current ? (
                <span className="rounded-full border border-border/70 bg-surface-raised px-2 py-0.5 text-[10px] font-medium text-text-subtle">
                  {t("current")}
                </span>
              ) : selected ? (
                <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                  {t("selected")}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-text-subtle">
              <span>{categoryLabel}</span>
              {color ? (
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full border border-black/5 dark:border-white/10"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
              ) : null}
            </div>
          </div>
        </div>
        {selected ? (
          <div className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        ) : null}
      </div>

      {description ? <p className="mt-3 text-sm leading-relaxed text-text">{description}</p> : null}
    </div>
  );

  if (!interactive) {
    return cardBody;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "block w-full rounded-[28px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        disabled && "cursor-not-allowed"
      )}
    >
      {cardBody}
    </button>
  );
}

function RoleSelectorHeader({
  title,
  description,
  fallbackTitle,
  fallbackDescription,
  leading
}: {
  title: string | undefined;
  description: string | undefined;
  fallbackTitle: string;
  fallbackDescription: string;
  leading?: ReactNode;
}) {
  const resolvedDescription = description ?? fallbackDescription;
  return (
    <div className="mb-4 flex items-start gap-2">
      {leading}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text">{title ?? fallbackTitle}</p>
        {resolvedDescription.length > 0 ? (
          <p className="mt-1 text-xs leading-relaxed text-text-muted">{resolvedDescription}</p>
        ) : null}
      </div>
    </div>
  );
}

export function AssistantRoleSelector({
  roles,
  selectedRoleKey,
  onSelect,
  title,
  description,
  currentRoleKey = null,
  loading = false,
  error = null,
  disabled = false,
  onRetry,
  embedded = false
}: AssistantRoleSelectorProps) {
  const t = useTranslations("assistantRole");
  const locale = useLocale();
  const messages = useMessages() as { assistantRole?: { categories?: Record<string, string> } };
  const [mobilePane, setMobilePane] = useState<MobilePane>("list");

  const selectedRole =
    roles?.find((role) => role.key === selectedRoleKey) ??
    (selectedRoleKey === null ? null : (roles?.[0] ?? null));

  const shellClassName = embedded
    ? "text-left"
    : "rounded-[28px] border border-border/70 bg-background/88 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_1px_2px_rgba(0,0,0,0.03)] sm:p-5";

  const handleSelectRole = (roleKey: string) => {
    onSelect(roleKey);
    setMobilePane("detail");
  };

  if (loading) {
    return (
      <div className={cn(shellClassName, !embedded && "p-5 text-sm text-text-muted")}>
        <RoleSelectorHeader
          title={title}
          description={description}
          fallbackTitle={t("title")}
          fallbackDescription={t("description")}
        />
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <UserCog className="h-4 w-4 text-accent" />
          <span>{t("loading")}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn(shellClassName, !embedded && "p-5")}>
        <RoleSelectorHeader
          title={title}
          description={description}
          fallbackTitle={t("title")}
          fallbackDescription={t("description")}
        />
        <p className="mt-3 text-sm text-destructive">{error}</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-raised px-3 py-1.5 text-xs font-medium text-text transition-colors hover:bg-surface-hover"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            {t("retry")}
          </button>
        ) : null}
      </div>
    );
  }

  if (roles !== null && roles.length === 0) {
    return (
      <div
        className={cn(
          shellClassName,
          !embedded &&
            "rounded-[28px] border border-dashed border-border bg-background/88 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_1px_2px_rgba(0,0,0,0.03)]"
        )}
      >
        <RoleSelectorHeader
          title={title}
          description={description}
          fallbackTitle={t("title")}
          fallbackDescription={t("description")}
        />
        <p className="mt-3 text-sm font-medium text-text">{t("emptyTitle")}</p>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">{t("emptyBody")}</p>
      </div>
    );
  }

  return (
    <div className={shellClassName}>
      <RoleSelectorHeader
        title={title}
        description={description}
        fallbackTitle={t("title")}
        fallbackDescription={t("description")}
        leading={
          mobilePane === "detail" ? (
            <button
              type="button"
              onClick={() => setMobilePane("list")}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text md:hidden"
              aria-label={t("backToList")}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : null
        }
      />
      <div
        className={cn(
          "flex min-h-[22rem] flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/60 md:min-h-[26rem] md:flex-row",
          embedded && "bg-background/40"
        )}
        data-testid="assistant-role-catalog"
      >
        <div
          className={cn(
            "min-h-0 w-full overflow-y-auto overscroll-contain py-2 md:w-[min(100%,15.5rem)] md:shrink-0 md:border-r md:border-border/50",
            mobilePane === "detail" ? "hidden md:block" : "block"
          )}
        >
          <ul className="space-y-0.5 px-2" role="listbox" aria-label={title ?? t("title")}>
            {(roles ?? []).map((role) => {
              const roleTitle = resolveLocalizedRoleText(role.name, locale, "Role");
              const selected = role.key === selectedRoleKey;
              const current = role.key === currentRoleKey;
              return (
                <li key={role.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => handleSelectRole(role.key)}
                    disabled={disabled}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors",
                      selected
                        ? "bg-accent/8 text-text"
                        : "text-text-muted hover:bg-surface-hover hover:text-text",
                      disabled && "cursor-not-allowed opacity-70"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-xs",
                        selected ? "border-accent/30 bg-accent/10" : "border-border/60 bg-surface"
                      )}
                      aria-hidden="true"
                    >
                      {role.iconEmoji ?? resolveRoleIconFallback(roleTitle)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">
                        {roleTitle}
                      </span>
                      {current ? (
                        <span className="block truncate text-[11px] text-text-subtle">
                          {t("current")}
                        </span>
                      ) : selected ? (
                        <span className="block truncate text-[11px] text-accent">
                          {t("selected")}
                        </span>
                      ) : null}
                    </span>
                    {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5",
            mobilePane === "list" ? "hidden md:block" : "block"
          )}
        >
          {selectedRole ? (
            <AssistantRoleDetailPane
              role={selectedRole}
              locale={locale}
              categoryLabels={messages.assistantRole?.categories}
              skillsTitle={t("connectedSkills")}
              skillsEmpty={t("connectedSkillsEmpty")}
            />
          ) : (
            <p className="text-sm text-text-muted">{t("description")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
