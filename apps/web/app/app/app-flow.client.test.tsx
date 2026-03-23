import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    getAssistantMemoryItems: vi.fn(),
    getAssistantWebChats: vi.fn(),
    postAssistantCreate: vi.fn(),
    patchAssistantDraft: vi.fn(),
    patchAssistantWebChat: vi.fn(),
    postAssistantPublish: vi.fn(),
    postAssistantRollback: vi.fn(),
    postAssistantReset: vi.fn(),
    postAssistantWebChatArchive: vi.fn(),
    deleteAssistantWebChat: vi.fn(),
    postAssistantMemoryItemForget: vi.fn(),
    postAssistantMemoryDoNotRemember: vi.fn(),
    streamAssistantWebChatTurn: vi.fn()
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
    getAssistantMemoryItems: assistantApiMocks.getAssistantMemoryItems,
    getAssistantWebChats: assistantApiMocks.getAssistantWebChats,
    postAssistantCreate: assistantApiMocks.postAssistantCreate,
    patchAssistantDraft: assistantApiMocks.patchAssistantDraft,
    patchAssistantWebChat: assistantApiMocks.patchAssistantWebChat,
    postAssistantPublish: assistantApiMocks.postAssistantPublish,
    postAssistantRollback: assistantApiMocks.postAssistantRollback,
    postAssistantReset: assistantApiMocks.postAssistantReset,
    postAssistantWebChatArchive: assistantApiMocks.postAssistantWebChatArchive,
    deleteAssistantWebChat: assistantApiMocks.deleteAssistantWebChat,
    postAssistantMemoryItemForget: assistantApiMocks.postAssistantMemoryItemForget,
    postAssistantMemoryDoNotRemember: assistantApiMocks.postAssistantMemoryDoNotRemember,
    streamAssistantWebChatTurn: assistantApiMocks.streamAssistantWebChatTurn
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
      memoryControl: null,
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

function makeAssistantResponseWithDraft(
  draftDisplayName: string | null,
  draftInstructions: string | null
): AssistantLifecycleState {
  const state = makeAssistantResponse();
  return {
    ...state,
    draft: {
      ...state.draft,
      displayName: draftDisplayName,
      instructions: draftInstructions
    }
  };
}

function makeAssistantResponseWithApplyStatus(
  status: AssistantLifecycleState["runtimeApply"]["status"]
): AssistantLifecycleState {
  const state = makeAssistantResponse();
  return {
    ...state,
    runtimeApply: {
      ...state.runtimeApply,
      status
    }
  };
}

function makeAssistantResponseWithoutVisibleUpdates(): AssistantLifecycleState {
  const state = makeAssistantResponse();
  return {
    ...state,
    draft: {
      displayName: null,
      instructions: null,
      updatedAt: null
    },
    latestPublishedVersion: null,
    runtimeApply: {
      ...state.runtimeApply,
      status: "not_requested",
      finishedAt: null,
      error: null
    },
    governance: {
      ...state.governance,
      platformManagedUpdatedAt: null
    },
    materialization: {
      ...state.materialization,
      sourceAction: null
    }
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
    assistantApiMocks.getAssistantWebChats.mockReset();
    assistantApiMocks.patchAssistantDraft.mockReset();
    assistantApiMocks.patchAssistantWebChat.mockReset();
    assistantApiMocks.postAssistantPublish.mockReset();
    assistantApiMocks.postAssistantRollback.mockReset();
    assistantApiMocks.postAssistantReset.mockReset();
    assistantApiMocks.postAssistantWebChatArchive.mockReset();
    assistantApiMocks.deleteAssistantWebChat.mockReset();
    assistantApiMocks.streamAssistantWebChatTurn.mockReset();
    assistantApiMocks.getAssistantMemoryItems.mockReset();
    assistantApiMocks.postAssistantMemoryItemForget.mockReset();
    assistantApiMocks.postAssistantMemoryDoNotRemember.mockReset();
    assistantApiMocks.getAssistantWebChats.mockResolvedValue([]);
    assistantApiMocks.getAssistantMemoryItems.mockResolvedValue([]);
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
    expect(screen.getByText("Publish state:")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText("Apply state:")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText("Rollback available:")).toBeInTheDocument();
    expect(screen.getByText("yes")).toBeInTheDocument();
    expect(screen.getByText("Assistant setup paths")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Quick start", level: 3 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quick start path" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Advanced setup path" })).toBeInTheDocument();
    expect(screen.getByText("Lifecycle safety controls")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rollback to selected version" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset assistant" })).toBeInTheDocument();
    expect(screen.getByText("Assistant activity and updates")).toBeInTheDocument();
    expect(screen.getByText("Update:")).toBeInTheDocument();
    expect(screen.getByText("Assistant is live after the latest apply.")).toBeInTheDocument();
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

  it("applies quick start path to assistant draft without publishing", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponse());
    assistantApiMocks.patchAssistantDraft.mockResolvedValue(
      makeAssistantResponseWithDraft("Field Ops Copilot", "Act as a personal assistant for the current user.")
    );

    render(<AppFlowClient />);

    expect(await screen.findByText("Assistant setup paths")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Assistant display name"), {
      target: { value: "Field Ops Copilot" }
    });
    fireEvent.change(screen.getByLabelText("Primary goal"), {
      target: { value: "Keep me focused on priority tasks" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply quick start to draft" }));

    await waitFor(() => {
      expect(assistantApiMocks.patchAssistantDraft).toHaveBeenCalledTimes(1);
    });
    expect(assistantApiMocks.patchAssistantDraft).toHaveBeenCalledWith(
      "token-user-1",
      expect.objectContaining({
        instructions: expect.stringContaining("Primary goal: Keep me focused on priority tasks.")
      })
    );
    expect(screen.getByText("Draft setup saved. No publish has been performed.")).toBeInTheDocument();
  });

  it("applies advanced setup path to draft and auto-creates assistant when absent", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(null);
    assistantApiMocks.postAssistantCreate.mockResolvedValue(makeAssistantResponse());
    assistantApiMocks.patchAssistantDraft.mockResolvedValue(
      makeAssistantResponseWithDraft("Analyst Assistant", "Follow explicit daily planning instructions.")
    );

    render(<AppFlowClient />);

    expect(await screen.findByText("Assistant setup paths")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Advanced setup path" }));
    fireEvent.change(screen.getByLabelText("Assistant display name"), {
      target: { value: "Analyst Assistant" }
    });
    fireEvent.change(screen.getByLabelText("Draft instructions"), {
      target: { value: "Follow explicit daily planning instructions." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply advanced setup to draft" }));

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantCreate).toHaveBeenCalledTimes(1);
      expect(assistantApiMocks.patchAssistantDraft).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("Draft setup saved. No publish has been performed.")).toBeInTheDocument();
  });

  it("publishes draft and keeps apply state separate", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponseWithApplyStatus("failed"));
    assistantApiMocks.postAssistantPublish.mockResolvedValue(
      makeAssistantResponseWithApplyStatus("pending")
    );

    render(<AppFlowClient />);

    expect(await screen.findByText("Publish draft")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Publish draft" }));

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantPublish).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("Publish requested. Apply state is tracked separately.")).toBeInTheDocument();
    expect(screen.getByText("Applying")).toBeInTheDocument();
  });

  it("shows recovery-worthy update marker when apply fails", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponseWithApplyStatus("failed"));

    render(<AppFlowClient />);

    expect(await screen.findByText("Assistant activity and updates")).toBeInTheDocument();
    expect(screen.getByText("Attention:")).toBeInTheDocument();
    expect(
      screen.getByText("Latest apply needs attention. Consider rollback if a previous version was stable.")
    ).toBeInTheDocument();
  });

  it("shows no visible marker message when no meaningful update exists", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponseWithoutVisibleUpdates());

    render(<AppFlowClient />);

    expect(await screen.findByText("Assistant activity and updates")).toBeInTheDocument();
    expect(screen.getByText("No visible assistant updates right now.")).toBeInTheDocument();
  });

  it("rolls back to selected published version", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponse());
    assistantApiMocks.postAssistantRollback.mockResolvedValue(makeAssistantResponseWithApplyStatus("pending"));

    render(<AppFlowClient />);

    expect(await screen.findByText("Lifecycle safety controls")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Target version"), {
      target: { value: "1" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Rollback to selected version" }));

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantRollback).toHaveBeenCalledTimes(1);
    });
    expect(assistantApiMocks.postAssistantRollback).toHaveBeenCalledWith("token-user-1", {
      targetVersion: 1
    });
    expect(
      screen.getByText("Rollback requested. A new published version was created from the selected target.")
    ).toBeInTheDocument();
  });

  it("requires explicit confirmation before reset", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponse());

    render(<AppFlowClient />);

    expect(await screen.findByText("Lifecycle safety controls")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset assistant" }));
    expect(await screen.findByText(/Confirm reset by checking the box and typing RESET/)).toBeInTheDocument();
    expect(assistantApiMocks.postAssistantReset).not.toHaveBeenCalled();
  });

  it("resets assistant after explicit confirmation", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponse());
    assistantApiMocks.postAssistantReset.mockResolvedValue(
      makeAssistantResponseWithDraft(null, null)
    );

    render(<AppFlowClient />);

    expect(await screen.findByText("Lifecycle safety controls")).toBeInTheDocument();
    fireEvent.click(
      screen.getByLabelText(
        "I understand reset changes assistant content and cannot be undone from this screen."
      )
    );
    fireEvent.change(screen.getByLabelText("Type RESET to confirm"), {
      target: { value: "RESET" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset assistant" }));

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantReset).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText(/Reset requested\./)).toBeInTheDocument();
  });
});
