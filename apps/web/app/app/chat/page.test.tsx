import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatPage from "./page";

const navigationMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: new URLSearchParams()
}));

const chatHookMocks = vi.hoisted(() => ({
  sendWelcome: vi.fn(),
  loadHistory: vi.fn(),
  markHistoryEmpty: vi.fn(),
  isStreaming: false,
  chatId: null as string | null,
  threadKeys: [] as string[]
}));

const appDataMocks = vi.hoisted(() => ({
  isLoading: false,
  isReloading: false,
  isReloadingChats: false,
  assistantStatus: "live" as const,
  chats: [] as Array<{
    chat: { id: string; surfaceThreadKey: string; title: string | null; deepModeEnabled: boolean };
  }>,
  assistant: null,
  reloadChats: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: navigationMocks.replace
  }),
  useSearchParams: () => navigationMocks.searchParams
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en"
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    userId: "user-1"
  })
}));

vi.mock("../_components/use-chat", () => ({
  useChat: (threadKey: string) => {
    chatHookMocks.threadKeys.push(threadKey);
    return chatHookMocks;
  }
}));

vi.mock("../_components/app-shell", () => ({
  useAppDataContext: () => appDataMocks
}));

vi.mock("../_components/chat-area", () => ({
  ChatArea: () => <div>chat-area</div>
}));

describe("ChatPage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    chatHookMocks.chatId = null;
    chatHookMocks.isStreaming = false;
    chatHookMocks.threadKeys = [];
  });

  it("does not auto-create a welcome chat just because the chat list is empty", async () => {
    navigationMocks.searchParams = new URLSearchParams();
    chatHookMocks.sendWelcome.mockReset();
    chatHookMocks.markHistoryEmpty.mockReset();
    navigationMocks.replace.mockReset();
    appDataMocks.chats = [];
    appDataMocks.reloadChats.mockReset();

    render(<ChatPage />);

    await waitFor(() => {
      expect(chatHookMocks.sendWelcome).not.toHaveBeenCalled();
    });
    expect(navigationMocks.replace).not.toHaveBeenCalled();
  });

  it("creates the welcome chat only when explicitly requested by setup", async () => {
    navigationMocks.searchParams = new URLSearchParams("thread=welcome&welcome=1");
    chatHookMocks.sendWelcome.mockReset();
    chatHookMocks.sendWelcome.mockResolvedValue(undefined);
    chatHookMocks.markHistoryEmpty.mockReset();
    navigationMocks.replace.mockReset();
    appDataMocks.chats = [];
    appDataMocks.reloadChats.mockReset();

    render(<ChatPage />);

    await waitFor(() => {
      expect(chatHookMocks.sendWelcome).toHaveBeenCalledWith("en");
    });
    await waitFor(() => {
      expect(appDataMocks.reloadChats).toHaveBeenCalled();
    });
    expect(navigationMocks.replace).toHaveBeenCalledWith("/app/chat?thread=welcome");
  });

  it("validates an existing chat even when the hook already has the same chat id", async () => {
    navigationMocks.searchParams = new URLSearchParams("thread=thread-1");
    chatHookMocks.loadHistory.mockReset();
    chatHookMocks.markHistoryEmpty.mockReset();
    chatHookMocks.chatId = "chat-1";
    chatHookMocks.isStreaming = false;
    appDataMocks.chats = [
      {
        chat: {
          id: "chat-1",
          surfaceThreadKey: "thread-1",
          title: "Chat",
          deepModeEnabled: false
        }
      }
    ];

    render(<ChatPage />);

    await waitFor(() => {
      expect(chatHookMocks.loadHistory).toHaveBeenCalledWith("chat-1");
    });
    expect(chatHookMocks.markHistoryEmpty).not.toHaveBeenCalled();
  });

  it("keeps the same draft thread key across bare chat remounts", async () => {
    navigationMocks.searchParams = new URLSearchParams();
    chatHookMocks.markHistoryEmpty.mockReset();
    appDataMocks.chats = [];

    const first = render(<ChatPage />);
    await waitFor(() => {
      expect(chatHookMocks.markHistoryEmpty).toHaveBeenCalled();
    });
    const firstThreadKey = chatHookMocks.threadKeys.at(-1);
    expect(firstThreadKey).toMatch(/^web-/);

    first.unmount();
    chatHookMocks.markHistoryEmpty.mockReset();
    render(<ChatPage />);

    await waitFor(() => {
      expect(chatHookMocks.markHistoryEmpty).toHaveBeenCalled();
    });
    expect(chatHookMocks.threadKeys.at(-1)).toBe(firstThreadKey);
  });

  it("clears the draft thread key after the server chat is created and mirrored into the URL", async () => {
    navigationMocks.searchParams = new URLSearchParams();
    navigationMocks.replace.mockReset();
    appDataMocks.reloadChats.mockReset();
    appDataMocks.chats = [];
    chatHookMocks.chatId = "chat-1";

    render(<ChatPage />);

    await waitFor(() => {
      expect(navigationMocks.replace).toHaveBeenCalled();
    });
    expect(window.sessionStorage.getItem("persai.draft-chat-thread.v1")).toBeNull();
  });
});
