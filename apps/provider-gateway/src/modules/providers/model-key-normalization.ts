const MODEL_KEY_DASH_REGEX = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;

export function normalizeModelKey(value: string): string {
  return value.trim().replace(MODEL_KEY_DASH_REGEX, "-");
}

export function toNormalizedNonEmptyModelKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeModelKey(value);
  return normalized.length > 0 ? normalized : null;
}
