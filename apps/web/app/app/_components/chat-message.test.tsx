import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forwardRef, type ReactEventHandler } from "react";
import { ChatMessageBubble, resolveInternalChatCta } from "./chat-message";
import type { ChatMessage } from "./use-chat";
import type { TurnEvent } from "@persai/contracts";

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

// ADR-170 — small event-log fixture builders. Each test reads as a list of
// events with an explicit `seq`, never hand-assembled JSON, and `seq` is the
// only ordering fact any of them carry.
const EVENT_AT = "2026-08-01T00:00:00.000Z";

function noteEvent(seq: number, text: string, display: "step" | "content" = "step"): TurnEvent {
  return { kind: "note", seq, at: EVENT_AT, text, display };
}

function toolCallEvent(
  seq: number,
  name: string,
  options: { ok?: boolean; toolCallId?: string } = {}
): TurnEvent {
  return {
    kind: "tool_call",
    seq,
    at: EVENT_AT,
    name,
    ok: options.ok ?? true,
    toolCallId: options.toolCallId ?? `call-${seq}`
  };
}

function deliveryEvent(
  seq: number,
  attachmentId: string,
  options: {
    artifactKind?: "image" | "video" | "audio" | "document" | "file";
    filename?: string | null;
    sizeBytes?: number | null;
  } = {}
): TurnEvent {
  return {
    kind: "delivery",
    seq,
    at: EVENT_AT,
    attachmentId,
    artifactKind: options.artifactKind ?? "image",
    filename: options.filename ?? null,
    sizeBytes: options.sizeBytes ?? null
  };
}

function answerTextEvent(seq: number, text: string): TurnEvent {
  return { kind: "answer_text", seq, at: EVENT_AT, text };
}

function jobAcceptedEvent(
  seq: number,
  jobId: string,
  jobKind: "media" | "document" | "sandbox" = "media"
): TurnEvent {
  return { kind: "job_accepted", seq, at: EVENT_AT, jobId, jobKind };
}

function turnStoppedEvent(seq: number, reason = "user_stopped"): TurnEvent {
  return { kind: "turn_stopped", seq, at: EVENT_AT, reason };
}

function turnFailedEvent(seq: number, reason = "provider_error"): TurnEvent {
  return { kind: "turn_failed", seq, at: EVENT_AT, reason };
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

  it("ADR-170: a note with display 'content' renders inline as content without a process badge", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Финал.",
          turnEvents: [
            noteEvent(1, "Текст 1\n| col | col |\n|---|---|\n| a | b |\n| c | d |", "content"),
            answerTextEvent(2, "Финал.")
          ]
        })}
      />
    );

    expect(screen.getByText(/Текст 1/)).toBeInTheDocument();
    expect(screen.getByText(/\| col \| col \|/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Выполнено|Найдено|Прочитано/ })).toBeNull();
    expect(screen.getByText("Финал.")).toBeInTheDocument();
  });

  it("ADR-170: a multi-line content note renders inline as content regardless of its markdown shape", () => {
    // D10 — the server's `note.display` flag decides step-vs-content, not
    // client markdown sniffing. This text is plain (no table/heading/list)
    // yet is still rendered as content purely because `display: "content"`.
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Финал.",
          turnEvents: [
            noteEvent(1, "Обычный текст без разметки.", "content"),
            answerTextEvent(2, "Финал.")
          ]
        })}
      />
    );

    expect(screen.getByText("Обычный текст без разметки.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Выполнено/ })).toBeNull();
  });

  it("ADR-170: a note with display 'step' folds into the collapsed process badge, never rendered as content", () => {
    // Same underlying text shape flipped only by `display` — proves the
    // classification is the server flag alone, not text inspection.
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          turnEvents: [
            noteEvent(1, "сейчас", "step"),
            noteEvent(2, "готово", "step"),
            noteEvent(3, "продолжаю", "step"),
            answerTextEvent(4, "Готово.")
          ]
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
          turnEvents: [
            toolCallEvent(1, "web_search", { toolCallId: "call-1" }),
            toolCallEvent(2, "web_search", { toolCallId: "call-2" }),
            answerTextEvent(3, "Готово.")
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
    const image = { ...makeImageAttachment("att-inline-1"), sizeBytes: 1024 * 1024 };
    const { container } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Вот картинка.",
          turnEvents: [
            noteEvent(1, "сейчас"),
            toolCallEvent(2, "image_generate", { toolCallId: "call-img-1" }),
            deliveryEvent(3, "att-inline-1"),
            answerTextEvent(4, "Вот картинка.")
          ],
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
    const image = { ...makeImageAttachment("att-inline-1"), sizeBytes: 1024 * 1024 };
    // Live rendering trusts `message.content` for the plain-answer case —
    // the server is responsible for keeping it the clean final answer.
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "Пишу итоговый ответ.",
          turnEvents: [
            noteEvent(1, "сейчас"),
            toolCallEvent(2, "image_generate", { toolCallId: "call-img-1" }),
            deliveryEvent(3, "att-inline-1"),
            answerTextEvent(4, "Пишу итоговый ответ.")
          ],
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
    const answer = screen.getByText("Пишу итоговый ответ.");
    expect(stream.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const cursor = screen.getByTestId("streaming-cursor");
    expect(answer.compareDocumentPosition(cursor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("ADR-167: live receipt banner opens the received image in the lightbox", () => {
    const image = { ...makeImageAttachment("att-open-1"), sizeBytes: 1024 * 1024 };
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "",
          turnEvents: [
            toolCallEvent(1, "image_generate", { toolCallId: "call-img-1" }),
            deliveryEvent(2, "att-open-1")
          ],
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
    const document = makeDocumentAttachment("att-dl-1");
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "",
          turnEvents: [
            toolCallEvent(1, "document_render", { toolCallId: "call-doc-1" }),
            deliveryEvent(2, "att-dl-1", { artifactKind: "document" })
          ],
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
      sizeBytes: 1024 * 1024
    };
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "",
          turnEvents: [
            toolCallEvent(1, "image_generate", { toolCallId: "call-img-1" }),
            deliveryEvent(2, "att-no-path")
          ],
          attachments: [image]
        })}
      />
    );

    expect(screen.getByTestId("media-receipt-open-att-no-path")).toBeDisabled();
    expect(screen.queryByTestId("mock-image-lightbox")).toBeNull();
  });

  it("ADR-167: delivery receipts survive live to committed and terminal strip appears only after commit", () => {
    const image = { ...makeImageAttachment("att-live-commit-1"), sizeBytes: 1024 * 1024 };
    const { rerender } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "",
          turnEvents: [
            noteEvent(1, "сейчас"),
            toolCallEvent(2, "image_generate", { toolCallId: "call-img-1" }),
            deliveryEvent(3, "att-live-commit-1")
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
          turnEvents: [
            noteEvent(1, "сейчас"),
            toolCallEvent(2, "image_generate", { toolCallId: "call-img-1" }),
            deliveryEvent(3, "att-live-commit-1"),
            answerTextEvent(4, "Готово.")
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

  it("suppresses a live continuation strip until terminal commit", () => {
    const image = { ...makeImageAttachment("att-catchup-1"), sizeBytes: 1024 * 1024 };
    const { container } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "",
          turnEvents: [
            noteEvent(1, "догоняю"),
            toolCallEvent(2, "image_generate", { toolCallId: "call-img-1" }),
            deliveryEvent(3, "att-catchup-1")
          ],
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

  it("ADR-167: async-cont delivery-only bubble suppresses technical Получено receipts", () => {
    const image = { ...makeImageAttachment("att-async-delivery-1"), sizeBytes: 1024 * 1024 };
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          id: "local-assistant-async-cont:delivery-1",
          status: "streaming",
          content: "",
          conversationalPublish: true,
          attachments: [image],
          turnEvents: [deliveryEvent(1, "att-async-delivery-1")]
        })}
      />
    );

    expect(screen.queryByTestId("media-receipt-lines")).toBeNull();
    expect(screen.queryByRole("button", { name: /Выполнено|Сгенерировано/ })).toBeNull();
    expect(screen.queryByText(/Получено изображение/)).toBeNull();
    expect(screen.queryByTestId("attachment-strip")).toBeNull();
  });

  it("ADR-167: async-cont with real work keeps one process badge but no technical Получено", () => {
    const image = { ...makeImageAttachment("att-async-work-1"), sizeBytes: 1024 * 1024 };
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          id: "publish-async-cont-1",
          status: "committed",
          content: "Продолжаю.",
          conversationalPublish: true,
          attachments: [image],
          turnEvents: [
            noteEvent(1, "сверяю"),
            toolCallEvent(2, "web_fetch", { toolCallId: "call-1" }),
            deliveryEvent(3, "att-async-work-1"),
            answerTextEvent(4, "Продолжаю.")
          ]
        })}
      />
    );

    expect(screen.getAllByRole("button", { name: /Выполнено/ })).toHaveLength(1);
    expect(screen.queryByTestId("media-receipt-lines")).toBeNull();
    expect(screen.queryByText(/Получено изображение/)).toBeNull();
    expect(screen.getByTestId("attachment-strip")).toBeInTheDocument();
  });

  it("ADR-167: document/PDF receipt stays visible live first, then persists with full strip", () => {
    const documentAttachment = makeDocumentAttachment("att-doc-1");
    const { rerender } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "",
          turnEvents: [
            noteEvent(1, "готовлю файл"),
            toolCallEvent(2, "document_render", { toolCallId: "call-doc-1" }),
            deliveryEvent(3, "att-doc-1", { artifactKind: "document" })
          ],
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
          turnEvents: [
            noteEvent(1, "готовлю файл"),
            toolCallEvent(2, "document_render", { toolCallId: "call-doc-1" }),
            deliveryEvent(3, "att-doc-1", { artifactKind: "document" }),
            answerTextEvent(4, "Готово.")
          ],
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

  it("ADR-170: strict seq order places a delivery exactly between two answer segments", () => {
    const image = { ...makeImageAttachment("att-mid-answer-1"), sizeBytes: 1024 * 1024 };
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "Первая часть. Вторая часть.",
          turnEvents: [
            answerTextEvent(1, "Первая часть. "),
            deliveryEvent(2, "att-mid-answer-1"),
            answerTextEvent(3, "Вторая часть.")
          ],
          attachments: [image]
        })}
      />
    );

    const firstPart = screen.getByText("Первая часть.");
    const receipt = screen.getByTestId("process-live-answer-receipt-stream");
    const secondPart = screen.getByText("Вторая часть.");
    expect(receipt).toHaveTextContent(/Получено изображение.*генерация.*1\.0 MB/);
    expect(
      firstPart.compareDocumentPosition(receipt) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      receipt.compareDocumentPosition(secondPart) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("ADR-170 D5.3: a COMMITTED message renders a delivery interleaved between two answer segments", () => {
    // The founder's complaint was specifically about the committed/expanded
    // view disagreeing with the live view — this proves the committed render
    // path also reads the log's `seq` order, not `message.content`.
    const image = { ...makeImageAttachment("att-committed-mid-answer-1"), sizeBytes: 1024 * 1024 };
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Первая часть. Вторая часть.",
          turnEvents: [
            answerTextEvent(1, "Первая часть. "),
            deliveryEvent(2, "att-committed-mid-answer-1"),
            answerTextEvent(3, "Вторая часть.")
          ],
          attachments: [image]
        })}
      />
    );

    const firstPart = screen.getByText("Первая часть.");
    const receipt = screen.getByTestId("process-live-answer-receipt-stream");
    const secondPart = screen.getByText("Вторая часть.");
    expect(receipt).toHaveTextContent(/Получено изображение.*генерация.*1\.0 MB/);
    expect(
      firstPart.compareDocumentPosition(receipt) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      receipt.compareDocumentPosition(secondPart) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("ADR-170 D5.3 regression: the same log renders the same element order live and committed (the founder's reported defect)", () => {
    // The original defect: a receipt sat correctly in the live stream, then
    // reordered in the committed message and the expanded process block once
    // the turn ended, because live trusted the log while committed trusted a
    // separately assembled `message.content`. One source (the log) for both
    // means the order can no longer disagree between the two renders.
    const image = { ...makeImageAttachment("att-same-order-1"), sizeBytes: 1024 * 1024 };
    const sharedTurnEvents = [
      answerTextEvent(1, "Готовлю картинку. "),
      deliveryEvent(2, "att-same-order-1"),
      answerTextEvent(3, "Вот результат.")
    ];

    const { rerender } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "Готовлю картинку. Вот результат.",
          turnEvents: sharedTurnEvents,
          attachments: [image]
        })}
      />
    );
    const liveContainer = screen.getByTestId("process-live-answer-receipt-stream").parentElement!;
    const liveOrder = Array.from(liveContainer.children).map((node) =>
      node.textContent?.includes("Получено") ? "receipt" : node.textContent?.trim()
    );

    rerender(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готовлю картинку. Вот результат.",
          turnEvents: sharedTurnEvents,
          attachments: [image]
        })}
      />
    );
    const committedContainer = screen.getByTestId(
      "process-live-answer-receipt-stream"
    ).parentElement!;
    const committedOrder = Array.from(committedContainer.children).map((node) =>
      node.textContent?.includes("Получено") ? "receipt" : node.textContent?.trim()
    );

    expect(committedOrder).toEqual(liveOrder);
    expect(liveOrder).toEqual(["Готовлю картинку.", "receipt", "Вот результат."]);
  });

  it("ADR-170 FIX: a delivery at/after the first answer_text renders exactly once — the answer stream, not duplicated inside the expanded committed badge", () => {
    // The suite this program inherited never combined a preceding note/tool
    // (which creates a process badge) with a delivery landing inside the
    // answer — the exact combination that rendered the receipt twice:
    // once via `allPieces` feeding the badge, once via `answerSegments`.
    const image = { ...makeImageAttachment("att-double-render-1"), sizeBytes: 1024 * 1024 };
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Часть текста. Продолжение.",
          turnEvents: [
            noteEvent(1, "готовлю"),
            toolCallEvent(2, "image_generate", { toolCallId: "call-img-1" }),
            answerTextEvent(3, "Часть текста. "),
            deliveryEvent(4, "att-double-render-1"),
            answerTextEvent(5, "Продолжение.")
          ],
          attachments: [image]
        })}
      />
    );

    // Collapsed: exactly one visible receipt anywhere in the bubble.
    expect(screen.getAllByTestId("media-receipt-open-att-double-render-1")).toHaveLength(1);

    const badge = expandProcessBadge(/Выполнено|Сгенерировано/);
    expect(badge).toHaveAttribute("aria-expanded", "true");
    // Expanded: still exactly one — expanding must not reveal a second copy.
    expect(screen.getAllByTestId("media-receipt-open-att-double-render-1")).toHaveLength(1);

    const folded = screen.getByTestId("process-timeline-receipts");
    expect(within(folded).queryByTestId("media-receipt-open-att-double-render-1")).toBeNull();
    expect(folded).toHaveTextContent("готовлю");

    const firstPart = screen.getByText("Часть текста.");
    const receipt = screen.getByTestId("media-receipt-open-att-double-render-1");
    const secondPart = screen.getByText("Продолжение.");
    // seq order: narration (1,2) < answer part 1 (3) < receipt (4) < answer part 2 (5).
    expect(
      folded.compareDocumentPosition(firstPart) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      firstPart.compareDocumentPosition(receipt) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      receipt.compareDocumentPosition(secondPart) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("ADR-170 FIX mirror case: a delivery before the first answer_text renders exactly once, in the process stream, never in the answer stream", () => {
    const image = { ...makeImageAttachment("att-pre-answer-only-1"), sizeBytes: 1024 * 1024 };
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          turnEvents: [
            noteEvent(1, "готовлю"),
            toolCallEvent(2, "image_generate", { toolCallId: "call-img-1" }),
            deliveryEvent(3, "att-pre-answer-only-1"),
            answerTextEvent(4, "Готово.")
          ],
          attachments: [image]
        })}
      />
    );

    // Collapsed: no receipt outside the badge, no answer-stream receipt.
    expect(screen.queryByTestId("media-receipt-open-att-pre-answer-only-1")).toBeNull();
    expect(screen.queryByTestId("process-live-answer-receipt-stream")).toBeNull();

    expandProcessBadge();
    // Expanded: exactly one receipt, inside the process stream.
    expect(screen.getAllByTestId("media-receipt-open-att-pre-answer-only-1")).toHaveLength(1);
    const folded = screen.getByTestId("process-timeline-receipts");
    expect(
      within(folded).getByTestId("media-receipt-open-att-pre-answer-only-1")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("process-live-answer-receipt-stream")).toBeNull();
  });

  it("ADR-170: an open answer_text growing in place at the same seq renders one element, not two", () => {
    const baseMessage = makeAssistantMessage({
      status: "streaming",
      content: "Hello ",
      turnEvents: [answerTextEvent(1, "Hello ")]
    });
    const { rerender } = render(<ChatMessageBubble chatId="chat-1" message={baseMessage} />);
    expect(screen.getAllByText(/Hello/)).toHaveLength(1);

    // The same event, same `seq`, grew in place — this must still be exactly
    // one rendered text node with the concatenated text, never a second one.
    rerender(
      <ChatMessageBubble
        chatId="chat-1"
        message={{
          ...baseMessage,
          content: "Hello world",
          turnEvents: [answerTextEvent(1, "Hello world")]
        }}
      />
    );
    expect(screen.getAllByText(/Hello world/)).toHaveLength(1);
    expect(screen.queryByText("Hello ")).toBeNull();
  });

  it("ADR-170 D5.2.1: renders the unnumbered tail after every numbered event and replaces it", () => {
    const { rerender } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          turnEvents: [noteEvent(1, "сейчас"), answerTextEvent(2, "Готово.")],
          textTail: "Прив"
        })}
      />
    );

    const answer = screen.getByText("Готово.");
    const tail = screen.getByText("Прив");
    expect(answer.compareDocumentPosition(tail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    rerender(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          turnEvents: [noteEvent(1, "сейчас"), answerTextEvent(2, "Готово.")],
          textTail: "Привет"
        })}
      />
    );

    expect(screen.getByText("Привет")).toBeInTheDocument();
    expect(screen.queryByText("Прив")).toBeNull();

    rerender(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          turnEvents: [noteEvent(1, "сейчас"), answerTextEvent(2, "Готово.")],
          textTail: ""
        })}
      />
    );

    expect(screen.queryByText("Привет")).toBeNull();
  });

  it("ADR-170 D5.2.1: renders a tail when the live message has no numbered events", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({ content: "", textTail: "Потоковый текст." })}
      />
    );

    expect(screen.getByText("Потоковый текст.")).toBeInTheDocument();
  });

  it("ADR-170 D5.2.1: ignores a stale tail on a committed message", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          turnEvents: [answerTextEvent(1, "Готово.")],
          textTail: "Устаревший хвост"
        })}
      />
    );

    expect(screen.getByText("Готово.")).toBeInTheDocument();
    expect(screen.queryByText("Устаревший хвост")).toBeNull();
  });

  it("ADR-170 D7: a message with no turnEvents renders no process block, only the answer and attachments", () => {
    const image = makeImageAttachment("att-no-log-1");
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово, без лога.",
          attachments: [image]
        })}
      />
    );

    expect(screen.getByText("Готово, без лога.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Выполнено|Найдено|Прочитано/ })).toBeNull();
    expect(screen.queryByTestId("media-receipt-lines")).toBeNull();
    expect(screen.getByTestId("attachment-strip")).toBeInTheDocument();
  });

  it("ADR-170 D5.2.2: a log whose only event is an empty reserved answer_text renders no assistant text and no process block", () => {
    const { container } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "",
          turnEvents: [answerTextEvent(1, "")]
        })}
      />
    );

    expect(screen.queryByRole("button", { name: /Выполнено|Найдено|Прочитано/ })).toBeNull();
    expect(screen.queryByTestId("process-live-answer-receipt-stream")).toBeNull();
    expect(screen.queryByTestId("process-live-note-receipt-stream")).toBeNull();
    expect(screen.queryByTestId("process-timeline-receipts")).toBeNull();
    // No stray empty bubble, step row, or separator of any kind.
    expect(container.textContent).toBe("");
  });

  it("ADR-170 D5.2.2: a reserved slot that is later filled renders exactly once, at its original seq position, with no flicker artifact left behind", () => {
    const { rerender } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "",
          turnEvents: [noteEvent(1, "сейчас"), answerTextEvent(2, "")]
        })}
      />
    );

    // While the seq-2 slot is reserved (empty), only the note is visible.
    const liveStreamBeforeFill = screen.getByTestId("process-live-note-receipt-stream");
    expect(liveStreamBeforeFill).toHaveTextContent("сейчас");
    expect(screen.queryByText("Готово.")).toBeNull();

    // The server fills the SAME seq in place — same event, kind and text
    // replaced, never a second event appended.
    rerender(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "",
          turnEvents: [noteEvent(1, "сейчас"), answerTextEvent(2, "Готово.")]
        })}
      />
    );

    const filled = screen.getAllByText("Готово.");
    expect(filled).toHaveLength(1);
    const liveStreamAfterFill = screen.getByTestId("process-live-note-receipt-stream");
    expect(
      liveStreamAfterFill.compareDocumentPosition(filled[0]!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("ADR-170 D5.2.2: an empty reserved note does not increment the process badge step count", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          turnEvents: [noteEvent(1, "сейчас"), noteEvent(2, ""), answerTextEvent(3, "Готово.")]
        })}
      />
    );

    expect(screen.getByRole("button", { name: "Выполнено · 1 шаг" })).toBeInTheDocument();
  });

  it("ADR-170 D2.1/D11: a delivery whose attachment id is not yet in attachments renders nothing rather than crash or guess", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "",
          turnEvents: [
            noteEvent(1, "готовлю"),
            toolCallEvent(2, "image_generate", { toolCallId: "call-img-1" }),
            deliveryEvent(3, "att-not-yet-caught-up")
          ],
          attachments: []
        })}
      />
    );

    // The note still renders; the unresolved delivery renders nothing.
    const stream = screen.getByTestId("process-live-note-receipt-stream");
    expect(stream).toHaveTextContent("готовлю");
    expect(screen.queryByTestId("media-receipt-lines")).toBeNull();
    expect(screen.queryByText(/Получено/)).toBeNull();
  });

  it("ADR-170: a job_accepted bookkeeping event carries no visible piece of its own", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "streaming",
          content: "",
          turnEvents: [
            noteEvent(1, "запускаю фон"),
            jobAcceptedEvent(2, "job-1", "media"),
            toolCallEvent(3, "image_generate", { toolCallId: "call-1" })
          ]
        })}
      />
    );

    const stream = screen.getByTestId("process-live-note-receipt-stream");
    expect(stream).toHaveTextContent("запускаю фон");
    expect(stream).not.toHaveTextContent("job-1");
  });

  it("ADR-170: a turn_stopped log keeps the partial answer and prior notes visible with no crash", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "partial",
          stopReason: "user_stopped",
          content: "Успел написать часть.",
          turnEvents: [
            noteEvent(1, "сейчас"),
            answerTextEvent(2, "Успел написать часть."),
            turnStoppedEvent(3)
          ]
        })}
      />
    );

    expect(screen.getByText("Успел написать часть.")).toBeInTheDocument();
    expect(screen.getByTestId("user-stopped-badge")).toBeInTheDocument();
  });

  it("ADR-170: a turn_failed log renders whatever notes/answer preceded it with no crash", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Частичный ответ.",
          turnEvents: [
            noteEvent(1, "пробую"),
            answerTextEvent(2, "Частичный ответ."),
            turnFailedEvent(3)
          ]
        })}
      />
    );

    // The terminal `turn_failed` fact carries no visible piece of its own —
    // it must not crash rendering, and the notes/answer that preceded it
    // still render normally.
    expect(screen.getByText("Частичный ответ.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Выполнено · 1 шаг" })).toBeInTheDocument();
  });

  it("preserves order for mixed connective text, content, then connective text plus tool", () => {
    const { container } = render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Итог.",
          turnEvents: [
            noteEvent(1, "сейчас"),
            noteEvent(2, "## Content Title\nbody", "content"),
            noteEvent(3, "продолжаю"),
            toolCallEvent(4, "web_fetch", { toolCallId: "call-1" }),
            answerTextEvent(5, "Итог.")
          ]
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

  it("skips empty notes between tools and groups only tool pieces", () => {
    render(
      <ChatMessageBubble
        chatId="chat-1"
        message={makeAssistantMessage({
          status: "committed",
          content: "Готово.",
          turnEvents: [
            noteEvent(1, ""),
            toolCallEvent(2, "web_fetch", { toolCallId: "call-1" }),
            noteEvent(3, ""),
            toolCallEvent(4, "web_fetch", { toolCallId: "call-2" }),
            answerTextEvent(5, "Готово.")
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
          turnEvents: [noteEvent(1, "сейчас"), answerTextEvent(2, "ок")]
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
          turnEvents: [
            noteEvent(1, "сейчас"),
            toolCallEvent(2, "web_fetch", { ok: false, toolCallId: "call-1" }),
            answerTextEvent(3, "Готово.")
          ]
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

  it("renders only final text for an empty assistant message body with no turn events", () => {
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
          turnEvents: [
            noteEvent(1, "связка1"),
            noteEvent(2, "## Content Title\nbody", "content"),
            noteEvent(3, "связка2"),
            toolCallEvent(4, "web_fetch", { toolCallId: "call-1" }),
            answerTextEvent(5, "Итог.")
          ]
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
          turnEvents: [
            noteEvent(1, "связка1"),
            noteEvent(2, "## Content Title\nbody", "content"),
            noteEvent(3, "связка2"),
            toolCallEvent(4, "web_fetch", { toolCallId: "call-1" }),
            answerTextEvent(5, "Итог.")
          ]
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
          turnEvents: [
            toolCallEvent(1, "knowledge_search", { toolCallId: "call-1" }),
            toolCallEvent(2, "knowledge_search", { toolCallId: "call-2" }),
            answerTextEvent(3, "Готово.")
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
          turnEvents: [
            toolCallEvent(1, "web_search", { toolCallId: "call-1" }),
            toolCallEvent(2, "image_generate", { toolCallId: "call-2" }),
            answerTextEvent(3, "Готово.")
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
          turnEvents: [
            toolCallEvent(1, "image_edit", { toolCallId: "call-1" }),
            answerTextEvent(2, "Готово.")
          ]
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
          turnEvents: [
            toolCallEvent(1, "document", { toolCallId: "call-1" }),
            toolCallEvent(2, "document", { toolCallId: "call-2" }),
            answerTextEvent(3, "Готово.")
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
          turnEvents: [
            toolCallEvent(1, "shell", { toolCallId: "call-1" }),
            answerTextEvent(2, "Готово.")
          ]
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
          turnEvents: [
            noteEvent(1, "alpha"),
            noteEvent(2, "beta"),
            toolCallEvent(3, "web_fetch", { toolCallId: "call-1" }),
            toolCallEvent(4, "image_generate", { toolCallId: "call-2" }),
            answerTextEvent(5, "Готово.")
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
          turnEvents: [
            toolCallEvent(1, "browser", { toolCallId: "call-1" }),
            toolCallEvent(2, "browser", { toolCallId: "call-2" }),
            toolCallEvent(3, "browser", { toolCallId: "call-3" }),
            toolCallEvent(4, "browser", { toolCallId: "call-4" }),
            toolCallEvent(5, "shell", { toolCallId: "call-5" }),
            toolCallEvent(6, "todo_write", { toolCallId: "call-6" }),
            answerTextEvent(7, "Готово.")
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
