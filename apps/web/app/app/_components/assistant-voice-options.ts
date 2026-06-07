import type { AssistantGender } from "./assistant-persona";

export type VoiceOption<T extends string = string> = {
  value: T;
  label: string;
  gender: "male" | "female" | "neutral" | "unknown";
};

export const YANDEX_VOICE_OPTIONS: readonly VoiceOption<
  | "marina"
  | "jane"
  | "ermil"
  | "zahar"
  | "lera"
  | "masha"
  | "dasha"
  | "alexander"
  | "kirill"
  | "anton"
>[] = [
  { value: "marina", label: "Marina", gender: "female" },
  { value: "jane", label: "Jane", gender: "female" },
  { value: "ermil", label: "Ermil", gender: "male" },
  { value: "zahar", label: "Zahar", gender: "male" },
  { value: "lera", label: "Lera", gender: "female" },
  { value: "masha", label: "Masha", gender: "female" },
  { value: "dasha", label: "Dasha", gender: "female" },
  { value: "alexander", label: "Alexander", gender: "male" },
  { value: "kirill", label: "Kirill", gender: "male" },
  { value: "anton", label: "Anton", gender: "male" }
] as const;

export const OPENAI_VOICE_OPTIONS: readonly VoiceOption<
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "fable"
  | "onyx"
  | "nova"
  | "sage"
  | "shimmer"
  | "verse"
  | "marin"
  | "cedar"
>[] = [
  { value: "alloy", label: "Alloy", gender: "neutral" },
  { value: "ash", label: "Ash", gender: "male" },
  { value: "ballad", label: "Ballad", gender: "female" },
  { value: "coral", label: "Coral", gender: "female" },
  { value: "echo", label: "Echo", gender: "male" },
  { value: "fable", label: "Fable", gender: "female" },
  { value: "onyx", label: "Onyx", gender: "male" },
  { value: "nova", label: "Nova", gender: "female" },
  { value: "sage", label: "Sage", gender: "neutral" },
  { value: "shimmer", label: "Shimmer", gender: "female" },
  { value: "verse", label: "Verse", gender: "male" },
  { value: "marin", label: "Marin", gender: "female" },
  { value: "cedar", label: "Cedar", gender: "male" }
] as const;

export type VoiceLanguageBucket = "ru" | "en" | "other";

/**
 * ADR-113 Slice 3 — unified entry shape for the premium voice picker across
 * all three TTS providers. ElevenLabs entries carry catalog metadata
 * (language/category/preview); Yandex/OpenAI come from fixed enums and leave
 * the catalog-only fields null/"other".
 */
export type VoicePickerEntry = {
  value: string;
  label: string;
  gender: "male" | "female" | "neutral" | "unknown";
  language: string | null;
  languageBucket: VoiceLanguageBucket;
  category: string | null;
  previewUrl: string | null;
};

export type VoicePickerFilter = {
  query: string;
  gender: "all" | "male" | "female" | "neutral" | "unknown";
  languageBucket: "all" | VoiceLanguageBucket;
  category: "all" | string;
};

export function filterVoicePickerEntries(
  entries: readonly VoicePickerEntry[],
  filter: VoicePickerFilter
): VoicePickerEntry[] {
  const query = filter.query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filter.gender !== "all" && entry.gender !== filter.gender) {
      return false;
    }
    if (filter.languageBucket !== "all" && entry.languageBucket !== filter.languageBucket) {
      return false;
    }
    if (filter.category !== "all" && (entry.category ?? "") !== filter.category) {
      return false;
    }
    if (query.length > 0) {
      const haystack =
        `${entry.label} ${entry.language ?? ""} ${entry.category ?? ""}`.toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    return true;
  });
}

export function filterVoiceOptions<T extends string>(
  options: readonly VoiceOption<T>[],
  assistantGender: AssistantGender
): VoiceOption<T>[] {
  if (assistantGender === "neutral") {
    return [...options];
  }
  return options.filter((option) => option.gender === assistantGender);
}

export function resolveDefaultYandexVoiceOption(
  assistantGender: AssistantGender
): (typeof YANDEX_VOICE_OPTIONS)[number]["value"] {
  switch (assistantGender) {
    case "male":
      return "ermil";
    case "female":
      return "jane";
    default:
      return "marina";
  }
}

export function resolveDefaultOpenAiVoiceOption(
  assistantGender: AssistantGender
): (typeof OPENAI_VOICE_OPTIONS)[number]["value"] {
  switch (assistantGender) {
    case "male":
      return "cedar";
    case "female":
      return "marin";
    default:
      return "sage";
  }
}
