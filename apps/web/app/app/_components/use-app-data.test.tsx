import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppData } from "./use-app-data";

const clerkMocks = vi.hoisted(() => ({
  getToken: vi.fn()
}));

const apiMocks = vi.hoisted(() => ({
  getAssistantLifecycleView: vi.fn(),
  getAssistantWebChats: vi.fn(),
  getAssistantTelegramIntegration: vi.fn(),
  getAssistantNotificationPreference: vi.fn(),
  getAssistantPlanVisibility: vi.fn(),
  getAssistantBillingSubscription: vi.fn(),
  getAdminPlanVisibility: vi.fn(),
  postAssistantCreateLifecycleView: vi.fn(),
  postAssistantSwitch: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: clerkMocks.getToken
  })
}));

vi.mock("../assistant-api-client", () => ({
  getAssistantLifecycleView: apiMocks.getAssistantLifecycleView,
  getAssistantWebChats: apiMocks.getAssistantWebChats,
  getAssistantTelegramIntegration: apiMocks.getAssistantTelegramIntegration,
  getAssistantNotificationPreference: apiMocks.getAssistantNotificationPreference,
  getAssistantPlanVisibility: apiMocks.getAssistantPlanVisibility,
  getAssistantBillingSubscription: apiMocks.getAssistantBillingSubscription,
  getAdminPlanVisibility: apiMocks.getAdminPlanVisibility,
  postAssistantCreateLifecycleView: apiMocks.postAssistantCreateLifecycleView,
  postAssistantSwitch: apiMocks.postAssistantSwitch
}));

describe("useAppData", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clerkMocks.getToken.mockResolvedValue("token-1");
    apiMocks.getAssistantLifecycleView.mockResolvedValue({
      assistant: null,
      assistants: [],
      activeAssistantId: null,
      assistantLimit: { usedAssistants: 0, maxAssistants: 1 }
    });
    apiMocks.getAssistantWebChats.mockResolvedValue([]);
    apiMocks.getAssistantTelegramIntegration.mockResolvedValue(null);
    apiMocks.getAssistantNotificationPreference.mockResolvedValue(null);
    apiMocks.getAssistantPlanVisibility.mockResolvedValue(null);
    apiMocks.getAssistantBillingSubscription.mockResolvedValue(null);
    apiMocks.getAdminPlanVisibility.mockRejectedValue(new Error("not admin"));
    apiMocks.postAssistantCreateLifecycleView.mockResolvedValue({
      assistant: {
        id: "assistant-2",
        latestPublishedVersion: null,
        runtimeApply: { status: "not_requested" }
      },
      assistants: [
        {
          id: "assistant-1",
          displayName: "Alpha",
          avatarEmoji: null,
          avatarUrl: null,
          createdAt: "2026-05-26T14:00:00.000Z",
          updatedAt: "2026-05-26T14:00:00.000Z"
        },
        {
          id: "assistant-2",
          displayName: "Beta",
          avatarEmoji: null,
          avatarUrl: null,
          createdAt: "2026-05-26T15:00:00.000Z",
          updatedAt: "2026-05-26T15:00:00.000Z"
        }
      ],
      activeAssistantId: "assistant-2",
      assistantLimit: { usedAssistants: 2, maxAssistants: 3 }
    });
    apiMocks.postAssistantSwitch.mockResolvedValue({
      assistant: {
        id: "assistant-2",
        latestPublishedVersion: null,
        runtimeApply: { status: "not_requested" }
      },
      assistants: [
        {
          id: "assistant-1",
          displayName: "Alpha",
          avatarEmoji: null,
          avatarUrl: null,
          createdAt: "2026-05-26T14:00:00.000Z",
          updatedAt: "2026-05-26T14:00:00.000Z"
        },
        {
          id: "assistant-2",
          displayName: "Beta",
          avatarEmoji: null,
          avatarUrl: null,
          createdAt: "2026-05-26T15:00:00.000Z",
          updatedAt: "2026-05-26T15:00:00.000Z"
        }
      ],
      activeAssistantId: "assistant-2",
      assistantLimit: { usedAssistants: 2, maxAssistants: 3 }
    });
  });

  it("does not resolve assistant as missing when the assistant request fails", async () => {
    apiMocks.getAssistantLifecycleView.mockRejectedValue(new Error("Network unavailable"));

    const { result } = renderHook(() => useAppData(null));

    await waitFor(() => {
      expect(result.current.error).toBe("Network unavailable");
    });
    expect(result.current.assistant).toBeNull();
    expect(result.current.assistantResolved).toBe(false);
    expect(result.current.assistantStatus).toBe("none");
    expect(result.current.isLoading).toBe(false);
  });

  it("optimistically bumps the matching chat row activity without reloading the page", async () => {
    apiMocks.getAssistantLifecycleView.mockResolvedValue({
      assistant: null,
      assistants: [],
      activeAssistantId: null,
      assistantLimit: { usedAssistants: 0, maxAssistants: 1 }
    });
    apiMocks.getAssistantWebChats.mockResolvedValue([
      {
        chat: {
          id: "chat-1",
          surfaceThreadKey: "thread-1",
          title: "Chat",
          lastMessageAt: "2026-04-25T12:00:00.000Z",
          createdAt: "2026-04-25T11:00:00.000Z",
          archivedAt: null,
          deepModeEnabled: false
        },
        lastMessagePreview: null
      }
    ]);

    const { result } = renderHook(() => useAppData(null));

    await waitFor(() => {
      expect(result.current.chats).toHaveLength(1);
    });

    act(() => {
      result.current.markChatListActivity("thread-1");
    });

    expect(result.current.chats[0]?.chat.lastMessageAt).not.toBe("2026-04-25T12:00:00.000Z");
    expect(result.current.chats[0]?.chat.surfaceThreadKey).toBe("thread-1");
  });

  it("switches assistants and refreshes assistant-scoped slices", async () => {
    apiMocks.getAssistantWebChats.mockResolvedValue([
      {
        chat: {
          id: "chat-1",
          surfaceThreadKey: "thread-1",
          title: "Alpha chat",
          lastMessageAt: "2026-04-25T12:00:00.000Z",
          createdAt: "2026-04-25T11:00:00.000Z",
          archivedAt: null,
          deepModeEnabled: false
        },
        lastMessagePreview: null
      }
    ]);
    apiMocks.getAssistantTelegramIntegration.mockResolvedValue({
      connectionStatus: "not_connected"
    });
    apiMocks.getAssistantNotificationPreference.mockResolvedValue({
      selectedChannel: "web",
      availableChannels: ["web"]
    });
    apiMocks.getAssistantPlanVisibility.mockResolvedValue({
      planId: "plan-alpha",
      displayName: "Alpha Plan"
    });

    const { result } = renderHook(() => useAppData(null));

    await waitFor(() => {
      expect(result.current.chats[0]?.chat.surfaceThreadKey).toBe("thread-1");
    });

    apiMocks.getAssistantWebChats.mockResolvedValue([
      {
        chat: {
          id: "chat-2",
          surfaceThreadKey: "thread-2",
          title: "Beta chat",
          lastMessageAt: "2026-04-25T13:00:00.000Z",
          createdAt: "2026-04-25T12:00:00.000Z",
          archivedAt: null,
          deepModeEnabled: false
        },
        lastMessagePreview: null
      }
    ]);

    await waitFor(() => {
      expect(apiMocks.getAssistantPlanVisibility).toHaveBeenCalled();
    });
    const planCallsBeforeSwitch = apiMocks.getAssistantPlanVisibility.mock.calls.length;

    apiMocks.getAssistantPlanVisibility.mockResolvedValue({
      planId: "plan-beta",
      displayName: "Beta Plan"
    });

    await act(async () => {
      await result.current.switchAssistant("assistant-2");
    });

    await waitFor(() => {
      expect(result.current.activeAssistantId).toBe("assistant-2");
    });
    expect(apiMocks.postAssistantSwitch).toHaveBeenCalledWith("token-1", "assistant-2");
    expect(result.current.assistant?.id).toBe("assistant-2");
    expect(result.current.chats[0]?.chat.surfaceThreadKey).toBe("thread-2");
    expect(apiMocks.getAssistantPlanVisibility.mock.calls.length).toBeGreaterThan(
      planCallsBeforeSwitch
    );
    expect(result.current.plan).toEqual({ planId: "plan-beta", displayName: "Beta Plan" });
  });
});
