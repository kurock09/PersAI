import { describe, expect, it } from "vitest";
import {
  filterVoiceOptions,
  filterVoicePickerEntries,
  OPENAI_VOICE_OPTIONS,
  resolveDefaultOpenAiVoiceOption,
  resolveDefaultYandexVoiceOption,
  YANDEX_VOICE_OPTIONS,
  type VoicePickerEntry
} from "./assistant-voice-options";

const PICKER_ENTRIES: VoicePickerEntry[] = [
  {
    value: "ru-anna",
    label: "Anna",
    gender: "female",
    language: "ru",
    languageBucket: "ru",
    category: "premade",
    previewUrl: "https://cdn/anna.mp3"
  },
  {
    value: "en-brian",
    label: "Brian",
    gender: "male",
    language: "en",
    languageBucket: "en",
    category: "professional",
    previewUrl: null
  },
  {
    value: "en-cleo",
    label: "Cleo",
    gender: "female",
    language: "en",
    languageBucket: "en",
    category: "premade",
    previewUrl: null
  }
];

const NO_FILTER = { query: "", gender: "all", languageBucket: "all", category: "all" } as const;

describe("assistant voice options", () => {
  it("filters yandex voices by assistant gender", () => {
    expect(filterVoiceOptions(YANDEX_VOICE_OPTIONS, "male").map((voice) => voice.value)).toEqual([
      "ermil",
      "zahar",
      "alexander",
      "kirill",
      "anton"
    ]);
    expect(filterVoiceOptions(YANDEX_VOICE_OPTIONS, "female").map((voice) => voice.value)).toEqual([
      "marina",
      "jane",
      "lera",
      "masha",
      "dasha"
    ]);
  });

  it("keeps neutral assistants on the full voice list", () => {
    expect(filterVoiceOptions(OPENAI_VOICE_OPTIONS, "neutral")).toHaveLength(
      OPENAI_VOICE_OPTIONS.length
    );
  });

  it("returns provider defaults per gender", () => {
    expect(resolveDefaultYandexVoiceOption("male")).toBe("ermil");
    expect(resolveDefaultYandexVoiceOption("female")).toBe("jane");
    expect(resolveDefaultOpenAiVoiceOption("male")).toBe("cedar");
    expect(resolveDefaultOpenAiVoiceOption("female")).toBe("marin");
  });
});

describe("filterVoicePickerEntries", () => {
  it("returns all entries when no filter is active", () => {
    expect(filterVoicePickerEntries(PICKER_ENTRIES, NO_FILTER)).toHaveLength(3);
  });

  it("filters by gender", () => {
    expect(
      filterVoicePickerEntries(PICKER_ENTRIES, { ...NO_FILTER, gender: "female" }).map(
        (entry) => entry.value
      )
    ).toEqual(["ru-anna", "en-cleo"]);
  });

  it("filters by language bucket", () => {
    expect(
      filterVoicePickerEntries(PICKER_ENTRIES, { ...NO_FILTER, languageBucket: "en" }).map(
        (entry) => entry.value
      )
    ).toEqual(["en-brian", "en-cleo"]);
  });

  it("filters by category", () => {
    expect(
      filterVoicePickerEntries(PICKER_ENTRIES, { ...NO_FILTER, category: "professional" }).map(
        (entry) => entry.value
      )
    ).toEqual(["en-brian"]);
  });

  it("matches the query against label, language, and category", () => {
    expect(
      filterVoicePickerEntries(PICKER_ENTRIES, { ...NO_FILTER, query: "cleo" }).map(
        (entry) => entry.value
      )
    ).toEqual(["en-cleo"]);
    expect(
      filterVoicePickerEntries(PICKER_ENTRIES, { ...NO_FILTER, query: "professional" }).map(
        (entry) => entry.value
      )
    ).toEqual(["en-brian"]);
  });

  it("combines multiple active filters", () => {
    expect(
      filterVoicePickerEntries(PICKER_ENTRIES, {
        query: "",
        gender: "female",
        languageBucket: "en",
        category: "premade"
      }).map((entry) => entry.value)
    ).toEqual(["en-cleo"]);
  });
});
