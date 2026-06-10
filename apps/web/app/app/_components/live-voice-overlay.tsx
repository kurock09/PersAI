"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import { AlertTriangle, Loader2, Mic, PhoneOff, Volume2, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import type { LiveVoiceError, LiveVoiceStatus, LiveVoiceTransport } from "./live-voice-types";

type LiveVoiceOverlayProps = {
  status: LiveVoiceStatus;
  error: LiveVoiceError | null;
  transport: LiveVoiceTransport | null;
  onStop: () => void;
  onClose: () => void;
};

function isActiveStatus(status: LiveVoiceStatus): boolean {
  return (
    status === "connecting" ||
    status === "listening" ||
    status === "speaking" ||
    status === "working" ||
    status === "recovering" ||
    status === "stopping"
  );
}

function resolveStatusLabelKey(status: LiveVoiceStatus): string {
  switch (status) {
    case "connecting":
      return "connecting";
    case "listening":
      return "listening";
    case "speaking":
      return "speaking";
    case "working":
      return "working";
    case "recovering":
      return "recovering";
    case "stopping":
      return "stopping";
    case "unavailable":
      return "unavailable";
    default:
      return "connecting";
  }
}

function resolveTransportBadge(transport: LiveVoiceTransport | null): string | null {
  switch (transport) {
    case "direct-webrtc":
      return "WebRTC";
    case "direct-websocket":
      return "WebSocket";
    case "relay-websocket":
      return "Relay";
    default:
      return null;
  }
}

function StateIndicator({ status }: { status: LiveVoiceStatus }) {
  const pulseTone =
    status === "speaking" ? "bg-accent" : status === "recovering" ? "bg-warning" : "bg-success";
  const Icon = status === "speaking" ? Volume2 : status === "recovering" ? AlertTriangle : Mic;

  return (
    <div className="relative flex h-16 w-16 items-center justify-center">
      <motion.span
        aria-hidden="true"
        className={cn("absolute inset-0 rounded-full opacity-20", pulseTone)}
        animate={{ scale: [1, 1.16, 1], opacity: [0.16, 0.34, 0.16] }}
        transition={{ duration: 1.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
      />
      <motion.span
        aria-hidden="true"
        className={cn("absolute inset-[8px] rounded-full opacity-20", pulseTone)}
        animate={{ scale: [1, 1.08, 1], opacity: [0.18, 0.3, 0.18] }}
        transition={{
          duration: 1.1,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
          delay: 0.1
        }}
      />
      <span
        className={cn(
          "relative flex h-12 w-12 items-center justify-center rounded-full border border-white/10 text-white shadow-lg",
          status === "recovering"
            ? "bg-warning/20 text-warning"
            : status === "speaking"
              ? "bg-accent/20 text-accent"
              : "bg-success/20 text-success"
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
    </div>
  );
}

export function LiveVoiceOverlay({
  status,
  error,
  transport,
  onStop,
  onClose
}: LiveVoiceOverlayProps) {
  const t = useTranslations("chat");
  const titleId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const active = isActiveStatus(status);
  const unavailable = status === "unavailable";
  const terminal = !active;
  const transportBadge = resolveTransportBadge(transport);

  const errorMessage = useMemo(() => {
    if (error?.code === "live_voice_microphone_denied") {
      return t("liveVoice.micDenied");
    }
    return error?.message ?? t("liveVoice.errorHint");
  }, [error?.code, error?.message, t]);

  useEffect(() => {
    buttonRef.current?.focus();
  }, [status, errorMessage]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      if (active) {
        onStop();
      } else {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, onClose, onStop]);

  const body = error ? (
    <>
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-destructive/25 bg-destructive/10 text-destructive">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <div className="space-y-2 text-center">
        <h2 id={titleId} className="text-lg font-semibold text-text">
          {t("liveVoice.error")}
        </h2>
        <p className="text-sm leading-relaxed text-text-muted">{errorMessage}</p>
      </div>
      <button
        ref={buttonRef}
        type="button"
        onClick={onClose}
        className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-surface px-5 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
      >
        {t("liveVoice.close")}
      </button>
    </>
  ) : unavailable ? (
    <>
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-warning/25 bg-warning/10 text-warning">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <div className="space-y-2 text-center">
        <h2 id={titleId} className="text-lg font-semibold text-text">
          {t("liveVoice.unavailable")}
        </h2>
        <p className="text-sm leading-relaxed text-text-muted">{t("liveVoice.unavailableHint")}</p>
      </div>
      <button
        ref={buttonRef}
        type="button"
        onClick={onClose}
        className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-surface px-5 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
      >
        {t("liveVoice.close")}
      </button>
    </>
  ) : (
    <>
      <StateIndicator status={status} />
      <div className="space-y-2 text-center">
        <h2 id={titleId} className="text-lg font-semibold text-text">
          {t(`liveVoice.${resolveStatusLabelKey(status)}`)}
        </h2>
        <div className="flex items-center justify-center gap-2 text-sm text-text-muted">
          {status === "connecting" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {transportBadge ? (
            <span className="rounded-full border border-border/70 bg-surface px-2 py-0.5 text-xs">
              {transportBadge}
            </span>
          ) : null}
        </div>
      </div>
      <button
        ref={buttonRef}
        type="button"
        onClick={onStop}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-destructive px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-destructive/90"
      >
        <PhoneOff className="h-4 w-4" />
        {t("liveVoice.stop")}
      </button>
    </>
  );

  return (
    <AnimatePresence>
      {status !== "idle" ? (
        <motion.div
          key="live-voice-overlay"
          className="fixed inset-0 z-[9500] flex items-end justify-center bg-bg/80 p-3 backdrop-blur-sm md:items-center md:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-label={t("liveVoice.start")}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="relative flex w-full max-w-md flex-col items-center gap-5 rounded-[28px] border border-border/80 bg-surface-raised/95 px-5 py-6 text-text shadow-[0_28px_80px_rgba(0,0,0,0.45)] md:px-6"
          >
            {terminal ? (
              <button
                type="button"
                onClick={onClose}
                className="absolute right-3 top-3 rounded-full border border-border/70 bg-surface p-2 text-text-subtle transition-colors hover:text-text"
                aria-label={t("liveVoice.close")}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
            {body}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
