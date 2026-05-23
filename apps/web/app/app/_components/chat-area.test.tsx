import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ChatArea } from "./chat-area";
import type { ChatMessage, UseChatReturn } from "./use-chat";
import { patchAssistantWebChat } from "../assistant-api-client";

const chatMessageBubbleMock = vi.hoisted(() => vi.fn());
const getTokenMock = vi.hoisted(() => vi.fn(async (): Promise<string | null> => null));

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
    openSidebar: vi.fn()
  })
}));

vi.mock("./chat-message", () => ({
  ChatMessageBubble: (props: {
    message: ChatMessage;
    preResponseStatus?: "thinking" | "working";
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

vi.mock("./activity-badge", () => ({
  ActivityBadge: ({ event }: { event: { label: string } }) => <div>{event.label}</div>
}));

vi.mock("./assistant-avatar", () => ({
  AssistantAvatar: () => <div data-testid="assistant-avatar" />
}));

vi.mock("../assistant-api-client", () => ({
  patchAssistantWebChat: vi.fn(async () => undefined),
  postAssistantMemoryDoNotRemember: vi.fn(async () => undefined),
  transcribeVoice: vi.fn(async () => "")
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
  }
): UseChatReturn {
  const contents = Array.isArray(messageContent) ? messageContent : [messageContent];
  const isStreaming = options?.isStreaming ?? true;
  const messages: ChatMessage[] = contents.map((content, index) => ({
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
    isStreaming,
    historyLoading: false,
    hasOlderMessages: options?.hasOlderMessages ?? false,
    olderMessagesLoading: options?.olderMessagesLoading ?? false,
    issue: options?.issue ?? null,
    compaction: null,
    recentAutoCompaction: null,
    compactionRunning: false,
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
});
