import assert from "node:assert/strict";
import { renderPresenceBlock } from "../src/modules/turns/presence-renderer";

const TEMPLATE = `# Sense of Time

- In-thread: {{time_since_last_user_message_in_thread}}
- Anywhere: {{time_since_last_user_message_anywhere}}
- Local time: {{current_local_time}}
- Local weekday: {{current_local_weekday}}
- Local date: {{current_local_date}}

Do not recite this back.`;

// 2026-04-22 is a Wednesday. UTC noon → 15:00 in Europe/Moscow (UTC+3).
const NOW = new Date("2026-04-22T12:00:00.000Z");

export async function runPresenceRendererTest(): Promise<void> {
  const englishOutput = renderPresenceBlock({
    template: TEMPLATE,
    now: NOW,
    timezone: "Europe/Moscow",
    locale: "en-US",
    lastUserMessageInThreadAt: new Date(NOW.getTime() - 30 * 60_000),
    lastUserMessageAnywhereAt: new Date("2026-04-21T20:00:00.000Z")
  });
  assert.ok(englishOutput !== null, "English render returns a non-null block");
  assert.match(
    englishOutput,
    /In-thread: less than an hour ago/,
    "English in-thread relative time"
  );
  assert.match(englishOutput, /Anywhere: yesterday/, "English anywhere relative time");
  assert.match(
    englishOutput,
    /Local time: 15:00/,
    "Local time formatted HH:MM in Europe/Moscow tz"
  );
  assert.match(englishOutput, /Local weekday: Wednesday/, "English weekday name");
  // ADR-119 Slice 12: absolute date is mandatory so the model never invents a year.
  assert.match(englishOutput, /Local date: April 22, 2026/, "English absolute date (long style)");
  assert.match(englishOutput, /Do not recite this back\./, "Usage rule line preserved verbatim");

  const russianOutput = renderPresenceBlock({
    template: TEMPLATE,
    now: NOW,
    timezone: "Europe/Moscow",
    locale: "ru-RU",
    lastUserMessageInThreadAt: new Date(NOW.getTime() - 30 * 60_000),
    lastUserMessageAnywhereAt: new Date("2026-04-21T20:00:00.000Z")
  });
  assert.ok(russianOutput !== null);
  assert.match(russianOutput, /In-thread: меньше часа назад/, "Russian in-thread relative time");
  assert.match(russianOutput, /Anywhere: вчера/, "Russian anywhere relative time");
  assert.match(
    russianOutput,
    /Local time: 15:00/,
    "Local time HH:MM is locale-independent in en-GB pattern"
  );
  // Russian weekday for 2026-04-22 (Wednesday) → "среда"
  assert.match(russianOutput, /Local weekday: среда/, "Russian weekday name");
  // Russian absolute date for 2026-04-22 → "22 апреля 2026 г." (Intl long style)
  assert.match(russianOutput, /Local date: 22 апреля 2026 г\./, "Russian absolute date");

  // "Never" fallback — both timestamps null but block still renders all four lines.
  const neverOutput = renderPresenceBlock({
    template: TEMPLATE,
    now: NOW,
    timezone: "Europe/Moscow",
    locale: "en-US",
    lastUserMessageInThreadAt: null,
    lastUserMessageAnywhereAt: null
  });
  assert.ok(neverOutput !== null);
  assert.match(neverOutput, /In-thread: never/, "Null in-thread → English 'never'");
  assert.match(neverOutput, /Anywhere: never/, "Null anywhere → English 'never'");

  const neverOutputRu = renderPresenceBlock({
    template: TEMPLATE,
    now: NOW,
    timezone: "Europe/Moscow",
    locale: "ru",
    lastUserMessageInThreadAt: null,
    lastUserMessageAnywhereAt: null
  });
  assert.ok(neverOutputRu !== null);
  assert.match(neverOutputRu, /In-thread: никогда/, "Null in-thread → Russian 'никогда'");
  assert.match(neverOutputRu, /Anywhere: никогда/, "Null anywhere → Russian 'никогда'");

  // Empty / blank template returns null so the developer-tail can omit the section.
  assert.equal(
    renderPresenceBlock({
      template: "",
      now: NOW,
      timezone: "UTC",
      locale: "en",
      lastUserMessageInThreadAt: null,
      lastUserMessageAnywhereAt: null
    }),
    null,
    "Blank template returns null"
  );
  assert.equal(
    renderPresenceBlock({
      template: "   \n  \t  ",
      now: NOW,
      timezone: "UTC",
      locale: "en",
      lastUserMessageInThreadAt: null,
      lastUserMessageAnywhereAt: null
    }),
    null,
    "Whitespace-only template returns null"
  );

  // Bad timezone falls back to UTC and never throws.
  const badTzOutput = renderPresenceBlock({
    template: TEMPLATE,
    now: NOW,
    timezone: "Not/A_Real_Zone",
    locale: "en",
    lastUserMessageInThreadAt: null,
    lastUserMessageAnywhereAt: null
  });
  assert.ok(badTzOutput !== null);
  assert.match(badTzOutput, /Local time: 12:00/, "Bad timezone falls back to UTC");

  // Unknown placeholders are left alone (defensive: if a custom template
  // adds {{some_unknown_var}} we do NOT throw or silently delete the line).
  const unknownPlaceholderOutput = renderPresenceBlock({
    template: "Hello {{some_unknown_var}} — local: {{current_local_time}}",
    now: NOW,
    timezone: "Europe/Moscow",
    locale: "en",
    lastUserMessageInThreadAt: null,
    lastUserMessageAnywhereAt: null
  });
  assert.ok(unknownPlaceholderOutput !== null);
  assert.match(unknownPlaceholderOutput, /\{\{some_unknown_var\}\}/);
  assert.match(unknownPlaceholderOutput, /local: 15:00/);
}
