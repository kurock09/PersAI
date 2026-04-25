import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forwardRef } from "react";
import { ChatMessageBubble } from "./chat-message";
import type { ChatMessage } from "./use-chat";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key
}));

vi.mock("./assistant-avatar", () => ({
  AssistantAvatar: () => <div data-testid="assistant-avatar" />
}));

vi.mock("./voice-message-player", () => ({
  VoiceMessagePlayer: () => <div data-testid="voice-message-player" />
}));

vi.mock("./image-lightbox", () => ({
  ImageLightbox: () => null
}));

vi.mock("../assistant-api-client", () => ({
  getAttachmentDownloadUrl: () => "/dummy"
}));

// react-markdown is heavy and unrelated to the indicator under test —
// stub it to a fragment so the test stays focused on Section M behaviour.
vi.mock("react-markdown", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>
}));

vi.mock("remark-gfm", () => ({ default: () => null }));
vi.mock("remark-math", () => ({ default: () => null }));
vi.mock("rehype-katex", () => ({ default: () => null }));

// Render motion.* / AnimatePresence as plain DOM passthrough so spinner
// presence in jsdom is not gated on framer-motion's rAF-driven exit
// animation completing.
vi.mock("framer-motion", () => {
  type DivProps = React.HTMLAttributes<HTMLDivElement> & {
    [key: `data-${string}`]: unknown;
  };
  const MotionDiv = forwardRef<HTMLDivElement, DivProps>(function MotionDiv(
    {
      children,
      // Strip motion-only props so React doesn't warn about them.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ...rest
    },
    ref
  ) {
    const {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      initial,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      animate,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      exit,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      transition,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      layout,
      ...domProps
    } = rest as DivProps & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
      layout?: unknown;
    };
    return (
      <div ref={ref} {...domProps}>
        {children}
      </div>
    );
  });

  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    motion: { div: MotionDiv }
  };
});

function makeUserMessage(
  status: ChatMessage["status"],
  overrides: Partial<ChatMessage> = {}
): ChatMessage {
  return {
    id: "user-1",
    role: "user",
    content: "Hello",
    status,
    ...overrides
  };
}

function makeImageAttachment(id: string): NonNullable<ChatMessage["attachments"]>[number] {
  return {
    id,
    attachmentType: "image",
    originalFilename: "photo.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1024,
    processingStatus: "ready",
    createdAt: "2026-04-25T12:00:00.000Z"
  };
}

function makeAssistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "",
    status: "streaming",
    ...overrides
  };
}

const ATTACHMENTS_ONLY_PLACEHOLDER_TEXT = "(attached files)";

const SENDING_INDICATOR_TESTID = "message-sending-indicator";
const FAILED_SHORT_LABEL = "failedShort";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ChatMessageBubble — sending indicator (ADR-076 Section M)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("does not render the spinner before the 1s delay elapses", () => {
    render(<ChatMessageBubble message={makeUserMessage("sending")} />);

    expect(screen.queryByTestId(SENDING_INDICATOR_TESTID)).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(999);
    });

    expect(screen.queryByTestId(SENDING_INDICATOR_TESTID)).not.toBeInTheDocument();
  });

  it("renders the spinner after 1s of sustained `sending`", () => {
    render(<ChatMessageBubble message={makeUserMessage("sending")} />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByTestId(SENDING_INDICATOR_TESTID)).toBeInTheDocument();
  });

  it("removes the spinner when the bubble flips to `committed`", () => {
    const { rerender } = render(<ChatMessageBubble message={makeUserMessage("sending")} />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId(SENDING_INDICATOR_TESTID)).toBeInTheDocument();

    rerender(<ChatMessageBubble message={makeUserMessage("committed")} />);

    expect(screen.queryByTestId(SENDING_INDICATOR_TESTID)).not.toBeInTheDocument();
  });

  it("never shows the spinner when `send_failed` lands before the 1s delay", () => {
    const { rerender } = render(<ChatMessageBubble message={makeUserMessage("sending")} />);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByTestId(SENDING_INDICATOR_TESTID)).not.toBeInTheDocument();

    rerender(
      <ChatMessageBubble
        message={makeUserMessage("send_failed")}
        onRetryPendingSend={vi.fn()}
        onCancelPendingSend={vi.fn()}
      />
    );

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.queryByTestId(SENDING_INDICATOR_TESTID)).not.toBeInTheDocument();
    expect(screen.getByText(FAILED_SHORT_LABEL)).toBeInTheDocument();
  });

  it("removes the spinner and surfaces `Not delivered` when send_failed lands after the spinner is visible", () => {
    const { rerender } = render(<ChatMessageBubble message={makeUserMessage("sending")} />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId(SENDING_INDICATOR_TESTID)).toBeInTheDocument();

    rerender(
      <ChatMessageBubble
        message={makeUserMessage("send_failed")}
        onRetryPendingSend={vi.fn()}
        onCancelPendingSend={vi.fn()}
      />
    );

    expect(screen.queryByTestId(SENDING_INDICATOR_TESTID)).not.toBeInTheDocument();
    expect(screen.getByText(FAILED_SHORT_LABEL)).toBeInTheDocument();
  });
});

describe("ChatMessageBubble — attachments-only user message (FIX 3)", () => {
  it("does not render the literal '(attached files)' placeholder when the user sent only attachments", () => {
    render(
      <ChatMessageBubble
        message={makeUserMessage("committed", {
          content: ATTACHMENTS_ONLY_PLACEHOLDER_TEXT,
          attachments: [makeImageAttachment("att-1")]
        })}
      />
    );

    expect(screen.queryByText(ATTACHMENTS_ONLY_PLACEHOLDER_TEXT)).not.toBeInTheDocument();
  });

  it("does not render any user text node when content is empty after trim and attachments are present", () => {
    const { container } = render(
      <ChatMessageBubble
        message={makeUserMessage("committed", {
          content: "   ",
          attachments: [makeImageAttachment("att-2")]
        })}
      />
    );

    expect(container.querySelector("p.whitespace-pre-wrap")).toBeNull();
  });

  it("still renders the user's real text when both text and attachments are present", () => {
    render(
      <ChatMessageBubble
        message={makeUserMessage("committed", {
          content: "Look at this please",
          attachments: [makeImageAttachment("att-3")]
        })}
      />
    );

    expect(screen.getByText("Look at this please")).toBeInTheDocument();
  });

  it("renders the placeholder text verbatim when there are no attachments (defensive — should never happen in production)", () => {
    render(
      <ChatMessageBubble
        message={makeUserMessage("committed", {
          content: ATTACHMENTS_ONLY_PLACEHOLDER_TEXT
        })}
      />
    );

    // Suppression is gated on attachments.length > 0; without attachments
    // the bubble renders content unchanged so future regressions in the
    // composer can't silently swallow user-visible text.
    expect(screen.getByText(ATTACHMENTS_ONLY_PLACEHOLDER_TEXT)).toBeInTheDocument();
  });
});

describe("ChatMessageBubble — pre-response status", () => {
  it("shows thinking before the first assistant token", () => {
    render(<ChatMessageBubble message={makeAssistantMessage()} preResponseStatus="thinking" />);

    expect(screen.getByText("preResponseThinking")).toBeInTheDocument();
  });

  it("shows working while a tool is active before text starts", () => {
    render(<ChatMessageBubble message={makeAssistantMessage()} preResponseStatus="working" />);

    expect(screen.getByText("preResponseWorking")).toBeInTheDocument();
  });

  it("hides pre-response status after text starts streaming", () => {
    render(
      <ChatMessageBubble
        message={makeAssistantMessage({ content: "Hello" })}
        preResponseStatus="thinking"
      />
    );

    expect(screen.queryByText("preResponseThinking")).toBeNull();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });
});
