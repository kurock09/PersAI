"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/app/lib/utils";

/**
 * ADR-109 Slice 9 — voice preview play/pause button.
 *
 * When `previewAudioUrl` is non-null and non-empty: renders an active play/pause
 * toggle button. Click toggles HTML5 audio playback. Only one preview plays at
 * a time across all instances on the page (coordinated via a module-level ref).
 *
 * When `previewAudioUrl` is null or empty: renders a grey, disabled play icon
 * button with `aria-disabled="true"` and tooltip "Preview unavailable".
 */

// Module-level coordination: only one audio element plays at a time.
let currentlyPlayingAudio: HTMLAudioElement | null = null;
let currentlyPlayingSetPlaying: ((v: boolean) => void) | null = null;
let currentPlaybackSessionId = 0;
const PREVIEW_START_TIMEOUT_MS = 4_000;

export function VoicePreviewButton({
  previewAudioUrl,
  voiceLabel,
  previewUnavailableLabel = "Preview unavailable",
  playLabel,
  pauseLabel,
  className,
  iconClassName,
  disabled = false
}: {
  previewAudioUrl: string | null;
  voiceLabel: string;
  previewUnavailableLabel?: string;
  playLabel?: string;
  pauseLabel?: string;
  className?: string;
  iconClassName?: string;
  disabled?: boolean;
}): React.ReactElement {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackSessionRef = useRef(0);
  const startupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isActive = previewAudioUrl !== null && previewAudioUrl.length > 0;
  const resolvedPlayLabel = playLabel ?? `Play preview: ${voiceLabel}`;
  const resolvedPauseLabel = pauseLabel ?? `Pause preview: ${voiceLabel}`;

  const clearCurrentPlayback = (audio: HTMLAudioElement | null) => {
    if (audio !== null && currentlyPlayingAudio === audio) {
      currentlyPlayingAudio = null;
      currentlyPlayingSetPlaying = null;
    }
  };

  const clearStartupTimeout = () => {
    if (startupTimeoutRef.current !== null) {
      clearTimeout(startupTimeoutRef.current);
      startupTimeoutRef.current = null;
    }
  };

  const scheduleStartupTimeout = (audio: HTMLAudioElement, sessionId: number) => {
    clearStartupTimeout();
    startupTimeoutRef.current = setTimeout(() => {
      if (
        playbackSessionRef.current !== sessionId ||
        currentPlaybackSessionId !== sessionId ||
        audioRef.current !== audio
      ) {
        return;
      }
      clearCurrentPlayback(audio);
      setIsStarting(false);
      setIsPlaying(false);
    }, PREVIEW_START_TIMEOUT_MS);
  };

  const stopLocalPlayback = (audio: HTMLAudioElement | null) => {
    currentPlaybackSessionId += 1;
    playbackSessionRef.current = currentPlaybackSessionId;
    clearStartupTimeout();
    setIsStarting(false);
    if (audio !== null) {
      audio.pause();
      clearCurrentPlayback(audio);
    }
    setIsPlaying(false);
  };

  const ensureAudio = (src: string): HTMLAudioElement => {
    const existing = audioRef.current;
    if (existing !== null && existing.src === src) {
      return existing;
    }
    if (existing !== null) {
      existing.pause();
      clearCurrentPlayback(existing);
    }
    const audio = new Audio(src);
    audioRef.current = audio;
    audio.addEventListener("ended", () => {
      clearStartupTimeout();
      clearCurrentPlayback(audio);
      setIsStarting(false);
      setIsPlaying(false);
    });
    audio.addEventListener("pause", () => {
      clearStartupTimeout();
      clearCurrentPlayback(audio);
      setIsStarting(false);
      setIsPlaying(false);
    });
    audio.addEventListener("error", () => {
      clearStartupTimeout();
      clearCurrentPlayback(audio);
      setIsStarting(false);
      setIsPlaying(false);
    });
    audio.addEventListener("playing", () => {
      if (audioRef.current !== audio) {
        return;
      }
      clearStartupTimeout();
      setIsStarting(false);
      setIsPlaying(true);
    });
    return audio;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopLocalPlayback(audioRef.current);
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null) {
      return;
    }
    if (!previewAudioUrl || audio.src !== previewAudioUrl) {
      stopLocalPlayback(audio);
      audioRef.current = null;
    }
  }, [previewAudioUrl]);

  function handleClick(event: MouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    if (!isActive || !previewAudioUrl || disabled) {
      return;
    }

    const audio = ensureAudio(previewAudioUrl);
    if ((isPlaying || isStarting) && audioRef.current === audio) {
      stopLocalPlayback(audio);
      return;
    }

    if (currentlyPlayingAudio !== null && currentlyPlayingAudio !== audio) {
      currentlyPlayingAudio.pause();
      currentlyPlayingSetPlaying?.(false);
    }

    if ("currentTime" in audio && typeof audio.currentTime === "number") {
      audio.currentTime = 0;
    }

    const sessionId = ++currentPlaybackSessionId;
    playbackSessionRef.current = sessionId;
    currentlyPlayingAudio = audio;
    currentlyPlayingSetPlaying = setIsPlaying;
    setIsStarting(true);
    scheduleStartupTimeout(audio, sessionId);
    void audio
      .play()
      .then(() => {
        if (playbackSessionRef.current !== sessionId || currentPlaybackSessionId !== sessionId) {
          return;
        }
        clearStartupTimeout();
        setIsStarting(false);
        setIsPlaying(true);
      })
      .catch(() => {
        if (playbackSessionRef.current !== sessionId || currentPlaybackSessionId !== sessionId) {
          return;
        }
        clearStartupTimeout();
        clearCurrentPlayback(audio);
        setIsStarting(false);
        setIsPlaying(false);
      });
  }

  if (!isActive || disabled) {
    return (
      <button
        type="button"
        aria-disabled="true"
        title={previewUnavailableLabel}
        className={cn(
          "inline-flex h-6 w-6 shrink-0 cursor-not-allowed items-center justify-center rounded-full",
          "text-text-subtle opacity-40",
          className
        )}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        aria-label={previewUnavailableLabel}
      >
        <Play className={cn("h-3 w-3", iconClassName)} />
      </button>
    );
  }

  return (
    <button
      type="button"
      title={isPlaying ? resolvedPauseLabel : resolvedPlayLabel}
      aria-label={isPlaying ? resolvedPauseLabel : resolvedPlayLabel}
      onClick={handleClick}
      onMouseDown={(event) => event.stopPropagation()}
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors",
        "border border-border bg-surface hover:bg-surface-raised text-accent",
        className
      )}
    >
      {isPlaying ? (
        <Pause className={cn("h-3 w-3", iconClassName)} />
      ) : (
        <Play className={cn("h-3 w-3", iconClassName)} />
      )}
    </button>
  );
}
