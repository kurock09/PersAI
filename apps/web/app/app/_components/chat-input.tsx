"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  SendHorizonal,
  Square,
  Paperclip,
  X,
  FileText,
  Music,
  Film,
  Mic,
  Loader2
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import { useTranslations } from "next-intl";

const ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,audio/mpeg,audio/ogg,audio/wav,audio/webm,video/mp4,video/webm,application/pdf";
const MAX_FILES = 5;
const ACCEPTED_MIME_TYPES = new Set(ACCEPT.split(","));

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
  return ACCEPTED_MIME_TYPES.has(file.type);
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
  onSend: (text: string, files?: File[]) => void;
  onTranscribeVoice: (audioBlob: Blob, filename: string) => Promise<string>;
  onVoiceTranscriptionError?: (error: unknown) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
}

export function ChatInput({
  onSend,
  onTranscribeVoice,
  onVoiceTranscriptionError,
  onStop,
  isStreaming,
  disabled
}: ChatInputProps) {
  const t = useTranslations("chat");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingStartTimeRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  const handleSend = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const text = el.value.trim();
    if (text.length === 0 && pendingFiles.length === 0) return;
    onSend(
      text.length > 0 ? text : "(attached files)",
      pendingFiles.length > 0 ? pendingFiles : undefined
    );
    el.value = "";
    el.style.height = "auto";
    setPendingFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [onSend, pendingFiles]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!isStreaming && !disabled) {
          handleSend();
        }
      }
    },
    [handleSend, isStreaming, disabled]
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

  const isRecording = recordingState === "recording";
  const isTranscribing = recordingState === "transcribing";
  const inputDisabled = disabled || isRecording || isTranscribing;

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
      if (inputDisabled || isStreaming || recordingState !== "idle") return;
      if (!Array.from(e.dataTransfer.items).some((item) => item.kind === "file")) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setDragActive(true);
    },
    [inputDisabled, isStreaming, recordingState]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (inputDisabled || isStreaming || recordingState !== "idle") return;
      if (!Array.from(e.dataTransfer.items).some((item) => item.kind === "file")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [inputDisabled, isStreaming, recordingState]
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
      if (inputDisabled || isStreaming || recordingState !== "idle") return;
      if (!Array.from(e.dataTransfer.items).some((item) => item.kind === "file")) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      appendFiles(Array.from(e.dataTransfer.files));
    },
    [appendFiles, inputDisabled, isStreaming, recordingState]
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

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
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
      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch {
      setRecordingState("idle");
    }
  }, [onSend, onTranscribeVoice, onVoiceTranscriptionError, stopRecordingCleanup]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      stopRecordingCleanup();
      setRecordingState("idle");
      setRecordingSeconds(0);
    }
  }, [stopRecordingCleanup]);

  const cancelRecording = useCallback(() => {
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

  return (
    <div className="border-t border-border bg-bg px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:px-4 md:py-3">
      <div className="mx-auto max-w-3xl">
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

        {isRecording && (
          <div className="mb-2 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive" />
            <span className="text-sm font-medium text-destructive">
              {t("recording", { duration: formatDuration(recordingSeconds) })}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={cancelRecording}
              className="cursor-pointer rounded px-2 py-0.5 text-xs text-text-muted transition-colors hover:bg-surface-hover"
            >
              {t("cancelRecording")}
            </button>
            <button
              type="button"
              onClick={stopRecording}
              className="cursor-pointer rounded bg-accent px-3 py-0.5 text-xs text-white transition-colors hover:bg-accent-hover"
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

        <div
          className={cn(
            "flex items-end gap-2 rounded-xl border border-border bg-surface p-2 transition-colors focus-within:border-border-strong",
            dragActive && "border-accent bg-accent/5"
          )}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            disabled={inputDisabled || isStreaming}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "mb-0.5 rounded-lg p-2 transition-colors",
              inputDisabled || isStreaming
                ? "cursor-default text-text-subtle/40"
                : "cursor-pointer text-text-subtle hover:bg-surface-hover hover:text-text-muted"
            )}
            title={t("attachFile")}
          >
            <Paperclip className="h-5 w-5 md:h-4 md:w-4" />
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={t("placeholder")}
            disabled={inputDisabled}
            onInput={resize}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            className={cn(
              "flex-1 resize-none bg-transparent text-sm text-text placeholder:text-text-subtle",
              "outline-none",
              "max-h-[200px] py-2"
            )}
          />

          {!isRecording && !isTranscribing && (
            <button
              type="button"
              disabled={disabled || isStreaming}
              onClick={() => void startRecording()}
              className={cn(
                "mb-0.5 rounded-lg p-2 transition-colors",
                disabled || isStreaming
                  ? "cursor-default text-text-subtle/40"
                  : "cursor-pointer text-text-subtle hover:bg-surface-hover hover:text-text-muted"
              )}
              title={t("voiceMessage")}
            >
              <Mic className="h-5 w-5 md:h-4 md:w-4" />
            </button>
          )}

          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              className="mb-0.5 cursor-pointer rounded-lg bg-destructive/15 p-2 text-destructive transition-colors hover:bg-destructive/25"
              title={t("stop")}
            >
              <Square className="h-5 w-5 md:h-4 md:w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={inputDisabled}
              className={cn(
                "mb-0.5 rounded-lg p-2 transition-colors",
                inputDisabled
                  ? "cursor-default text-text-subtle/40"
                  : "cursor-pointer bg-accent text-white hover:bg-accent-hover"
              )}
              title={t("send")}
            >
              <SendHorizonal className="h-5 w-5 md:h-4 md:w-4" />
            </button>
          )}
        </div>

        <p className="mt-1.5 hidden text-center text-[11px] text-text-subtle md:block">
          {t("inputHint")}
        </p>
      </div>
    </div>
  );
}
