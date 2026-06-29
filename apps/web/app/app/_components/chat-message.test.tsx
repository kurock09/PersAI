import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forwardRef } from "react";
import { ChatMessageBubble, resolveInternalChatCta } from "./chat-message";
import type { ChatMessage } from "./use-chat";

const imageLightboxMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: vi.fn().mockResolvedValue("test-token")
  })
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, number>) => {
    if (key === "processBadge.worked") {
      const steps = values?.steps ?? 0;
      const suffix = steps === 1 ? "шаг" : steps >= 2 && steps <= 4 ? "шага" : "шагов";
      return `Выполнено · ${String(steps)} ${suffix}`;
    }
    if (key === "processBadge.exploredSearches") {
      const n = values?.n ?? 0;
      const suffix = n === 1 ? "источник" : n >= 2 && n <= 4 ? "источника" : "источников";
      return `Найдено · ${String(n)} ${suffix}`;
    }
    if (key === "processBadge.knowledgeFetches") {
      return `Прочитано · ${String(values?.n ?? 0)} карточка`;
    }
    if (key === "processBadge.generatedImages") {
      return `Сгенерировано · ${String(values?.n ?? 0)} изобр.`;
    }
    if (key === "processBadge.editedImages") {
      return `Отредактировано · ${String(values?.n ?? 0)} изобр.`;
    }
    if (key === "processBadge.generatedVideos") {
      return `Сгенерировано · ${String(values?.n ?? 0)} видео`;
    }
    if (key === "processBadge.preparedDocuments") {
      return `Подготовлено · ${String(values?.n ?? 0)} документ`;
    }
    if (key === "processBadge.wroteFiles") {
      return `Записано · ${String(values?.n ?? 0)} файл`;
    }
    if (key === "processBadge.readFiles") {
      return `Прочитано · ${String(values?.n ?? 0)} файл`;
    }
    if (key === "processBadge.ranCommands") {
      return `Запущено · ${String(values?.n ?? 0)} команда`;
    }
    if (key === "processBadge.readPages") {
      const n = values?.n ?? 0;
      const suffix = n === 1 ? "страница" : n >= 2 && n <= 4 ? "страницы" : "страниц";
      return `Прочитано · ${String(n)} ${suffix}`;
    }
    return key;
  }
}));

vi.mock("./assistant-avatar", () => ({
  AssistantAvatar: () => <div data-testid="assistant-avatar" />
}));

vi.mock("./voice-message-player", () => ({
  VoiceMessagePlayer: () => <div data-testid="voice-message-player" />
}));

vi.mock("./authenticated-attachment-image", () => ({
  AuthenticatedAttachmentImage: ({
    src,
    alt,
    className
  }: {
    src: string;
    alt: string;
    className?: string;
  }) => (
    <img data-testid="authenticated-attachment-image" src={src} alt={alt} className={className} />
  )
}));

vi.mock("./image-lightbox", () => ({
  ImageLightbox: (props: {
    open: boolean;
    src: string;
    downloadUrl?: string;
    filename?: string;
    mediaType?: string;
    galleryItems?: Array<{ src: string; filename?: string }>;
    currentIndex?: number;
    onNavigate?: (nextIndex: number) => void;
  }) => {
    imageLightboxMock(props);
    return props.open ? (
      <div
        data-testid="mock-image-lightbox"
        data-src={props.src}
        data-download-url={props.downloadUrl}
        data-filename={props.filename}
        data-media-type={props.mediaType}
        data-gallery-count={props.galleryItems?.length ?? 0}
        data-current-index={props.currentIndex}
      />
    ) : null;
  }
}));

vi.mock("../assistant-api-client", () => ({
  getAssistantDocumentPptxPrepareUrl: (docId: string, options?: { versionId?: string | null }) =>
    `/api/assistant-document/${docId}/prepare-pptx${
      options?.versionId ? `?versionId=${options.versionId}` : ""
    }`,
  getAssistantAttachmentPreviewUrl: (input: {
    chatId: string;
    path: string | null;
    thumbnailStoragePath?: string | null;
    posterStoragePath?: string | null;
    attachmentType?: string | null;
  }) => {
    if (input.attachmentType === "image" && input.thumbnailStoragePath) {
      return `/api/v1/assistant/chats/web/${input.chatId}/files?path=${encodeURIComponent(input.thumbnailStoragePath)}`;
    }
    if (input.attachmentType === "video" && input.posterStoragePath) {
      return `/api/v1/assistant/chats/web/${input.chatId}/files?path=${encodeURIComponent(input.posterStoragePath)}`;
    }
    return input.path
      ? `/api/v1/assistant/chats/web/${input.chatId}/files?path=${encodeURIComponent(input.path)}`
      : null;
  },
  buildChatFileUrl: (input: { chatId: string; storagePath: string; download?: boolean }) =>
    `/api/v1/assistant/chats/web/${input.chatId}/files?path=${encodeURIComponent(input.storagePath)}${input.download ? "&download=1" : ""}`
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
    path: "/workspace/photo.jpg",
    thumbnailStoragePath: "/workspace/photo.jpg.thumb.webp",
    posterStoragePath: null,
    attachmentType: "image",
    originalFilename: "photo.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1024,
    processingStatus: "ready",
    createdAt: "2026-04-25T12:00:00.000Z"
  };
}

function makeVideoAttachment(id: string): NonNullable<ChatMessage["attachments"]>[number] {
  return {
    id,
    path: "/workspace/clip.mp4",
    thumbnailStoragePath: null,
    posterStoragePath: "/workspace/clip.mp4.poster.jpg",
    attachmentType: "video",
    originalFilename: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 4096,
    processingStatus: "ready",
    createdAt: "2026-06-07T10:00:00.000Z"
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
  delete (window as unknown as { PersaiNative?: unknown }).PersaiNative;
  imageLightboxMock.mockClear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mockCanvasVideoThumbnail(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn()
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,thumbnail"
  );
}

function defineVideoIntrinsicFrame(
  video: HTMLVideoElement,
  input: { width: number; height: number; duration?: number }
): void {
  Object.defineProperty(video, "duration", {
    configurable: true,
    value: input.duration ?? 10
  });
  Object.defineProperty(video, "videoWidth", {
    configurable: true,
    value: input.width
  });
  Object.defineProperty(video, "videoHeight", {
    configurable: true,
    value: input.height
  });
}

describe("ChatMessageBubble — sending indicator (ADR-076 Section M)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("does not render the spinner before the short delay elapses", () => {
    render(<ChatMessageBubble chatId="chat-1" message={makeUserMessage("sending")} />);

    expect(screen.queryByTestId(SENDING_INDICATOR_TESTID)).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(249);
    });

    expect(screen.queryByTestId(SENDING_INDICATOR_TESTID)).not.toBeInTheDocument();
  });

  it("renders the spinner after the short sustained `sending` delay", () => {
    render(<ChatMessageBubble chatId="chat-1" message={makeUserMessage("sending")} />);

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByTestId(SENDING_INDICATOR_TESTID)).toBeInTheDocument();
  });

  it("does not render the off-bubble spinner for attachment sends", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
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
        chatId="chat-1"
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
    const { rerender } = render(
      <ChatMessageBubble chatId="chat-1" message={makeUserMessage("sending")} />
    );

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByTestId(SENDING_INDICATOR_TESTID)).toBeInTheDocument();

    rerender(<ChatMessageBubble chatId="chat-1" message={makeUserMessage("committed")} />);

    expect(screen.queryByTestId(SENDING_INDICATOR_TESTID)).not.toBeInTheDocument();
  });

  it("never shows the spinner when `send_failed` lands before the short delay", () => {
    const { rerender } = render(
      <ChatMessageBubble chatId="chat-1" message={makeUserMessage("sending")} />
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByTestId(SENDING_INDICATOR_TESTID)).not.toBeInTheDocument();

    rerender(
      <ChatMessageBubble
        chatId="chat-1"
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
    const { rerender } = render(
      <ChatMessageBubble chatId="chat-1" message={makeUserMessage("sending")} />
    );

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByTestId(SENDING_INDICATOR_TESTID)).toBeInTheDocument();

    rerender(
      <ChatMessageBubble
        chatId="chat-1"
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
        chatId="chat-1"
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
        chatId="chat-1"
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
        chatId="chat-1"
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
        chatId="chat-1"
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
        chatId="chat-1"
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
        chatId="chat-1"
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
  it("passes same-message image attachments as a gallery to the lightbox", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeUserMessage("committed", {
          content: ATTACHMENTS_ONLY_PLACEHOLDER_TEXT,
          attachments: [
            {
              ...makeImageAttachment("att-image-1"),
              path: "/workspace/photo-1.jpg",
              thumbnailStoragePath: "/workspace/photo-1.jpg.thumb.webp"
            },
            {
              ...makeImageAttachment("att-image-2"),
              path: "/workspace/photo-2.jpg",
              thumbnailStoragePath: "/workspace/photo-2.jpg.thumb.webp"
            }
          ]
        })}
      />
    );

    const imageButtons = screen.getAllByRole("button");
    fireEvent.click(imageButtons[0]!);

    const lightbox = screen.getByTestId("mock-image-lightbox");
    expect(lightbox).toHaveAttribute(
      "data-src",
      "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fphoto-1.jpg"
    );
    expect(lightbox).toHaveAttribute("data-gallery-count", "2");
    expect(lightbox).toHaveAttribute("data-current-index", "0");
    expect(imageLightboxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        open: true,
        src: "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fphoto-1.jpg",
        galleryItems: [
          expect.objectContaining({
            src: "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fphoto-1.jpg"
          }),
          expect.objectContaining({
            src: "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fphoto-2.jpg"
          })
        ],
        currentIndex: 0,
        onNavigate: expect.any(Function)
      })
    );
  });

  it("uses path download URLs when an attachment is linked to workspace storage", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeUserMessage("committed", {
          attachments: [
            {
              ...makeImageAttachment("att-file-path"),
              attachmentType: "document",
              originalFilename: "spec.pdf",
              mimeType: "application/pdf",
              path: "/workspace/spec.pdf",
              thumbnailStoragePath: null,
              posterStoragePath: null
            }
          ]
        })}
      />
    );

    expect(screen.getByRole("link", { name: /spec\.pdf/i })).toHaveAttribute(
      "href",
      "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fspec.pdf&download=1"
    );
  });

  it("keeps history-loaded path attachments downloadable after refresh", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeUserMessage("committed", {
          attachments: [
            {
              id: "persisted-att-1",
              path: "/workspace/after-refresh.pdf",
              thumbnailStoragePath: null,
              posterStoragePath: null,
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
      "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fafter-refresh.pdf&download=1"
    );
  });

  it("renders a quiet secondary PPTX action for PDF presentation attachments", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeUserMessage("committed", {
          attachments: [
            {
              id: "presentation-pdf-1",
              path: "/workspace/board-deck.pdf",
              thumbnailStoragePath: null,
              posterStoragePath: null,
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
                outputFormat: "pdf",
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
      "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fboard-deck.pdf&download=1"
    );
    const pptxButton = screen.getByRole("button", {
      name: /presentationDownloadPptxAction|Download PPTX|Скачать PPTX/i
    });
    expect(pptxButton).toBeInTheDocument();
  });

  it("renders the PPTX action when descriptorMode marks a presentation even if documentType is missing", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeUserMessage("committed", {
          attachments: [
            {
              id: "presentation-pdf-2",
              path: "/workspace/school-deck.pdf",
              thumbnailStoragePath: null,
              posterStoragePath: null,
              attachmentType: "document",
              originalFilename: "school-deck.pdf",
              mimeType: "application/pdf",
              sizeBytes: 4096,
              processingStatus: "ready",
              documentLink: {
                docId: "doc-presentation-2",
                versionId: "version-presentation-2",
                versionNumber: 1,
                descriptorMode: "create_presentation",
                documentType: null,
                outputFormat: "pdf",
                documentStatus: "ready",
                versionStatus: "ready",
                isCurrentOutput: true
              },
              createdAt: "2026-05-18T11:30:00.000Z"
            }
          ]
        })}
      />
    );

    expect(
      screen.getByRole("button", {
        name: /presentationDownloadPptxAction|Download PPTX|Скачать PPTX/i
      })
    ).toBeInTheDocument();
  });

  it("does not render a fallback download link when a committed file lacks path", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeUserMessage("committed", {
          attachments: [
            {
              ...makeImageAttachment("att-without-path"),
              attachmentType: "document",
              originalFilename: "legacy.pdf",
              mimeType: "application/pdf",
              path: null,
              thumbnailStoragePath: null,
              posterStoragePath: null
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
        chatId="chat-1"
        message={makeUserMessage("committed", {
          attachments: [
            {
              ...makeImageAttachment("att-deleted-file"),
              attachmentType: "document",
              originalFilename: "deleted.pdf",
              mimeType: "application/pdf",
              path: null,
              thumbnailStoragePath: null,
              posterStoragePath: null,
              unavailable: true
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

describe("ChatMessageBubble — video attachment preview", () => {
  it("renders a deterministic premium play placeholder before metadata or frames load", () => {
    const { container } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeUserMessage("committed", {
          content: ATTACHMENTS_ONLY_PLACEHOLDER_TEXT,
          attachments: [makeVideoAttachment("video-att-1")]
        })}
      />
    );

    expect(screen.getByRole("button", { name: "openVideo" })).toBeInTheDocument();
    expect(screen.getByTestId("chat-video-preview-placeholder")).toBeInTheDocument();
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("data-preview-frame-ready", "false");
    expect(screen.queryByText("clip.mp4")).toBeNull();
  });

  it("opens the video lightbox through the existing card click path", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeUserMessage("committed", {
          content: ATTACHMENTS_ONLY_PLACEHOLDER_TEXT,
          attachments: [makeVideoAttachment("video-att-2")]
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "openVideo" }));

    const lightbox = screen.getByTestId("mock-image-lightbox");
    expect(lightbox).toHaveAttribute(
      "data-src",
      "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fclip.mp4"
    );
    expect(lightbox).toHaveAttribute(
      "data-download-url",
      "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fclip.mp4&download=1"
    );
    expect(lightbox).toHaveAttribute("data-filename", "clip.mp4");
    expect(lightbox).toHaveAttribute("data-media-type", "video");
    expect(imageLightboxMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: true,
        src: "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fclip.mp4",
        mediaType: "video"
      })
    );
  });

  it("updates the compact duration label and preview geometry after metadata loads", () => {
    const { container } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeUserMessage("committed", {
          content: ATTACHMENTS_ONLY_PLACEHOLDER_TEXT,
          attachments: [makeVideoAttachment("video-att-3")]
        })}
      />
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (video === null) {
      throw new Error("Expected inline video metadata element to render.");
    }
    defineVideoIntrinsicFrame(video, { width: 720, height: 1280, duration: 65 });

    fireEvent.loadedMetadata(video);

    expect(screen.getByText("1:05")).toBeInTheDocument();
    expect(screen.getByTestId("chat-video-preview-placeholder")).toHaveAttribute(
      "data-aspect-ratio",
      "0.7190"
    );
    expect(screen.getByTestId("chat-video-preview-placeholder")).toHaveAttribute(
      "data-preset",
      "portrait"
    );
  });

  it("uses a stable square preset for near-square videos", () => {
    const { container } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeUserMessage("committed", {
          content: ATTACHMENTS_ONLY_PLACEHOLDER_TEXT,
          attachments: [makeVideoAttachment("video-att-square")]
        })}
      />
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (video === null) {
      throw new Error("Expected inline video metadata element to render.");
    }
    defineVideoIntrinsicFrame(video, { width: 1024, height: 1024 });

    fireEvent.loadedMetadata(video);

    expect(screen.getByTestId("chat-video-preview-placeholder")).toHaveAttribute(
      "data-preset",
      "square"
    );
    expect(screen.getByTestId("chat-video-preview-placeholder")).toHaveStyle({
      width: "151px",
      height: "151px"
    });
  });

  it("reveals the real inline video frame only on safe browser surfaces", () => {
    mockCanvasVideoThumbnail();
    const { container } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeUserMessage("committed", {
          content: ATTACHMENTS_ONLY_PLACEHOLDER_TEXT,
          attachments: [makeVideoAttachment("video-att-4")]
        })}
      />
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (video === null) {
      throw new Error("Expected inline video metadata element to render.");
    }
    defineVideoIntrinsicFrame(video, { width: 720, height: 1280 });

    expect(video).toHaveAttribute("data-preview-frame-ready", "false");
    expect(video).toHaveAttribute("data-inline-frame-surface", "enabled");
    expect(screen.getByTestId("chat-video-preview-placeholder")).toHaveAttribute(
      "data-thumbnail-ready",
      "true"
    );
    fireEvent.loadedData(video);
    expect(video).toHaveAttribute("data-preview-frame-ready", "true");
    expect(video).toHaveClass("opacity-100");
    expect(screen.getByTestId("chat-video-preview-placeholder")).toHaveAttribute(
      "data-thumbnail-ready",
      "true"
    );
    expect(screen.getByTestId("chat-video-preview-thumbnail")).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,thumbnail"
    );
  });

  it("shows a real canvas thumbnail while keeping the native video surface hidden", () => {
    mockCanvasVideoThumbnail();
    (window as unknown as { PersaiNative?: unknown }).PersaiNative = {};
    const { container } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeUserMessage("committed", {
          content: ATTACHMENTS_ONLY_PLACEHOLDER_TEXT,
          attachments: [makeVideoAttachment("video-att-5")]
        })}
      />
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (video === null) {
      throw new Error("Expected inline video metadata element to render.");
    }
    defineVideoIntrinsicFrame(video, { width: 720, height: 1280 });

    fireEvent.loadedData(video);
    expect(video).toHaveAttribute("data-preview-frame-ready", "true");
    expect(video).toHaveAttribute("data-inline-frame-surface", "disabled");
    expect(video).toHaveClass("opacity-0");
    expect(screen.getByTestId("chat-video-preview-placeholder")).toHaveAttribute(
      "data-thumbnail-ready",
      "true"
    );
    expect(screen.getByTestId("chat-video-preview-thumbnail")).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,thumbnail"
    );
  });
});

describe("ChatMessageBubble — pre-response status", () => {
  it("shows thinking before the first assistant token", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage()}
        preResponseStatus={{ kind: "thinking" }}
      />
    );

    expect(screen.getByText("preResponseThinking")).toBeInTheDocument();
  });

  it("shows the live activity label while work is active before text starts", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage()}
        preResponseStatus={{
          kind: "activity",
          event: {
            id: "activity-1",
            type: "tool_use",
            label: "knowledge_search_finished"
          }
        }}
      />
    );

    expect(screen.getByText("activityKnowledgeSearchDone")).toBeInTheDocument();
  });

  it("keeps the inline cursor status below visible streaming text", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({ content: "Hello" })}
        preResponseStatus={{
          kind: "activity",
          event: {
            id: "activity-1",
            type: "tool_use",
            label: "knowledge_search_finished"
          }
        }}
      />
    );

    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("activityKnowledgeSearchDone")).toBeInTheDocument();
  });

  it("keeps an empty inline cursor while assistant text is streaming without activity", () => {
    render(
      <ChatMessageBubble chatId="chat-1" message={makeAssistantMessage({ content: "Hello" })} />
    );

    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByTestId("streaming-cursor")).toBeInTheDocument();
    expect(screen.queryByText("preResponseThinking")).not.toBeInTheDocument();
  });

  it("shows only the empty cursor while text deltas are active even with prior activity", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({ content: "Hello", streamingTextActive: true })}
        preResponseStatus={{
          kind: "activity",
          event: {
            id: "activity-1",
            type: "tool_use",
            label: "knowledge_search_finished"
          }
        }}
      />
    );

    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByTestId("streaming-cursor")).toBeInTheDocument();
    expect(screen.queryByText("activityKnowledgeSearchDone")).not.toBeInTheDocument();
  });

  it("renders table working notes inline as content blocks without a process badge", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Финал.",
          workingNotes: ["Текст 1\n| col | col |\n|---|---|\n| a | b |\n| c | d |"]
        })}
      />
    );

    expect(screen.getByText(/Текст 1/)).toBeInTheDocument();
    expect(screen.getByText(/\| col \| col \|/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Выполнено|Найдено|Прочитано/ })).toBeNull();
    expect(screen.getByText("Финал.")).toBeInTheDocument();
  });

  it("renders list working notes with at least three items inline as content", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Финал.",
          workingNotes: ["1. step\n2. step\n3. step"]
        })}
      />
    );

    expect(screen.getByText(/1\. step/)).toBeInTheDocument();
    expect(screen.getByText(/2\. step/)).toBeInTheDocument();
    expect(screen.getByText(/3\. step/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Выполнено/ })).toBeNull();
  });

  it("renders heading working notes inline as content", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Финал.",
          workingNotes: ["## Title\nbody"]
        })}
      />
    );

    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Выполнено/ })).toBeNull();
  });

  it("groups only short connective working notes into one process badge", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          workingNotes: ["сейчас", "готово", "продолжаю"]
        })}
      />
    );

    expect(screen.getByRole("button", { name: "Выполнено · 3 шага" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.queryByText("сейчас")).not.toBeInTheDocument();
    expect(screen.getByText("Готово.")).toBeInTheDocument();
  });

  it("groups tools without text into a search process badge", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          toolInvocations: [
            { name: "web_search", iteration: 0, ok: true },
            { name: "web_search", iteration: 0, ok: true }
          ]
        })}
      />
    );

    expect(screen.getByRole("button", { name: "Найдено · 2 источника" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  it("preserves order for mixed connective text, content, then connective text plus tool", () => {
    const { container } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Итог.",
          workingNotes: ["сейчас", "## Content Title\nbody", "продолжаю"],
          toolInvocations: [{ name: "web_fetch", iteration: 2, ok: true }]
        })}
      />
    );

    const badge = screen.getByRole("button", { name: "Выполнено · 3 шага" });
    const contentTitle = screen.getByText("Content Title");

    expect(
      badge.compareDocumentPosition(contentTitle) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Выполнено ·/ })).toHaveLength(1);
    expect(container).toHaveTextContent("Итог.");
  });

  it("skips empty working notes between tools and groups only tool pieces", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          workingNotes: ["", ""],
          toolInvocations: [
            { name: "web_fetch", iteration: 0, ok: true },
            { name: "web_fetch", iteration: 1, ok: true }
          ]
        })}
      />
    );

    expect(screen.getByRole("button", { name: "Прочитано · 2 страницы" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Выполнено/ })).toBeNull();
  });

  it("always renders the final answer text inline even when it is short", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "ок",
          workingNotes: ["сейчас"]
        })}
      />
    );

    expect(screen.getByRole("button", { name: "Выполнено · 1 шаг" })).toBeInTheDocument();
    expect(screen.getByText("ок")).toBeInTheDocument();
  });

  it("expands a process badge to show text and tool rows", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          workingNotes: ["сейчас"],
          toolInvocations: [{ name: "web_fetch", iteration: 0, ok: false }]
        })}
      />
    );

    const badge = screen.getByRole("button", { name: "Выполнено · 2 шага" });
    expect(screen.queryByText("сейчас")).not.toBeInTheDocument();
    expect(screen.queryByText(/web fetch/)).not.toBeInTheDocument();

    fireEvent.click(badge);

    expect(badge).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("сейчас")).toBeInTheDocument();
    expect(screen.getByText(/web fetch \(failed\)/)).toBeInTheDocument();
  });

  it("renders only final text for an empty assistant message body with no working notes or tools", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Только ответ."
        })}
      />
    );

    expect(screen.getByText("Только ответ.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Выполнено|Найдено|Прочитано/ })).toBeNull();
  });

  it("streaming mode preserves per-iter ordering", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "Итог.",
          workingNotes: ["связка1", "## Content Title\nbody", "связка2"],
          toolInvocations: [{ name: "web_fetch", iteration: 2, ok: true }]
        })}
      />
    );

    const firstBadge = screen.getByRole("button", { name: "Выполнено · 1 шаг" });
    const contentTitle = screen.getByText("Content Title");
    const secondBadge = screen.getByRole("button", { name: "Выполнено · 2 шага" });

    expect(
      firstBadge.compareDocumentPosition(contentTitle) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      contentTitle.compareDocumentPosition(secondBadge) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("committed mode collapses all process pieces into one top badge", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Итог.",
          workingNotes: ["связка1", "## Content Title\nbody", "связка2"],
          toolInvocations: [{ name: "web_fetch", iteration: 2, ok: true }]
        })}
      />
    );

    const badge = screen.getByRole("button", { name: "Выполнено · 3 шага" });
    const contentTitle = screen.getByText("Content Title");
    expect(screen.getAllByRole("button", { name: /Выполнено ·/ })).toHaveLength(1);
    expect(
      badge.compareDocumentPosition(contentTitle) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("committed badge label adapts to single tool type", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          toolInvocations: [
            { name: "knowledge_search", iteration: 0, ok: true },
            { name: "knowledge_search", iteration: 1, ok: true }
          ]
        })}
      />
    );

    expect(screen.getByRole("button", { name: "Найдено · 2 источника" })).toBeInTheDocument();
  });

  it("committed badge label falls back to worked when mixed tools", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          toolInvocations: [
            { name: "web_search", iteration: 0, ok: true },
            { name: "image_generate", iteration: 1, ok: true }
          ]
        })}
      />
    );

    expect(screen.getByRole("button", { name: "Выполнено · 2 шага" })).toBeInTheDocument();
  });

  it("image_edit gets editedImages label", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          toolInvocations: [{ name: "image_edit", iteration: 0, ok: true }]
        })}
      />
    );

    expect(screen.getByRole("button", { name: "Отредактировано · 1 изобр." })).toBeInTheDocument();
  });

  it("document gets preparedDocuments label", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          toolInvocations: [
            { name: "document", iteration: 0, ok: true },
            { name: "document", iteration: 1, ok: true }
          ]
        })}
      />
    );

    expect(screen.getByRole("button", { name: "Подготовлено · 2 документ" })).toBeInTheDocument();
  });

  it("shell gets ranCommands label", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          toolInvocations: [{ name: "shell", iteration: 0, ok: true }]
        })}
      />
    );

    expect(screen.getByRole("button", { name: "Запущено · 1 команда" })).toBeInTheDocument();
  });

  it("expand committed badge shows all pieces in chronological order", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          workingNotes: ["alpha", "beta"],
          toolInvocations: [
            { name: "web_fetch", iteration: 0, ok: true },
            { name: "image_generate", iteration: 1, ok: true }
          ]
        })}
      />
    );

    const badge = screen.getByRole("button", { name: "Выполнено · 4 шага" });
    fireEvent.click(badge);

    const alpha = screen.getByText("alpha");
    const webFetch = screen.getByText(/web fetch/);
    const beta = screen.getByText("beta");
    const imageGenerate = screen.getByText(/image generate/);
    expect(alpha.compareDocumentPosition(webFetch) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(webFetch.compareDocumentPosition(beta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      beta.compareDocumentPosition(imageGenerate) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  // ADR-125 follow-up: per-message engagement annotation moved to the chat
  // header subtitle. Process badges do not reintroduce skill/scenario text.
  it("never renders an engagement annotation in the process badge row", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Done.",
          workingNotes: ["Checking facts."]
        })}
      />
    );

    expect(screen.queryByTestId("engagement-annotation")).not.toBeInTheDocument();
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

describe("ChatMessageBubble — file attachment pill layout", () => {
  it("keeps file size on one line inside the pill", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeUserMessage("committed", {
          attachments: [
            {
              id: "att-word-1",
              path: "/workspace/report.docx",
              thumbnailStoragePath: null,
              posterStoragePath: null,
              attachmentType: "document",
              originalFilename: "Новый документ (3).docx",
              mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              sizeBytes: 22221,
              processingStatus: "ready",
              createdAt: "2026-05-02T10:00:00.000Z"
            }
          ]
        })}
      />
    );

    expect(screen.getByText("21.7 KB")).toHaveClass("whitespace-nowrap");

    const pill = screen.getByRole("link", { name: /Новый документ \(3\)\.docx/i });
    expect(pill).toHaveClass("max-w-[min(100%,320px)]");
    expect(pill).toHaveClass("w-fit");
  });
});
