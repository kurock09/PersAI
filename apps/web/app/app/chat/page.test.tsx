import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ChatPage from "./page";

const navigationMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: new URLSearchParams()
}));

const chatHookMocks = vi.hoisted(() => ({
  sendWelcome: vi.fn(),
  loadHistory: vi.fn(),
  isStreaming: false,
  chatId: null
}));

const appDataMocks = vi.hoisted(() => ({
  isLoading: false,
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
  useChat: () => chatHookMocks
}));

vi.mock("../_components/app-shell", () => ({
  useAppDataContext: () => appDataMocks
}));

vi.mock("../_components/chat-area", () => ({
  ChatArea: () => <div>chat-area</div>
}));

describe("ChatPage", () => {
  it("does not auto-create a welcome chat just because the chat list is empty", async () => {
    navigationMocks.searchParams = new URLSearchParams();
    chatHookMocks.sendWelcome.mockReset();
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
});
