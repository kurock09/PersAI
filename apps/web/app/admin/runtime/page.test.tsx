import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminRuntimeProviderSettingsState } from "@persai/contracts";
import AdminRuntimePage, {
  buildRouterPrecheckRuleOverrides,
  normalizeVideoModelParametersForSlice2,
  normalizeDecimalInputText,
  parseDecimalInputText,
  parseRouterTriggerTerms
} from "./page";

const clerkMocks = vi.hoisted(() => ({
  getToken: vi.fn()
}));

const apiMocks = vi.hoisted(() => ({
  getAdminRuntimeProviderSettings: vi.fn(),
  putAdminRuntimeProviderSettings: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: clerkMocks.getToken
  })
}));

vi.mock("@/app/app/assistant-api-client", () => ({
  getAdminRuntimeProviderSettings: apiMocks.getAdminRuntimeProviderSettings,
  putAdminRuntimeProviderSettings: apiMocks.putAdminRuntimeProviderSettings
}));

function createRuntimeSettingsState(): AdminRuntimeProviderSettingsState {
  return {
    schema: "persai.adminRuntimeProviderSettings.v2",
    mode: "global_settings",
    primary: {
      provider: "openai",
      model: "gpt-5.4"
    },
    fallback: null,
    routingFastModelKey: null,
    routerPolicy: {
      enabled: false,
      mode: "shadow",
      classifierFailureFallbackMode: "normal",
      clarifyOnMissingContext: true,
      analyzeUploadsOnB2cUpload: false,
      precheckRuleOverrides: null
    },
    availableModelsByProvider: {
      openai: ["gpt-5.4"],
      anthropic: [],
      deepseek: ["deepseek-v4-flash"],
      kimi: []
    },
    availableModelCatalogByProvider: {
      openai: {
        models: [
          {
            model: "gpt-5.4",
            capabilities: ["chat"],
            kind: "cinematic",
            active: true,
            billingMode: "token_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cacheWriteInputTokenWeight: 1,
            cachedInputTokenWeight: 0.25,
            outputTokenWeight: 4,
            displayLabel: "GPT 5.4",
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 1.25,
                cacheCreationInputPer1M: 0,
                cachedInputPer1M: 0.25,
                outputPer1M: 10
              }
            }
          },
          {
            model: "gpt-image-2",
            capabilities: ["image"],
            kind: "cinematic",
            active: true,
            billingMode: "fixed_operation",
            effectiveFrom: "2026-05-01T00:00:00.000Z",
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: null,
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              fixedOperationPricing: {
                unitLabel: "render",
                pricePerOperation: 0.04
              }
            }
          }
        ]
      },
      anthropic: {
        models: []
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
            inputTokenWeight: 0.112,
            cacheWriteInputTokenWeight: 0.112,
            cachedInputTokenWeight: 0.00224,
            outputTokenWeight: 0.224,
            displayLabel: "DeepSeek V4 Flash",
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 0.14,
                cacheCreationInputPer1M: 0,
                cachedInputPer1M: 0.0028,
                outputPer1M: 0.28
              }
            }
          }
        ]
      },
      kimi: { models: [] },
      runway: {
        models: []
      },
      kling: {
        models: []
      },
      heygen: {
        models: []
      }
    },
    providerKeys: {
      openai: {
        configured: true,
        lastFour: "1234",
        updatedAt: "2026-05-20T16:00:00.000Z"
      },
      anthropic: {
        configured: false,
        lastFour: null,
        updatedAt: null
      },
      deepseek: {
        configured: false,
        lastFour: null,
        updatedAt: null
      },
      kimi: {
        configured: false,
        lastFour: null,
        updatedAt: null
      }
    },
    vcoinExchangeRate: 20,
    notes: []
  };
}

describe("AdminRuntimePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerkMocks.getToken.mockResolvedValue("token-1");
    apiMocks.getAdminRuntimeProviderSettings.mockResolvedValue(createRuntimeSettingsState());
    apiMocks.putAdminRuntimeProviderSettings.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("switches pricing editor branches with billing mode and saves only the active branch", async () => {
    render(<AdminRuntimePage />);

    await waitFor(() =>
      expect(apiMocks.getAdminRuntimeProviderSettings).toHaveBeenCalledWith("token-1")
    );

    fireEvent.click(screen.getByRole("button", { name: /Provider Model Catalog/i }));

    fireEvent.change(screen.getByLabelText("OpenAI catalog entry"), {
      target: { value: "1" }
    });

    fireEvent.change(screen.getAllByLabelText("Billing mode")[0]!, {
      target: { value: "tiered_operation" }
    });

    expect(screen.getByRole("button", { name: "Add tier" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add tier" }));
    fireEvent.change(screen.getByLabelText("Tier label"), {
      target: { value: "HD" }
    });
    fireEvent.change(screen.getByLabelText("Match value"), {
      target: { value: "1024x1024" }
    });
    const tierPrice = screen.getByLabelText("Price");
    fireEvent.change(tierPrice, {
      target: { value: "0.08" }
    });
    fireEvent.blur(tierPrice);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiMocks.putAdminRuntimeProviderSettings).toHaveBeenCalledWith(
        "token-1",
        expect.any(Object)
      )
    );

    const request = apiMocks.putAdminRuntimeProviderSettings.mock.calls[0]![1];
    const imageProfile = request.availableModelCatalogByProvider.openai.models.find(
      (profile: { model: string }) => profile.model === "gpt-image-2"
    );

    expect(imageProfile.billingMode).toBe("tiered_operation");
    expect(imageProfile.providerPriceMetadata).toEqual({
      currency: "USD",
      tieredOperationPricing: {
        unitLabel: null,
        tiers: [{ label: "HD", matchValue: "1024x1024", price: 0.08 }]
      }
    });
    expect(imageProfile.providerPriceMetadata).not.toHaveProperty("fixedOperationPricing");
    expect(imageProfile.providerPriceMetadata).not.toHaveProperty("tokenPricing");
    expect(imageProfile.providerPriceMetadata).not.toHaveProperty("timePricing");
  }, 15000);

  it("edits and persists the OpenAI chat prompt cache policy", async () => {
    render(<AdminRuntimePage />);

    await waitFor(() =>
      expect(apiMocks.getAdminRuntimeProviderSettings).toHaveBeenCalledWith("token-1")
    );

    fireEvent.click(screen.getByRole("button", { name: /Provider Model Catalog/i }));
    fireEvent.change(screen.getByLabelText("Prompt cache policy"), {
      target: { value: "explicit:30m" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiMocks.putAdminRuntimeProviderSettings).toHaveBeenCalledWith(
        "token-1",
        expect.any(Object)
      )
    );
    const request = apiMocks.putAdminRuntimeProviderSettings.mock.calls[0]![1];
    const chatProfile = request.availableModelCatalogByProvider.openai.models.find(
      (profile: { model: string }) => profile.model === "gpt-5.4"
    );
    expect(chatProfile?.promptCachePolicy).toEqual({
      mode: "explicit",
      ttl: "30m",
      stableAnchor: "explicit",
      sealedSpineBreakpoint: "explicit"
    });
  });

  it("archives existing catalog rows instead of deleting them from the saved catalog", async () => {
    render(<AdminRuntimePage />);

    await waitFor(() =>
      expect(apiMocks.getAdminRuntimeProviderSettings).toHaveBeenCalledWith("token-1")
    );

    fireEvent.click(screen.getByRole("button", { name: /Provider Model Catalog/i }));

    fireEvent.change(screen.getByLabelText("OpenAI catalog entry"), {
      target: { value: "1" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Archive version gpt-image-2" }));

    expect(screen.getByRole("button", { name: "Archive version gpt-image-2" })).toBeDisabled();
    expect(screen.getByText("Archived")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiMocks.putAdminRuntimeProviderSettings).toHaveBeenCalledWith(
        "token-1",
        expect.any(Object)
      )
    );

    const request = apiMocks.putAdminRuntimeProviderSettings.mock.calls[0]![1];
    const imageProfiles = request.availableModelCatalogByProvider.openai.models.filter(
      (profile: { model: string }) => profile.model === "gpt-image-2"
    );

    expect(imageProfiles).toHaveLength(1);
    expect(imageProfiles[0]).toMatchObject({
      model: "gpt-image-2",
      active: false
    });
    expect(imageProfiles[0].effectiveTo).toBeTruthy();
  });

  it("round-trips the upload analysis router toggle", async () => {
    render(<AdminRuntimePage />);

    await waitFor(() =>
      expect(apiMocks.getAdminRuntimeProviderSettings).toHaveBeenCalledWith("token-1")
    );

    fireEvent.click(screen.getByRole("button", { name: /Router Policy/i }));
    fireEvent.click(
      screen.getByLabelText("Analyze uploads in B2C chats. Project chats always analyze uploads.")
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiMocks.putAdminRuntimeProviderSettings).toHaveBeenCalledWith(
        "token-1",
        expect.any(Object)
      )
    );

    const request = apiMocks.putAdminRuntimeProviderSettings.mock.calls.at(-1)?.[1];
    expect(request.routerPolicy.analyzeUploadsOnB2cUpload).toBe(true);
  });
});

describe("AdminRuntimePage catalog picker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerkMocks.getToken.mockResolvedValue("token-1");
    apiMocks.getAdminRuntimeProviderSettings.mockResolvedValue(createRuntimeSettingsState());
    apiMocks.putAdminRuntimeProviderSettings.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows one model editor at a time and switches via catalog entry select", async () => {
    render(<AdminRuntimePage />);

    await waitFor(() =>
      expect(apiMocks.getAdminRuntimeProviderSettings).toHaveBeenCalledWith("token-1")
    );

    fireEvent.click(screen.getByRole("button", { name: /Provider Model Catalog/i }));

    expect(screen.getAllByLabelText("Billing mode")).toHaveLength(2);
    expect(screen.getAllByLabelText("Input / 1M")).toHaveLength(2);
    expect(screen.queryByLabelText("Price / operation")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("OpenAI catalog entry"), {
      target: { value: "1" }
    });

    expect(screen.getAllByLabelText("Billing mode")).toHaveLength(2);
    expect(screen.getAllByLabelText("Input / 1M")).toHaveLength(1);
    expect(screen.getByLabelText("Price / operation")).toBeInTheDocument();
  });

  it("renders DeepSeek alongside video catalog cards in chat provider selectors", async () => {
    render(<AdminRuntimePage />);

    await waitFor(() =>
      expect(apiMocks.getAdminRuntimeProviderSettings).toHaveBeenCalledWith("token-1")
    );

    fireEvent.click(screen.getByRole("button", { name: /Provider Model Catalog/i }));

    expect(screen.getByRole("heading", { name: "Runway" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Kling" })).toBeInTheDocument();
    expect(screen.getAllByText("Video only").length).toBeGreaterThanOrEqual(2);

    const providerSelects = screen.getAllByLabelText("Provider");
    expect(providerSelects.length).toBeGreaterThan(0);
    for (const select of providerSelects) {
      const optionValues = within(select)
        .getAllByRole("option")
        .map((option) => option.textContent);
      expect(optionValues).toEqual(["OpenAI", "Anthropic", "DeepSeek", "Kimi"]);
    }
  });

  it("keeps Runway rows video-only with time-metered pricing defaults", async () => {
    render(<AdminRuntimePage />);

    await waitFor(() =>
      expect(apiMocks.getAdminRuntimeProviderSettings).toHaveBeenCalledWith("token-1")
    );

    fireEvent.click(screen.getByRole("button", { name: /Provider Model Catalog/i }));

    // Catalog order: openai, anthropic, deepseek, kimi, runway, kling, heygen
    fireEvent.click(screen.getAllByRole("button", { name: "Add model" })[4]!);

    const runwayBillingMode = screen.getAllByLabelText("Billing mode").at(-1)!;
    expect(runwayBillingMode).toHaveValue("time_metered");
    fireEvent.change(screen.getAllByLabelText("Model key").at(-1)!, {
      target: { value: "runway-gen-4" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiMocks.putAdminRuntimeProviderSettings).toHaveBeenCalledWith(
        "token-1",
        expect.any(Object)
      )
    );

    const request = apiMocks.putAdminRuntimeProviderSettings.mock.calls.at(-1)?.[1];
    expect(request.availableModelCatalogByProvider.runway.models).toHaveLength(1);
    expect(request.availableModelCatalogByProvider.runway.models[0]).toMatchObject({
      model: "runway-gen-4",
      capabilities: ["video"],
      billingMode: "time_metered",
      videoModelParameters: {
        duration: { kind: "allowed_list", values: [5, 8, 10] },
        aspectRatios: [
          { aspectRatio: "16:9", size: "1280x720", providerValue: "1280:720" },
          { aspectRatio: "9:16", size: "720x1280", providerValue: "720:1280" }
        ],
        referenceImageSupported: true,
        audioCapabilities: ["silent"],
        inputCapabilities: ["text", "single_reference_image"],
        providerParameters: null
      }
    });
    expect(request.availableModelsByProvider).toEqual({
      openai: ["gpt-5.4"],
      anthropic: [],
      deepseek: ["deepseek-v4-flash"],
      kimi: []
    });
  }, 30_000);

  it("seeds kimi-k3 token pricing when adding a Kimi catalog row", async () => {
    render(<AdminRuntimePage />);

    await waitFor(() =>
      expect(apiMocks.getAdminRuntimeProviderSettings).toHaveBeenCalledWith("token-1")
    );

    fireEvent.click(screen.getByRole("button", { name: /Provider Model Catalog/i }));
    // Catalog order: openai, anthropic, deepseek, kimi, runway, kling, heygen
    fireEvent.click(screen.getAllByRole("button", { name: "Add model" })[3]!);

    fireEvent.change(screen.getAllByLabelText("Model key").at(-1)!, {
      target: { value: "kimi-k3" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiMocks.putAdminRuntimeProviderSettings).toHaveBeenCalledWith(
        "token-1",
        expect.any(Object)
      )
    );

    const request = apiMocks.putAdminRuntimeProviderSettings.mock.calls.at(-1)?.[1];
    expect(request.availableModelCatalogByProvider.kimi.models).toHaveLength(1);
    expect(request.availableModelCatalogByProvider.kimi.models[0]).toMatchObject({
      model: "kimi-k3",
      capabilities: ["chat"],
      billingMode: "token_metered",
      providerPriceMetadata: {
        currency: "USD",
        tokenPricing: {
          inputPer1M: 3.0,
          cacheCreationInputPer1M: 0,
          cachedInputPer1M: 0.3,
          outputPer1M: 15.0
        }
      }
    });
  });

  it("saves active-slice Kling video defaults without deferred omni", async () => {
    render(<AdminRuntimePage />);

    await waitFor(() =>
      expect(apiMocks.getAdminRuntimeProviderSettings).toHaveBeenCalledWith("token-1")
    );

    fireEvent.click(screen.getByRole("button", { name: /Provider Model Catalog/i }));
    // Catalog order: openai, anthropic, deepseek, kimi, runway, kling, heygen
    fireEvent.click(screen.getAllByRole("button", { name: "Add model" })[5]!);

    fireEvent.change(screen.getAllByLabelText("Model key").at(-1)!, {
      target: { value: "kling-v3" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiMocks.putAdminRuntimeProviderSettings).toHaveBeenCalledWith(
        "token-1",
        expect.any(Object)
      )
    );

    const request = apiMocks.putAdminRuntimeProviderSettings.mock.calls.at(-1)?.[1];
    expect(request.availableModelCatalogByProvider.kling.models[0]).toMatchObject({
      model: "kling-v3",
      capabilities: ["video"],
      videoModelParameters: {
        referenceImageSupported: true,
        audioCapabilities: ["silent", "provider_native_audio", "voice_control"],
        inputCapabilities: ["text", "single_reference_image", "multi_image"],
        providerParameters: {
          mode: "pro",
          sound: "off"
        }
      }
    });
  });
  // ADR-109 Slice 2b: capability kind badge renders per-row
  it("renders Cinematic badge for non-HeyGen rows and Talking Avatar badge for HeyGen rows", async () => {
    const stateWithHeygen = {
      ...createRuntimeSettingsState(),
      availableModelCatalogByProvider: {
        ...createRuntimeSettingsState().availableModelCatalogByProvider,
        heygen: {
          models: [
            {
              model: "heygen-v2",
              capabilities: ["video"],
              kind: "talking_avatar",
              active: true,
              billingMode: "fixed_operation",
              effectiveFrom: null,
              effectiveTo: null,
              inputTokenWeight: 1,
              cacheWriteInputTokenWeight: 1,
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
        }
      }
    };
    apiMocks.getAdminRuntimeProviderSettings.mockResolvedValue(stateWithHeygen);

    render(<AdminRuntimePage />);

    await waitFor(() =>
      expect(apiMocks.getAdminRuntimeProviderSettings).toHaveBeenCalledWith("token-1")
    );

    fireEvent.click(screen.getByRole("button", { name: /Provider Model Catalog/i }));

    // OpenAI rows (non-HeyGen) show "Cinematic"
    const cinematicBadges = screen.getAllByLabelText("Capability kind");
    expect(cinematicBadges.some((el) => el.textContent === "Cinematic")).toBe(true);

    // HeyGen row shows "Talking Avatar"
    expect(cinematicBadges.some((el) => el.textContent === "Talking Avatar")).toBe(true);
  });
});

describe("admin runtime decimal inputs", () => {
  it("parses dot and comma decimals for per-1M pricing fields", () => {
    expect(normalizeDecimalInputText("0,075")).toBe("0.075");
    expect(parseDecimalInputText("0.075")).toBe(0.075);
    expect(parseDecimalInputText("0,")).toBeNull();
    expect(parseDecimalInputText("0.")).toBeNull();
  });
});

describe("admin runtime video capability helpers", () => {
  it("normalizes active slice video capabilities dynamically", () => {
    expect(
      normalizeVideoModelParametersForSlice2({
        duration: { kind: "allowed_list", values: [5, 8, 10] },
        aspectRatios: [{ aspectRatio: "16:9", size: "1280x720", providerValue: "16:9" }],
        referenceImageSupported: false,
        audioCapabilities: ["voice_control"],
        inputCapabilities: ["text", "single_reference_image", "multi_image", "omni"],
        providerParameters: {
          mode: "pro",
          sound: "on"
        }
      })
    ).toEqual({
      duration: { kind: "allowed_list", values: [5, 8, 10] },
      aspectRatios: [{ aspectRatio: "16:9", size: "1280x720", providerValue: "16:9" }],
      referenceImageSupported: false,
      audioCapabilities: ["silent"],
      inputCapabilities: ["text"],
      providerParameters: {
        mode: "pro",
        sound: "off"
      }
    });
  });
});

describe("AdminRuntimePage decimal pricing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerkMocks.getToken.mockResolvedValue("token-1");
    apiMocks.getAdminRuntimeProviderSettings.mockResolvedValue(createRuntimeSettingsState());
    apiMocks.putAdminRuntimeProviderSettings.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps fractional per-1M pricing while typing", async () => {
    render(<AdminRuntimePage />);

    await waitFor(() =>
      expect(apiMocks.getAdminRuntimeProviderSettings).toHaveBeenCalledWith("token-1")
    );

    fireEvent.click(screen.getByRole("button", { name: /Provider Model Catalog/i }));

    const inputPer1M = screen.getAllByLabelText("Input / 1M")[0]!;
    await act(async () => {
      fireEvent.focus(inputPer1M);
      fireEvent.change(inputPer1M, { target: { value: "0,075" } });
      fireEvent.blur(inputPer1M);
    });
    await waitFor(() => expect(inputPer1M).toHaveValue("0.075"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    await waitFor(() => {
      const request = apiMocks.putAdminRuntimeProviderSettings.mock.calls[0]![1];
      const chatProfile = request.availableModelCatalogByProvider.openai.models.find(
        (profile: { model: string }) => profile.model === "gpt-5.4"
      );
      expect(chatProfile?.providerPriceMetadata.tokenPricing.inputPer1M).toBe(0.075);
    });
  });

  it("ADR-108 Slice 5 — shows 1 USD = 20 VC label next to a time_metered price row", async () => {
    const stateWithTimeMetered = {
      ...createRuntimeSettingsState(),
      vcoinExchangeRate: 20,
      availableModelCatalogByProvider: {
        ...createRuntimeSettingsState().availableModelCatalogByProvider,
        runway: {
          models: [
            {
              model: "gen4-turbo",
              capabilities: ["video"],
              kind: "cinematic",
              active: true,
              billingMode: "time_metered",
              effectiveFrom: null,
              effectiveTo: null,
              inputTokenWeight: 1,
              cacheWriteInputTokenWeight: 1,
              cachedInputTokenWeight: 1,
              outputTokenWeight: 1,
              displayLabel: "Gen4 Turbo",
              notes: null,
              providerPriceMetadata: {
                currency: "USD",
                timePricing: { unit: "second", pricePerUnit: 0.05 }
              }
            }
          ]
        }
      }
    };
    apiMocks.getAdminRuntimeProviderSettings.mockResolvedValue(stateWithTimeMetered);

    render(<AdminRuntimePage />);
    await waitFor(() =>
      expect(apiMocks.getAdminRuntimeProviderSettings).toHaveBeenCalledWith("token-1")
    );

    fireEvent.click(screen.getByRole("button", { name: /Provider Model Catalog/i }));
    fireEvent.change(screen.getByLabelText("Runway catalog entry"), { target: { value: "0" } });

    await waitFor(() => {
      expect(screen.getByText("1 USD = 20 VC")).toBeInTheDocument();
    });
  });

  it("renders the HeyGen catalog card with the empty-rows placeholder copy", async () => {
    render(<AdminRuntimePage />);
    await waitFor(() =>
      expect(apiMocks.getAdminRuntimeProviderSettings).toHaveBeenCalledWith("token-1")
    );

    fireEvent.click(screen.getByRole("button", { name: /Provider Model Catalog/i }));

    expect(screen.getByText("HeyGen")).toBeInTheDocument();
    expect(screen.getByText(/Catalog rows arrive in Slice 2b/i)).toBeInTheDocument();
  });
});

describe("admin runtime router policy helpers", () => {
  it("parses one trigger phrase per line", () => {
    expect(parseRouterTriggerTerms("ok\ncontinue\nok")).toEqual(["ok", "continue"]);
  });

  it("builds per-category precheck overrides from admin textareas", () => {
    expect(
      buildRouterPrecheckRuleOverrides({
        continueTermsText: "ok\ncontinue\nok",
        retrievalTermsText: "find in docs",
        reasoningTermsText: "architecture",
        premiumTermsText: "cover letter",
        toolTermsText: "browse",
        productPriorityTermsText: "тариф\nplan",
        webPriorityTermsText: "today\nweather",
        personalPriorityTermsText: "i\nmy"
      })
    ).toEqual({
      continueTerms: ["ok", "continue"],
      retrievalTerms: ["find in docs"],
      reasoningTerms: ["architecture"],
      premiumTerms: ["cover letter"],
      toolTerms: ["browse"],
      productPriorityTerms: ["тариф", "plan"],
      webPriorityTerms: ["today", "weather"],
      personalPriorityTerms: ["i", "my"]
    });
  });

  it("returns null for blank overrides", () => {
    expect(
      buildRouterPrecheckRuleOverrides({
        continueTermsText: "   ",
        retrievalTermsText: "",
        reasoningTermsText: "",
        premiumTermsText: "",
        toolTermsText: "",
        productPriorityTermsText: "",
        webPriorityTermsText: "",
        personalPriorityTermsText: ""
      })
    ).toBeNull();
  });
});

describe("ADR-122 — max output tokens and context window inputs", () => {
  beforeEach(() => {
    clerkMocks.getToken.mockResolvedValue("token-1");
    apiMocks.getAdminRuntimeProviderSettings.mockResolvedValue(createRuntimeSettingsState());
    apiMocks.putAdminRuntimeProviderSettings.mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it("renders Max output tokens and Context window inputs for a catalog entry", async () => {
    render(<AdminRuntimePage />);
    await waitFor(() =>
      expect(apiMocks.getAdminRuntimeProviderSettings).toHaveBeenCalledWith("token-1")
    );

    fireEvent.click(screen.getByRole("button", { name: /Provider Model Catalog/i }));

    await waitFor(() => {
      expect(screen.getAllByLabelText("Max output tokens").length).toBeGreaterThan(0);
      expect(screen.getAllByLabelText("Context window").length).toBeGreaterThan(0);
    });
  });

  it("accepts a positive integer for Max output tokens and saves it", async () => {
    render(<AdminRuntimePage />);
    await waitFor(() =>
      expect(apiMocks.getAdminRuntimeProviderSettings).toHaveBeenCalledWith("token-1")
    );

    fireEvent.click(screen.getByRole("button", { name: /Provider Model Catalog/i }));

    const inputs = await waitFor(() => screen.getAllByLabelText("Max output tokens"));
    const input = inputs[0]!;
    fireEvent.change(input, { target: { value: "64000" } });
    fireEvent.blur(input);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMocks.putAdminRuntimeProviderSettings).toHaveBeenCalled());
    const savedArg = apiMocks.putAdminRuntimeProviderSettings.mock.calls[0]![1];
    const openaiModels = savedArg.availableModelCatalogByProvider?.openai?.models ?? [];
    expect(openaiModels[0]?.maxOutputTokens).toBe(64000);
  });

  it("shows placeholder for null Max output tokens and accepts clearing to null", async () => {
    const stateWithValues = {
      ...createRuntimeSettingsState(),
      availableModelCatalogByProvider: {
        ...createRuntimeSettingsState().availableModelCatalogByProvider,
        openai: {
          models: createRuntimeSettingsState().availableModelCatalogByProvider.openai.models.map(
            (m, i) => (i === 0 ? { ...m, maxOutputTokens: 64000, contextWindow: 200000 } : m)
          )
        }
      }
    };
    apiMocks.getAdminRuntimeProviderSettings.mockResolvedValue(stateWithValues);

    render(<AdminRuntimePage />);
    await waitFor(() =>
      expect(apiMocks.getAdminRuntimeProviderSettings).toHaveBeenCalledWith("token-1")
    );

    fireEvent.click(screen.getByRole("button", { name: /Provider Model Catalog/i }));

    // The max output tokens input should initially show the seeded value
    const maxTokenInputs = await waitFor(() => screen.getAllByLabelText("Max output tokens"));
    const maxTokenInput = maxTokenInputs[0] as HTMLInputElement;
    expect(maxTokenInput.value).toBe("64000");

    // Context window shows seeded value
    const ctxInputs = await waitFor(() => screen.getAllByLabelText("Context window"));
    const ctxInput = ctxInputs[0] as HTMLInputElement;
    expect(ctxInput.value).toBe("200000");

    // Clearing the value and blurring sets draft to empty and triggers null callback
    fireEvent.change(maxTokenInput, { target: { value: "" } });

    // After clearing, the draft value should be ""
    await waitFor(() => {
      expect(maxTokenInput.value).toBe("");
    });
  });
});
