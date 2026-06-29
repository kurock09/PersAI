"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import {
  Send,
  Square,
  Paperclip,
  X,
  FileText,
  Music,
  Film,
  Mic,
  Trash2,
  Loader2,
  Camera,
  Image as ImageIcon,
  Files as FilesIcon
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/app/lib/utils";
import { useTranslations } from "next-intl";
import {
  CHAT_ATTACHMENT_ACCEPT,
  isAcceptedChatFile,
  isKnowledgeEligibleFile
} from "../chat-file-policy";
import type {
  WebChatActiveDocumentJobState,
  WebChatActiveMediaJobState
} from "../assistant-api-client";
import { useTouchDevice } from "./use-touch-device";
import { ATTACHMENTS_ONLY_PLACEHOLDER } from "./attachments-only-placeholder";

const MAX_FILES = 5;
const MAX_CHAT_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_CHAT_UPLOAD_MB = Math.floor(MAX_CHAT_UPLOAD_BYTES / (1024 * 1024));

/** Ignore thumb jitter before computing swipe distance. */
const VOICE_GESTURE_SLOP_PX = 12;
/** Mic action column width in the composer (`w-10`). */
const VOICE_MIC_COLUMN_PX = 40;
/** Trash target diameter (`h-8 w-8`). */
const VOICE_TRASH_SIZE_PX = 32;
/** Keep trash left of the mic so a holding thumb does not cover it. */
const VOICE_THUMB_CLEARANCE_PX = Math.round(52 * 1.5);
/** Trash anchor from the composer's right edge (mic column + clearance). */
const VOICE_TRASH_OFFSET_FROM_RIGHT_PX = VOICE_MIC_COLUMN_PX + VOICE_THUMB_CLEARANCE_PX;
/** Pill stretch so the left edge fully wraps the trash target, not just touches it. */
const VOICE_PILL_MAX_STRETCH_PX =
  VOICE_TRASH_OFFSET_FROM_RIGHT_PX + VOICE_TRASH_SIZE_PX - VOICE_MIC_COLUMN_PX;
/** Finger within this distance of the trash center arms cancel. */
const VOICE_TRASH_ARM_TOLERANCE_PX = 36;
const VOICE_HOLD_MIN_MS = 280;
/** Above one line of text (leading-5 + py-2.5×2) the composer uses a fixed radius, not a pill. */
const COMPOSER_SINGLE_LINE_HEIGHT_PX = 40;

/** Circular 40px targets; hover only on fine pointers (2026 chat UX baseline). */
const composerIconButtonClass = (opts: { disabled?: boolean; active?: boolean }) =>
  cn(
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors select-none",
    opts.disabled
      ? "cursor-default text-text-subtle/40"
      : cn(
          "cursor-pointer text-text-subtle active:bg-surface-hover active:text-text-muted",
          opts.active && "bg-surface-hover text-text-muted",
          "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-surface-hover [@media(hover:hover)_and_(pointer:fine)]:hover:text-text-muted"
        )
  );

const composerActionSlotClass =
  "absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] select-none active:scale-[0.96]";

const composerSendButtonClass = (disabled: boolean) =>
  cn(
    composerActionSlotClass,
    "bg-accent text-white shadow-sm",
    disabled
      ? "cursor-default opacity-40"
      : "cursor-pointer [@media(hover:hover)_and_(pointer:fine)]:hover:bg-accent-hover"
  );

const composerStopButtonClass = cn(
  composerActionSlotClass,
  "rounded-full bg-destructive/15 text-destructive",
  "cursor-pointer [@media(hover:hover)_and_(pointer:fine)]:hover:bg-destructive/25"
);

function shouldRestoreComposerFocusAfterSend(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  // Hybrid Windows laptops can report maxTouchPoints > 0 while the primary
  // interaction is still a desktop keyboard/mouse. Only suppress focus on
  // touch-only environments where focusing would pop the mobile keyboard.
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function restoreComposerFocusAfterSend(el: HTMLTextAreaElement): void {
  const restore = () => {
    if (!el.isConnected || el.disabled) return;
    el.focus({ preventScroll: true });
  };
  restore();
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(restore);
  }
  window.setTimeout(restore, 0);
  window.setTimeout(restore, 80);
}

function shouldKeepDesktopComposerFocusOnPointerDown(): boolean {
  return shouldRestoreComposerFocusAfterSend();
}

function fileIcon(mime: string) {
  if (mime.startsWith("image/")) return null;
  if (mime.startsWith("audio/")) return <Music className="h-5 w-5 text-text-subtle" />;
  if (mime.startsWith("video/")) return <Film className="h-5 w-5 text-text-subtle" />;
  return <FileText className="h-5 w-5 text-text-subtle" />;
}

function PendingFilePreview({
  file,
  ordinal,
  showOrdinal
}: {
  file: File;
  ordinal: number;
  showOrdinal: boolean;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file.type.startsWith("image/")) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (file.type.startsWith("image/")) {
    return (
      <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded">
        {previewUrl !== null ? (
          <img src={previewUrl} alt={file.name} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-surface-hover">
            <ImageIcon className="h-4 w-4 text-text-subtle" />
          </span>
        )}
        {showOrdinal ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-xl font-semibold leading-none text-white/25"
          >
            {ordinal}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="relative flex h-8 w-8 shrink-0 items-center justify-center">
      {fileIcon(file.type)}
      {showOrdinal ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-semibold text-text-muted/25"
        >
          {ordinal}
        </span>
      ) : null}
    </span>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

function pickVoiceRecordingMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac",
    "audio/ogg;codecs=opus",
    "audio/ogg"
  ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "";
}

function voiceFilenameForMime(mimeType: string): string {
  const base = (mimeType.split(";")[0] ?? mimeType).trim().toLowerCase();
  if (base.includes("mp4") || base.includes("aac")) {
    return `voice-${Date.now()}.m4a`;
  }
  if (base.includes("ogg")) {
    return `voice-${Date.now()}.ogg`;
  }
  return `voice-${Date.now()}.webm`;
}

function isAcceptedFile(file: File): boolean {
  return isAcceptedChatFile(file);
}

function resolveMediaJobLabel(
  t: ReturnType<typeof useTranslations>,
  job: WebChatActiveMediaJobState,
  nowMs: number
): string {
  // ADR-109 Slice 10b — talking-avatar render takes 1–5 minutes and HeyGen
  // poll exposes only `pending|processing|completed|failed`. Rather than show
  // a static "Generating video" chip that reads as a hang, rotate honest copy
  // by elapsed wall-clock time. Cinematic (Kling/Runway/OpenAI) jobs and any
  // job missing/with a non-`talking_avatar` `displayKind` keep the legacy
  // `mediaJobVideoGenerate` chip byte-identical (preserves cross-slice
  // invariant 1).
  if (job.operation === "video_generate" && job.displayKind === "talking_avatar") {
    const elapsedSec = resolveMediaJobElapsedSeconds(job, nowMs);
    if (elapsedSec < 30) return t("chatTalkingAvatarBannerStage1");
    if (elapsedSec < 120) return t("chatTalkingAvatarBannerStage2");
    if (elapsedSec < 300) return t("chatTalkingAvatarBannerStage3");
    return t("chatTalkingAvatarBannerStage4");
  }
  switch (job.operation) {
    case "image_edit":
      return t("mediaJobImageEdit");
    case "video_generate":
      return t("mediaJobVideoGenerate");
    case "audio_generate":
      return t("mediaJobAudioGenerate");
    case "image_generate":
    default:
      return t("mediaJobImageGenerate");
  }
}

function resolveMediaJobElapsedSeconds(job: WebChatActiveMediaJobState, nowMs: number): number {
  const startedAtMs = Date.parse(job.startedAt ?? job.createdAt);
  if (Number.isNaN(startedAtMs)) {
    return 0;
  }
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
}

function resolveDocumentJobLabel(
  t: ReturnType<typeof useTranslations>,
  job: WebChatActiveDocumentJobState
): string {
  switch (job.descriptorMode) {
    case "revise_document":
      return t("documentJobRevise");
    case "export_or_redeliver":
      return t("documentJobRedeliver");
    case "create_presentation":
    default:
      return t("documentJobPresentation");
  }
}

function resolveDocumentJobElapsedSeconds(
  job: WebChatActiveDocumentJobState,
  nowMs: number
): number {
  const startedAtMs = Date.parse(job.startedAt ?? job.createdAt);
  if (Number.isNaN(startedAtMs)) {
    return 0;
  }
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
}

function collectAcceptedFiles(
  files: Iterable<File>,
  existingCount: number
): { accepted: File[]; oversized: File[] } {
  const accepted: File[] = [];
  const oversized: File[] = [];
  for (const file of files) {
    if (!isAcceptedFile(file)) continue;
    if (file.size > MAX_CHAT_UPLOAD_BYTES) {
      oversized.push(file);
      continue;
    }
    if (existingCount + accepted.length >= MAX_FILES) break;
    accepted.push(file);
  }
  return { accepted, oversized };
}

type RecordingState = "idle" | "recording" | "transcribing";

interface ChatInputProps {
  onSend: (
    text: string,
    files?: File[],
    options?: {
      addToKnowledgeBase?: boolean | undefined;
    }
  ) => void;
  onTranscribeVoice: (audioBlob: Blob, filename: string) => Promise<string>;
  onVoiceTranscriptionError?: (error: unknown) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  /**
   * Single-slot pending send state surfaced from useChat. When the previous
   * outgoing message failed, sending is blocked until the user retries or
   * cancels (the chat shell offers both actions on the bubble itself).
   */
  pendingSendStatus?:
    | "sending"
    | "reconciling"
    | "send_failed"
    | "send_failed_unconfirmed"
    | "send_failed_confirmed"
    | null;
  activeMediaJobs?: WebChatActiveMediaJobState[];
  activeDocumentJobs?: WebChatActiveDocumentJobState[];
}

export interface ChatInputHandle {
  /**
   * Programmatically set the draft text of the composer, e.g. when the
   * parent restores a cancelled outgoing message back into the input.
   * Auto-resizes the textarea, focuses it, and moves the caret to the end.
   */
  setDraft: (text: string) => void;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  {
    onSend,
    onTranscribeVoice,
    onVoiceTranscriptionError,
    onStop,
    isStreaming,
    disabled,
    pendingSendStatus = null,
    activeMediaJobs = [],
    activeDocumentJobs = []
  }: ChatInputProps,
  ref
) {
  const t = useTranslations("chat");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Camera + Photos use dedicated hidden inputs so the OS picker matches the
  // tile the user actually tapped (capture=environment for the camera; no
  // capture for the gallery so iOS/Android open the multi-select photo
  // sheet). The existing fileInputRef stays for the catch-all "File" tile.
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);
  const cameraPreviewVideoRef = useRef<HTMLVideoElement>(null);
  const cameraPreviewStreamRef = useRef<MediaStream | null>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const attachTriggerRef = useRef<HTMLButtonElement>(null);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  const isTouchDevice = useTouchDevice();
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [draftText, setDraftText] = useState("");
  const [isComposerMultiline, setIsComposerMultiline] = useState(false);
  const [addToKnowledgeBase, setAddToKnowledgeBase] = useState(false);
  const [attachmentFeedback, setAttachmentFeedback] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [cameraPreviewState, setCameraPreviewState] = useState<
    "idle" | "loading" | "ready" | "unavailable"
  >("idle");

  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [mediaJobNowMs, setMediaJobNowMs] = useState(() => Date.now());
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const recordingAttemptIdRef = useRef(0);
  const touchRecordingIntentActiveRef = useRef(false);
  const focusRestoreDeadlineRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      cameraPreviewStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    const deadline = focusRestoreDeadlineRef.current;
    if (deadline === 0 || Date.now() > deadline) {
      focusRestoreDeadlineRef.current = 0;
      return;
    }
    if (isTouchDevice && !shouldRestoreComposerFocusAfterSend()) {
      focusRestoreDeadlineRef.current = 0;
      return;
    }
    const el = textareaRef.current;
    if (el === null) {
      return;
    }
    if (document.activeElement === el) {
      focusRestoreDeadlineRef.current = 0;
      return;
    }
    restoreComposerFocusAfterSend(el);
  }, [isStreaming, pendingSendStatus, isTouchDevice]);

  useEffect(() => {
    if (activeMediaJobs.length === 0 && activeDocumentJobs.length === 0) {
      return;
    }
    setMediaJobNowMs(Date.now());
    const timer = window.setInterval(() => {
      setMediaJobNowMs(Date.now());
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [activeDocumentJobs, activeMediaJobs]);

  const stopCameraPreview = useCallback(() => {
    cameraPreviewStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraPreviewStreamRef.current = null;
    if (cameraPreviewVideoRef.current) {
      cameraPreviewVideoRef.current.srcObject = null;
    }
  }, []);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(el.scrollHeight, 200);
    el.style.height = `${nextHeight}px`;
    setIsComposerMultiline(nextHeight > COMPOSER_SINGLE_LINE_HEIGHT_PX);
  }, []);

  const handleDraftChange = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      setDraftText(e.currentTarget.value);
      requestAnimationFrame(() => resize());
    },
    [resize]
  );

  useImperativeHandle(
    ref,
    () => ({
      setDraft(text: string) {
        const el = textareaRef.current;
        if (el === null) return;
        setDraftText(text);
        requestAnimationFrame(() => resize());
        el.focus();
        const end = text.length;
        try {
          el.setSelectionRange(end, end);
        } catch {
          /* setSelectionRange may throw on non-text inputs in old browsers */
        }
      }
    }),
    [resize]
  );

  const sendBlockedByFailedSlot = pendingSendStatus !== null;
  const hardBlockedByFailedSlot =
    pendingSendStatus === "send_failed" ||
    pendingSendStatus === "send_failed_unconfirmed" ||
    pendingSendStatus === "send_failed_confirmed";

  const handleSend = useCallback(() => {
    if (sendBlockedByFailedSlot) return;
    const el = textareaRef.current;
    if (!el) return;
    const text = draftText.trim();
    if (text.length === 0 && pendingFiles.length === 0) return;
    const shouldAddToKnowledgeBase =
      addToKnowledgeBase && pendingFiles.some((file) => isKnowledgeEligibleFile(file));
    onSend(
      // FIX 3 — keep the placeholder going to the API (server-side `message`
      // is required non-empty after trim) but route it through a shared
      // sentinel so `chat-message.tsx` can recognize and hide it at render
      // time. The user's bubble shows just the attachments instead of a
      // literal "(attached files)" line.
      text.length > 0 ? text : ATTACHMENTS_ONLY_PLACEHOLDER,
      pendingFiles.length > 0 ? pendingFiles : undefined,
      shouldAddToKnowledgeBase ? { addToKnowledgeBase: true } : undefined
    );
    setDraftText("");
    el.style.height = "auto";
    setIsComposerMultiline(false);
    setPendingFiles([]);
    setAddToKnowledgeBase(false);
    setAttachmentFeedback(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!isTouchDevice || shouldRestoreComposerFocusAfterSend()) {
      focusRestoreDeadlineRef.current = Date.now() + 400;
      restoreComposerFocusAfterSend(el);
    }
  }, [addToKnowledgeBase, draftText, isTouchDevice, onSend, pendingFiles, sendBlockedByFailedSlot]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // On touch devices (phones, tablets) Enter must insert a newline so
      // the soft keyboard's Return key behaves like in every chat app
      // (Telegram, WhatsApp, iMessage). Sending is exclusively the Send
      // button. On desktop, Enter sends and Shift+Enter inserts a newline.
      if (isTouchDevice) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!isStreaming && !disabled && !sendBlockedByFailedSlot) {
          handleSend();
        }
      }
    },
    [handleSend, isStreaming, disabled, isTouchDevice, sendBlockedByFailedSlot]
  );

  const appendFiles = useCallback(
    (files: Iterable<File>) => {
      setPendingFiles((prev) => {
        const { accepted, oversized } = collectAcceptedFiles(files, prev.length);
        setAttachmentFeedback(
          oversized.length > 0 ? t("attachmentTooLarge", { limit: MAX_CHAT_UPLOAD_MB }) : null
        );
        return accepted.length > 0 ? [...prev, ...accepted] : prev;
      });
    },
    [t]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files;
      if (!selected) return;
      appendFiles(Array.from(selected));
      e.target.value = "";
    },
    [appendFiles]
  );

  const removeFile = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
    setAttachmentFeedback(null);
  }, []);

  // Outside click + Escape close for the attachment tiles popover. Excludes
  // the trigger button itself so a second tap on the paperclip toggles
  // (mousedown would otherwise close before click could re-open).
  useEffect(() => {
    if (!attachMenuOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (attachMenuRef.current?.contains(target)) return;
      if (attachTriggerRef.current?.contains(target)) return;
      setAttachMenuOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setAttachMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [attachMenuOpen]);

  useEffect(() => {
    if (!attachMenuOpen || !isTouchDevice) {
      stopCameraPreview();
      setCameraPreviewState("idle");
      return;
    }

    let cancelled = false;
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      setCameraPreviewState("unavailable");
      return;
    }

    setCameraPreviewState("loading");
    void mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: "environment" }
        },
        audio: false
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        cameraPreviewStreamRef.current = stream;
        const video = cameraPreviewVideoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play().catch(() => undefined);
        }
        setCameraPreviewState("ready");
      })
      .catch(() => {
        if (!cancelled) {
          stopCameraPreview();
          setCameraPreviewState("unavailable");
        }
      });

    return () => {
      cancelled = true;
      stopCameraPreview();
    };
  }, [attachMenuOpen, isTouchDevice, stopCameraPreview]);

  useEffect(() => {
    if (cameraPreviewState !== "ready" || !cameraPreviewVideoRef.current) return;
    cameraPreviewVideoRef.current.srcObject = cameraPreviewStreamRef.current;
    void cameraPreviewVideoRef.current.play().catch(() => undefined);
  }, [cameraPreviewState]);

  const pickFromTile = useCallback((which: "camera" | "photos" | "file") => {
    setAttachMenuOpen(false);
    // Defer the OS picker open until after the popover close paint so the
    // user perceives the tile pressing → menu collapsing → picker rising
    // as a single chained motion rather than two competing surfaces.
    requestAnimationFrame(() => {
      if (which === "camera") cameraInputRef.current?.click();
      else if (which === "photos") photosInputRef.current?.click();
      else fileInputRef.current?.click();
    });
  }, []);

  const isRecording = recordingState === "recording";
  const isTranscribing = recordingState === "transcribing";
  const composerDisabled =
    disabled === true || isRecording || isTranscribing || hardBlockedByFailedSlot;
  const controlsDisabled =
    disabled === true || isRecording || isTranscribing || sendBlockedByFailedSlot;
  const hasKnowledgeEligibleFiles = pendingFiles.some((file) => isKnowledgeEligibleFile(file));
  const visibleMediaJobs = activeMediaJobs.slice(0, 2);
  const showCollapsedMediaJobs = activeMediaJobs.length > 2;
  const visibleDocumentJobs = activeDocumentJobs.slice(0, 2);
  const showCollapsedDocumentJobs = activeDocumentJobs.length > 2;
  const composerCanSend = draftText.trim().length > 0 || pendingFiles.length > 0;
  const showAttachmentOrdinals = pendingFiles.length > 1;
  const showComposerMicSlot = !isRecording || isTouchDevice;
  const showStop = isStreaming;
  const showTranscribing = isTranscribing && !isStreaming;
  const showSend = !showStop && !showTranscribing && composerCanSend;
  const showMic = !showStop && !showTranscribing && showComposerMicSlot && !composerCanSend;
  const composerActionSwapClass = (visible: boolean) =>
    cn(
      visible ? "scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0",
      !visible && "invisible"
    );

  useEffect(() => {
    if (!hasKnowledgeEligibleFiles) {
      setAddToKnowledgeBase(false);
    }
  }, [hasKnowledgeEligibleFiles]);

  useEffect(() => {
    resize();
  }, [draftText, resize]);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const { accepted: pastedFiles, oversized } = collectAcceptedFiles(
        Array.from(e.clipboardData.items)
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null),
        pendingFiles.length
      );
      if (pastedFiles.length === 0) {
        setAttachmentFeedback(
          oversized.length > 0 ? t("attachmentTooLarge", { limit: MAX_CHAT_UPLOAD_MB }) : null
        );
        return;
      }
      e.preventDefault();
      setAttachmentFeedback(
        oversized.length > 0 ? t("attachmentTooLarge", { limit: MAX_CHAT_UPLOAD_MB }) : null
      );
      appendFiles(pastedFiles);
    },
    [appendFiles, pendingFiles.length, t]
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (controlsDisabled || isStreaming || recordingState !== "idle") return;
      if (!Array.from(e.dataTransfer.items).some((item) => item.kind === "file")) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setDragActive(true);
    },
    [controlsDisabled, isStreaming, recordingState]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (controlsDisabled || isStreaming || recordingState !== "idle") return;
      if (!Array.from(e.dataTransfer.items).some((item) => item.kind === "file")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [controlsDisabled, isStreaming, recordingState]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!dragActive) return;
      e.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setDragActive(false);
      }
    },
    [dragActive]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (controlsDisabled || isStreaming || recordingState !== "idle") return;
      if (!Array.from(e.dataTransfer.items).some((item) => item.kind === "file")) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      appendFiles(Array.from(e.dataTransfer.files));
    },
    [appendFiles, controlsDisabled, isStreaming, recordingState]
  );

  const stopRecordingCleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
  }, []);

  const startRecording = useCallback(
    async (options?: { touchHold?: boolean }) => {
      const attemptId = recordingAttemptIdRef.current + 1;
      recordingAttemptIdRef.current = attemptId;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (
          attemptId !== recordingAttemptIdRef.current ||
          (options?.touchHold === true && !touchRecordingIntentActiveRef.current)
        ) {
          stream.getTracks().forEach((track) => track.stop());
          if (attemptId === recordingAttemptIdRef.current) {
            setRecordingState("idle");
            setRecordingSeconds(0);
          }
          return;
        }
        streamRef.current = stream;

        const mimeType = pickVoiceRecordingMimeType();
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
        const resolvedMimeType = recorder.mimeType || mimeType || "audio/webm";
        mediaRecorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onstop = () => {
          if (attemptId !== recordingAttemptIdRef.current) {
            chunksRef.current = [];
            stopRecordingCleanup();
            setRecordingState("idle");
            setRecordingSeconds(0);
            return;
          }
          const blob = new Blob(chunksRef.current, { type: resolvedMimeType });
          const elapsedSec = (Date.now() - recordingStartTimeRef.current) / 1000;
          chunksRef.current = [];
          stopRecordingCleanup();

          if (blob.size < 500) {
            setRecordingState("idle");
            setRecordingSeconds(0);
            return;
          }

          const bytesPerSec = elapsedSec > 0 ? blob.size / elapsedSec : 0;
          if (elapsedSec >= 2 && bytesPerSec < 1000) {
            setRecordingState("idle");
            setRecordingSeconds(0);
            onVoiceTranscriptionError?.({
              code: "voice_transcription_empty",
              message: "No speech was detected in your recording."
            });
            return;
          }

          setRecordingState("transcribing");

          const filename = voiceFilenameForMime(resolvedMimeType);
          const voiceFile = new File([blob], filename, { type: resolvedMimeType });

          void (async () => {
            try {
              const text = await onTranscribeVoice(blob, filename);
              const trimmedText = text.trim();
              if (trimmedText.length === 0) {
                throw {
                  code: "voice_transcription_empty",
                  message: "Voice transcription returned empty text. Please try again."
                };
              }
              onSend(trimmedText, [voiceFile]);
            } catch (error) {
              onVoiceTranscriptionError?.(error);
            } finally {
              setRecordingState("idle");
              setRecordingSeconds(0);
            }
          })();
        };

        recorder.start(250);
        recordingStartTimeRef.current = Date.now();
        setRecordingState("recording");
        setRecordingSeconds(0);
        timerRef.current = setInterval(() => {
          setRecordingSeconds((prev) => prev + 1);
        }, 1000);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[mic] startRecording FAILED:", err);
        if (attemptId === recordingAttemptIdRef.current) {
          setRecordingState("idle");
          setRecordingSeconds(0);
        }
      }
    },
    [onSend, onTranscribeVoice, onVoiceTranscriptionError, stopRecordingCleanup]
  );

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.requestData();
      } catch {
        /* requestData is best-effort across browsers */
      }
      recorder.stop();
    } else {
      recordingAttemptIdRef.current += 1;
      stopRecordingCleanup();
      setRecordingState("idle");
      setRecordingSeconds(0);
    }
  }, [stopRecordingCleanup]);

  const cancelRecording = useCallback(() => {
    recordingAttemptIdRef.current += 1;
    chunksRef.current = [];
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }
    stopRecordingCleanup();
    setRecordingState("idle");
    setRecordingSeconds(0);
  }, [stopRecordingCleanup]);

  // ── Hold-to-record (touch only) ────────────────────────────────────────
  // Telegram-style press-and-hold: hold mic, release to send, deliberate
  // swipe left into the cancel zone then release to discard. Desktop keeps
  // click-to-toggle.
  const holdActiveRef = useRef(false);
  const holdPointerIdRef = useRef<number | null>(null);
  const holdStartTimeRef = useRef(0);
  const holdStartXRef = useRef(0);
  const trashTargetXRef = useRef(0);
  const maxVoicePillWidthRef = useRef(48);
  const cancelArmedRef = useRef(false);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [voicePillWidthPx, setVoicePillWidthPx] = useState(0);
  const voicePillEngulfsTrash =
    isRecording && (cancelArmed || voicePillWidthPx >= VOICE_PILL_MAX_STRETCH_PX - 6);
  const swipeLeftPxRef = useRef(0);

  const safeVibrate = useCallback((pattern: number | number[]) => {
    if (typeof navigator === "undefined") return;
    const n = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
    try {
      n.vibrate?.(pattern);
    } catch {
      /* haptic feedback is best-effort */
    }
  }, []);

  const resetHoldGesture = useCallback(() => {
    holdActiveRef.current = false;
    holdPointerIdRef.current = null;
    cancelArmedRef.current = false;
    swipeLeftPxRef.current = 0;
    setCancelArmed(false);
    setVoicePillWidthPx(0);
  }, []);

  const updateCancelFromPointer = useCallback(
    (clientX: number) => {
      const rawSwipeLeftPx = Math.max(0, holdStartXRef.current - clientX);
      const swipeLeft = Math.max(0, rawSwipeLeftPx - VOICE_GESTURE_SLOP_PX);
      const armed = clientX <= trashTargetXRef.current + VOICE_TRASH_ARM_TOLERANCE_PX;
      if (armed !== cancelArmedRef.current) {
        cancelArmedRef.current = armed;
        setCancelArmed(armed);
        if (armed) safeVibrate(12);
      }

      const targetPillStretch = armed
        ? maxVoicePillWidthRef.current
        : Math.min(swipeLeft, maxVoicePillWidthRef.current);
      if (targetPillStretch !== swipeLeftPxRef.current) {
        swipeLeftPxRef.current = targetPillStretch;
        setVoicePillWidthPx(targetPillStretch);
      }
    },
    [safeVibrate]
  );

  const isRecorderCapturing = useCallback(() => {
    const state = mediaRecorderRef.current?.state;
    return state === "recording" || state === "paused";
  }, []);

  const finishHoldGesture = useCallback(
    (opts: { cancelOnShortHold: boolean }) => {
      if (!holdActiveRef.current) return;
      holdActiveRef.current = false;
      touchRecordingIntentActiveRef.current = false;
      const heldMs = Date.now() - holdStartTimeRef.current;
      const recorderStarted = isRecorderCapturing() || recordingState === "recording";
      const shortHoldShouldCancel =
        opts.cancelOnShortHold && heldMs < VOICE_HOLD_MIN_MS && !recorderStarted;
      if (cancelArmedRef.current || shortHoldShouldCancel) {
        cancelRecording();
      } else if (recorderStarted) {
        stopRecording();
      } else {
        recordingAttemptIdRef.current += 1;
        stopRecordingCleanup();
        setRecordingState("idle");
        setRecordingSeconds(0);
      }
      resetHoldGesture();
    },
    [
      cancelRecording,
      isRecorderCapturing,
      recordingState,
      resetHoldGesture,
      stopRecording,
      stopRecordingCleanup
    ]
  );

  const handleHoldPointerEnd = useCallback(
    (pointerId: number, source: "up" | "cancel") => {
      if (!holdActiveRef.current) return;
      if (holdPointerIdRef.current !== null && pointerId !== holdPointerIdRef.current) {
        return;
      }
      const recorderStarted = isRecorderCapturing() || recordingState === "recording";
      if (source === "cancel" && !cancelArmedRef.current && !recorderStarted) {
        touchRecordingIntentActiveRef.current = false;
        recordingAttemptIdRef.current += 1;
        resetHoldGesture();
        return;
      }
      finishHoldGesture({ cancelOnShortHold: source === "up" });
    },
    [finishHoldGesture, isRecorderCapturing, recordingState, resetHoldGesture]
  );

  const handleMicPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!isTouchDevice) return;
      // Accept touch + pen + unknown ("" on older WebViews). Reject only mouse,
      // because the desktop branch already handles click-to-toggle for mice.
      if (e.pointerType === "mouse") return;
      if (disabled || isStreaming || sendBlockedByFailedSlot) return;
      e.preventDefault();
      holdActiveRef.current = true;
      holdPointerIdRef.current = e.pointerId;
      holdStartTimeRef.current = Date.now();
      holdStartXRef.current = e.clientX;
      const composerRect = composerShellRef.current?.getBoundingClientRect();
      trashTargetXRef.current =
        composerRect !== undefined
          ? composerRect.right - VOICE_TRASH_OFFSET_FROM_RIGHT_PX - VOICE_TRASH_SIZE_PX / 2
          : e.clientX - VOICE_TRASH_OFFSET_FROM_RIGHT_PX - VOICE_TRASH_SIZE_PX / 2;
      maxVoicePillWidthRef.current = VOICE_PILL_MAX_STRETCH_PX;
      cancelArmedRef.current = false;
      swipeLeftPxRef.current = 0;
      setCancelArmed(false);
      setVoicePillWidthPx(0);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* setPointerCapture is best-effort across browsers */
      }
      safeVibrate(15);
      touchRecordingIntentActiveRef.current = true;
      void startRecording({ touchHold: true });
    },
    [isTouchDevice, disabled, isStreaming, sendBlockedByFailedSlot, startRecording, safeVibrate]
  );

  const handleMicPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!holdActiveRef.current || e.pointerId !== holdPointerIdRef.current) return;
      updateCancelFromPointer(e.clientX);
    },
    [updateCancelFromPointer]
  );

  const handleMicPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!holdActiveRef.current) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* best-effort */
      }
      e.currentTarget.blur();
      handleHoldPointerEnd(e.pointerId, "up");
    },
    [handleHoldPointerEnd]
  );

  const handleMicPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.blur();
      if (!holdActiveRef.current) return;
      handleHoldPointerEnd(e.pointerId, "cancel");
    },
    [handleHoldPointerEnd]
  );

  useEffect(() => {
    if (!isTouchDevice || !holdActiveRef.current) return;
    const previousTouchAction = document.body.style.touchAction;
    document.body.style.touchAction = "none";
    return () => {
      document.body.style.touchAction = previousTouchAction;
    };
  }, [isTouchDevice, isRecording]);

  useEffect(() => {
    if (!isTouchDevice) return;
    const onWindowPointerMove = (e: PointerEvent) => {
      if (!holdActiveRef.current || e.pointerType === "mouse") return;
      if (holdPointerIdRef.current !== null && e.pointerId !== holdPointerIdRef.current) return;
      updateCancelFromPointer(e.clientX);
    };
    const onWindowPointerUp = (e: PointerEvent) => {
      if (!holdActiveRef.current || e.pointerType === "mouse") return;
      handleHoldPointerEnd(e.pointerId, "up");
    };
    const onWindowPointerCancel = (e: PointerEvent) => {
      if (!holdActiveRef.current || e.pointerType === "mouse") return;
      handleHoldPointerEnd(e.pointerId, "cancel");
    };
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerCancel);
    };
  }, [handleHoldPointerEnd, isTouchDevice, updateCancelFromPointer]);

  return (
    <div className="border-t border-border bg-bg px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:border-t-0 md:px-4 md:py-3">
      <div className="mx-auto w-full max-w-[50rem]">
        {pendingFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingFiles.map((file, idx) => (
              <div
                key={`${file.name}-${String(idx)}`}
                className="group/file relative flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5"
              >
                <PendingFilePreview
                  file={file}
                  ordinal={idx + 1}
                  showOrdinal={showAttachmentOrdinals}
                />
                <span className="max-w-[120px] truncate text-xs text-text-muted">{file.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(idx)}
                  className="ml-0.5 cursor-pointer rounded-full p-0.5 text-text-subtle transition-colors hover:bg-destructive/15 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {hasKnowledgeEligibleFiles && (
          <label className="mb-2 flex cursor-pointer items-start gap-2 rounded-lg border border-border/70 bg-surface px-3 py-2">
            <input
              type="checkbox"
              aria-label={t("knowledgeAddToBase")}
              checked={addToKnowledgeBase}
              disabled={controlsDisabled}
              onChange={(e) => setAddToKnowledgeBase(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent disabled:cursor-not-allowed"
            />
            <span className="min-w-0">
              <span className="block text-sm text-text">{t("knowledgeAddToBase")}</span>
              <span className="block text-xs text-text-muted">{t("knowledgeAddToBaseHint")}</span>
            </span>
          </label>
        )}

        {isRecording && !isTouchDevice && (
          <div className="mb-2 flex items-center gap-3 rounded-2xl border border-border bg-surface-raised px-3 py-2.5 shadow-sm">
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
              <span
                aria-hidden="true"
                className="absolute inset-0 animate-ping rounded-full bg-accent/20"
              />
              <span className="relative flex h-full w-full items-center justify-center rounded-full bg-accent/12 text-accent">
                <Mic className="h-4 w-4" />
              </span>
            </span>
            <span className="min-w-0">
              <span className="block font-mono text-sm font-medium tabular-nums text-text">
                {t("recording", { duration: formatDuration(recordingSeconds) })}
              </span>
              <span className="block text-[11px] text-text-subtle">{t("voiceHoldRelease")}</span>
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={cancelRecording}
              className="cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              {t("cancelRecording")}
            </button>
            <button
              type="button"
              onClick={stopRecording}
              className="cursor-pointer rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-accent-hover"
            >
              {t("sendRecording")}
            </button>
          </div>
        )}

        {isTranscribing && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            <span className="text-sm text-text-muted">{t("transcribing")}</span>
          </div>
        )}

        {dragActive && (
          <div className="mb-2 rounded-lg border border-dashed border-accent/50 bg-accent/5 px-3 py-2 text-center text-xs text-text-muted">
            {t("dropFilesHere")}
          </div>
        )}
        {attachmentFeedback ? (
          <div
            role="status"
            aria-live="polite"
            className="mb-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {attachmentFeedback}
          </div>
        ) : null}

        <div className="relative">
          {(activeMediaJobs.length > 0 || activeDocumentJobs.length > 0) && (
            <div
              aria-live="polite"
              className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-2 flex flex-col items-center gap-2 md:inset-x-auto md:right-0 md:items-end"
            >
              {activeMediaJobs.length > 0 &&
                (showCollapsedMediaJobs ? (
                  <div className="inline-flex max-w-full items-center rounded-full border border-border/70 bg-surface px-3 py-1 text-xs text-text-muted shadow-sm pointer-events-auto">
                    <span className="truncate">
                      {t("mediaJobsInProgress", { count: activeMediaJobs.length })}
                    </span>
                  </div>
                ) : (
                  <div className="flex max-w-full justify-center gap-2 overflow-x-auto pb-0.5 pointer-events-auto md:justify-end">
                    {visibleMediaJobs.map((job) => (
                      <div
                        key={job.id}
                        className="inline-flex shrink-0 items-center rounded-full border border-border/70 bg-surface px-3 py-1 text-xs text-text-muted shadow-sm"
                      >
                        <span className="whitespace-nowrap">
                          {resolveMediaJobLabel(t, job, mediaJobNowMs)}{" "}
                          {formatDuration(resolveMediaJobElapsedSeconds(job, mediaJobNowMs))}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              {activeDocumentJobs.length > 0 &&
                (showCollapsedDocumentJobs ? (
                  <div className="inline-flex max-w-full items-center rounded-full border border-border/70 bg-surface px-3 py-1 text-xs text-text-muted shadow-sm pointer-events-auto">
                    <span className="truncate">
                      {t("documentJobsInProgress", { count: activeDocumentJobs.length })}
                    </span>
                  </div>
                ) : (
                  <div className="flex max-w-full justify-center gap-2 overflow-x-auto pb-0.5 pointer-events-auto md:justify-end">
                    {visibleDocumentJobs.map((job) => (
                      <div
                        key={job.id}
                        className="inline-flex shrink-0 items-center rounded-full border border-border/70 bg-surface px-3 py-1 text-xs text-text-muted shadow-sm"
                      >
                        <span className="whitespace-nowrap">
                          {resolveDocumentJobLabel(t, job)}{" "}
                          {formatDuration(resolveDocumentJobElapsedSeconds(job, mediaJobNowMs))}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          )}

          <AnimatePresence>
            {isTouchDevice && isRecording && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-none mb-2 flex justify-center"
              >
                <div
                  data-testid="voice-recording-banner"
                  data-cancel-armed={cancelArmed ? "true" : "false"}
                  role="status"
                  aria-live="polite"
                  aria-label={t("recording", { duration: formatDuration(recordingSeconds) })}
                  className={cn(
                    "inline-flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 shadow-sm backdrop-blur-sm transition-colors duration-150",
                    cancelArmed
                      ? "border-destructive/35 bg-destructive/10 text-destructive"
                      : "border-border/60 bg-surface/95 text-text"
                  )}
                >
                  <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-0 animate-ping rounded-full",
                        cancelArmed ? "bg-destructive/20" : "bg-accent/20"
                      )}
                    />
                    <Mic
                      className={cn(
                        "relative h-3.5 w-3.5",
                        cancelArmed ? "text-destructive" : "text-accent"
                      )}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="font-mono text-sm font-medium tabular-nums">
                    {formatDuration(recordingSeconds)}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div
            ref={composerShellRef}
            data-testid="chat-composer-shell"
            className={cn(
              "relative flex min-h-12 items-end gap-0.5 border border-border/80 bg-surface-raised py-1 pl-1 pr-1.5 shadow-sm transition-[border-color,box-shadow,border-radius] focus-within:border-border-strong focus-within:shadow-md",
              isComposerMultiline ? "rounded-[22px]" : "rounded-full",
              dragActive && "border-accent bg-accent/5",
              sendBlockedByFailedSlot && "opacity-90",
              isTouchDevice && isRecording && "touch-none overflow-visible"
            )}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={CHAT_ATTACHMENT_ACCEPT}
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileChange}
            />
            <input
              ref={photosInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              ref={attachTriggerRef}
              type="button"
              disabled={controlsDisabled || isStreaming}
              aria-haspopup="menu"
              aria-expanded={attachMenuOpen}
              onClick={() =>
                setAttachMenuOpen((open) => {
                  const next = !open;
                  if (next && isTouchDevice) {
                    setCameraPreviewState("loading");
                  }
                  return next;
                })
              }
              className={composerIconButtonClass({
                disabled: controlsDisabled || isStreaming,
                active: attachMenuOpen
              })}
              title={t("attachFile")}
            >
              <Paperclip className="h-5 w-5 md:h-4 md:w-4" />
            </button>

            {/*
             * Telegram-style attachment tiles popover. Sits above the composer
             * (anchored bottom-full of the relative composer row) so the input
             * keeps its bottom edge stable as the menu opens / closes; on
             * mobile the keyboard isn't pushed around either. Three square
             * tiles in a single row — Camera / Photos / File — each tile is
             * a quiet warm card that warms up to accent on hover/active.
             */}
            <AnimatePresence>
              {attachMenuOpen && (
                <motion.div
                  ref={attachMenuRef}
                  role="menu"
                  aria-label={t("attachFile")}
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    "absolute bottom-full left-0 z-30 mb-2 rounded-2xl border border-border bg-surface-raised p-2 shadow-xl backdrop-blur-sm",
                    isTouchDevice ? "w-full max-w-[18rem]" : "w-[6.75rem]"
                  )}
                >
                  <div className={cn("grid gap-2", isTouchDevice ? "grid-cols-3" : "grid-cols-1")}>
                    {isTouchDevice && (
                      <>
                        <AttachTile
                          icon={<Camera className="h-6 w-6" />}
                          label={t("attachMenuCamera")}
                          preview={
                            cameraPreviewState !== "unavailable" ? (
                              <CameraPreviewTile
                                videoRef={cameraPreviewVideoRef}
                                state={cameraPreviewState}
                              />
                            ) : undefined
                          }
                          onClick={() => pickFromTile("camera")}
                        />
                        <AttachTile
                          icon={<ImageIcon className="h-6 w-6" />}
                          label={t("attachMenuPhotos")}
                          onClick={() => pickFromTile("photos")}
                        />
                      </>
                    )}
                    <AttachTile
                      icon={<FilesIcon className="h-6 w-6" />}
                      label={t("attachMenuFile")}
                      onClick={() => pickFromTile("file")}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {isTouchDevice && isRecording && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.82, x: 8 }}
                  animate={{
                    opacity: 1,
                    scale: cancelArmed ? 1.06 : 1,
                    x: 0
                  }}
                  exit={{ opacity: 0, scale: 0.9, x: 6 }}
                  transition={{
                    opacity: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
                    scale: { type: "spring", stiffness: 460, damping: 26 },
                    x: { duration: 0.22, ease: [0.22, 1, 0.36, 1] }
                  }}
                  className="pointer-events-none absolute top-1/2 z-20 flex -translate-y-1/2 items-center justify-center"
                  style={{ right: `${VOICE_TRASH_OFFSET_FROM_RIGHT_PX}px` }}
                >
                  <div
                    data-testid="voice-cancel-trash"
                    className={cn(
                      "relative flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-150",
                      voicePillEngulfsTrash
                        ? cancelArmed
                          ? "bg-transparent text-destructive"
                          : "bg-transparent text-text-subtle/70"
                        : cancelArmed
                          ? "bg-destructive/15 text-destructive"
                          : "text-text-subtle/55"
                    )}
                  >
                    {!voicePillEngulfsTrash && !cancelArmed ? (
                      <motion.span
                        aria-hidden="true"
                        className="absolute inset-0 rounded-full border border-text-subtle/20"
                        animate={{ opacity: [0.25, 0.55, 0.25], scale: [0.94, 1.04, 0.94] }}
                        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
                      />
                    ) : null}
                    <Trash2 className="relative h-4 w-4" aria-hidden="true" />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <textarea
              ref={textareaRef}
              rows={1}
              placeholder={t("placeholder")}
              disabled={composerDisabled}
              value={draftText}
              onChange={handleDraftChange}
              onInput={handleDraftChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              style={{ resize: "none" }}
              className={cn(
                "flex-1 resize-none bg-transparent text-sm leading-5 text-text placeholder:text-text-subtle",
                "outline-none",
                "max-h-[200px] py-2.5 pl-0.5 pr-1",
                isTouchDevice && isRecording && "opacity-0"
              )}
            />

            <div className="relative z-30 mb-0.5 h-10 w-10 shrink-0 self-end overflow-visible">
              <AnimatePresence>
                {isTouchDevice && isRecording && (
                  <motion.div
                    initial={{ width: VOICE_MIC_COLUMN_PX, opacity: 0 }}
                    animate={{
                      width: VOICE_MIC_COLUMN_PX + voicePillWidthPx,
                      opacity: 1
                    }}
                    exit={{ width: VOICE_MIC_COLUMN_PX, opacity: 0 }}
                    transition={{
                      width: { type: "spring", stiffness: 420, damping: 32, mass: 0.75 },
                      opacity: { duration: 0.14, ease: [0.22, 1, 0.36, 1] }
                    }}
                    data-testid="voice-stretch-pill"
                    className={cn(
                      "pointer-events-none absolute top-1/2 right-0 z-[5] h-9 -translate-y-1/2 rounded-full border",
                      cancelArmed
                        ? "border-destructive/40 bg-destructive/12"
                        : "border-accent/25 bg-accent/10"
                    )}
                  />
                )}
              </AnimatePresence>
              <button
                type="button"
                onMouseDown={(e) => {
                  if (shouldKeepDesktopComposerFocusOnPointerDown()) {
                    e.preventDefault();
                  }
                }}
                onClick={onStop}
                className={cn(composerStopButtonClass, composerActionSwapClass(showStop))}
                title={t("stop")}
                aria-hidden={!showStop}
                tabIndex={showStop ? 0 : -1}
              >
                <Square className="h-4 w-4 fill-current" strokeWidth={0} />
              </button>
              <div
                className={cn(
                  composerActionSlotClass,
                  "cursor-default",
                  composerActionSwapClass(showTranscribing)
                )}
                aria-hidden={!showTranscribing}
              >
                <Loader2 className="h-5 w-5 animate-spin text-text-subtle" />
              </div>
              {showComposerMicSlot ? (
                <button
                  type="button"
                  disabled={disabled || isStreaming || sendBlockedByFailedSlot}
                  {...(isTouchDevice
                    ? {
                        onPointerDown: handleMicPointerDown,
                        onPointerMove: handleMicPointerMove,
                        onPointerUp: handleMicPointerUp,
                        onPointerCancel: handleMicPointerCancel,
                        onContextMenu: (e: React.MouseEvent) => e.preventDefault()
                      }
                    : { onClick: () => void startRecording() })}
                  className={cn(
                    composerActionSlotClass,
                    "relative z-10 rounded-full touch-none",
                    composerActionSwapClass(showMic),
                    disabled || isStreaming || sendBlockedByFailedSlot
                      ? "cursor-default text-text-subtle/40"
                      : cn(
                          "cursor-pointer text-text-subtle active:bg-surface-hover active:text-text-muted",
                          "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-surface-hover [@media(hover:hover)_and_(pointer:fine)]:hover:text-text-muted",
                          isTouchDevice &&
                            isRecording &&
                            !cancelArmed &&
                            "bg-transparent text-accent",
                          isTouchDevice &&
                            isRecording &&
                            cancelArmed &&
                            "bg-transparent text-destructive"
                        )
                  )}
                  title={isTouchDevice ? t("voiceHoldToRecord") : t("voiceMessage")}
                  aria-label={isTouchDevice ? t("voiceHoldToRecord") : t("voiceMessage")}
                  aria-hidden={!showMic}
                  tabIndex={showMic ? 0 : -1}
                >
                  <Mic className="h-5 w-5 md:h-4 md:w-4" />
                </button>
              ) : null}
              <button
                type="button"
                onMouseDown={(e) => {
                  if (shouldKeepDesktopComposerFocusOnPointerDown()) {
                    e.preventDefault();
                  }
                }}
                onClick={handleSend}
                disabled={controlsDisabled}
                className={cn(
                  composerSendButtonClass(controlsDisabled),
                  composerActionSwapClass(showSend)
                )}
                title={t("send")}
                aria-hidden={!showSend}
                tabIndex={showSend ? 0 : -1}
              >
                <Send className="h-[18px] w-[18px] md:h-4 md:w-4" strokeWidth={2.25} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

/**
 * One quiet square tile inside the attachment popover. Square aspect keeps
 * the three tiles visually equivalent regardless of label width, and the
 * warm tonal hover state (accent-tinted ring + surface-hover background)
 * matches the same premium-but-calm signal language as the chat list
 * Sparkles badge and the deep-mode subtitle in the chat header.
 */
function AttachTile({
  icon,
  label,
  preview,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  preview?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "group relative flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl bg-surface ring-1 ring-border/40 transition-colors",
        "hover:bg-surface-hover hover:ring-accent/40 active:bg-surface-hover",
        preview && "bg-black ring-white/10"
      )}
    >
      {preview && <span className="absolute inset-0">{preview}</span>}
      <span
        className={cn(
          "relative z-10 text-text-muted transition-colors group-hover:text-accent",
          preview &&
            "rounded-full bg-black/30 p-1.5 text-white/90 shadow-sm backdrop-blur-sm group-hover:text-white"
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          "relative z-10 text-[11px] font-medium text-text-muted",
          preview && "text-white/90 drop-shadow"
        )}
      >
        {label}
      </span>
    </button>
  );
}

function CameraPreviewTile({
  videoRef,
  state
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  state: "idle" | "loading" | "ready" | "unavailable";
}) {
  return (
    <>
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        aria-hidden="true"
        className={cn(
          "h-full w-full object-cover transition-opacity duration-200",
          state === "ready" ? "opacity-100" : "opacity-0"
        )}
      />
      <span className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-black/20" />
      {state !== "ready" && (
        <span className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_60%)]" />
      )}
    </>
  );
}
