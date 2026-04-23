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
});
