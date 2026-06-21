import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminKnowledgePage, {
  flattenAvailableTextModelOptions,
  KNOWLEDGE_LOCALE_OPTIONS,
  productTextEntryDraftToPayload,
  productTextEntryToDraft,
  summarizeProductTextEntries,
  validateProductTextEntryDraft
} from "./page";

const clerkMocks = vi.hoisted(() => ({
  getToken: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: clerkMocks.getToken
  })
}));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

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
          anthropic: ["claude-4.6-sonnet-medium-thinking"],
          deepseek: ["deepseek-v4-flash"]
        },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "ignored-chat",
                capabilities: ["chat"],
                kind: "cinematic",
                active: true,
                billingMode: "token_metered",
                effectiveFrom: null,
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: {
                    inputPer1M: 0,
                    cacheCreationInputPer1M: 0,
                    cachedInputPer1M: 0,
                    outputPer1M: 0
                  }
                }
              }
            ]
          },
          anthropic: {
            models: [
              {
                model: "ignored-chat",
                capabilities: ["chat"],
                kind: "cinematic",
                active: true,
                billingMode: "token_metered",
                effectiveFrom: null,
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: {
                    inputPer1M: 0,
                    cacheCreationInputPer1M: 0,
                    cachedInputPer1M: 0,
                    outputPer1M: 0
                  }
                }
              }
            ]
          },
          deepseek: {
            models: [
              {
                model: "deepseek-v4-flash",
                capabilities: ["chat"],
                kind: "cinematic",
                active: true,
                billingMode: "token_metered",
                effectiveFrom: null,
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: {
                    inputPer1M: 0,
                    cacheCreationInputPer1M: 0,
                    cachedInputPer1M: 0,
                    outputPer1M: 0
                  }
                }
              }
            ]
          },
          runway: {
            models: []
          },
          kling: {
            models: []
          },
          heygen: {
            models: []
          }
        }
      })
    ).toEqual([
      { provider: "openai", model: "gpt-5.4-mini" },
      { provider: "openai", model: "text-embedding-3-small" },
      { provider: "anthropic", model: "claude-4.6-sonnet-medium-thinking" },
      { provider: "deepseek", model: "deepseek-v4-flash" }
    ]);
  });

  it("falls back to chat catalog when legacy available models are absent", () => {
    expect(
      flattenAvailableTextModelOptions({
        availableModelsByProvider: {
          openai: [],
          anthropic: [],
          deepseek: []
        },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-5.4-mini",
                capabilities: ["chat"],
                kind: "cinematic",
                active: true,
                billingMode: "token_metered",
                effectiveFrom: null,
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: {
                    inputPer1M: 0,
                    cacheCreationInputPer1M: 0,
                    cachedInputPer1M: 0,
                    outputPer1M: 0
                  }
                }
              },
              {
                model: "gpt-image-2",
                capabilities: ["image"],
                kind: "cinematic",
                active: true,
                billingMode: "fixed_operation",
                effectiveFrom: null,
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  fixedOperationPricing: { unitLabel: null, pricePerOperation: 0 }
                }
              },
              {
                model: "sora-2",
                capabilities: ["video"],
                kind: "cinematic",
                active: true,
                billingMode: "fixed_operation",
                effectiveFrom: null,
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  fixedOperationPricing: { unitLabel: null, pricePerOperation: 0 }
                }
              }
            ]
          },
          anthropic: {
            models: [
              {
                model: "claude-4.6-sonnet-medium-thinking",
                capabilities: ["chat"],
                kind: "cinematic",
                active: true,
                billingMode: "token_metered",
                effectiveFrom: null,
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: {
                    inputPer1M: 0,
                    cacheCreationInputPer1M: 0,
                    cachedInputPer1M: 0,
                    outputPer1M: 0
                  }
                }
              }
            ]
          },
          deepseek: {
            models: []
          },
          runway: {
            models: []
          },
          kling: {
            models: []
          },
          heygen: {
            models: []
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

describe("AdminKnowledgePage Smart Retrieval Limits (ADR-094)", () => {
  beforeEach(() => {
    clerkMocks.getToken.mockResolvedValue("token-1");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function installLoadFetch(): void {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/admin/knowledge-sources/retrieval-policy")) {
        return jsonResponse({
          policy: {
            schema: "persai.adminKnowledgeRetrievalPolicy.v1",
            embeddingModelKey: null,
            retrievalModelKey: null,
            authoringModelKey: null,
            smartSearchEnabled: true,
            smartSearchLongDocSummaryChars: 800,
            fetchFullModeAbsoluteMaxChars: 100000,
            fetchFullModeAbsoluteMaxChatMessages: 800,
            embeddingChangeImpact: null,
            notes: []
          }
        });
      }
      if (url.endsWith("/admin/runtime/provider-settings")) {
        return jsonResponse({
          settings: {
            availableModelsByProvider: {
              openai: ["text-embedding-3-large"],
              anthropic: [],
              deepseek: []
            },
            availableModelCatalogByProvider: {
              openai: { models: [] },
              anthropic: { models: [] },
              deepseek: { models: [] },
              runway: { models: [] },
              kling: { models: [] },
              heygen: { models: [] }
            }
          }
        });
      }
      return jsonResponse({});
    });
  }

  it("hydrates the four admin ceilings from the loaded policy", async () => {
    installLoadFetch();
    render(<AdminKnowledgePage />);
    await waitFor(() => {
      expect(screen.getByText("Smart Retrieval Limits")).toBeTruthy();
    });
    const smartEnabled = screen.getByLabelText(/Smart search enabled/i) as HTMLInputElement;
    expect(smartEnabled.checked).toBe(true);
    const summaryInput = screen.getByLabelText(/Long-doc summary cap/i) as HTMLInputElement;
    expect(summaryInput.value).toBe("800");
    const fullModeCharsInput = screen.getByLabelText(
      /Fetch full mode max chars/i
    ) as HTMLInputElement;
    expect(fullModeCharsInput.value).toBe("100000");
    const fullModeMessagesInput = screen.getByLabelText(
      /Fetch full mode max chat messages/i
    ) as HTMLInputElement;
    expect(fullModeMessagesInput.value).toBe("800");
  });

  it("sends the four admin ceilings in the save round-trip", async () => {
    const fetchMock = vi.mocked(fetch);
    installLoadFetch();

    render(<AdminKnowledgePage />);
    await waitFor(() => {
      expect(screen.getByText("Smart Retrieval Limits")).toBeTruthy();
    });

    const smartEnabled = screen.getByLabelText(/Smart search enabled/i);
    fireEvent.click(smartEnabled);

    const summaryInput = screen.getByLabelText(/Long-doc summary cap/i) as HTMLInputElement;
    fireEvent.change(summaryInput, { target: { value: "1200" } });

    const fullModeCharsInput = screen.getByLabelText(
      /Fetch full mode max chars/i
    ) as HTMLInputElement;
    fireEvent.change(fullModeCharsInput, { target: { value: "120000" } });

    const fullModeMessagesInput = screen.getByLabelText(
      /Fetch full mode max chat messages/i
    ) as HTMLInputElement;
    fireEvent.change(fullModeMessagesInput, { target: { value: "1000" } });

    let savedBody: Record<string, unknown> | null = null;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/admin/knowledge-sources/retrieval-policy") && init?.method === "POST") {
        savedBody = JSON.parse(String(init.body));
        expect((init.headers as Record<string, string>)["x-persai-step-up-token"]).toBeUndefined();
        return jsonResponse({
          policy: {
            schema: "persai.adminKnowledgeRetrievalPolicy.v1",
            embeddingModelKey: null,
            retrievalModelKey: null,
            authoringModelKey: null,
            smartSearchEnabled: false,
            smartSearchLongDocSummaryChars: 1200,
            fetchFullModeAbsoluteMaxChars: 120000,
            fetchFullModeAbsoluteMaxChatMessages: 1000,
            embeddingChangeImpact: null,
            notes: []
          }
        });
      }
      return jsonResponse({});
    });

    fireEvent.click(screen.getByRole("button", { name: /Save models/i }));
    await waitFor(() => {
      expect(savedBody).not.toBeNull();
    });
    expect(savedBody).toMatchObject({
      smartSearchEnabled: false,
      smartSearchLongDocSummaryChars: 1200,
      fetchFullModeAbsoluteMaxChars: 120000,
      fetchFullModeAbsoluteMaxChatMessages: 1000
    });
  });

  it("previews embedding impact before step-up confirmation", async () => {
    const fetchMock = vi.mocked(fetch);
    installLoadFetch();

    render(<AdminKnowledgePage />);
    await waitFor(() => {
      expect(screen.getByText("Admin Knowledge models")).toBeTruthy();
    });

    const embeddingSelect = screen.getByLabelText(/Embedding index model/i) as HTMLSelectElement;
    fireEvent.change(embeddingSelect, { target: { value: "text-embedding-3-large" } });

    let previewBody: Record<string, unknown> | null = null;
    let savedHeaders: HeadersInit | undefined;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (
        url.endsWith("/admin/knowledge-sources/retrieval-policy/embedding-change-preview") &&
        init?.method === "POST"
      ) {
        previewBody = JSON.parse(String(init.body));
        return jsonResponse({
          impact: {
            fromEmbeddingModelKey: null,
            toEmbeddingModelKey: "text-embedding-3-large",
            requiresDangerousConfirmation: true,
            vectorSearchWillBeDisabled: false,
            alreadyIndexedSourceCount: 7,
            affectedSourceCount: 2,
            affectedChunkCount: 10,
            affectedBytes: 3600,
            sources: [
              {
                sourceType: "global_knowledge_source",
                label: "Product KB uploaded files",
                affectedSourceCount: 1,
                totalChunks: 4,
                totalBytes: 1200
              },
              {
                sourceType: "skill_document",
                label: "Skill documents",
                affectedSourceCount: 1,
                totalChunks: 6,
                totalBytes: 2400
              }
            ]
          }
        });
      }
      if (url.endsWith("/admin/step-up/challenge") && init?.method === "POST") {
        return jsonResponse({ challenge: { token: "step-up-token" } });
      }
      if (url.endsWith("/admin/knowledge-sources/retrieval-policy") && init?.method === "POST") {
        savedHeaders = init.headers;
        return jsonResponse({
          policy: {
            schema: "persai.adminKnowledgeRetrievalPolicy.v1",
            embeddingModelKey: "text-embedding-3-large",
            retrievalModelKey: null,
            authoringModelKey: null,
            smartSearchEnabled: true,
            smartSearchLongDocSummaryChars: 800,
            fetchFullModeAbsoluteMaxChars: 100000,
            fetchFullModeAbsoluteMaxChatMessages: 800,
            embeddingChangeImpact: null,
            notes: []
          }
        });
      }
      return jsonResponse({});
    });

    fireEvent.click(screen.getByRole("button", { name: /Save models/i }));
    await waitFor(() => {
      expect(previewBody).toEqual({ embeddingModelKey: "text-embedding-3-large" });
    });
    expect(savedHeaders).toBeUndefined();
    expect(screen.getByText("Confirm embedding model reindex")).toBeTruthy();
    expect(screen.getByText("Product KB uploaded files")).toBeTruthy();
    expect(screen.getByText("Skill documents")).toBeTruthy();
    expect(screen.getByText(/4 chunks/i)).toBeTruthy();
    expect(screen.getByText(/6 chunks/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Confirm model change/i }));
    await waitFor(() => {
      expect(savedHeaders).toBeDefined();
    });
    expect((savedHeaders as Record<string, string>)["x-persai-step-up-token"]).toBe(
      "step-up-token"
    );
  });
});
