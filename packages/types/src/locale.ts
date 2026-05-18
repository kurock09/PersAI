export const SUPPORTED_LOCALES = ["en", "ru"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Normalize arbitrary locale tags (e.g. navigator.language, workspace.locale)
 * to a supported PersAI locale, or null when no supported language is present.
 */
export function normalizeLocaleInput(value: string | null | undefined): SupportedLocale | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const primary = trimmed.split(/[-_]/)[0]?.toLowerCase() ?? "";
  if (isSupportedLocale(primary)) {
    return primary;
  }

  return null;
}

export interface ResolvePreferredLocaleInput {
  preferredLocale?: string | null;
  workspaceLocale?: string | null;
}

/**
 * Persisted user preference wins; workspace locale is transitional fallback; default `en`.
 */
export function resolvePreferredLocale(input: ResolvePreferredLocaleInput): SupportedLocale {
  return (
    normalizeLocaleInput(input.preferredLocale) ??
    normalizeLocaleInput(input.workspaceLocale) ??
    "en"
  );
}
