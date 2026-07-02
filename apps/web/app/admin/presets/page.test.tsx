import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminPresetsPage from "./page";

const clerkMocks = vi.hoisted(() => ({
  getToken: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: clerkMocks.getToken
  })
}));

type ToolState = {
  toolCode: string;
  displayName: string;
  description: string | null;
  modelDescription: string | null;
  modelUsageGuidance: string | null;
  codeDefaultModelDescription: string | null;
  codeDefaultModelUsageGuidance: string | null;
  modelDescriptionOverridden: boolean;
  modelUsageGuidanceOverridden: boolean;
  toolClass: "utility";
  capabilityGroup: "workspace_ops";
  policyClass: "plan_managed";
  catalogStatus: "active";
};

function makeTool(overrides: Partial<ToolState> = {}): ToolState {
  return {
    toolCode: "scheduled_action",
    displayName: "Scheduled Action",
    description: "Catalog description",
    modelDescription: "Code default description",
    modelUsageGuidance: "Code default guidance",
    codeDefaultModelDescription: "Code default description",
    codeDefaultModelUsageGuidance: "Code default guidance",
    modelDescriptionOverridden: false,
    modelUsageGuidanceOverridden: false,
    toolClass: "utility",
    capabilityGroup: "workspace_ops",
    policyClass: "plan_managed",
    catalogStatus: "active",
    ...overrides
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

describe("AdminPresetsPage tool prompt defaults", () => {
  beforeEach(() => {
    clerkMocks.getToken.mockResolvedValue("token-1");
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true)
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders catalog-backed tools read-only when use code default is enabled", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/admin/prompt-templates")) {
        return jsonResponse({ presets: [] });
      }
      if (url.endsWith("/api/v1/admin/tools/metadata")) {
        return jsonResponse({ tools: [makeTool()] });
      }
      if (url.endsWith("/api/v1/admin/persona-archetypes")) {
        return jsonResponse({ archetypes: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<AdminPresetsPage />);

    await screen.findByText("Scheduled Action");
    const checkbox = screen.getByLabelText("Use code default") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    const description = screen.getByDisplayValue("Code default description") as HTMLTextAreaElement;
    const guidance = screen.getByDisplayValue("Code default guidance") as HTMLTextAreaElement;
    expect(description.readOnly).toBe(true);
    expect(guidance.readOnly).toBe(true);
  });

  it("resets prompt templates through the API and refreshes the editor text", async () => {
    const customPreset = {
      id: "system",
      template: "Custom system template",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };
    const resetPreset = {
      id: "system",
      template: "Factory system template",
      updatedAt: "2026-01-02T00:00:00.000Z"
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/admin/prompt-templates")) {
        return jsonResponse({ presets: [customPreset] });
      }
      if (url.endsWith("/api/v1/admin/tools/metadata")) {
        return jsonResponse({ tools: [] });
      }
      if (url.endsWith("/api/v1/admin/persona-archetypes")) {
        return jsonResponse({ archetypes: [] });
      }
      if (url.endsWith("/api/v1/admin/prompt-templates/system/reset-to-default")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({ preset: resetPreset });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<AdminPresetsPage />);

    await screen.findByText("Custom system template");
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));

    await screen.findByText("Factory system template");
    await waitFor(() => {
      expect(screen.queryByText("Custom system template")).not.toBeInTheDocument();
    });
  });

  it("does not PATCH a stale client-side prompt default when the reset API rejects", async () => {
    const customPreset = {
      id: "system",
      template: "Custom system template",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/admin/prompt-templates")) {
        return jsonResponse({ presets: [customPreset] });
      }
      if (url.endsWith("/api/v1/admin/tools/metadata")) {
        return jsonResponse({ tools: [] });
      }
      if (url.endsWith("/api/v1/admin/persona-archetypes")) {
        return jsonResponse({ archetypes: [] });
      }
      if (url.endsWith("/api/v1/admin/prompt-templates/system/reset-to-default")) {
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({ errors: [{ message: "Unauthorized" }] }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url.endsWith("/api/v1/admin/prompt-templates/system")) {
        throw new Error("Reset failure must not fall back to PATCH with a client-side default.");
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<AdminPresetsPage />);

    await screen.findAllByText("Custom system template");
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));

    await screen.findByText('Failed to reset prompt template "system" to default.');
    expect(screen.getAllByText("Custom system template").length).toBeGreaterThan(0);
  });

  it("resets a tool override back to code defaults and read-only mode", async () => {
    const overrideTool = makeTool({
      modelDescription: "Custom override description",
      modelUsageGuidance: "Custom override guidance",
      modelDescriptionOverridden: true,
      modelUsageGuidanceOverridden: true
    });
    const resetTool = makeTool();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/admin/prompt-templates")) {
        return jsonResponse({ presets: [] });
      }
      if (url.endsWith("/api/v1/admin/tools/metadata")) {
        return jsonResponse({ tools: [overrideTool] });
      }
      if (url.endsWith("/api/v1/admin/persona-archetypes")) {
        return jsonResponse({ archetypes: [] });
      }
      if (url.endsWith("/api/v1/admin/tools/metadata/scheduled_action")) {
        expect(init?.method).toBe("PATCH");
        expect(init?.body).toBe(
          JSON.stringify({
            modelDescription: null,
            modelUsageGuidance: null
          })
        );
        return jsonResponse({ tool: resetTool });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<AdminPresetsPage />);

    await screen.findByDisplayValue("Custom override description");
    const checkbox = screen.getByLabelText("Use code default") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));

    await waitFor(() => {
      expect(checkbox.checked).toBe(true);
    });
    const description = screen.getByDisplayValue("Code default description") as HTMLTextAreaElement;
    const guidance = screen.getByDisplayValue("Code default guidance") as HTMLTextAreaElement;
    expect(description.readOnly).toBe(true);
    expect(guidance.readOnly).toBe(true);
  });

  it("renders the tools section as selection guide with no catalog-block variable chip", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/admin/prompt-templates")) {
        return jsonResponse({
          presets: [
            {
              id: "tools",
              template: "<tool_usage_policy>\nUse only the declared tools.\n</tool_usage_policy>",
              updatedAt: "2026-01-01T00:00:00.000Z"
            }
          ]
        });
      }
      if (url.endsWith("/api/v1/admin/tools/metadata")) {
        return jsonResponse({ tools: [] });
      }
      if (url.endsWith("/api/v1/admin/persona-archetypes")) {
        return jsonResponse({ archetypes: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<AdminPresetsPage />);

    await screen.findByText("Native Tool Runtime — Selection Guide");
    expect(
      screen.getByText(
        "Cross-tool selection guide in the cached system prefix. Edit here to control which tool the model calls and when. Per-tool mechanical contract (description, usage guidance) lives in Per-Tool Model Instructions below."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("tools_catalog_block")).not.toBeInTheDocument();
  });

  it("renders voice summary sample variables inside onboarding compiled preview", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/admin/prompt-templates")) {
        return jsonResponse({
          presets: [
            {
              id: "preview_bootstrap",
              template: "Preview says: {{voice_summary_line}}",
              updatedAt: "2026-01-01T00:00:00.000Z"
            },
            {
              id: "welcome_bootstrap",
              template: "Welcome says: {{voice_summary_line}}",
              updatedAt: "2026-01-01T00:00:00.000Z"
            }
          ]
        });
      }
      if (url.endsWith("/api/v1/admin/tools/metadata")) {
        return jsonResponse({ tools: [] });
      }
      if (url.endsWith("/api/v1/admin/persona-archetypes")) {
        return jsonResponse({ archetypes: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<AdminPresetsPage />);

    await screen.findByText("Compiled Preview");
    fireEvent.click(screen.getByRole("button", { name: "Preview character test" }));
    await screen.findByText(
      "Preview says: Your voice is **Magnetic Strategist** — warm, concise, confident, and slightly playful."
    );
    fireEvent.click(screen.getByRole("button", { name: "Welcome first chat" }));
    await screen.findByText(
      "Welcome says: Your voice is **Magnetic Strategist** — warm, concise, confident, and slightly playful."
    );
  });

  it("advertises only the live system assembly blocks in the system palette", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/admin/prompt-templates")) {
        return jsonResponse({
          presets: [
            {
              id: "system",
              template:
                "{{soul_block}}\n\n{{reminders_protocol_block}}\n\n{{response_contract_block}}",
              updatedAt: "2026-01-01T00:00:00.000Z"
            }
          ]
        });
      }
      if (url.endsWith("/api/v1/admin/tools/metadata")) {
        return jsonResponse({ tools: [] });
      }
      if (url.endsWith("/api/v1/admin/persona-archetypes")) {
        return jsonResponse({ archetypes: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<AdminPresetsPage />);

    await screen.findByRole("heading", { name: "System Prompt Assembly", level: 2 });
    expect(screen.getByRole("button", { name: "soul_block" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "user_block" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "identity_block" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "enabled_skills_block" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "reminders_protocol_block" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "memory_protocol_block" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "response_contract_block" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "tools_block" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "agents_block" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "assistant_identity_block" })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "user_identity_block" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "locale_block" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "timezone_block" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "persona_instructions_block" })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "heartbeat_block" })).not.toBeInTheDocument();
  });

  it("leaves the ordinary preview empty when the API does not return a system template", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/admin/prompt-templates")) {
        return jsonResponse({
          presets: [
            {
              id: "reminders_protocol",
              template: "API reminders protocol section",
              updatedAt: "2026-01-01T00:00:00.000Z"
            },
            {
              id: "response_contract",
              template: "API response contract section",
              updatedAt: "2026-01-01T00:00:00.000Z"
            }
          ]
        });
      }
      if (url.endsWith("/api/v1/admin/tools/metadata")) {
        return jsonResponse({ tools: [] });
      }
      if (url.endsWith("/api/v1/admin/persona-archetypes")) {
        return jsonResponse({ archetypes: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<AdminPresetsPage />);

    await screen.findByText("Compiled Preview");
    const preview = screen.getByText((_, element) => element?.tagName === "PRE");
    expect(preview).toBeEmptyDOMElement();
  });
});
