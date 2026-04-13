import { describe, expect, it } from "vitest";
import {
  filterVoiceOptions,
  OPENAI_VOICE_OPTIONS,
  resolveDefaultOpenAiVoiceOption,
  resolveDefaultYandexVoiceOption,
  YANDEX_VOICE_OPTIONS
} from "./assistant-voice-options";

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
