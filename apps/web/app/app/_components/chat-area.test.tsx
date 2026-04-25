import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ChatArea } from "./chat-area";
import type { ChatMessage, UseChatReturn } from "./use-chat";

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: vi.fn(async () => null)
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
  ChatMessageBubble: ({ message }: { message: ChatMessage }) => <div>{message.content}</div>
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
  vi.restoreAllMocks();
});

function createChat(
  messageContent: string | string[],
  options?: {
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
    chatId: "chat-1",
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
    loadHistory: vi.fn(async () => undefined),
    markHistoryEmpty: vi.fn(),
    loadOlderMessages: options?.loadOlderMessages ?? vi.fn(async () => undefined),
    pendingSendStatus: null,
    retryPendingSend: vi.fn(async () => undefined),
    cancelPendingSend: vi.fn(() => null)
  };
}

describe("ChatArea", () => {
  it("keeps auto-scrolling while the last assistant message streams new content", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoView
    });
    const { rerender } = render(<ChatArea chat={createChat("Hello")} />);

    scrollIntoView.mockClear();

    rerender(<ChatArea chat={createChat("Hello world")} />);

    expect(scrollIntoView).toHaveBeenCalled();
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
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoView
    });
    const { container } = render(
      <ChatArea chat={createChat(["Older", "Latest"], { isStreaming: false })} />
    );
    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLDivElement;
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
    fireEvent.click(screen.getByLabelText("scrollToBottom"));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
  });
});
