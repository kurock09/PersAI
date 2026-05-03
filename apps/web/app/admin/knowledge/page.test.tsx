import { describe, expect, it } from "vitest";
import {
  flattenAvailableTextModelOptions,
  KNOWLEDGE_LOCALE_OPTIONS,
  productTextEntryDraftToPayload,
  productTextEntryToDraft,
  summarizeProductTextEntries,
  validateProductTextEntryDraft
} from "./page";

describe("admin knowledge page helpers", () => {
  it("uses a fixed locale option list for Product KB text entries", () => {
    expect(KNOWLEDGE_LOCALE_OPTIONS.map((option) => option.value)).toEqual([
      "",
      "en",
      "en-US",
      "ru",
      "ru-RU"
    ]);
  });

  it("flattens available text models from runtime settings", () => {
    expect(
      flattenAvailableTextModelOptions({
        availableModelsByProvider: {
          openai: ["gpt-5.4-mini", "text-embedding-3-small"],
          anthropic: ["claude-4.6-sonnet-medium-thinking"]
        },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "ignored-chat",
                capabilities: ["chat"],
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: null
              }
            ]
          },
          anthropic: {
            models: [
              {
                model: "ignored-chat",
                capabilities: ["chat"],
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: null
              }
            ]
          }
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
          openai: {
            models: [
              {
                model: "gpt-5.4-mini",
                capabilities: ["chat"],
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: null
              },
              {
                model: "gpt-image-2",
                capabilities: ["image"],
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: null
              },
              {
                model: "sora-2",
                capabilities: ["video"],
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: null
              }
            ]
          },
          anthropic: {
            models: [
              {
                model: "claude-4.6-sonnet-medium-thinking",
                capabilities: ["chat"],
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: null
              }
            ]
          }
        }
      })
    ).toEqual([
      { provider: "openai", model: "gpt-5.4-mini" },
      { provider: "anthropic", model: "claude-4.6-sonnet-medium-thinking" }
    ]);
  });

  it("keeps Product KB text entries draft-first until explicitly activated", () => {
    const draft = productTextEntryToDraft(null);
    expect(draft.lifecycleStatus).toBe("draft");
    expect(validateProductTextEntryDraft(draft)).toMatchObject({
      title: expect.stringContaining("Title"),
      body: expect.stringContaining("20")
    });

    const payload = productTextEntryDraftToPayload({
      ...draft,
      title: "Refund policy",
      body: "Approved Product KB answer about refunds.",
      category: "billing",
      locale: "en",
      tagsText: "billing, refunds",
      lifecycleStatus: "active"
    });

    expect(payload).toMatchObject({
      title: "Refund policy",
      category: "billing",
      locale: "en",
      tags: ["billing", "refunds"],
      lifecycleStatus: "active",
      provenanceKind: "manual",
      provenanceMetadata: null
    });
  });

  it("summarizes Product KB authored entry lifecycle counts", () => {
    const base = {
      id: "entry-1",
      title: "Entry",
      body: "Approved body content.",
      category: null,
      locale: null,
      tags: [],
      provenanceKind: "manual" as const,
      provenanceMetadata: null,
      archivedAt: null,
      createdAt: "2026-05-02T12:00:00.000Z",
      updatedAt: "2026-05-02T12:00:00.000Z",
      status: "ready" as const,
      currentVersion: 1,
      chunkCount: 1,
      processorProviderKey: null,
      processorMode: null,
      processingQuality: null,
      lastIndexedAt: null,
      lastReindexRequestedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null
    };

    expect(
      summarizeProductTextEntries([
        { ...base, id: "active", lifecycleStatus: "active" },
        { ...base, id: "draft", lifecycleStatus: "draft" },
        { ...base, id: "stale", lifecycleStatus: "stale" }
      ])
    ).toEqual({ total: 3, active: 1, draft: 1, stale: 1 });
  });
});
