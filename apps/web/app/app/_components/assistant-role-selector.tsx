"use client";

import { RefreshCcw, UserCog } from "lucide-react";
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
  showMission?: boolean;
};

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

export function AssistantRoleCard({
  role,
  selected,
  current = false,
  interactive = false,
  disabled = false,
  onClick,
  showMission = current || selected
}: AssistantRoleCardProps) {
  const t = useTranslations("assistantRole");
  const locale = useLocale();
  const messages = useMessages() as { assistantRole?: { categories?: Record<string, string> } };
  const color = normalizeRoleColor(role.color);
  const title = resolveLocalizedRoleText(role.name, locale, "Role");
  const description = resolveLocalizedRoleText(role.description, locale);
  const mission = resolveLocalizedRoleText(role.mission, locale);
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
      {showMission && mission ? (
        <p className="mt-2 text-xs leading-relaxed text-text-muted">{mission}</p>
      ) : null}
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
  fallbackDescription
}: {
  title: string | undefined;
  description: string | undefined;
  fallbackTitle: string;
  fallbackDescription: string;
}) {
  const resolvedDescription = description ?? fallbackDescription;
  return (
    <div className="mb-4">
      <p className="text-sm font-semibold text-text">{title ?? fallbackTitle}</p>
      {resolvedDescription.length > 0 ? (
        <p className="mt-1 text-xs leading-relaxed text-text-muted">{resolvedDescription}</p>
      ) : null}
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
  showCurrentMission = true,
  embedded = false
}: AssistantRoleSelectorProps) {
  const t = useTranslations("assistantRole");
  const shellClassName = embedded
    ? "text-left"
    : "rounded-[28px] border border-border/70 bg-background/88 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_1px_2px_rgba(0,0,0,0.03)] sm:p-5";

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
      />
      <div className="grid gap-3 md:grid-cols-2">
        {(roles ?? []).map((role) => (
          <AssistantRoleCard
            key={role.id}
            role={role}
            selected={selectedRoleKey === role.key}
            current={currentRoleKey === role.key}
            interactive
            disabled={disabled}
            onClick={() => onSelect(role.key)}
            showMission={
              selectedRoleKey === role.key && (currentRoleKey !== role.key || showCurrentMission)
            }
          />
        ))}
      </div>
    </div>
  );
}
