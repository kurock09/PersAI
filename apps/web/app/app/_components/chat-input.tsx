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
  SendHorizonal,
  Square,
  Paperclip,
  X,
  FileText,
  Music,
  Film,
  Mic,
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
import type { WebChatActiveMediaJobState } from "../assistant-api-client";
import { useTouchDevice } from "./use-touch-device";
import { ATTACHMENTS_ONLY_PLACEHOLDER } from "./attachments-only-placeholder";

const MAX_FILES = 5;

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

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

function isAcceptedFile(file: File): boolean {
  return isAcceptedChatFile(file);
}

function resolveMediaJobLabel(
  t: ReturnType<typeof useTranslations>,
  job: WebChatActiveMediaJobState
): string {
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

function collectAcceptedFiles(files: Iterable<File>, existingCount: number): File[] {
  const accepted: File[] = [];
  for (const file of files) {
    if (!isAcceptedFile(file)) continue;
    if (existingCount + accepted.length >= MAX_FILES) break;
    accepted.push(file);
  }
  return accepted;
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
    activeMediaJobs = []
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
  const dragDepthRef = useRef(0);
  const isTouchDevice = useTouchDevice();
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [addToKnowledgeBase, setAddToKnowledgeBase] = useState(false);
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
    if (activeMediaJobs.length === 0) {
      return;
    }
    setMediaJobNowMs(Date.now());
    const timer = window.setInterval(() => {
      setMediaJobNowMs(Date.now());
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [activeMediaJobs]);

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
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      setDraft(text: string) {
        const el = textareaRef.current;
        if (el === null) return;
        el.value = text;
        resize();
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
    const text = el.value.trim();
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
    el.value = "";
    el.style.height = "auto";
    setPendingFiles([]);
    setAddToKnowledgeBase(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!isTouchDevice || shouldRestoreComposerFocusAfterSend()) {
      focusRestoreDeadlineRef.current = Date.now() + 400;
      restoreComposerFocusAfterSend(el);
    }
  }, [addToKnowledgeBase, isTouchDevice, onSend, pendingFiles, sendBlockedByFailedSlot]);

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

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected) return;
    setPendingFiles((prev) => {
      return [...prev, ...collectAcceptedFiles(Array.from(selected), prev.length)];
    });
    e.target.value = "";
  }, []);

  const appendFiles = useCallback((files: Iterable<File>) => {
    setPendingFiles((prev) => [...prev, ...collectAcceptedFiles(files, prev.length)]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
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

  useEffect(() => {
    if (!hasKnowledgeEligibleFiles) {
      setAddToKnowledgeBase(false);
    }
  }, [hasKnowledgeEligibleFiles]);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const pastedFiles = collectAcceptedFiles(
        Array.from(e.clipboardData.items)
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null),
        pendingFiles.length
      );
      if (pastedFiles.length === 0) {
        return;
      }
      e.preventDefault();
      appendFiles(pastedFiles);
    },
    [appendFiles, pendingFiles.length]
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
        // 2026-04-25 diagnostic — see [mic] in logcat to trace where startRecording fails on Samsung Z Fold.
        // eslint-disable-next-line no-console
        console.log("[mic] startRecording: requesting getUserMedia");
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
        // eslint-disable-next-line no-console
        console.log("[mic] startRecording: getUserMedia OK, picking mimeType");

        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";
        // eslint-disable-next-line no-console
        console.log(`[mic] startRecording: mimeType=${mimeType}`);
        const recorder = new MediaRecorder(stream, { mimeType });
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
          const blob = new Blob(chunksRef.current, { type: mimeType });
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
            onVoiceTranscriptionError?.(new Error("NO_AUDIO_DETECTED"));
            return;
          }

          setRecordingState("transcribing");

          const filename = `voice-${Date.now()}.webm`;
          const voiceFile = new File([blob], filename, { type: mimeType });

          void (async () => {
            try {
              const text = await onTranscribeVoice(blob, filename);
              const trimmedText = text.trim();
              if (trimmedText.length === 0) {
                throw new Error("Voice transcription returned empty text. Please try again.");
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
        // eslint-disable-next-line no-console
        console.log("[mic] startRecording: recorder.start() OK, state=recording");
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
  // Telegram-style press-and-hold UX: pointer-down on the mic starts the
  // recorder, pointer-up sends, swipe up beyond a threshold flips into a
  // "release-to-cancel" state. Desktop / mouse users keep the existing
  // click-to-toggle behaviour because the founder asked us not to disturb
  // the web flow.
  const HOLD_MIN_MS = 250;
  const CANCEL_THRESHOLD_PX = 80;
  const holdActiveRef = useRef(false);
  const holdStartTimeRef = useRef(0);
  const holdStartYRef = useRef(0);
  const cancelArmedRef = useRef(false);
  const [cancelArmed, setCancelArmed] = useState(false);

  const safeVibrate = useCallback((pattern: number | number[]) => {
    if (typeof navigator === "undefined") return;
    const n = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
    try {
      n.vibrate?.(pattern);
    } catch {
      /* haptic feedback is best-effort */
    }
  }, []);

  const handleMicPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      // 2026-04-25 diagnostic: surface the exit reason via Capacitor/Console
      // so logcat shows why the recorder didn't start on a real device.
      // Cheap, single-line, removed once the Samsung Z Fold flow is verified.
      // eslint-disable-next-line no-console
      console.log(
        `[mic] pointerdown type=${e.pointerType} touch=${isTouchDevice} disabled=${disabled} streaming=${isStreaming}`
      );
      if (!isTouchDevice) return;
      // Accept touch + pen + unknown ("" on older WebViews). Reject only mouse,
      // because the desktop branch already handles click-to-toggle for mice.
      if (e.pointerType === "mouse") return;
      if (disabled || isStreaming || sendBlockedByFailedSlot) return;
      e.preventDefault();
      holdActiveRef.current = true;
      holdStartTimeRef.current = Date.now();
      holdStartYRef.current = e.clientY;
      cancelArmedRef.current = false;
      setCancelArmed(false);
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
      if (!holdActiveRef.current) return;
      const dy = holdStartYRef.current - e.clientY;
      const armed = dy > CANCEL_THRESHOLD_PX;
      if (armed !== cancelArmedRef.current) {
        cancelArmedRef.current = armed;
        setCancelArmed(armed);
        if (armed) safeVibrate(10);
      }
    },
    [safeVibrate]
  );

  const handleMicPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!holdActiveRef.current) return;
      holdActiveRef.current = false;
      touchRecordingIntentActiveRef.current = false;
      const heldMs = Date.now() - holdStartTimeRef.current;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* best-effort */
      }
      e.currentTarget.blur();
      if (cancelArmedRef.current || heldMs < HOLD_MIN_MS) {
        cancelRecording();
      } else {
        stopRecording();
      }
      cancelArmedRef.current = false;
      setCancelArmed(false);
    },
    [cancelRecording, stopRecording]
  );

  const handleMicPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.blur();
      if (!holdActiveRef.current) return;
      holdActiveRef.current = false;
      touchRecordingIntentActiveRef.current = false;
      cancelRecording();
      cancelArmedRef.current = false;
      setCancelArmed(false);
    },
    [cancelRecording]
  );

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
                {file.type.startsWith("image/") ? (
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="h-8 w-8 rounded object-cover"
                  />
                ) : (
                  fileIcon(file.type)
                )}
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

        <div className="relative">
          {activeMediaJobs.length > 0 && (
            <div
              aria-live="polite"
              className="pointer-events-none absolute bottom-full left-0 right-0 z-10 mb-2"
            >
              {showCollapsedMediaJobs ? (
                <div className="inline-flex max-w-full items-center rounded-full border border-border/70 bg-surface px-3 py-1 text-xs text-text-muted shadow-sm pointer-events-auto">
                  <span className="truncate">
                    {t("mediaJobsInProgress", { count: activeMediaJobs.length })}
                  </span>
                </div>
              ) : (
                <div className="flex max-w-full gap-2 overflow-x-auto pb-0.5 pointer-events-auto">
                  {visibleMediaJobs.map((job) => (
                    <div
                      key={job.id}
                      className="inline-flex shrink-0 items-center rounded-full border border-border/70 bg-surface px-3 py-1 text-xs text-text-muted shadow-sm"
                    >
                      <span className="whitespace-nowrap">
                        {resolveMediaJobLabel(t, job)}{" "}
                        {formatDuration(resolveMediaJobElapsedSeconds(job, mediaJobNowMs))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div
            className={cn(
              "relative flex items-end gap-2 rounded-2xl border border-border bg-surface-raised p-2 transition-colors focus-within:border-border-strong",
              dragActive && "border-accent bg-accent/5",
              sendBlockedByFailedSlot && "opacity-90"
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
              className={cn(
                "mb-0.5 rounded-lg p-2 transition-colors",
                controlsDisabled || isStreaming
                  ? "cursor-default text-text-subtle/40"
                  : "cursor-pointer text-text-subtle hover:bg-surface-hover hover:text-text-muted",
                attachMenuOpen && "bg-surface-hover text-text-muted"
              )}
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

            {/*
             * Hold-to-record overlay (touch only). Floats above the composer,
             * centered horizontally so the user's eye lands on the recording
             * indicator while their thumb is still on the mic button. Pointer
             * events stay on the mic button via setPointerCapture, so the
             * overlay itself is non-interactive (`pointer-events-none`).
             */}
            <AnimatePresence>
              {isTouchDevice && isRecording && (
                <motion.div
                  role="status"
                  aria-live="polite"
                  aria-label={t("recording", { duration: formatDuration(recordingSeconds) })}
                  initial={{ opacity: 0, y: 12, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12, scale: 0.96 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-3 flex -translate-x-1/2 flex-col items-center"
                >
                  <div
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-2xl border bg-surface-raised px-5 py-4 shadow-xl backdrop-blur-sm transition-colors",
                      cancelArmed ? "border-destructive/40" : "border-border"
                    )}
                  >
                    <span className="relative flex h-14 w-14 items-center justify-center">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute inset-0 animate-ping rounded-full",
                          cancelArmed ? "bg-destructive/30" : "bg-accent/30"
                        )}
                      />
                      <span
                        className={cn(
                          "relative flex h-full w-full items-center justify-center rounded-full transition-colors",
                          cancelArmed
                            ? "bg-destructive/15 text-destructive"
                            : "bg-accent/15 text-accent"
                        )}
                      >
                        <Mic className="h-7 w-7" />
                      </span>
                    </span>
                    <span
                      className={cn(
                        "font-mono text-sm tabular-nums transition-colors",
                        cancelArmed ? "text-destructive" : "text-text-muted"
                      )}
                    >
                      {formatDuration(recordingSeconds)}
                    </span>
                    <span
                      className={cn(
                        "text-center text-[11px] leading-tight transition-colors",
                        cancelArmed ? "text-destructive" : "text-text-subtle"
                      )}
                    >
                      {cancelArmed ? (
                        t("voiceCancelArmed")
                      ) : (
                        <>
                          {t("voiceHoldRelease")}
                          <span aria-hidden="true" className="mx-1 text-border-strong">
                            ·
                          </span>
                          {t("voiceSwipeUpToCancel")}
                        </>
                      )}
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <textarea
              ref={textareaRef}
              rows={1}
              placeholder={t("placeholder")}
              disabled={composerDisabled}
              onInput={resize}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              style={{ resize: "none" }}
              className={cn(
                "flex-1 resize-none bg-transparent text-sm text-text placeholder:text-text-subtle",
                "outline-none",
                "max-h-[200px] py-2"
              )}
            />

            {(!isRecording || isTouchDevice) && !isTranscribing && (
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
                  "mb-0.5 rounded-lg p-2 transition-colors select-none",
                  disabled || isStreaming || sendBlockedByFailedSlot
                    ? "cursor-default text-text-subtle/40"
                    : isTouchDevice
                      ? "cursor-pointer text-text-subtle active:bg-surface-hover active:text-text-muted"
                      : "cursor-pointer text-text-subtle hover:bg-surface-hover hover:text-text-muted",
                  isTouchDevice && isRecording && !cancelArmed && "bg-accent/15 text-accent",
                  isTouchDevice &&
                    isRecording &&
                    cancelArmed &&
                    "bg-destructive/15 text-destructive"
                )}
                title={isTouchDevice ? t("voiceHoldToRecord") : t("voiceMessage")}
                aria-label={isTouchDevice ? t("voiceHoldToRecord") : t("voiceMessage")}
              >
                <Mic className="h-5 w-5 md:h-4 md:w-4" />
              </button>
            )}

            {isStreaming ? (
              <button
                type="button"
                onMouseDown={(e) => {
                  if (shouldKeepDesktopComposerFocusOnPointerDown()) {
                    e.preventDefault();
                  }
                }}
                onClick={onStop}
                className="mb-0.5 cursor-pointer rounded-lg bg-destructive/15 p-2 text-destructive transition-colors hover:bg-destructive/25"
                title={t("stop")}
              >
                <Square className="h-5 w-5 md:h-4 md:w-4" />
              </button>
            ) : (
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
                  "mb-0.5 rounded-lg p-2 transition-colors",
                  controlsDisabled
                    ? "cursor-default text-text-subtle/40"
                    : "cursor-pointer bg-accent text-white hover:bg-accent-hover"
                )}
                title={t("send")}
              >
                <SendHorizonal className="h-5 w-5 md:h-4 md:w-4" />
              </button>
            )}
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
