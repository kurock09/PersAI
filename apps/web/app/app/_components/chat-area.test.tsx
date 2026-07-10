import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ChatArea } from "./chat-area";
import type { ChatMessage, UseChatReturn } from "./use-chat";
import { patchAssistantWebChat } from "../assistant-api-client";
import * as projectFilesEvents from "./project-files-events";

const chatMessageBubbleMock = vi.hoisted(() => vi.fn());
const getTokenMock = vi.hoisted(() => vi.fn(async (): Promise<string | null> => null));
const openSidebarMock = vi.hoisted(() => vi.fn());
const openSettingsMock = vi.hoisted(() => vi.fn());
const openAssistantBrowserProfileViewMock = vi.hoisted(() => vi.fn());
const dismissAssistantBrowserProfileViewMock = vi.hoisted(() => vi.fn());
const getCurrentLocalBrowserBridgeStatusMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: getTokenMock
  })
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key
}));

vi.mock("./app-shell", () => ({
  useShellActions: () => ({
    openSidebar: openSidebarMock,
    openSettings: openSettingsMock
  })
}));

vi.mock("./chat-message", () => ({
  ChatMessageBubble: (props: {
    message: ChatMessage;
    preResponseStatus?: { kind: "thinking" | "activity"; event?: { label: string } };
    onAssistantAction?: (text: string) => void;
    onDoNotRemember?: (messageId: string) => void;
  }) => {
    chatMessageBubbleMock(props);
    return <div>{props.message.content}</div>;
  }
}));

vi.mock("./chat-input", () => ({
  ChatInput: () => <div data-testid="chat-input" />
}));

vi.mock("./assistant-avatar", () => ({
  AssistantAvatar: () => <div data-testid="assistant-avatar" />
}));

vi.mock("../assistant-api-client", () => ({
  dismissAssistantBrowserProfileView: dismissAssistantBrowserProfileViewMock,
  openAssistantBrowserProfileView: openAssistantBrowserProfileViewMock,
  patchAssistantWebChat: vi.fn(async () => undefined),
  postAssistantMemoryDoNotRemember: vi.fn(async () => undefined),
  transcribeVoice: vi.fn(async () => "")
}));

vi.mock("../browser-bridge-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../browser-bridge-client")>()),
  getCurrentLocalBrowserBridgeStatus: getCurrentLocalBrowserBridgeStatusMock
}));

let intersectionObserverCallback: ((entries: Array<{ isIntersecting: boolean }>) => void) | null =
  null;

beforeAll(() => {
  class MockIntersectionObserver {
    constructor(
      callback: (entries: IntersectionObserverEntry[], observer: IntersectionObserver) => void
    ) {
      intersectionObserverCallback = (entries) =>
        callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
    }

    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
    root = null;
    rootMargin = "";
    thresholds = [];
  }

  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  cleanup();
  intersectionObserverCallback = null;
  chatMessageBubbleMock.mockClear();
  getTokenMock.mockClear();
  openAssistantBrowserProfileViewMock.mockReset();
  dismissAssistantBrowserProfileViewMock.mockReset();
  getCurrentLocalBrowserBridgeStatusMock.mockReset();
  openSidebarMock.mockClear();
  sessionStorage.clear();
  projectFilesEvents.resetProjectFilesHintStateForTests();
  vi.restoreAllMocks();
});

function createChat(
  messageContent: string | string[],
  options?: {
    chatId?: string;
    isStreaming?: boolean;
    hasOlderMessages?: boolean;
    olderMessagesLoading?: boolean;
    loadOlderMessages?: UseChatReturn["loadOlderMessages"];
    issue?: UseChatReturn["issue"];
    messages?: ChatMessage[];
    currentEngagement?: UseChatReturn["currentEngagement"];
  }
): UseChatReturn {
  const contents = Array.isArray(messageContent) ? messageContent : [messageContent];
  const isStreaming = options?.isStreaming ?? true;
  const messages: ChatMessage[] =
    options?.messages ??
    contents.map((content, index) => ({
      id: `assistant-${index + 1}`,
      role: "assistant",
      content,
      status: isStreaming && index === contents.length - 1 ? "streaming" : ("committed" as const)
    }));

  return {
    entries: messages.map((message) => ({ kind: "message", message })),
    messages,
    chatId: options?.chatId ?? "chat-1",
    activeMediaJobs: [],
    activeDocumentJobs: [],
    currentEngagement: options?.currentEngagement ?? null,
    pendingBrowserLogin: null,
    browserLoginModalOpen: false,
    dismissBrowserLogin: vi.fn(),
    abortBrowserLogin: vi.fn().mockResolvedValue(undefined),
    reopenBrowserLogin: vi.fn(),
    clearPendingBrowserLogin: vi.fn(),
    isStreaming,
    historyLoading: false,
    hasOlderMessages: options?.hasOlderMessages ?? false,
    olderMessagesLoading: options?.olderMessagesLoading ?? false,
    issue: options?.issue ?? null,
    compaction: null,
    recentAutoCompaction: null,
    compactionRunning: false,
    chatPlan: [],
    chatPlanTotalCount: 0,
    chatPlanWindowed: false,
    refreshChatPlan: vi.fn(async () => undefined),
    clearChatPlan: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    sendWelcome: vi.fn(async () => undefined),
    compactNow: vi.fn(async () => null),
    stop: vi.fn(),
    clearIssue: vi.fn(),
    reportIssue: vi.fn(),
    noteDocumentJobStarted: vi.fn(),
    loadHistory: vi.fn(async () => undefined),
    markHistoryEmpty: vi.fn(),
    loadOlderMessages: options?.loadOlderMessages ?? vi.fn(async () => undefined),
    pendingSendStatus: null,
    retryPendingSend: vi.fn(async () => undefined),
    cancelPendingSend: vi.fn(() => null)
  };
}

describe("ChatArea", () => {
  it("persists project chat mode through the shared mode menu", async () => {
    getTokenMock.mockResolvedValueOnce("token-1");
    const patchMock = vi.mocked(patchAssistantWebChat);
    render(<ChatArea chat={createChat("Hello", { isStreaming: false })} />);

    fireEvent.click(screen.getByRole("button", { name: "modeMenuAria" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /modeProjectLabel/ }));

    await waitFor(() => {
      expect(patchMock).toHaveBeenCalledWith("token-1", "chat-1", { chatMode: "project" });
    });
  });

  it("persists project chat mode from the mobile mode menu", async () => {
    getTokenMock.mockResolvedValueOnce("token-1");
    const patchMock = vi.mocked(patchAssistantWebChat);
    render(<ChatArea chat={createChat("Hello", { isStreaming: false })} />);

    // Mobile chip uses md:hidden; in jsdom the desktop breakpoint often wins, so
    // query the touch-only control as hidden rather than stubbing viewport CSS.
    fireEvent.click(screen.getByRole("button", { name: "modeMenuAria", hidden: true }));
    const menu = screen.getByRole("menu");
    expect(menu.className).toContain("top-full");
    expect(menu.className).toContain("mt-2");
    expect(menu.className).toContain("right-0");
    expect(menu.className).not.toContain("left-0");
    expect(menu.className).not.toContain("bottom-full");
    fireEvent.click(screen.getByRole("menuitem", { name: /modeProjectLabel/ }));

    await waitFor(() => {
      expect(patchMock).toHaveBeenCalledWith("token-1", "chat-1", { chatMode: "project" });
    });
  });

  it("opens the sidebar and signals project files hint on mobile project activation", async () => {
    getTokenMock.mockResolvedValueOnce("token-1");
    const dispatchSpy = vi.spyOn(projectFilesEvents, "dispatchProjectModeActivated");
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query === "(max-width: 767px)",
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn()
        }) as unknown as MediaQueryList
    );

    render(<ChatArea chat={createChat("Hello", { isStreaming: false })} />);

    fireEvent.click(screen.getByRole("button", { name: "modeMenuAria" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /modeProjectLabel/ }));

    await waitFor(() => {
      expect(openSidebarMock).toHaveBeenCalledTimes(1);
      expect(dispatchSpy).toHaveBeenCalledWith("chat-1");
    });
  });

  it("signals project files hint on desktop without opening the sidebar", async () => {
    getTokenMock.mockResolvedValueOnce("token-1");
    const dispatchSpy = vi.spyOn(projectFilesEvents, "dispatchProjectModeActivated");
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn()
        }) as unknown as MediaQueryList
    );

    render(<ChatArea chat={createChat("Hello", { isStreaming: false })} />);

    fireEvent.click(screen.getByRole("button", { name: "modeMenuAria" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /modeProjectLabel/ }));

    await waitFor(() => {
      expect(openSidebarMock).not.toHaveBeenCalled();
      expect(dispatchSpy).toHaveBeenCalledWith("chat-1");
    });
  });

  it("does not repeat the project files hint in the same browser session", async () => {
    projectFilesEvents.markProjectFilesHintShown("chat-1");
    getTokenMock.mockResolvedValueOnce("token-1");
    const dispatchSpy = vi.spyOn(projectFilesEvents, "dispatchProjectModeActivated");

    render(<ChatArea chat={createChat("Hello", { isStreaming: false })} />);

    fireEvent.click(screen.getByRole("button", { name: "modeMenuAria" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /modeProjectLabel/ }));

    await waitFor(() => {
      expect(patchAssistantWebChat).toHaveBeenCalled();
    });
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(openSidebarMock).not.toHaveBeenCalled();
  });

  it("keeps auto-scrolling while the last assistant message streams new content", () => {
    const { container, rerender } = render(<ChatArea chat={createChat("Hello")} />);
    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLDivElement;
    const scrollTo = vi.fn();
    Object.defineProperty(scrollContainer, "scrollTo", {
      configurable: true,
      value: scrollTo
    });

    scrollTo.mockClear();

    rerender(<ChatArea chat={createChat("Hello world")} />);

    expect(scrollTo).toHaveBeenCalled();
  });

  it("preserves scroll position when older messages are prepended", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoView
    });

    const loadOlderMessages = vi.fn(async () => undefined);
    const { container, rerender } = render(
      <ChatArea
        chat={createChat(["Newest", "Latest"], {
          isStreaming: false,
          hasOlderMessages: true,
          loadOlderMessages
        })}
      />
    );

    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLDivElement;
    let scrollHeight = 400;
    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight
    });
    Object.defineProperty(scrollContainer, "clientHeight", {
      configurable: true,
      get: () => 200
    });
    scrollContainer.scrollTop = 120;

    scrollIntoView.mockClear();

    act(() => {
      intersectionObserverCallback?.([{ isIntersecting: true }]);
    });

    expect(loadOlderMessages).toHaveBeenCalled();

    scrollHeight = 600;
    rerender(
      <ChatArea
        chat={createChat(["Older", "Newest", "Latest"], {
          isStreaming: false,
          hasOlderMessages: true,
          loadOlderMessages
        })}
      />
    );

    expect(scrollContainer.scrollTop).toBe(320);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("shows localized voice retry guidance for empty transcriptions", () => {
    render(
      <ChatArea
        chat={createChat("Hello", {
          isStreaming: false,
          issue: {
            classId: "voice_transcription_empty",
            message: "No speech was detected in your recording.",
            guidance: "Record again."
          }
        })}
      />
    );

    expect(screen.getByText("voiceTranscriptionEmptyTitle")).toBeInTheDocument();
    expect(screen.getByText("voiceTranscriptionEmptyGuidance")).toBeInTheDocument();
  });

  it("shows the browser re-login banner and routes its actions through chat state", async () => {
    const abortBrowserLogin = vi.fn().mockResolvedValue(undefined);
    const reopenBrowserLogin = vi.fn();
    render(
      <ChatArea
        chat={{
          ...createChat("Hello", { isStreaming: false }),
          pendingBrowserLogin: {
            profileId: "profile-1",
            profileKey: "bitrix",
            displayName: "Bitrix24",
            loginUrl: "https://bitrix.example/login",
            workspaceId: "workspace-1",
            bridgeClientKind: "extension",
            completionMode: "login"
          },
          browserLoginModalOpen: false,
          abortBrowserLogin,
          reopenBrowserLogin
        }}
      />
    );

    expect(screen.getByText("Bitrix24")).toBeInTheDocument();
    expect(screen.getByText("browserLoginContinueHint")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "browserLoginContinue" }));
    expect(reopenBrowserLogin).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "browserLoginCancel" }));
    await waitFor(() => {
      expect(abortBrowserLogin).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps assist checkpoints in a banner and resumes the assistant after Done", async () => {
    getTokenMock.mockResolvedValue("token-1");
    getCurrentLocalBrowserBridgeStatusMock.mockResolvedValue({
      connected: true,
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      bridgeDeviceId: "mobile-device-1"
    });
    openAssistantBrowserProfileViewMock.mockResolvedValue({});
    dismissAssistantBrowserProfileViewMock.mockResolvedValue(undefined);
    const clearPendingBrowserLogin = vi.fn();
    const send = vi.fn().mockResolvedValue(undefined);
    render(
      <ChatArea
        assistantId="assistant-1"
        chat={{
          ...createChat("Hello", { isStreaming: false }),
          pendingBrowserLogin: {
            profileId: "profile-1",
            profileKey: "lavka",
            displayName: "Lavka",
            loginUrl: "https://lavka.yandex.ru/",
            workspaceId: "workspace-1",
            bridgeClientKind: "extension",
            completionMode: "assist"
          },
          browserLoginModalOpen: true,
          clearPendingBrowserLogin,
          send
        }}
      />
    );

    expect(screen.getByTestId("browser-assist-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("browser-login-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "browserAssistOpen" }));
    await waitFor(() => {
      expect(openAssistantBrowserProfileViewMock).toHaveBeenCalledWith(
        "token-1",
        "assistant-1",
        "profile-1",
        "mobile-device-1"
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "browserLoginAssistDone" }));
    await waitFor(() => {
      expect(dismissAssistantBrowserProfileViewMock).toHaveBeenCalledWith(
        "token-1",
        "assistant-1",
        "profile-1"
      );
      expect(clearPendingBrowserLogin).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith("browserAssistResumeMessage");
    });
  });

  it("shows localized provider failure guidance", () => {
    render(
      <ChatArea
        chat={createChat("Hello", {
          isStreaming: false,
          issue: {
            classId: "provider_failure",
            message: "A model provider issue interrupted this chat turn.",
            guidance: "Wait a moment and retry the same thread."
          }
        })}
      />
    );

    expect(screen.getByText("issueProviderFailure")).toBeInTheDocument();
    expect(screen.getByText("issueProviderFailureGuidance")).toBeInTheDocument();
  });

  it("shows localized safety restriction banner with support action", () => {
    openSettingsMock.mockReset();
    render(
      <ChatArea
        chat={createChat("Hello", {
          isStreaming: false,
          issue: {
            classId: "safety_restricted",
            message: "",
            guidance: "",
            data: { reasonCode: "hack_abuse" }
          }
        })}
      />
    );

    expect(screen.getByText("safetyRestrictedTitle")).toBeInTheDocument();
    expect(screen.getByText("safetyRestrictedBodyHackAbuse")).toBeInTheDocument();
    expect(screen.getByText("safetyRestrictedDetail")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "safetyRestrictedOpenSupport" }));
    expect(openSettingsMock).toHaveBeenCalledWith("support");
  });

  it("shows safety inbound warn banner above input with support action", () => {
    openSettingsMock.mockReset();
    render(
      <ChatArea
        chat={createChat("I cannot help with that.", {
          isStreaming: false,
          messages: [
            {
              id: "user-1",
              role: "user",
              content: "hack account",
              status: "committed"
            },
            {
              id: "warn-1",
              role: "assistant",
              content: "",
              status: "committed",
              platformNotice: {
                kind: "safety_inbound_warn",
                reasonCode: "hack_abuse"
              }
            },
            {
              id: "assistant-1",
              role: "assistant",
              content: "I cannot help with that.",
              status: "committed"
            }
          ]
        })}
      />
    );

    expect(screen.getByText("safetyInboundWarnTitle")).toBeInTheDocument();
    expect(screen.getByText("safetyInboundWarnBodyHackAbuse")).toBeInTheDocument();
    expect(screen.getByText("safetyInboundWarnDetail")).toBeInTheDocument();
    expect(screen.queryByText("I cannot help with that.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "safetyInboundWarnOpenSupport" }));
    expect(openSettingsMock).toHaveBeenCalledWith("support");
  });

  it("renders server-provided storage issue copy without replacing it locally", () => {
    render(
      <ChatArea
        chat={createChat("Hello", {
          isStreaming: false,
          issue: {
            classId: "media_storage_full",
            message: "Media storage is full (512 MB used out of 512 MB).",
            guidance: "Delete old chats or files to free space, then try again.",
            data: { usedMb: 512, limitMb: 512 }
          }
        })}
      />
    );

    expect(
      screen.getByText("Media storage is full (512 MB used out of 512 MB).")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Delete old chats or files to free space, then try again.")
    ).toBeInTheDocument();
  });

  it("does not show assistant thinking while the previous user message is still sending", () => {
    const userMessage: ChatMessage = {
      id: "local-user-1",
      role: "user",
      content: "Hello",
      status: "sending"
    };
    const assistantMessage: ChatMessage = {
      id: "local-assistant-1",
      role: "assistant",
      content: "",
      status: "streaming"
    };
    const baseChat = createChat("", { isStreaming: true });

    render(
      <ChatArea
        chat={{
          ...baseChat,
          entries: [
            { kind: "message", message: userMessage },
            { kind: "message", message: assistantMessage }
          ],
          messages: [userMessage, assistantMessage],
          pendingSendStatus: "sending"
        }}
      />
    );

    const assistantProps = chatMessageBubbleMock.mock.calls.find(
      ([props]) => props.message.id === "local-assistant-1"
    )?.[0];
    expect(assistantProps?.preResponseStatus).toBeUndefined();
  });

  it("passes the next activity into the streaming assistant bubble instead of rendering a banner", () => {
    const assistantMessage: ChatMessage = {
      id: "local-assistant-1",
      role: "assistant",
      content: "",
      status: "streaming"
    };
    const baseChat = createChat("", { isStreaming: true });

    render(
      <ChatArea
        chat={{
          ...baseChat,
          entries: [
            { kind: "message", message: assistantMessage },
            {
              kind: "activity",
              event: {
                id: "activity-1",
                type: "tool_use",
                label: "knowledge_search_finished"
              }
            }
          ],
          messages: [assistantMessage]
        }}
      />
    );

    const assistantProps = chatMessageBubbleMock.mock.calls.find(
      ([props]) => props.message.id === "local-assistant-1"
    )?.[0];
    expect(assistantProps?.preResponseStatus).toEqual({
      kind: "activity",
      event: {
        id: "activity-1",
        type: "tool_use",
        label: "knowledge_search_finished"
      }
    });
  });

  it("keeps the next activity attached after assistant text already started streaming", () => {
    const assistantMessage: ChatMessage = {
      id: "local-assistant-1",
      role: "assistant",
      content: "Hi",
      status: "streaming"
    };
    const baseChat = createChat("", { isStreaming: true });

    render(
      <ChatArea
        chat={{
          ...baseChat,
          entries: [
            { kind: "message", message: assistantMessage },
            {
              kind: "activity",
              event: {
                id: "activity-1",
                type: "tool_use",
                label: "knowledge_search_finished"
              }
            }
          ],
          messages: [assistantMessage]
        }}
      />
    );

    const assistantProps = chatMessageBubbleMock.mock.calls.find(
      ([props]) => props.message.id === "local-assistant-1"
    )?.[0];
    expect(assistantProps?.preResponseStatus).toEqual({
      kind: "activity",
      event: {
        id: "activity-1",
        type: "tool_use",
        label: "knowledge_search_finished"
      }
    });
  });

  it("renders media-package billing return copy instead of subscription copy", () => {
    render(
      <ChatArea
        chat={createChat("Hello", { isStreaming: false })}
        billingReturnKind="success"
        billingPlanCode="__media_package__"
        billingPaymentIntentId="pi-package"
      />
    );

    expect(screen.getByText("billingReturnPackageSuccessTitle")).toBeInTheDocument();
    expect(screen.getByText("billingReturnPackageSuccessBody")).toBeInTheDocument();
    expect(screen.queryByText("billingReturnSuccessTitle")).toBeNull();
  });

  it("routes failed media-package retry to packages", () => {
    render(
      <ChatArea
        chat={createChat("Hello", { isStreaming: false })}
        billingReturnKind="failed"
        billingPlanCode="__media_package__"
        billingPaymentIntentId="pi-package"
      />
    );

    expect(screen.getByRole("link", { name: "billingReturnPackageRetry" })).toHaveAttribute(
      "href",
      "/app/packages"
    );
  });

  it("renders the chat title as quiet single-line context", () => {
    render(
      <ChatArea chat={createChat("Hello", { isStreaming: false })} title="Very long chat title" />
    );

    expect(screen.getByRole("heading", { name: "Very long chat title" })).toHaveClass(
      "text-sm",
      "font-medium",
      "text-text-muted",
      "truncate"
    );
  });

  it("shows a quiet scroll-to-bottom button when reading older messages", () => {
    const { container } = render(
      <ChatArea chat={createChat(["Older", "Latest"], { isStreaming: false })} />
    );
    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLDivElement;
    const scrollTo = vi.fn();
    Object.defineProperty(scrollContainer, "scrollTo", {
      configurable: true,
      value: scrollTo
    });
    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      get: () => 1200
    });
    Object.defineProperty(scrollContainer, "clientHeight", {
      configurable: true,
      get: () => 500
    });
    scrollContainer.scrollTop = 100;

    fireEvent.scroll(scrollContainer);
    const scrollButton = screen.getByLabelText("scrollToBottom");
    expect(scrollButton).toHaveClass("right-3", "md:left-1/2", "md:-translate-x-1/2");
    fireEvent.click(scrollButton);

    expect(scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: "smooth" });
  });

  it("jumps to the bottom again when switching to another loaded chat", async () => {
    const { container, rerender } = render(
      <ChatArea chat={createChat(["Old", "Current"], { chatId: "chat-1", isStreaming: false })} />
    );
    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLDivElement;
    const scrollTo = vi.fn();
    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      get: () => 1400
    });
    Object.defineProperty(scrollContainer, "scrollTo", {
      configurable: true,
      value: scrollTo
    });

    scrollTo.mockClear();
    rerender(
      <ChatArea
        chat={createChat(["Other old", "Other current"], {
          chatId: "chat-2",
          isStreaming: false
        })}
      />
    );

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 1400, behavior: "auto" });
    });
  });

  it("keeps assistant bubble callbacks stable across streaming rerenders", () => {
    const firstChat = createChat(["Stable answer", "Streaming"]);
    const { rerender } = render(<ChatArea chat={firstChat} />);

    const firstProps = chatMessageBubbleMock.mock.calls.find(
      ([props]) => props.message.id === "assistant-1"
    )?.[0];
    expect(firstProps?.onAssistantAction).toBeTypeOf("function");
    expect(firstProps?.onDoNotRemember).toBeTypeOf("function");

    chatMessageBubbleMock.mockClear();

    const secondChat: UseChatReturn = {
      ...firstChat,
      entries: [
        firstChat.entries[0]!,
        {
          kind: "message",
          message: {
            ...(firstChat.entries[1]!.kind === "message"
              ? firstChat.entries[1]!.message
              : firstChat.messages[1]!),
            content: "Streaming update"
          }
        }
      ],
      messages: [
        firstChat.messages[0]!,
        {
          ...firstChat.messages[1]!,
          content: "Streaming update"
        }
      ]
    };

    rerender(<ChatArea chat={secondChat} />);

    const secondProps = chatMessageBubbleMock.mock.calls.find(
      ([props]) => props.message.id === "assistant-1"
    )?.[0];
    expect(secondProps?.onAssistantAction).toBe(firstProps?.onAssistantAction);
    expect(secondProps?.onDoNotRemember).toBe(firstProps?.onDoNotRemember);
  });

  it("dims smart and project modes with limit caption while paid light mode is active", async () => {
    getTokenMock.mockResolvedValue("token");
    render(
      <ChatArea
        chat={createChat(["Hello"], { chatId: "chat-light", isStreaming: false })}
        chatMode="normal"
        paidLightModeActive
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /modeMenuAria/ }));

    const smartItem = screen.getByRole("menuitem", { name: /modeDeepLabel/ });
    const projectItem = screen.getByRole("menuitem", { name: /modeProjectLabel/ });

    expect(smartItem).toHaveAttribute("aria-disabled", "true");
    expect(projectItem).toHaveAttribute("aria-disabled", "true");
    expect(smartItem).toHaveTextContent("modeLimitReachedCaption");
    expect(projectItem).toHaveTextContent("modeLimitReachedCaption");
  });

  // ADR-125 follow-up — chat-header subtitle surfaces the chat-level active
  // skill/scenario. The subtitle row is shared with the mode caption: when
  // no skill is engaged it falls back to the mode caption (desktop only).
  describe("chat-header subtitle", () => {
    function chatWithEngagement(options: {
      skillDisplayName: string;
      scenarioDisplayName: string | null;
    }): UseChatReturn {
      return createChat("ok", {
        isStreaming: false,
        currentEngagement: {
          skillDisplayName: options.skillDisplayName,
          scenarioDisplayName: options.scenarioDisplayName
        }
      });
    }

    it("renders skill + scenario subtitle when chat carries currentEngagement", () => {
      render(
        <ChatArea
          chat={chatWithEngagement({
            skillDisplayName: "Маркетолог",
            scenarioDisplayName: "Карусель"
          })}
          chatMode="normal"
        />
      );

      expect(screen.getByText("Маркетолог")).toBeInTheDocument();
      expect(screen.getByText("Карусель")).toBeInTheDocument();
      // 2026-06-22 founder feedback: the explicit "СКИЛЛ" label is gone —
      // the subtitle is just `<skill> · <scenario>` so we don't render the
      // i18n key any more.
      expect(screen.queryByText("activeSkillPrefix")).not.toBeInTheDocument();
      expect(screen.queryByText("modeDeepCaption")).not.toBeInTheDocument();
    });

    it("renders skill-only subtitle when currentEngagement has no scenario", () => {
      render(
        <ChatArea
          chat={chatWithEngagement({ skillDisplayName: "Finance", scenarioDisplayName: null })}
          chatMode="normal"
        />
      );

      expect(screen.getByText("Finance")).toBeInTheDocument();
      // Scenario separator should not render when scenarioDisplayName is null.
      expect(screen.queryByText("·")).not.toBeInTheDocument();
      expect(screen.queryByText("activeSkillPrefix")).not.toBeInTheDocument();
    });

    it("falls back to mode caption when no skill engagement is active", () => {
      render(<ChatArea chat={createChat("Hello", { isStreaming: false })} chatMode="smart" />);

      expect(screen.getByText("modeDeepCaption")).toBeInTheDocument();
    });

    it("renders no subtitle when chat is normal mode and no skill is engaged", () => {
      render(<ChatArea chat={createChat("Hello", { isStreaming: false })} chatMode="normal" />);

      expect(screen.queryByText("modeDeepCaption")).not.toBeInTheDocument();
      expect(screen.queryByText("modeProjectCaption")).not.toBeInTheDocument();
    });

    it("keeps the mode icon visible alongside the skill chip when a non-normal mode is active", () => {
      const { container } = render(
        <ChatArea
          chat={chatWithEngagement({ skillDisplayName: "Маркетолог", scenarioDisplayName: null })}
          chatMode="smart"
        />
      );

      // Sparkles is the Smart-mode icon (lucide injects an svg with class
      // containing "lucide-sparkles"). Presence proves the icon was rendered.
      const sparkles = container.querySelector("svg.lucide-sparkles");
      expect(sparkles).not.toBeNull();
      expect(screen.getByText("Маркетолог")).toBeInTheDocument();
    });
  });
});
