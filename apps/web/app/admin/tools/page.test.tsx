import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminToolsPage from "./page";

const clerkMocks = vi.hoisted(() => ({
  getToken: vi.fn(async () => "test-token")
}));

const fetchMock = vi.hoisted(() => vi.fn());

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
      displayName: "Video Generation API Key (Kling)",
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
      if (url.endsWith("/api/v1/admin/tools/economics") && init?.method === "PUT") {
        return jsonResponse({
          catalog: economicsPayload.catalog,
          configGeneration: 2
        });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
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
    expect(screen.getByText("Video Generation API Key (Kling)")).toBeTruthy();
    expect(
      screen.getByText(
        "Separate encrypted API keys for Runway and Kling video providers. These do not change the existing OpenAI image/edit credential slot."
      )
    ).toBeTruthy();
  });
});
