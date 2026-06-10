import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminToolsPage from "./page";

const clerkMocks = vi.hoisted(() => ({
  getToken: vi.fn(async () => "test-token")
}));

const fetchMock = vi.hoisted(() => vi.fn());
const clipboardWriteTextMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: clerkMocks.getToken
  })
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  )
}));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}

const credentialsPayload = {
  schema: "persai.adminToolCredentials.v1",
  credentials: [
    {
      credentialKey: "tool_web_search",
      toolCode: "web_search",
      displayName: "Web Search",
      configured: false,
      lastFour: null,
      updatedAt: null,
      providerId: "tavily",
      providerOptions: [{ id: "tavily", label: "Tavily", envVar: "TAVILY_API_KEY" }]
    },
    {
      credentialKey: "tool_tts_elevenlabs",
      toolCode: "tts",
      displayName: "Text-to-Speech API Key (ElevenLabs)",
      configured: true,
      lastFour: "tts1",
      updatedAt: "2026-06-01T11:00:00.000Z",
      providerId: null,
      providerOptions: null
    },
    {
      credentialKey: "tool_tts_yandex",
      toolCode: "tts",
      displayName: "Text-to-Speech API Key (Yandex SpeechKit)",
      configured: false,
      lastFour: null,
      updatedAt: null,
      providerId: null,
      providerOptions: null
    },
    {
      credentialKey: "tool_tts_openai",
      toolCode: "tts",
      displayName: "Text-to-Speech API Key (OpenAI)",
      configured: false,
      lastFour: null,
      updatedAt: null,
      providerId: null,
      providerOptions: null
    },
    {
      credentialKey: "tool_live_voice_custom_llm_ingress",
      toolCode: "live_voice",
      displayName: "Live Voice Custom LLM Ingress Secret",
      configured: false,
      lastFour: null,
      updatedAt: null,
      providerId: null,
      providerOptions: null
    },
    {
      credentialKey: "tool_live_voice_relay_ticket",
      toolCode: "live_voice",
      displayName: "Live Voice Relay Ticket Secret",
      configured: false,
      lastFour: null,
      updatedAt: null,
      providerId: null,
      providerOptions: null
    },
    {
      credentialKey: "tool_image_generate",
      toolCode: "image_generate",
      displayName: "Image Generation / Edit / OpenAI Video API Key",
      configured: true,
      lastFour: "img1",
      updatedAt: "2026-06-01T12:00:00.000Z",
      providerId: null,
      providerOptions: null
    },
    {
      credentialKey: "tool_video_generate_runway",
      toolCode: "video_generate",
      displayName: "Video Generation API Key (Runway)",
      configured: true,
      lastFour: "rway",
      updatedAt: "2026-06-01T13:00:00.000Z",
      providerId: null,
      providerOptions: null
    },
    {
      credentialKey: "tool_video_generate_kling",
      toolCode: "video_generate",
      displayName: "Video Generation Credentials (Kling Access Key + Secret Key JSON)",
      configured: false,
      lastFour: null,
      updatedAt: null,
      providerId: null,
      providerOptions: null
    },
    {
      credentialKey: "tool_video_generate_heygen",
      toolCode: "video_generate",
      displayName: "Video Generation API Key (HeyGen)",
      configured: false,
      lastFour: null,
      updatedAt: null,
      providerId: null,
      providerOptions: null
    }
  ],
  documentProviderConfigs: [],
  ttsPrimaryProviderId: "elevenlabs",
  ttsPrimaryProviderOptions: [],
  heygenVoiceCatalog: {
    refreshedAt: "2026-06-06T10:00:00.000Z",
    voicesCount: 20
  },
  notes: []
};

const economicsPayload = {
  catalog: {
    schema: "persai.toolPathPricingCatalog.v1",
    notes: ["Economics note."],
    rows: [
      {
        pathKey: "web_search:tavily",
        toolCode: "web_search",
        providerId: "tavily",
        billingMode: "fixed_operation",
        active: true,
        configured: false,
        providerPriceMetadata: {
          currency: "USD",
          fixedOperationPricing: {
            unitLabel: "search",
            pricePerOperation: 0
          }
        }
      }
    ]
  }
};

describe("AdminToolsPage economics", () => {
  beforeEach(() => {
    clipboardWriteTextMock.mockReset();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/admin/runtime/tool-credentials") && init?.method !== "PUT") {
        return jsonResponse({ credentials: credentialsPayload });
      }
      if (url.endsWith("/api/v1/admin/tools/billing")) {
        return jsonResponse({
          settings: { schema: "x", providers: [], notes: [] }
        });
      }
      if (url.endsWith("/api/v1/admin/tools/document-processing")) {
        return jsonResponse({
          settings: {
            policy: {
              defaultProvider: "local",
              highQualityFallbackProvider: "mistral",
              localFallbackEnabled: true,
              autoFallbackEnabled: true,
              needsReviewThreshold: 0.65
            },
            providers: [],
            notes: []
          }
        });
      }
      if (url.endsWith("/api/v1/admin/tools/economics") && init?.method !== "PUT") {
        return jsonResponse(economicsPayload);
      }
      if (url.endsWith("/api/v1/admin/step-up/challenge")) {
        return jsonResponse({ challenge: { token: "step-up-token" } });
      }
      if (
        url.endsWith("/api/v1/admin/runtime/tool-credentials/heygen-voice-catalog/refresh") &&
        init?.method === "POST"
      ) {
        return jsonResponse({
          credentials: {
            ...credentialsPayload,
            heygenVoiceCatalog: {
              refreshedAt: "2026-06-06T11:00:00.000Z",
              voicesCount: 300
            }
          }
        });
      }
      if (url.endsWith("/api/v1/admin/tools/economics") && init?.method === "PUT") {
        return jsonResponse({
          catalog: economicsPayload.catalog,
          configGeneration: 2
        });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads and saves tool-path economics", async () => {
    render(<AdminToolsPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save tool-path economics" })).toBeTruthy();
    });

    const priceInput = screen.getByLabelText("Price per operation");
    fireEvent.change(priceInput, { target: { value: "0.05" } });

    fireEvent.click(screen.getByRole("button", { name: "Save tool-path economics" }));

    await waitFor(() => {
      expect(screen.getByText("Tool-path economics saved.")).toBeTruthy();
    });

    const putCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/api/v1/admin/tools/economics") && init?.method === "PUT"
    );
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String(putCall?.[1]?.body));
    expect(body.rows[0]?.providerPriceMetadata?.fixedOperationPricing?.pricePerOperation).toBe(
      0.05
    );
  }, 15_000);

  it("renders separate video provider credentials without changing the media slot", async () => {
    render(<AdminToolsPage />);

    await waitFor(() => {
      expect(screen.getByText("Video Providers")).toBeTruthy();
    });

    expect(screen.getByText("Image Generation / Edit / OpenAI Video API Key")).toBeTruthy();
    expect(screen.getByText("Video Generation API Key (Runway)")).toBeTruthy();
    expect(
      screen.getByText("Video Generation Credentials (Kling Access Key + Secret Key JSON)")
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Separate encrypted credentials for Runway, Kling, and HeyGen video providers. Kling uses official Access Key + Secret Key JSON, and these do not change the existing OpenAI image/edit credential slot."
      )
    ).toBeTruthy();
  });

  it("renders the HeyGen video credential row with the default API key placeholder", async () => {
    render(<AdminToolsPage />);

    await waitFor(() => {
      expect(screen.getByText("Video Providers")).toBeTruthy();
    });

    const heygenLabel = screen.getByText("Video Generation API Key (HeyGen)");
    const card = heygenLabel.closest("div.rounded-lg");
    expect(card).toBeTruthy();
    const input = card?.querySelector("input");
    expect(input).toBeTruthy();
    expect(input?.getAttribute("placeholder")).toBe("Enter API key...");
  });

  it("refreshes the HeyGen voice catalog from the admin tools surface", async () => {
    render(<AdminToolsPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Refresh voices" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh voices" }));

    await waitFor(() => {
      expect(screen.getByText("Updated: 300 voices.")).toBeTruthy();
    });

    const refreshCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(
          "/api/v1/admin/runtime/tool-credentials/heygen-voice-catalog/refresh"
        ) && init?.method === "POST"
    );
    expect(refreshCall).toBeTruthy();
  });

  it("renders live voice internal secrets and supports generate/copy", async () => {
    const originalCrypto = globalThis.crypto;
    const getRandomValues = vi.fn((array: Uint8Array) => {
      for (let index = 0; index < array.length; index += 1) {
        array[index] = index + 1;
      }
      return array;
    });
    vi.stubGlobal("crypto", {
      ...originalCrypto,
      getRandomValues
    } as Crypto);

    render(<AdminToolsPage />);

    await waitFor(() => {
      expect(screen.getByText("Live Voice")).toBeTruthy();
    });

    expect(screen.getByText("Live Voice Custom LLM Ingress Secret")).toBeTruthy();
    expect(screen.getByText("Live Voice Relay Ticket Secret")).toBeTruthy();
    expect(
      screen.getByText(
        "The ElevenLabs API key for live voice is the same one entered in the TTS section above; set the two internal secrets below."
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Paste this same value into your ElevenLabs Agent -> Custom LLM -> API Key. PersAI verifies it as a Bearer token."
      )
    ).toBeTruthy();
    expect(
      screen.getByText("Server-only. Signs relay tickets; never entered into ElevenLabs.")
    ).toBeTruthy();

    const generateButton = screen.getByRole("button", {
      name: "Generate Live Voice Custom LLM Ingress Secret"
    });
    fireEvent.click(generateButton);

    const generatedInput = screen.getByDisplayValue("AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA");
    expect(generatedInput).toBeTruthy();
    expect(getRandomValues).toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy Live Voice Custom LLM Ingress Secret"
      })
    );

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(
        "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA"
      );
    });

    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock
      }
    });
  });
});
