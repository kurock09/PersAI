// ADR-074 Slice T1 / ADR-119 Slice 12 — pure renderer for the per-turn
// "presence" developer-tail block.
//
// The presence template lives in `promptDocuments.presence` (see the API-side
// `CompilePromptConstructorService`). It is a raw template string with five
// `{{...}}` placeholders that we interpolate at turn-construction time:
//
//   * `time_since_last_user_message_in_thread`
//   * `time_since_last_user_message_anywhere`
//   * `current_local_time`         (HH:MM in the user's timezone)
//   * `current_local_weekday`      (full weekday name, user's locale)
//   * `current_local_date`         (absolute date in user's locale + timezone)
//
// All five fields are ALWAYS rendered (per ADR T1 hard constraint #4); when a
// "last user message" timestamp is unknown, we fall back to a deterministic
// "never" string in the user's locale rather than dropping the line, so the
// block layout is identical for every turn.
//
// ADR-119 Slice 12 fix: the absolute date placeholder is REQUIRED so the model
// never confabulates the year. Pre-Slice-12 deploys carried only weekday + time,
// which caused live-test row A2 to invent "19 июня 2025" when the real date was
// "18 июня 2026". The new `current_local_date` field is rendered immediately
// adjacent to the weekday line so the model sees both together.

import {
  humanizeAge,
  resolveRelativeTimeLocale,
  type RelativeTimeLocale
} from "./relative-time-formatter";

const NEVER_PHRASE: Record<RelativeTimeLocale, string> = {
  en: "never",
  ru: "никогда"
};

const PLACEHOLDER_RE = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

export interface PresenceRenderInput {
  template: string;
  now: Date;
  timezone: string;
  locale: string;
  /**
   * Most recent user message timestamp inside the current thread, or `null`
   * if the user has not yet sent a message in this thread. The renderer
   * substitutes a locale-correct "never" phrase in that case.
   */
  lastUserMessageInThreadAt: Date | null;
  /**
   * Most recent user message timestamp across any thread for this
   * (user, assistant) pair, or `null` if the user has never messaged this
   * assistant before.
   */
  lastUserMessageAnywhereAt: Date | null;
}

/**
 * Renders the presence block by interpolating the four T1 placeholders into
 * the supplied template. Returns `null` when the template is empty / blank
 * after trimming so the runtime can omit the developer-tail section instead
 * of emitting an empty paragraph.
 *
 * Pure / deterministic: same inputs ⇒ same output, no I/O, no clocks beyond
 * the explicit `now` argument.
 */
export function renderPresenceBlock(input: PresenceRenderInput): string | null {
  const trimmedTemplate = input.template.trim();
  if (trimmedTemplate.length === 0) {
    return null;
  }
  const locale = resolveRelativeTimeLocale(input.locale);
  const neverPhrase = NEVER_PHRASE[locale];
  const values: Record<string, string> = {
    time_since_last_user_message_in_thread: input.lastUserMessageInThreadAt
      ? humanizeAge(input.lastUserMessageInThreadAt, input.now, locale)
      : neverPhrase,
    time_since_last_user_message_anywhere: input.lastUserMessageAnywhereAt
      ? humanizeAge(input.lastUserMessageAnywhereAt, input.now, locale)
      : neverPhrase,
    current_local_time: formatLocalTimeHHMM(input.now, input.timezone),
    current_local_weekday: formatLocalWeekday(input.now, input.timezone, input.locale),
    current_local_date: formatLocalDate(input.now, input.timezone, input.locale)
  };
  return interpolate(trimmedTemplate, values).trim();
}

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return values[key] ?? "";
    }
    return match;
  });
}

/**
 * Formats `now` as a 24-hour `HH:MM` string in the given IANA timezone.
 * Falls back to UTC if `Intl.DateTimeFormat` rejects the timezone (e.g. an
 * unknown / malformed tz string from a legacy workspace row).
 */
function formatLocalTimeHHMM(now: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(now);
  }
}

/**
 * Formats `now` as a long weekday name in the user's locale, evaluated in
 * the user's timezone. Falls back to English / UTC if either argument is
 * rejected by `Intl`.
 */
function formatLocalWeekday(now: Date, timezone: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      weekday: "long"
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "long"
    }).format(now);
  }
}

// ADR-119 Slice 12: full absolute date in the user's locale + timezone. Uses
// `dateStyle: "long"` so the year is always present (e.g. "18 июня 2026 г." in
// ru-RU, "June 18, 2026" in en-US). Falls back to en-US / UTC if Intl rejects
// the locale or timezone.
function formatLocalDate(now: Date, timezone: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      dateStyle: "long"
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      dateStyle: "long"
    }).format(now);
  }
}
