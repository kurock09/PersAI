import assert from "node:assert/strict";
import {
  humanizeAge,
  resolveRelativeTimeLocale
} from "../src/modules/turns/relative-time-formatter";

const NOW = new Date("2026-04-22T12:00:00.000Z");

export async function runRelativeTimeFormatterTest(): Promise<void> {
  // English (default) — preserves M3 carry-over wording exactly.
  assert.equal(
    humanizeAge(new Date(NOW.getTime() - 30 * 60_000), NOW),
    "less than an hour ago",
    "default locale renders < 60 minutes as English"
  );
  assert.equal(
    humanizeAge(new Date(NOW.getTime() - 3 * 60 * 60_000), NOW),
    "earlier today",
    "same calendar day ≥ 1h renders as English 'earlier today'"
  );
  assert.equal(
    humanizeAge(new Date("2026-04-21T20:00:00.000Z"), NOW),
    "yesterday",
    "previous calendar day renders as English 'yesterday'"
  );
  assert.equal(
    humanizeAge(new Date("2026-04-15T12:00:00.000Z"), NOW),
    "7 days ago",
    "older renders as English 'N days ago' with N>=2"
  );

  // Russian — bilingual T1 path.
  assert.equal(
    humanizeAge(new Date(NOW.getTime() - 30 * 60_000), NOW, "ru"),
    "меньше часа назад",
    "ru < 60 minutes"
  );
  assert.equal(
    humanizeAge(new Date(NOW.getTime() - 3 * 60 * 60_000), NOW, "ru"),
    "сегодня ранее",
    "ru same day ≥ 1h"
  );
  assert.equal(
    humanizeAge(new Date("2026-04-21T20:00:00.000Z"), NOW, "ru"),
    "вчера",
    "ru previous calendar day"
  );

  // Russian pluralization:
  //   * 1 → "день"
  //   * 2..4 → "дня"
  //   * 11..14 → "дней"
  //   * else → "дней"
  // The formatter floors to the nearest day with min=2; we test deltas that
  // produce specific day counts.
  assert.equal(
    humanizeAge(new Date(NOW.getTime() - 2 * 24 * 3_600_000), NOW, "ru"),
    "2 дня назад",
    "ru 2 days uses 'дня'"
  );
  assert.equal(
    humanizeAge(new Date(NOW.getTime() - 5 * 24 * 3_600_000), NOW, "ru"),
    "5 дней назад",
    "ru 5 days uses 'дней'"
  );
  assert.equal(
    humanizeAge(new Date(NOW.getTime() - 11 * 24 * 3_600_000), NOW, "ru"),
    "11 дней назад",
    "ru 11 days uses 'дней' (teens)"
  );
  assert.equal(
    humanizeAge(new Date(NOW.getTime() - 21 * 24 * 3_600_000), NOW, "ru"),
    "21 день назад",
    "ru 21 days uses 'день' (mod-10 == 1, not in teens)"
  );

  // Negative / zero deltas clamp to 0.
  assert.equal(
    humanizeAge(new Date(NOW.getTime() + 60_000), NOW),
    "less than an hour ago",
    "future timestamps clamp to 'less than an hour ago'"
  );

  // Locale resolution.
  assert.equal(resolveRelativeTimeLocale("ru-RU"), "ru");
  assert.equal(resolveRelativeTimeLocale("RU"), "ru");
  assert.equal(resolveRelativeTimeLocale("en-US"), "en");
  assert.equal(resolveRelativeTimeLocale(null), "en");
  assert.equal(resolveRelativeTimeLocale(undefined), "en");
  assert.equal(resolveRelativeTimeLocale(""), "en");
  assert.equal(resolveRelativeTimeLocale("xx-YY"), "en");
}
