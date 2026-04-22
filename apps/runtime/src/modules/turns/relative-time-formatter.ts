// ADR-074 Slice T1 — shared bilingual relative-time formatter.
//
// The "time-ago" helper used by the M3 cross-session continuity carry-over
// renderer was originally a private function inside that module and was
// English-only. T1 needs the same shape, but bilingual (English / Russian)
// so the new presence developer-tail block can render in the user's locale.
//
// Per ADR-074 Slice T1 hard constraint #5 the formatter must NOT be
// duplicated; both M3 and T1 consume this single helper. M3 consumes it via
// the wildcard re-export in `cross-session-carry-over-renderer.ts` and
// continues to render English (no `locale` argument); T1 passes the user
// locale through.

export type RelativeTimeLocale = "en" | "ru";

const PHRASES: Record<RelativeTimeLocale, RelativePhraseSet> = {
  en: {
    lessThanAnHour: "less than an hour ago",
    earlierToday: "earlier today",
    yesterday: "yesterday",
    daysAgo: (days) => `${String(days)} days ago`
  },
  ru: {
    lessThanAnHour: "меньше часа назад",
    earlierToday: "сегодня ранее",
    yesterday: "вчера",
    daysAgo: (days) => `${String(days)} ${pluralizeDaysRu(days)} назад`
  }
};

interface RelativePhraseSet {
  lessThanAnHour: string;
  earlierToday: string;
  yesterday: string;
  daysAgo: (days: number) => string;
}

/**
 * Returns a bilingual human-readable description of how long ago `then`
 * occurred relative to `now`. The output buckets exactly match the M3
 * carry-over renderer's original behaviour:
 *
 *   * `< 60 minutes`               → "less than an hour ago"
 *   * `same calendar day, < 24h`   → "earlier today"
 *   * `previous calendar day`      → "yesterday"
 *   * everything else              → "N days ago" (minimum 2)
 *
 * The default locale is `"en"` so the M3 re-export keeps its existing
 * English-only behaviour without any change to the call sites.
 */
export function humanizeAge(then: Date, now: Date, locale: RelativeTimeLocale = "en"): string {
  const phrases = PHRASES[locale] ?? PHRASES.en;
  const deltaMs = Math.max(0, now.getTime() - then.getTime());
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) {
    return phrases.lessThanAnHour;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24 && isSameCalendarDay(then, now)) {
    return phrases.earlierToday;
  }
  const yesterday = subtractDays(now, 1);
  if (isSameCalendarDay(then, yesterday)) {
    return phrases.yesterday;
  }
  const days = Math.max(2, Math.floor(deltaMs / (24 * 3_600_000)));
  return phrases.daysAgo(days);
}

/**
 * Resolves the bilingual subset locale from a wider BCP-47 / ICU locale tag
 * (e.g. `"ru-RU"` → `"ru"`, `"en-US"` → `"en"`). Anything not recognised as
 * Russian falls back to English so the formatter never throws.
 */
export function resolveRelativeTimeLocale(
  rawLocale: string | null | undefined
): RelativeTimeLocale {
  if (typeof rawLocale !== "string") {
    return "en";
  }
  const head = rawLocale.trim().toLowerCase().split(/[-_]/, 1)[0] ?? "";
  return head === "ru" ? "ru" : "en";
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function subtractDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() - days);
  return next;
}

// Russian noun-pluralisation rules for "день / дня / дней":
//   * 11..14 (mod 100)   → "дней"
//   * mod 10 == 1        → "день"
//   * mod 10 in 2..4     → "дня"
//   * everything else    → "дней"
function pluralizeDaysRu(days: number): string {
  const absoluteDays = Math.abs(Math.trunc(days));
  const lastTwoDigits = absoluteDays % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return "дней";
  }
  const lastDigit = absoluteDays % 10;
  if (lastDigit === 1) {
    return "день";
  }
  if (lastDigit >= 2 && lastDigit <= 4) {
    return "дня";
  }
  return "дней";
}
