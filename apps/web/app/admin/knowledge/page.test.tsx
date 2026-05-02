import { describe, expect, it } from "vitest";
import { flattenAvailableTextModelOptions } from "./page";

describe("admin knowledge page helpers", () => {
  it("flattens available text models from runtime settings", () => {
    expect(
      flattenAvailableTextModelOptions({
        availableModelsByProvider: {
          openai: ["gpt-5.4-mini", "text-embedding-3-small"],
          anthropic: ["claude-4.6-sonnet-medium-thinking"]
        },
        availableModelCatalogByProvider: {
          openai: { chat: ["ignored-chat"], image: [], video: [] },
          anthropic: { chat: ["ignored-chat"], image: [], video: [] }
        }
      })
    ).toEqual([
      { provider: "openai", model: "gpt-5.4-mini" },
      { provider: "openai", model: "text-embedding-3-small" },
      { provider: "anthropic", model: "claude-4.6-sonnet-medium-thinking" }
    ]);
  });

  it("falls back to chat catalog when legacy available models are absent", () => {
    expect(
      flattenAvailableTextModelOptions({
        availableModelsByProvider: {
          openai: [],
          anthropic: []
        },
        availableModelCatalogByProvider: {
          openai: { chat: ["gpt-5.4-mini"], image: ["gpt-image-2"], video: ["sora-2"] },
          anthropic: { chat: ["claude-4.6-sonnet-medium-thinking"], image: [], video: [] }
        }
      })
    ).toEqual([
      { provider: "openai", model: "gpt-5.4-mini" },
      { provider: "anthropic", model: "claude-4.6-sonnet-medium-thinking" }
    ]);
  });
});
