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
