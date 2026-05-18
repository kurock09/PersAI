import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forwardRef } from "react";
import { ChatMessageBubble, resolveInternalChatCta } from "./chat-message";
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
  getAssistantDocumentOriginalDownloadUrl: (
    docId: string,
    options?: { versionId?: string | null }
  ) =>
    `/api/assistant-document/${docId}/original${
      options?.versionId ? `?versionId=${options.versionId}` : ""
    }`,
  getAssistantFileDownloadUrl: (fileRef: string, options?: { download?: boolean }) =>
    `/api/assistant-file/${fileRef}${options?.download ? "?download=1" : ""}`
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
    fileRef: null,
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

  it("does not render the spinner before the short delay elapses", () => {
    render(<ChatMessageBubble message={makeUserMessage("sending")} />);

    expect(screen.queryByTestId(SENDING_INDICATOR_TESTID)).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(249);
    });

    expect(screen.queryByTestId(SENDING_INDICATOR_TESTID)).not.toBeInTheDocument();
  });

  it("renders the spinner after the short sustained `sending` delay", () => {
    render(<ChatMessageBubble message={makeUserMessage("sending")} />);

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByTestId(SENDING_INDICATOR_TESTID)).toBeInTheDocument();
  });

  it("does not render the off-bubble spinner for attachment sends", () => {
    render(
      <ChatMessageBubble
        message={makeUserMessage("sending", {
          attachments: [{ ...makeImageAttachment("att-pending"), processingStatus: "pending" }]
        })}
      />
    );

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.queryByTestId(SENDING_INDICATOR_TESTID)).not.toBeInTheDocument();
  });

  it("shows a compact upload percent inside pending attachment cards", () => {
    render(
      <ChatMessageBubble
        message={makeUserMessage("sending", {
          attachments: [
            {
              ...makeImageAttachment("att-pending-progress"),
              processingStatus: "pending",
              uploadProgressPercent: 42
            }
          ]
        })}
      />
    );

    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("removes the spinner when the bubble flips to `committed`", () => {
    const { rerender } = render(<ChatMessageBubble message={makeUserMessage("sending")} />);

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByTestId(SENDING_INDICATOR_TESTID)).toBeInTheDocument();

    rerender(<ChatMessageBubble message={makeUserMessage("committed")} />);

    expect(screen.queryByTestId(SENDING_INDICATOR_TESTID)).not.toBeInTheDocument();
  });

  it("never shows the spinner when `send_failed` lands before the short delay", () => {
    const { rerender } = render(<ChatMessageBubble message={makeUserMessage("sending")} />);

    act(() => {
      vi.advanceTimersByTime(100);
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
      vi.advanceTimersByTime(250);
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

  it("renders user attachments before the caption text when both are present", () => {
    const { container } = render(
      <ChatMessageBubble
        message={makeUserMessage("committed", {
          content: "Look at this please",
          attachments: [
            {
              ...makeImageAttachment("att-ordered"),
              localPreviewUrl: "blob:test-image"
            }
          ]
        })}
      />
    );

    const image = container.querySelector("img");
    const caption = screen.getByText("Look at this please");

    expect(image).not.toBeNull();
    if (image === null) {
      throw new Error("Expected image attachment preview to render.");
    }
    expect(image.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps user image preview radii aligned with the media bubble shell", () => {
    const { container } = render(
      <ChatMessageBubble
        message={makeUserMessage("committed", {
          content: ATTACHMENTS_ONLY_PLACEHOLDER_TEXT,
          attachments: [
            {
              ...makeImageAttachment("att-rounded"),
              localPreviewUrl: "blob:test-rounded-image"
            }
          ]
        })}
      />
    );

    const bubble = container.querySelector("div.bg-accent\\/15.p-1");
    const previewButton = container.querySelector(
      'button[disabled="false"], button:not([disabled])'
    );

    expect(bubble?.className).toContain("rounded-[18px]");
    expect(bubble?.className).toContain("rounded-br-md");
    expect(previewButton?.className).toContain("rounded-[14px]");
    expect(previewButton?.className).toContain("rounded-br-[10px]");
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

describe("ChatMessageBubble — canonical file attachments", () => {
  it("uses fileRef download URLs when an attachment is linked to a canonical File", () => {
    render(
      <ChatMessageBubble
        message={makeUserMessage("committed", {
          attachments: [
            {
              ...makeImageAttachment("att-file-ref"),
              attachmentType: "document",
              originalFilename: "spec.pdf",
              mimeType: "application/pdf",
              fileRef: "file-ref-1"
            }
          ]
        })}
      />
    );

    expect(screen.getByRole("link", { name: /spec\.pdf/i })).toHaveAttribute(
      "href",
      "/api/assistant-file/file-ref-1?download=1"
    );
  });

  it("keeps history-loaded fileRef attachments downloadable after refresh", () => {
    render(
      <ChatMessageBubble
        message={makeUserMessage("committed", {
          attachments: [
            {
              id: "persisted-att-1",
              fileRef: "persisted-file-ref-1",
              attachmentType: "document",
              originalFilename: "after-refresh.pdf",
              mimeType: "application/pdf",
              sizeBytes: 2048,
              processingStatus: "ready",
              createdAt: "2026-05-02T10:00:00.000Z"
            }
          ]
        })}
      />
    );

    expect(screen.getByRole("link", { name: /after-refresh\.pdf/i })).toHaveAttribute(
      "href",
      "/api/assistant-file/persisted-file-ref-1?download=1"
    );
  });

  it("renders a quiet secondary PPTX action for PDF presentation attachments", () => {
    render(
      <ChatMessageBubble
        message={makeUserMessage("committed", {
          attachments: [
            {
              id: "presentation-pdf-1",
              fileRef: "presentation-file-ref-1",
              attachmentType: "document",
              originalFilename: "board-deck.pdf",
              mimeType: "application/pdf",
              sizeBytes: 4096,
              processingStatus: "ready",
              documentLink: {
                docId: "doc-presentation-1",
                versionId: "version-presentation-1",
                versionNumber: 3,
                descriptorMode: "create_presentation",
                documentType: "presentation",
                documentStatus: "ready",
                versionStatus: "ready",
                isCurrentOutput: true
              },
              createdAt: "2026-05-18T11:00:00.000Z"
            }
          ]
        })}
      />
    );

    expect(screen.getByRole("link", { name: /board-deck\.pdf/i })).toHaveAttribute(
      "href",
      "/api/assistant-file/presentation-file-ref-1?download=1"
    );
    expect(screen.getByRole("link", { name: "PPTX" })).toHaveAttribute(
      "href",
      "/api/assistant-document/doc-presentation-1/original?versionId=version-presentation-1"
    );
  });

  it("does not render a fallback download link when a committed file lacks fileRef", () => {
    render(
      <ChatMessageBubble
        message={makeUserMessage("committed", {
          attachments: [
            {
              ...makeImageAttachment("att-without-file-ref"),
              attachmentType: "document",
              originalFilename: "legacy.pdf",
              mimeType: "application/pdf",
              fileRef: null
            }
          ]
        })}
      />
    );

    expect(screen.queryByRole("link", { name: /legacy\.pdf/i })).toBeNull();
    expect(screen.getByText("legacy.pdf")).toBeInTheDocument();
  });

  it("renders a quiet deleted-file status instead of a broken download card", () => {
    render(
      <ChatMessageBubble
        message={makeUserMessage("committed", {
          attachments: [
            {
              ...makeImageAttachment("att-deleted-file"),
              attachmentType: "document",
              originalFilename: "deleted.pdf",
              mimeType: "application/pdf",
              fileRef: null,
              fileDeleted: true
            }
          ]
        })}
      />
    );

    expect(screen.queryByRole("link", { name: /deleted\.pdf/i })).toBeNull();
    expect(screen.getByText("deleted.pdf")).toBeInTheDocument();
    expect(screen.getByText("fileDeleted")).toBeInTheDocument();
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

describe("resolveInternalChatCta", () => {
  it("recognizes internal pricing links", () => {
    expect(resolveInternalChatCta("/app/pricing")).toEqual({
      kind: "pricing",
      href: "/app/pricing"
    });
  });

  it("recognizes internal packages links", () => {
    expect(resolveInternalChatCta("https://persai.dev/app/packages")).toEqual({
      kind: "packages",
      href: "/app/packages"
    });
  });

  it("recognizes internal checkout links", () => {
    expect(resolveInternalChatCta("https://persai.dev/app/billing/checkout/pi_123")).toEqual({
      kind: "payment",
      href: "/app/billing/checkout/pi_123"
    });
  });

  it("ignores external non-PersAI links", () => {
    expect(resolveInternalChatCta("https://example.com/app/pricing")).toBeNull();
  });
});
