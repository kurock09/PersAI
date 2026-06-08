const TRIVIAL_TURN_PHRASES = new Set([
  "hi",
  "hello",
  "hey",
  "good morning",
  "good afternoon",
  "good evening",
  "thanks",
  "thank you",
  "ok",
  "okay",
  "sure",
  "got it",
  "noted",
  "roger",
  "привет",
  "здравствуйте",
  "доброе утро",
  "добрый день",
  "добрый вечер",
  "спасибо",
  "благодарю",
  "ок",
  "окей",
  "хорошо",
  "понял",
  "поняла",
  "ясно",
  "ага",
  "угу"
]);

const TRIVIAL_TURN_WORDS = new Set([
  "hi",
  "hello",
  "hey",
  "good",
  "morning",
  "afternoon",
  "evening",
  "thanks",
  "thank",
  "you",
  "ok",
  "okay",
  "sure",
  "got",
  "it",
  "noted",
  "roger",
  "привет",
  "здравствуйте",
  "доброе",
  "добрый",
  "утро",
  "день",
  "вечер",
  "спасибо",
  "благодарю",
  "ок",
  "окей",
  "хорошо",
  "понял",
  "поняла",
  "ясно",
  "ага",
  "угу"
]);

export function normalizeMemoryText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeGuardrailText(value: string): string {
  return normalizeMemoryText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTriviallyNonDurableUtterance(value: string): boolean {
  const normalized = normalizeGuardrailText(value);
  if (normalized.length === 0) {
    return true;
  }
  if (TRIVIAL_TURN_PHRASES.has(normalized)) {
    return true;
  }
  const words = normalized.split(" ").filter((word) => word.length > 0);
  return (
    words.length > 0 && words.length <= 3 && words.every((word) => TRIVIAL_TURN_WORDS.has(word))
  );
}

export function isObviouslyNonDurableMemorySummary(value: string): boolean {
  const normalized = normalizeMemoryText(value);
  if (normalized.length < 4) {
    return true;
  }
  return isTriviallyNonDurableUtterance(normalized);
}
