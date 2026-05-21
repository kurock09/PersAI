import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminRuntimeProviderSettingsState } from "@persai/contracts";
import AdminRuntimePage, {
  buildRouterPrecheckRuleOverrides,
  buildSkillRoutingPolicyInput,
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
      precheckRuleOverrides: null
    },
    skillRoutingPolicy: {
      initialCheckUserMessageIndex: 3,
      backgroundRecheckIntervalMessages: 5
    },
    availableModelsByProvider: {
      openai: ["gpt-5.4"],
      anthropic: []
    },
    availableModelCatalogByProvider: {
      openai: {
        models: [
          {
            model: "gpt-5.4",
            capabilities: ["chat"],
            active: true,
            billingMode: "token_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 0.25,
            outputTokenWeight: 4,
            displayLabel: "GPT 5.4",
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 1.25,
                cachedInputPer1M: 0.25,
                outputPer1M: 10
              }
            }
          },
          {
            model: "gpt-image-2",
            capabilities: ["image"],
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
      }
    },
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

    fireEvent.change(screen.getAllByLabelText("Billing mode")[1]!, {
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
  });

  it("archives existing catalog rows instead of deleting them from the saved catalog", async () => {
    render(<AdminRuntimePage />);

    await waitFor(() =>
      expect(apiMocks.getAdminRuntimeProviderSettings).toHaveBeenCalledWith("token-1")
    );

    fireEvent.click(screen.getByRole("button", { name: /Provider Model Catalog/i }));

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
});

describe("admin runtime decimal inputs", () => {
  it("parses dot and comma decimals for per-1M pricing fields", () => {
    expect(normalizeDecimalInputText("0,075")).toBe("0.075");
    expect(parseDecimalInputText("0.075")).toBe(0.075);
    expect(parseDecimalInputText("0,")).toBeNull();
    expect(parseDecimalInputText("0.")).toBeNull();
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

    const inputPer1M = screen.getByLabelText("Input / 1M");
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

  it("parses bounded skill routing cadence inputs", () => {
    expect(
      buildSkillRoutingPolicyInput({
        initialCheckUserMessageIndexText: "3",
        backgroundRecheckIntervalMessagesText: "5"
      })
    ).toEqual({
      initialCheckUserMessageIndex: 3,
      backgroundRecheckIntervalMessages: 5
    });
  });

  it("rejects invalid skill routing cadence inputs", () => {
    expect(() =>
      buildSkillRoutingPolicyInput({
        initialCheckUserMessageIndexText: "0",
        backgroundRecheckIntervalMessagesText: "x"
      })
    ).toThrow(/Initial background skill check must be between 1 and 20/);
  });
});
