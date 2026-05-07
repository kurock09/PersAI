import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppData } from "./use-app-data";

const clerkMocks = vi.hoisted(() => ({
  getToken: vi.fn()
}));

const apiMocks = vi.hoisted(() => ({
  getAssistant: vi.fn(),
  getAssistantWebChats: vi.fn(),
  getAssistantTelegramIntegration: vi.fn(),
  getAssistantNotificationPreference: vi.fn(),
  getAssistantPlanVisibility: vi.fn(),
  getAdminPlanVisibility: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: clerkMocks.getToken
  })
}));

vi.mock("../assistant-api-client", () => ({
  getAssistant: apiMocks.getAssistant,
  getAssistantWebChats: apiMocks.getAssistantWebChats,
  getAssistantTelegramIntegration: apiMocks.getAssistantTelegramIntegration,
  getAssistantNotificationPreference: apiMocks.getAssistantNotificationPreference,
  getAssistantPlanVisibility: apiMocks.getAssistantPlanVisibility,
  getAdminPlanVisibility: apiMocks.getAdminPlanVisibility
}));

describe("useAppData", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clerkMocks.getToken.mockResolvedValue("token-1");
    apiMocks.getAssistantWebChats.mockResolvedValue([]);
    apiMocks.getAssistantTelegramIntegration.mockResolvedValue(null);
    apiMocks.getAssistantNotificationPreference.mockResolvedValue(null);
    apiMocks.getAssistantPlanVisibility.mockResolvedValue(null);
    apiMocks.getAdminPlanVisibility.mockRejectedValue(new Error("not admin"));
  });

  it("does not resolve assistant as missing when the assistant request fails", async () => {
    apiMocks.getAssistant.mockRejectedValue(new Error("Network unavailable"));

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
    apiMocks.getAssistant.mockResolvedValue(null);
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
});
