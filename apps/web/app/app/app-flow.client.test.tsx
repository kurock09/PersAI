import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantLifecycleState } from "@persai/contracts";
import { AppFlowClient } from "./app-flow.client";
import { CurrentMeResponse } from "./me-api-client";

const clerkMocks = vi.hoisted(() => {
  return {
    getToken: vi.fn()
  };
});

const apiMocks = vi.hoisted(() => {
  return {
    getMe: vi.fn(),
    postOnboarding: vi.fn()
  };
});

const assistantApiMocks = vi.hoisted(() => {
  return {
    getAssistant: vi.fn(),
    postAssistantCreate: vi.fn()
  };
});

vi.mock("@clerk/nextjs", () => {
  return {
    useAuth: () => ({
      getToken: clerkMocks.getToken
    }),
    UserButton: () => <div data-testid="user-button" />,
    SignOutButton: ({ children }: { children: ReactNode }) => <>{children}</>
  };
});

vi.mock("./me-api-client", async () => {
  const actual = await vi.importActual<typeof import("./me-api-client")>("./me-api-client");

  return {
    ...actual,
    getMe: apiMocks.getMe,
    postOnboarding: apiMocks.postOnboarding
  };
});

vi.mock("./assistant-api-client", async () => {
  const actual = await vi.importActual<typeof import("./assistant-api-client")>(
    "./assistant-api-client"
  );

  return {
    ...actual,
    getAssistant: assistantApiMocks.getAssistant,
    postAssistantCreate: assistantApiMocks.postAssistantCreate
  };
});

function makeMeResponse(status: "pending" | "completed"): CurrentMeResponse {
  return {
    requestId: "req-1",
    me: {
      appUser: {
        id: "user-1",
        clerkUserId: "clerk-user-1",
        email: "user1@example.com",
        displayName: "User One"
      },
      onboarding: {
        isComplete: status === "completed",
        status
      },
      workspace:
        status === "completed"
          ? {
              id: "ws-1",
              name: "Workspace A",
              locale: "en-US",
              timezone: "UTC",
              status: "active",
              role: "owner"
            }
          : null
    }
  };
}

function makeAssistantResponse(): AssistantLifecycleState {
  return {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "ws-1",
    draft: {
      displayName: "Operator Assistant",
      instructions: "Use short, useful answers.",
      updatedAt: "2026-03-23T10:00:00.000Z"
    },
    latestPublishedVersion: {
      id: "pub-2",
      version: 2,
      publishedByUserId: "user-1",
      publishedAt: "2026-03-23T10:05:00.000Z",
      snapshot: {
        displayName: "Operator Assistant",
        instructions: "Use short, useful answers."
      }
    },
    runtimeApply: {
      status: "succeeded",
      targetPublishedVersionId: "pub-2",
      appliedPublishedVersionId: "pub-2",
      requestedAt: "2026-03-23T10:05:01.000Z",
      startedAt: "2026-03-23T10:05:02.000Z",
      finishedAt: "2026-03-23T10:05:03.000Z",
      error: null
    },
    governance: {
      capabilityEnvelope: null,
      secretRefs: null,
      policyEnvelope: null,
      quotaPlanCode: null,
      quotaHook: null,
      auditHook: null,
      platformManagedUpdatedAt: null
    },
    materialization: {
      latestSpecId: "spec-2",
      publishedVersionId: "pub-2",
      sourceAction: "publish",
      algorithmVersion: 1,
      contentHash: "hash-2",
      generatedAt: "2026-03-23T10:05:01.000Z",
      openclawBootstrapDocument: "{}",
      openclawWorkspaceDocument: "{}"
    },
    createdAt: "2026-03-23T10:00:00.000Z",
    updatedAt: "2026-03-23T10:05:03.000Z"
  };
}

describe("AppFlowClient onboarding gate", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clerkMocks.getToken.mockResolvedValue("token-user-1");
    assistantApiMocks.postAssistantCreate.mockReset();
  });

  it("shows onboarding gate when /me returns pending", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("pending"));

    render(<AppFlowClient />);

    expect(await screen.findByText("Onboarding required")).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toBeInTheDocument();
    expect(screen.queryByText("Me")).not.toBeInTheDocument();
  });

  it("shows assistant dashboard when /me returns completed", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponse());

    render(<AppFlowClient />);

    expect(await screen.findByText("Assistant dashboard")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Global publish and status bar")).toBeInTheDocument();
    });
    expect(screen.getByText("Assistant editor")).toBeInTheDocument();
    expect(screen.getAllByText("Persona").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Memory").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tools & Integrations").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Channels").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Limits & Safety Summary").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Publish History").length).toBeGreaterThan(0);
    expect(screen.getByText("Assistant summary")).toBeInTheDocument();
    expect(screen.getAllByText("v2").length).toBeGreaterThan(0);
    expect(screen.getByText("succeeded")).toBeInTheDocument();
    expect(screen.getByTestId("user-button")).toBeInTheDocument();
  });

  it("shows create assistant control when assistant is absent", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(null);

    render(<AppFlowClient />);

    expect(await screen.findByText("Assistant entity:")).toBeInTheDocument();
    expect(screen.getByText("not created")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create assistant" })).toBeInTheDocument();
    expect(screen.queryByText("Assistant editor")).not.toBeInTheDocument();
  });
});
