"use client";

import { useEffect, useMemo } from "react";
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

/**
 * ADR-114 — compact, non-blocking live voice indicator. Replaces the former
 * full-screen modal: it floats just above the composer as a small pill so the
 * chat transcript stays visible and interactive during a live conversation.
 */
export function LiveVoiceOverlay({
  status,
  error,
  transport,
  onStop,
  onClose
}: LiveVoiceOverlayProps) {
  const t = useTranslations("chat");

  const active = isActiveStatus(status);
  const unavailable = status === "unavailable";
  const transportBadge = resolveTransportBadge(transport);

  const errorMessage = useMemo(() => {
    if (error?.code === "live_voice_microphone_denied") {
      return t("liveVoice.micDenied");
    }
    return error?.message ?? t("liveVoice.errorHint");
  }, [error?.code, error?.message, t]);

  // Auto-dismiss terminal error/unavailable states so the chat is never left
  // with a stale pill the user has to manually close.
  useEffect(() => {
    if (active || status === "idle") {
      return;
    }
    const timer = window.setTimeout(() => {
      onClose();
    }, 6_000);
    return () => window.clearTimeout(timer);
  }, [active, status, onClose]);

  const pulseTone =
    status === "speaking" ? "bg-accent" : status === "recovering" ? "bg-warning" : "bg-success";
  const StatusIcon = status === "speaking" ? Volume2 : Mic;

  return (
    <AnimatePresence>
      {status !== "idle" ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-3 md:bottom-28">
          <motion.div
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "pointer-events-auto flex items-center gap-3 rounded-full border bg-surface-raised/95 py-2 pl-3 pr-2 shadow-[0_12px_40px_rgba(0,0,0,0.25)] backdrop-blur-sm",
              error
                ? "border-destructive/30"
                : unavailable
                  ? "border-warning/30"
                  : "border-border/80"
            )}
          >
            {error || unavailable ? (
              <>
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    error ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"
                  )}
                >
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <span className="max-w-[16rem] truncate text-sm text-text-muted">
                  {error ? errorMessage : t("liveVoice.unavailableHint")}
                </span>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-surface-hover hover:text-text"
                  aria-label={t("liveVoice.close")}
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center">
                  <motion.span
                    aria-hidden="true"
                    className={cn("absolute inset-0 rounded-full opacity-20", pulseTone)}
                    animate={{ scale: [1, 1.25, 1], opacity: [0.18, 0.36, 0.18] }}
                    transition={{
                      duration: 1.4,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: "easeInOut"
                    }}
                  />
                  <span
                    className={cn(
                      "relative flex h-7 w-7 items-center justify-center rounded-full",
                      status === "recovering"
                        ? "bg-warning/15 text-warning"
                        : status === "speaking"
                          ? "bg-accent/15 text-accent"
                          : "bg-success/15 text-success"
                    )}
                  >
                    {status === "connecting" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <StatusIcon className="h-4 w-4" />
                    )}
                  </span>
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-medium leading-tight text-text">
                    {t(`liveVoice.${resolveStatusLabelKey(status)}`)}
                  </span>
                  {transportBadge ? (
                    <span className="text-[11px] leading-tight text-text-subtle">
                      {transportBadge}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={onStop}
                  className="flex h-8 items-center gap-1.5 rounded-full bg-destructive px-3 text-xs font-medium text-white shadow-sm transition-colors hover:bg-destructive/90"
                >
                  <PhoneOff className="h-3.5 w-3.5" />
                  {t("liveVoice.stop")}
                </button>
              </>
            )}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
