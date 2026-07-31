import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forwardRef, type ReactEventHandler } from "react";
import { ChatMessageBubble, resolveInternalChatCta } from "./chat-message";
import type { ChatMessage } from "./use-chat";

const CHAT_SESSION_ROOT = "/workspace/assistants/assistant-1/sessions/runtime-session-1";

const imageLightboxMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: vi.fn().mockResolvedValue("test-token")
  })
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, number | string>) => {
    const n = typeof values?.n === "number" ? values.n : 0;
    const steps = typeof values?.steps === "number" ? values.steps : 0;
    const ruSteps = (count: number) =>
      count === 1 ? "шаг" : count >= 2 && count <= 4 ? "шага" : "шагов";
    const ruCommands = (count: number) =>
      count === 1 ? "команда" : count >= 2 && count <= 4 ? "команды" : "команд";
    const ruSearches = (count: number) =>
      count === 1 ? "поиск" : count >= 2 && count <= 4 ? "поиска" : "поисков";
    const ruPages = (count: number) =>
      count === 1 ? "страница" : count >= 2 && count <= 4 ? "страницы" : "страниц";
    const ruOps = (count: number) =>
      count === 1 ? "операция" : count >= 2 && count <= 4 ? "операции" : "операций";
    const ruUpdates = (count: number) =>
      count === 1 ? "обновление" : count >= 2 && count <= 4 ? "обновления" : "обновлений";
    const ruGens = (count: number) =>
      count === 1 ? "генерация" : count >= 2 && count <= 4 ? "генерации" : "генераций";
    const ruEdits = (count: number) =>
      count === 1 ? "правка" : count >= 2 && count <= 4 ? "правки" : "правок";
    const ruErrors = (count: number) =>
      count === 1 ? "ошибка" : count >= 2 && count <= 4 ? "ошибки" : "ошибок";
    const ruCards = (count: number) =>
      count === 1 ? "карточка" : count >= 2 && count <= 4 ? "карточки" : "карточек";
    const ruSources = (count: number) =>
      count === 1 ? "источник" : count >= 2 && count <= 4 ? "источника" : "источников";

    if (key === "processBadge.worked") {
      return `Выполнено · ${String(steps)} ${ruSteps(steps)}`;
    }
    if (key === "processBadge.exploredSearches") {
      return `Найдено · ${String(n)} ${ruSources(n)}`;
    }
    if (key === "processBadge.knowledgeFetches") {
      return `Прочитано · ${String(n)} ${ruCards(n)}`;
    }
    if (key === "processBadge.generatedImages") {
      return `Сгенерировано · ${String(n)} изобр.`;
    }
    if (key === "processBadge.editedImages") {
      return `Отредактировано · ${String(n)} изобр.`;
    }
    if (key === "processBadge.generatedVideos") {
      return `Сгенерировано · ${String(n)} видео`;
    }
    if (key === "processBadge.preparedDocuments") {
      return `Подготовлено · ${String(n)} документ`;
    }
    if (key === "processBadge.wroteFiles") {
      return `Записано · ${String(n)} файл`;
    }
    if (key === "processBadge.readFiles") {
      return `Прочитано · ${String(n)} файл`;
    }
    if (key === "processBadge.ranCommands") {
      return `Запущено · ${String(n)} ${ruCommands(n)}`;
    }
    if (key === "processBadge.readPages") {
      return `Прочитано · ${String(n)} ${ruPages(n)}`;
    }
    if (key === "processBadge.micro.browser") {
      return `В браузере · ${String(n)} ${ruSteps(n)}`;
    }
    if (key === "processBadge.micro.sandbox") {
      return `В песочнице · ${String(n)} ${ruCommands(n)}`;
    }
    if (key === "processBadge.micro.knowledgeSearch") {
      return `В знаниях · ${String(n)} ${ruSearches(n)}`;
    }
    if (key === "processBadge.micro.knowledgeFetch") {
      return `Прочитано из знаний · ${String(n)} ${ruCards(n)}`;
    }
    if (key === "processBadge.micro.webSearch") {
      return `В сети · ${String(n)} ${ruSearches(n)}`;
    }
    if (key === "processBadge.micro.webFetch") {
      return `Прочитано · ${String(n)} ${ruPages(n)}`;
    }
    if (key === "processBadge.micro.files") {
      return `Файлы · ${String(n)} ${ruOps(n)}`;
    }
    if (key === "processBadge.micro.workspaceSearch") {
      return `Поиск по файлам · ${String(n)} ${ruSteps(n)}`;
    }
    if (key === "processBadge.micro.todo") {
      return `План · ${String(n)} ${ruUpdates(n)}`;
    }
    if (key === "processBadge.micro.skill") {
      return `Навыки · ${String(n)} ${ruSteps(n)}`;
    }
    if (key === "processBadge.micro.imageGenerate") {
      return `Изображения · ${String(n)} ${ruGens(n)}`;
    }
    if (key === "processBadge.micro.imageEdit") {
      return `Изображения · ${String(n)} ${ruEdits(n)}`;
    }
    if (key === "processBadge.micro.videoGenerate") {
      return `Видео · ${String(n)} ${ruGens(n)}`;
    }
    if (key === "processBadge.micro.document") {
      return `Документы · ${String(n)} ${ruSteps(n)}`;
    }
    if (key === "processBadge.micro.memory") {
      return `Память · ${String(n)} ${ruSearches(n)}`;
    }
    if (key === "processBadge.micro.cron") {
      return `Расписание · ${String(n)} ${ruSteps(n)}`;
    }
    if (key === "processBadge.micro.message") {
      return `Сообщения · ${String(n)} ${ruSteps(n)}`;
    }
    if (key === "processBadge.micro.sessions") {
      return `Сессии · ${String(n)} ${ruSteps(n)}`;
    }
    if (key === "processBadge.micro.requestUserAction") {
      return `Запрос к тебе · ${String(n)} ${ruSteps(n)}`;
    }
    if (key === "processBadge.micro.other") {
      return `Другое · ${String(n)} ${ruSteps(n)}`;
    }
    if (key === "processBadge.micro.failedSuffix") {
      return ` · ${String(n)} ${ruErrors(n)}`;
    }
    if (key === "mediaReceiptImage") {
      return `🖼 Получено изображение — ${String(values?.detail ?? "")} (${String(values?.size ?? "")})`;
    }
    if (key === "mediaReceiptImageGeneration") {
      return "генерация";
    }
    if (key === "mediaReceiptVideo") {
      return `🎬 Получено видео (${String(values?.size ?? "")})`;
    }
    if (key === "mediaReceiptFile") {
      return `📎 Получен файл — ${String(values?.name ?? "")} (${String(values?.size ?? "")})`;
    }
    if (key === "mediaReceiptFileGeneric") {
      return "файл";
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
    className,
    onLoad
  }: {
    src: string;
    alt: string;
    className?: string;
    onLoad?: ReactEventHandler<HTMLImageElement>;
  }) => (
    <img
      data-testid="authenticated-attachment-image"
      src={src}
      alt={alt}
      className={className}
      onLoad={onLoad}
    />
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
  buildChatFileUrl: (input: {
    chatId: string;
    storagePath: string;
    download?: boolean;
    versionId?: string | null;
  }) =>
    `/api/v1/assistant/chats/web/${input.chatId}/files?path=${encodeURIComponent(input.storagePath)}${
      input.versionId ? `&versionId=${encodeURIComponent(input.versionId)}` : ""
    }${input.download ? "&download=1" : ""}`
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
    path: `${CHAT_SESSION_ROOT}/photo.jpg`,
    thumbnailStoragePath: `${CHAT_SESSION_ROOT}/photo.jpg.thumb.webp`,
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
    path: `${CHAT_SESSION_ROOT}/clip.mp4`,
    thumbnailStoragePath: null,
    posterStoragePath: `${CHAT_SESSION_ROOT}/clip.mp4.poster.jpg`,
    attachmentType: "video",
    originalFilename: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 4096,
    processingStatus: "ready",
    createdAt: "2026-06-07T10:00:00.000Z"
  };
}

function makeDocumentAttachment(id: string): NonNullable<ChatMessage["attachments"]>[number] {
  return {
    id,
    path: `${CHAT_SESSION_ROOT}/spec.pdf`,
    thumbnailStoragePath: null,
    posterStoragePath: null,
    attachmentType: "document",
    originalFilename: "spec.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2 * 1024 * 1024,
    processingStatus: "ready",
    createdAt: "2026-07-28T12:00:00.000Z"
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
    const previewFrame = screen.getByTestId("chat-image-preview");

    expect(bubble?.className).toContain("rounded-[18px]");
    expect(bubble?.className).toContain("rounded-br-md");
    expect(previewFrame.className).toContain("rounded-[14px]");
    expect(previewFrame.className).toContain("rounded-br-[10px]");
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
              path: `${CHAT_SESSION_ROOT}/photo-1.jpg`,
              thumbnailStoragePath: `${CHAT_SESSION_ROOT}/photo-1.jpg.thumb.webp`
            },
            {
              ...makeImageAttachment("att-image-2"),
              path: `${CHAT_SESSION_ROOT}/photo-2.jpg`,
              thumbnailStoragePath: `${CHAT_SESSION_ROOT}/photo-2.jpg.thumb.webp`
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
      "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fassistants%2Fassistant-1%2Fsessions%2Fruntime-session-1%2Fphoto-1.jpg"
    );
    expect(lightbox).toHaveAttribute("data-gallery-count", "2");
    expect(lightbox).toHaveAttribute("data-current-index", "0");
    expect(imageLightboxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        open: true,
        src: "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fassistants%2Fassistant-1%2Fsessions%2Fruntime-session-1%2Fphoto-1.jpg",
        galleryItems: [
          expect.objectContaining({
            src: "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fassistants%2Fassistant-1%2Fsessions%2Fruntime-session-1%2Fphoto-1.jpg"
          }),
          expect.objectContaining({
            src: "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fassistants%2Fassistant-1%2Fsessions%2Fruntime-session-1%2Fphoto-2.jpg"
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
              path: `${CHAT_SESSION_ROOT}/spec.pdf`,
              thumbnailStoragePath: null,
              posterStoragePath: null
            }
          ]
        })}
      />
    );

    expect(screen.getByRole("link", { name: /spec\.pdf/i })).toHaveAttribute(
      "href",
      "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fassistants%2Fassistant-1%2Fsessions%2Fruntime-session-1%2Fspec.pdf&download=1"
    );
  });

  it("renders visual attachments above file pills instead of mixing them into one stretched row", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeUserMessage("committed", {
          content: ATTACHMENTS_ONLY_PLACEHOLDER_TEXT,
          attachments: [
            {
              ...makeImageAttachment("att-mixed-image"),
              localPreviewUrl: "blob:mixed-image"
            },
            {
              id: "att-mixed-file",
              path: `${CHAT_SESSION_ROOT}/spec.pdf`,
              thumbnailStoragePath: null,
              posterStoragePath: null,
              attachmentType: "document",
              originalFilename: "spec.pdf",
              mimeType: "application/pdf",
              sizeBytes: 2048,
              processingStatus: "ready",
              createdAt: "2026-07-09T00:00:00.000Z"
            }
          ]
        })}
      />
    );

    const visualsRow = screen.getByTestId("attachment-strip-visuals");
    const filesRow = screen.getByTestId("attachment-strip-files");
    expect(
      visualsRow.compareDocumentPosition(filesRow) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(filesRow).toContainElement(screen.getByRole("link", { name: /spec\.pdf/i }));
    expect(visualsRow).toContainElement(screen.getByTestId("chat-image-preview"));
  });

  it("suppresses a duplicate previewable file pill when the same image asset is already shown", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeUserMessage("committed", {
          content: ATTACHMENTS_ONLY_PLACEHOLDER_TEXT,
          attachments: [
            {
              ...makeImageAttachment("att-dup-image"),
              path: `${CHAT_SESSION_ROOT}/persai-dev.png`,
              thumbnailStoragePath: `${CHAT_SESSION_ROOT}/persai-dev.png.thumb.webp`,
              originalFilename: "persai-dev.png",
              mimeType: "image/png"
            },
            {
              id: "att-dup-file",
              path: `${CHAT_SESSION_ROOT}/persai-dev.png`,
              thumbnailStoragePath: null,
              posterStoragePath: null,
              attachmentType: "document",
              originalFilename: "persai-dev.png",
              mimeType: "image/png",
              sizeBytes: 388 * 1024,
              processingStatus: "ready",
              createdAt: "2026-07-09T00:00:00.000Z"
            }
          ]
        })}
      />
    );

    expect(screen.getAllByTestId("chat-image-preview")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: /persai-dev\.png/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("attachment-strip-files")).not.toBeInTheDocument();
  });

  it("keeps history-loaded path attachments downloadable after refresh", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeUserMessage("committed", {
          attachments: [
            {
              id: "persisted-att-1",
              path: `${CHAT_SESSION_ROOT}/after-refresh.pdf`,
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
      "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fassistants%2Fassistant-1%2Fsessions%2Fruntime-session-1%2Fafter-refresh.pdf&download=1"
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
              path: `${CHAT_SESSION_ROOT}/board-deck.pdf`,
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
      "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fassistants%2Fassistant-1%2Fsessions%2Fruntime-session-1%2Fboard-deck.pdf&download=1"
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
              path: `${CHAT_SESSION_ROOT}/school-deck.pdf`,
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
      "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fassistants%2Fassistant-1%2Fsessions%2Fruntime-session-1%2Fclip.mp4"
    );
    expect(lightbox).toHaveAttribute(
      "data-download-url",
      "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fassistants%2Fassistant-1%2Fsessions%2Fruntime-session-1%2Fclip.mp4&download=1"
    );
    expect(lightbox).toHaveAttribute("data-filename", "clip.mp4");
    expect(lightbox).toHaveAttribute("data-media-type", "video");
    expect(imageLightboxMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: true,
        src: "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fassistants%2Fassistant-1%2Fsessions%2Fruntime-session-1%2Fclip.mp4",
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
    const status = screen.getByTestId("inline-streaming-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("exposes compact activity status as a polite live region without wrapping the transcript", () => {
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

    const status = screen.getByTestId("inline-streaming-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    // Bounded rail only — transcript answer container is not a live region.
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
  });

  it("shows live thinking full-width under Думаю with newest text kept in view", () => {
    const longThought = Array.from({ length: 40 }, (_, i) => `word${String(i)}`).join(" ");
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage()}
        preResponseStatus={{ kind: "thinking", thinkingPreview: longThought }}
      />
    );

    expect(screen.getByText("preResponseThinking")).toBeInTheDocument();
    const preview = screen.getByTestId("live-thinking-preview");
    expect(preview).toHaveClass("w-full");
    expect(preview).not.toHaveClass("max-w-[min(28rem,70vw)]");
    // Compact ~4-line bound while thought exists — no permanent empty reserve.
    expect(preview.className).toMatch(/max-h-\[5rem\]/);
    expect(preview.className).not.toMatch(/min-h-\[8\.75rem\]/);
    // Top-first rail (not justify-end on the outer slot) — short text under status.
    expect(preview).not.toHaveClass("justify-end");
    expect(preview.textContent).toContain("word39");
  });

  it("does not render the live-thinking rail before the first thought token arrives", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage()}
        preResponseStatus={{ kind: "thinking" }}
      />
    );

    expect(screen.getByText("preResponseThinking")).toBeInTheDocument();
    expect(screen.queryByTestId("live-thinking-preview")).not.toBeInTheDocument();
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
    // No empty live-thinking rail during activity when there is no thought text.
    expect(screen.queryByTestId("live-thinking-preview")).not.toBeInTheDocument();
  });

  it("places shell progress immediately under the activity label without an empty rail", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage()}
        preResponseStatus={{
          kind: "activity",
          event: {
            id: "activity-shell-1",
            type: "tool_use",
            label: "shell_started",
            shellCommand: "npm test",
            shellProgressLines: ["Collecting requests", "Running suite"]
          }
        }}
      />
    );

    expect(screen.getByText("activityShellStart")).toBeInTheDocument();
    expect(screen.getByText("Collecting requests")).toBeInTheDocument();
    expect(screen.getByText("Running suite")).toBeInTheDocument();
    expect(screen.queryByTestId("live-thinking-preview")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/min-h-\[8\.75rem\]/);
  });

  it("fades thinking text then removes the empty rail when switching to activity", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage()}
        preResponseStatus={{ kind: "thinking", thinkingPreview: "planning next step" }}
      />
    );

    const preview = screen.getByTestId("live-thinking-preview");
    expect(preview.textContent).toContain("planning next step");
    expect(preview.className).not.toMatch(/min-h-\[8\.75rem\]/);
    expect(preview.className).toMatch(/max-h-\[5rem\]/);

    rerender(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage()}
        preResponseStatus={{
          kind: "activity",
          event: {
            id: "activity-1",
            type: "tool_use",
            label: "shell_started",
            shellProgressLines: ["pip install deps"]
          }
        }}
      />
    );

    expect(screen.getByText("activityShellStart")).toBeInTheDocument();
    expect(screen.getByText("pip install deps")).toBeInTheDocument();
    // Short fade retains thought text briefly without a permanent empty reserve.
    expect(screen.getByTestId("live-thinking-preview").textContent).toContain("planning next step");

    act(() => {
      vi.advanceTimersByTime(220);
    });

    expect(screen.queryByTestId("live-thinking-preview")).not.toBeInTheDocument();
    expect(screen.getByText("pip install deps")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/min-h-\[8\.75rem\]/);
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
    expect(document.body.innerHTML).not.toMatch(/min-h-\[8\.75rem\]/);
  });

  it("does not reserve empty height for the cursor-only pre-answer path", () => {
    render(<ChatMessageBubble chatId="chat-1" message={makeAssistantMessage()} />);

    expect(screen.getByTestId("streaming-cursor")).toBeInTheDocument();
    expect(screen.queryByTestId("live-thinking-preview")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/min-h-\[8\.75rem\]/);
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

  function expandProcessBadge(name: string | RegExp = /Выполнено|Сгенерировано|Подготовлено/) {
    const badge = screen.getByRole("button", { name });
    // Rerenders can reuse ProcessBadge state; only click when collapsed.
    if (badge.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(badge);
    }
    return badge;
  }

  it("ADR-167: committed reply folds delivery receipts into Выполнено; terminal strip stays below", () => {
    const image = {
      ...makeImageAttachment("att-inline-1"),
      inlineAfterToolCallId: "call-img-1",
      sizeBytes: 1024 * 1024
    };
    const { container } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Вот картинка.",
          workingNotes: ["сейчас"],
          toolInvocations: [
            { name: "image_generate", iteration: 0, ok: true, toolCallId: "call-img-1" }
          ],
          inlineMediaPlacement: [{ toolCallId: "call-img-1", attachmentIds: ["att-inline-1"] }],
          attachments: [image]
        })}
      />
    );

    expect(screen.getAllByRole("button", { name: /Выполнено|Сгенерировано/ })).toHaveLength(1);
    // Collapsed: no outside receipt banners — attachments already show below.
    expect(screen.queryByTestId("media-receipt-lines")).toBeNull();
    expect(screen.queryByTestId("process-timeline-receipts")).toBeNull();
    expandProcessBadge();
    const folded = screen.getByTestId("process-timeline-receipts");
    expect(folded).toHaveTextContent(/Получено изображение.*генерация.*1\.0 MB/);
    expect(within(folded).getByTestId("media-receipt-lines")).toBeVisible();
    const strips = screen.getAllByTestId("attachment-strip");
    expect(strips).toHaveLength(1);
    expect(container.querySelector('img[alt="photo.jpg"]')).not.toBeNull();
    expect(
      screen.getByText("Вот картинка.").compareDocumentPosition(strips[0] as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("ADR-167: live USER_TURN shows note+receipt stream before the true answer text, not under badge", () => {
    const image = {
      ...makeImageAttachment("att-inline-1"),
      inlineAfterToolCallId: "call-img-1",
      sizeBytes: 1024 * 1024
    };
    // Raw live content is the cumulative provider stream: the note prefix
    // ("сейчас") plus the genuine post-tool-loop answer that follows it.
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "сейчас Пишу итоговый ответ.",
          workingNotes: ["сейчас"],
          toolInvocations: [
            { name: "image_generate", iteration: 0, ok: true, toolCallId: "call-img-1" }
          ],
          inlineMediaPlacement: [{ toolCallId: "call-img-1", attachmentIds: ["att-inline-1"] }],
          attachments: [image]
        })}
      />
    );

    expect(screen.queryAllByTestId("attachment-strip")).toHaveLength(0);
    const stream = screen.getByTestId("process-live-note-receipt-stream");
    expect(stream).toHaveAttribute("role", "status");
    expect(stream).toHaveAttribute("aria-live", "polite");
    expect(stream).toHaveAttribute("aria-relevant", "additions");
    expect(stream).toHaveTextContent(/сейчас/);
    expect(stream).toHaveTextContent(/Получено изображение.*генерация.*1\.0 MB/);
    expect(stream.textContent).toMatch(/сейчас[\s\S]*Получено изображение/);
    expect(screen.queryByTestId("process-timeline-receipts")).toBeNull();
    const badge = screen.getByRole("button", { name: /Выполнено|Сгенерировано/ });
    // Live stream must not sit under the process badge above streamed replicas.
    expect(badge.contains(stream)).toBe(false);
    // The note prefix is stripped from live content — only the genuine
    // post-tool-loop answer renders as content, and it must follow the
    // note+receipt stream (the raw note text stays inside the stream only,
    // it is not duplicated as answer text below).
    const answer = screen.getByText("Пишу итоговый ответ.");
    expect(stream.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const cursor = screen.getByTestId("streaming-cursor");
    expect(answer.compareDocumentPosition(cursor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("ADR-167: strips the raw workingNotes prefix from live content so answer text never duplicates notes", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          // Raw cumulative stream: note 1 + note 2 + the real answer, with no
          // reset between tool-loop iterations (matches production content).
          content: "Готовлю генерацию.Генерация: круг.Итоговый ответ готов.",
          workingNotes: ["Готовлю генерацию.", "Генерация: круг."]
        })}
      />
    );

    // Only the genuine post-tool-loop remainder renders as answer text.
    expect(screen.getByText("Итоговый ответ готов.")).toBeInTheDocument();
    expect(screen.queryByText(/^Готовлю генерацию\.Генерация/)).toBeNull();
    const stream = screen.getByTestId("process-live-note-receipt-stream");
    expect(stream).toHaveTextContent("Готовлю генерацию.");
    expect(stream).toHaveTextContent("Генерация: круг.");
  });

  it("ADR-167: live content matching no workingNotes prefix renders unchanged (safe fallback)", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          // workingNotes text was corrected/edited and no longer matches the
          // raw stream exactly — must not swallow any text.
          content: "Другой текст, не совпадающий с заметками.",
          workingNotes: ["Заметка, которой нет в content."]
        })}
      />
    );

    expect(screen.getByText("Другой текст, не совпадающий с заметками.")).toBeInTheDocument();
  });

  it("ADR-167: live receipt banner opens the received image in the lightbox", () => {
    const image = {
      ...makeImageAttachment("att-open-1"),
      inlineAfterToolCallId: "call-img-1",
      sizeBytes: 1024 * 1024
    };
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "",
          toolInvocations: [
            { name: "image_generate", iteration: 0, ok: true, toolCallId: "call-img-1" }
          ],
          inlineMediaPlacement: [{ toolCallId: "call-img-1", attachmentIds: ["att-open-1"] }],
          attachments: [image]
        })}
      />
    );

    fireEvent.click(screen.getByTestId("media-receipt-open-att-open-1"));
    const lightbox = screen.getByTestId("mock-image-lightbox");
    expect(lightbox).toHaveAttribute(
      "data-src",
      "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fassistants%2Fassistant-1%2Fsessions%2Fruntime-session-1%2Fphoto.jpg"
    );
  });

  it("ADR-167: live receipt banner downloads a received document", () => {
    const document = {
      ...makeDocumentAttachment("att-dl-1"),
      inlineAfterToolCallId: "call-doc-1"
    };
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "",
          toolInvocations: [
            { name: "document_render", iteration: 0, ok: true, toolCallId: "call-doc-1" }
          ],
          inlineMediaPlacement: [{ toolCallId: "call-doc-1", attachmentIds: ["att-dl-1"] }],
          attachments: [document]
        })}
      />
    );

    expect(screen.getByTestId("media-receipt-download-att-dl-1")).toHaveAttribute(
      "href",
      "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fassistants%2Fassistant-1%2Fsessions%2Fruntime-session-1%2Fspec.pdf&download=1"
    );
  });

  it("ADR-167: receipt banner stays non-clickable when the attachment has no path yet", () => {
    const image = {
      ...makeImageAttachment("att-no-path"),
      path: null,
      thumbnailStoragePath: null,
      inlineAfterToolCallId: "call-img-1",
      sizeBytes: 1024 * 1024
    };
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "",
          toolInvocations: [
            { name: "image_generate", iteration: 0, ok: true, toolCallId: "call-img-1" }
          ],
          inlineMediaPlacement: [{ toolCallId: "call-img-1", attachmentIds: ["att-no-path"] }],
          attachments: [image]
        })}
      />
    );

    expect(screen.getByTestId("media-receipt-open-att-no-path")).toBeDisabled();
    expect(screen.queryByTestId("mock-image-lightbox")).toBeNull();
  });

  it("ADR-167: delivery receipts survive live to committed and terminal strip appears only after commit", () => {
    const image = {
      ...makeImageAttachment("att-live-commit-1"),
      inlineAfterToolCallId: "call-img-1",
      sizeBytes: 1024 * 1024
    };
    const { rerender } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "",
          workingNotes: ["сейчас"],
          toolInvocations: [
            { name: "image_generate", iteration: 0, ok: true, toolCallId: "call-img-1" }
          ],
          inlineMediaPlacement: [
            { toolCallId: "call-img-1", attachmentIds: ["att-live-commit-1"] }
          ],
          attachments: [image]
        })}
      />
    );

    const liveStream = screen.getByTestId("process-live-note-receipt-stream");
    expect(liveStream).toHaveTextContent(/Получено изображение.*генерация.*1\.0 MB/);
    expect(screen.queryByTestId("attachment-strip")).toBeNull();
    expect(liveStream).toHaveAttribute("role", "status");
    expect(liveStream).toHaveAttribute("aria-live", "polite");

    rerender(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          workingNotes: ["сейчас"],
          toolInvocations: [
            { name: "image_generate", iteration: 0, ok: true, toolCallId: "call-img-1" }
          ],
          inlineMediaPlacement: [
            { toolCallId: "call-img-1", attachmentIds: ["att-live-commit-1"] }
          ],
          attachments: [image]
        })}
      />
    );

    // After commit, note+receipt stream folds into collapsed Выполнено; strip below.
    expect(screen.queryByTestId("process-live-note-receipt-stream")).toBeNull();
    expect(screen.queryByTestId("media-receipt-lines")).toBeNull();
    expect(screen.getByTestId("attachment-strip")).toBeInTheDocument();
    expandProcessBadge();
    const folded = screen.getByTestId("process-timeline-receipts");
    expect(folded).toHaveTextContent(/Получено изображение.*генерация.*1\.0 MB/);
    expect(folded).not.toHaveAttribute("role");
  });

  it("ADR-167: delivery order follows tool chronology inside the note+receipt stream", () => {
    const pdf = {
      ...makeDocumentAttachment("att-pdf-1"),
      originalFilename: "test-report.pdf",
      sizeBytes: 7680
    };
    const image = {
      ...makeImageAttachment("att-img-1"),
      sizeBytes: 778240
    };
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          workingNotes: ["сейчас"],
          toolInvocations: [
            { name: "document", iteration: 0, ok: true, toolCallId: "call-doc-1" },
            { name: "image_generate", iteration: 1, ok: true, toolCallId: "call-img-1" }
          ],
          inlineMediaPlacement: [
            { toolCallId: "call-doc-1", attachmentIds: ["att-pdf-1"] },
            { toolCallId: "call-img-1", attachmentIds: ["att-img-1"] }
          ],
          attachments: [pdf, image]
        })}
      />
    );

    expect(screen.queryByTestId("media-receipt-lines")).toBeNull();
    expandProcessBadge();
    const stream = screen.getByTestId("process-timeline-receipts");
    expect(stream.textContent).toMatch(
      /Получен файл — test-report\.pdf[\s\S]*Получено изображение — генерация/
    );
  });

  it("suppresses a live continuation strip until terminal commit", () => {
    const image = {
      ...makeImageAttachment("att-catchup-1"),
      sizeBytes: 1024 * 1024
    };
    const { container } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "",
          workingNotes: ["догоняю"],
          toolInvocations: [
            { name: "image_generate", iteration: 0, ok: true, toolCallId: "call-img-1" }
          ],
          inlineMediaPlacement: [{ toolCallId: "call-img-1", attachmentIds: ["att-catchup-1"] }],
          attachments: [image]
        })}
      />
    );

    expect(screen.getByTestId("process-live-note-receipt-stream")).toHaveTextContent(
      /Получено изображение.*генерация.*1\.0 MB/
    );
    expect(screen.queryByTestId("attachment-strip")).toBeNull();
    expect(screen.getByTestId("streaming-cursor")).toBeInTheDocument();
    expect(container.querySelector('img[alt="photo.jpg"]')).toBeNull();
  });

  it("ADR-165: live USER_TURN shows orphan media receipts when placement is missing", () => {
    const image = {
      ...makeImageAttachment("att-orphan-1"),
      sizeBytes: 1024 * 1024
    };
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "",
          workingNotes: ["жду"],
          toolInvocations: [
            { name: "image_generate", iteration: 0, ok: true, toolCallId: "call-img-1" }
          ],
          attachments: [image]
        })}
      />
    );

    expect(screen.queryByTestId("attachment-strip")).toBeNull();
    // The narrated note ("жду") never bound to this receipt's tool call, so
    // it is unclaimed — but no final answer text has started yet (`content`
    // is empty), so it renders inline in the ordinary note/receipt stream at
    // its frozen arrival position, not shunted into a separate after-answer
    // stream (that stream is reserved for the narrower case where the
    // receipt arrives *after* answer text already started — see the
    // dedicated regression test below).
    const stream = screen.getByTestId("process-live-note-receipt-stream");
    expect(stream).toHaveTextContent("жду");
    expect(stream).toHaveTextContent(/Получено изображение.*генерация.*1\.0 MB/);
    expect(screen.queryByTestId("process-live-unclaimed-receipt-stream")).toBeNull();
  });

  it("regression: an unclaimed receipt that arrives mid-tool-loop does not ride the live cursor as later notes stream in", () => {
    // Live repro (persai.dev, 2026-07-31, founder screenshot): the receipt
    // rendered correctly right after the note that was live when it
    // arrived, but then kept "sliding down" to stay glued just above
    // whatever note/status was currently live, as each *later* note
    // streamed in — because the old design appended every unclaimed receipt
    // after whatever notes were known *at render time*, recomputed fresh on
    // every render. This asserts the receipt settles once, between the note
    // that was live when it arrived and the very next note, and does not
    // move as later notes are appended.
    const image = {
      ...makeImageAttachment("att-riding-1"),
      sizeBytes: 1024 * 1024
    };
    const baseMessage = makeAssistantMessage({
      status: "streaming",
      content: "",
      toolInvocations: [
        { name: "image_generate", iteration: 0, ok: true, toolCallId: "call-img-1" }
      ],
      attachments: [image]
    });

    const { rerender } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={{
          ...baseMessage,
          workingNotes: ["Генерирую жёлтый круг.", "Изображение готово."]
        }}
      />
    );
    const streamBeforeMoreNotes = screen.getByTestId("process-live-note-receipt-stream");
    const notesBefore = Array.from(streamBeforeMoreNotes.children).map((node) => node.textContent);
    const receiptIndexBefore = notesBefore.findIndex((text) =>
      /Получено изображение/.test(text ?? "")
    );
    expect(receiptIndexBefore).toBe(2); // right after "Изображение готово." (index 1)

    // Two more notes stream in after the receipt already arrived.
    rerender(
      <ChatMessageBubble
        chatId="chat-1"
        message={{
          ...baseMessage,
          workingNotes: [
            "Генерирую жёлтый круг.",
            "Изображение готово.",
            "Формирую PDF.",
            "Готовлю документ."
          ]
        }}
      />
    );
    const streamAfterMoreNotes = screen.getByTestId("process-live-note-receipt-stream");
    const notesAfter = Array.from(streamAfterMoreNotes.children).map((node) => node.textContent);
    const receiptIndexAfter = notesAfter.findIndex((text) =>
      /Получено изображение/.test(text ?? "")
    );
    // Must stay pinned right after "Изображение готово." — not slide down to
    // sit just before "Готовлю документ." (the new live tail/cursor).
    expect(receiptIndexAfter).toBe(2);
    expect(notesAfter[3]).toMatch("Формирую PDF.");
    expect(notesAfter[4]).toMatch("Готовлю документ.");
  });

  it("regression: a receipt that arrives while the model is already narrating its answer renders below that narration, not above it", () => {
    // Live repro (persai.dev, 2026-07-30): the model finishes its tool loop
    // and starts streaming its final answer text ("Генерирую...", "Жду
    // результат.") as `content`, not as separate `workingNotes` — so by the
    // time the async image job delivers, there is no narrated tool call left
    // for the receipt to bind to (unclaimed). The banner must not render
    // above narration the user already read.
    const image = {
      ...makeImageAttachment("att-mid-narration-1"),
      sizeBytes: 1024 * 1024
    };
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "Генерирую изображение. Жду результат.",
          workingNotes: [],
          toolInvocations: [
            { name: "image_generate", iteration: 0, ok: true, toolCallId: "call-img-1" }
          ],
          attachments: [image]
        })}
      />
    );

    expect(screen.queryByTestId("process-live-note-receipt-stream")).toBeNull();
    const answer = screen.getByText(/Генерирую изображение\. Жду результат\./);
    const receiptStream = screen.getByTestId("process-live-unclaimed-receipt-stream");
    expect(receiptStream).toHaveTextContent(/Получено изображение.*генерация.*1\.0 MB/);
    // DOM order is render order here (no CSS reordering in this component) —
    // the answer text node must precede the receipt stream container.
    expect(
      answer.compareDocumentPosition(receiptStream) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("ADR-167: async-cont delivery-only bubble suppresses technical Получено receipts", () => {
    const image = {
      ...makeImageAttachment("att-async-delivery-1"),
      sizeBytes: 1024 * 1024
    };
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          id: "local-assistant-async-cont:delivery-1",
          status: "streaming",
          content: "",
          suppressMediaReceipts: true,
          attachments: [image],
          inlineMediaPlacement: [
            { toolCallId: "call-img-1", attachmentIds: ["att-async-delivery-1"] }
          ]
        })}
      />
    );

    expect(screen.queryByTestId("media-receipt-lines")).toBeNull();
    expect(screen.queryByRole("button", { name: /Выполнено|Сгенерировано/ })).toBeNull();
    expect(screen.queryByText(/Получено изображение/)).toBeNull();
    expect(screen.queryByTestId("attachment-strip")).toBeNull();
  });

  it("ADR-167: async-cont optimistic id suppresses Получено without explicit flag", () => {
    const image = {
      ...makeImageAttachment("att-async-id-heuristic-1"),
      sizeBytes: 1024 * 1024
    };
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          id: "local-assistant-async-cont:heuristic-1",
          status: "streaming",
          content: "",
          workingNotes: ["догоняю"],
          toolInvocations: [{ name: "web_fetch", iteration: 0, ok: true }],
          attachments: [image],
          inlineMediaPlacement: [
            { toolCallId: "call-img-1", attachmentIds: ["att-async-id-heuristic-1"] }
          ]
        })}
      />
    );

    expect(screen.queryByTestId("media-receipt-lines")).toBeNull();
    expect(screen.queryByText(/Получено изображение/)).toBeNull();
  });

  it("ADR-167: async-cont with real work keeps one process badge but no technical Получено", () => {
    const image = {
      ...makeImageAttachment("att-async-work-1"),
      sizeBytes: 1024 * 1024
    };
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          id: "publish-async-cont-1",
          status: "committed",
          content: "Продолжаю.",
          suppressMediaReceipts: true,
          workingNotes: ["сверяю"],
          toolInvocations: [{ name: "web_fetch", iteration: 0, ok: true }],
          attachments: [image],
          inlineMediaPlacement: [{ toolCallId: "call-img-1", attachmentIds: ["att-async-work-1"] }]
        })}
      />
    );

    expect(screen.getAllByRole("button", { name: /Выполнено/ })).toHaveLength(1);
    expect(screen.queryByTestId("media-receipt-lines")).toBeNull();
    expect(screen.queryByText(/Получено изображение/)).toBeNull();
    expect(screen.getByTestId("attachment-strip")).toBeInTheDocument();
  });

  it("ADR-167: document/PDF receipt stays visible live first, then persists with full strip", () => {
    const documentAttachment = {
      ...makeDocumentAttachment("att-doc-1"),
      inlineAfterToolCallId: "call-doc-1"
    };
    const { rerender } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "",
          workingNotes: ["готовлю файл"],
          toolInvocations: [
            { name: "document_render", iteration: 0, ok: true, toolCallId: "call-doc-1" }
          ],
          inlineMediaPlacement: [{ toolCallId: "call-doc-1", attachmentIds: ["att-doc-1"] }],
          attachments: [documentAttachment]
        })}
      />
    );

    const liveStream = screen.getByTestId("process-live-note-receipt-stream");
    expect(liveStream).toHaveAttribute("role", "status");
    expect(liveStream).toHaveAttribute("aria-live", "polite");
    expect(liveStream).toHaveTextContent(/spec\.pdf.*2\.0 MB/i);
    expect(screen.queryByTestId("attachment-strip")).toBeNull();

    rerender(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          workingNotes: ["готовлю файл"],
          toolInvocations: [
            { name: "document_render", iteration: 0, ok: true, toolCallId: "call-doc-1" }
          ],
          inlineMediaPlacement: [{ toolCallId: "call-doc-1", attachmentIds: ["att-doc-1"] }],
          attachments: [documentAttachment]
        })}
      />
    );

    expect(screen.queryByTestId("process-live-note-receipt-stream")).toBeNull();
    expect(screen.queryByTestId("media-receipt-lines")).toBeNull();
    expect(screen.getByTestId("attachment-strip")).toBeInTheDocument();
    expandProcessBadge();
    expect(screen.getByTestId("process-timeline-receipts")).toHaveTextContent(
      /spec\.pdf.*2\.0 MB/i
    );
    expect(screen.getByTestId("media-receipt-download-att-doc-1")).toHaveAttribute(
      "href",
      expect.stringContaining("spec.pdf")
    );
    expect(
      within(screen.getByTestId("attachment-strip")).getByRole("link", { name: /spec\.pdf/i })
    ).toBeInTheDocument();
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

  it("expands a process badge to show notes then tool micro-report", () => {
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
    expect(screen.queryByText(/Прочитано · 1 страница/)).not.toBeInTheDocument();

    fireEvent.click(badge);

    expect(badge).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("сейчас")).toBeInTheDocument();
    expect(screen.getByText("Прочитано · 1 страница · 1 ошибка")).toBeInTheDocument();
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

  it("ADR-167: streaming mode keeps exactly one process badge per message", () => {
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

    const badge = screen.getByRole("button", { name: "Выполнено · 3 шага" });
    const contentTitle = screen.getByText("Content Title");
    expect(screen.getAllByRole("button", { name: /Выполнено ·/ })).toHaveLength(1);
    expect(
      badge.compareDocumentPosition(contentTitle) & Node.DOCUMENT_POSITION_FOLLOWING
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

  it("expand committed badge groups notes first then tool family micro-report", () => {
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
    const beta = screen.getByText("beta");
    const webFetch = screen.getByText("Прочитано · 1 страница");
    const imageGenerate = screen.getByText("Изображения · 1 генерация");
    expect(alpha.compareDocumentPosition(beta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(beta.compareDocumentPosition(webFetch) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      webFetch.compareDocumentPosition(imageGenerate) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("expand groups repeated tools into one family line with count", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          toolInvocations: [
            { name: "browser", iteration: 0, ok: true },
            { name: "browser", iteration: 1, ok: true },
            { name: "browser", iteration: 2, ok: true },
            { name: "browser", iteration: 3, ok: true },
            { name: "shell", iteration: 4, ok: true },
            { name: "todo_write", iteration: 5, ok: true }
          ]
        })}
      />
    );

    const badge = screen.getByRole("button", { name: "Выполнено · 6 шагов" });
    fireEvent.click(badge);

    expect(screen.getByText("В браузере · 4 шага")).toBeInTheDocument();
    expect(screen.getByText("В песочнице · 1 команда")).toBeInTheDocument();
    expect(screen.getByText("План · 1 обновление")).toBeInTheDocument();
    expect(screen.queryByText(/browser/)).not.toBeInTheDocument();
    expect(screen.queryByText(/todo write/)).not.toBeInTheDocument();
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

describe("ChatMessageBubble — normal assistant layout (ADR-167 D3)", () => {
  it("does not render any remembered assistant-body min-height shell", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Short final answer.",
          attachments: [makeImageAttachment("att-no-min-height")]
        })}
      />
    );

    expect(screen.queryByTestId("assistant-body-high-water")).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/min-height:\s*\d+px/i);
    expect(document.body.innerHTML).not.toMatch(/min-h-\[8\.75rem\]/);
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
              path: `${CHAT_SESSION_ROOT}/report.docx`,
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

describe("ChatMessageBubble — user-stopped badge", () => {
  it("keeps partial assistant text and shows a compact stopped-by-user status", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          content: "Already wrote this part.",
          status: "partial",
          stopReason: "user_stopped"
        })}
      />
    );

    expect(screen.getByText("Already wrote this part.")).toBeInTheDocument();
    expect(screen.getByTestId("user-stopped-badge")).toHaveTextContent("stoppedByUser");
  });
});
