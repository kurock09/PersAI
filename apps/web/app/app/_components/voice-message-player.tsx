"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";

function formatVoiceTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const s = Math.floor(totalSeconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m)}:${String(r).padStart(2, "0")}`;
}

type VoiceMessagePlayerProps = {
  src: string;
  className?: string;
  /** Compact (user bubble) vs slightly wider */
  variant?: "user" | "assistant";
};

export function VoiceMessagePlayer({ src, className, variant = "user" }: VoiceMessagePlayerProps) {
  const t = useTranslations("chat");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    setReady(false);
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    el.pause();
    el.currentTime = 0;
    el.load();
  }, [src]);

  const onTimeUpdate = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    setCurrent(el.currentTime);
    if (el.duration && Number.isFinite(el.duration)) {
      setDuration(el.duration);
    }
  }, []);

  const onLoadedMetadata = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.duration && Number.isFinite(el.duration)) {
      setDuration(el.duration);
    }
    setReady(true);
  }, []);

  const onEnded = useCallback(() => {
    setPlaying(false);
    setCurrent(0);
    const el = audioRef.current;
    if (el) el.currentTime = 0;
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play().then(
        () => setPlaying(true),
        () => setPlaying(false)
      );
    }
  }, [playing]);

  const seek = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const el = audioRef.current;
      if (!el || !duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = Math.min(1, Math.max(0, x / rect.width));
      el.currentTime = ratio * duration;
      setCurrent(el.currentTime);
    },
    [duration]
  );

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border border-border/80 bg-surface-raised/90 py-1.5 pl-1.5 pr-3 shadow-sm",
        variant === "user" ? "max-w-[min(100%,240px)]" : "max-w-[min(100%,280px)]",
        className
      )}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onEnded={onEnded}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />

      <button
        type="button"
        onClick={() => void toggle()}
        disabled={!ready && !src}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
          "bg-accent text-white hover:bg-accent/90",
          "disabled:cursor-not-allowed disabled:opacity-40"
        )}
        title={playing ? t("pauseVoice") : t("playVoice")}
        aria-label={playing ? t("pauseVoice") : t("playVoice")}
      >
        {playing ? (
          <Pause className="h-4 w-4" fill="currentColor" />
        ) : (
          <Play className="h-4 w-4 ml-0.5" fill="currentColor" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="group/track relative h-1.5 w-full cursor-pointer rounded-full bg-border/60"
          onClick={seek}
          aria-label={t("voiceSeek")}
        >
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-accent/80 transition-[width] duration-150"
            style={{ width: `${String(progress * 100)}%` }}
          />
        </button>
        <div className="mt-1 flex justify-end text-[10px] tabular-nums text-text-subtle">
          {formatVoiceTime(current)} / {formatVoiceTime(duration)}
        </div>
      </div>
    </div>
  );
}
