"use client";

import { useEffect, useRef, useState } from "react";
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

export function VoicePreviewButton({
  previewAudioUrl,
  voiceLabel,
  previewUnavailableLabel = "Preview unavailable"
}: {
  previewAudioUrl: string | null;
  voiceLabel: string;
  previewUnavailableLabel?: string;
}): React.ReactElement {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isActive = previewAudioUrl !== null && previewAudioUrl.length > 0;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        if (currentlyPlayingAudio === audioRef.current) {
          currentlyPlayingAudio = null;
          currentlyPlayingSetPlaying = null;
        }
        audioRef.current = null;
      }
    };
  }, []);

  function handleClick(): void {
    if (!isActive || !previewAudioUrl) {
      return;
    }

    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
      currentlyPlayingAudio = null;
      currentlyPlayingSetPlaying = null;
      return;
    }

    // Pause whatever is currently playing
    if (currentlyPlayingAudio !== null && currentlyPlayingAudio !== audioRef.current) {
      currentlyPlayingAudio.pause();
      currentlyPlayingSetPlaying?.(false);
    }

    // Create audio element if needed
    if (audioRef.current === null) {
      const audio = new Audio(previewAudioUrl);
      audioRef.current = audio;
      audio.addEventListener("ended", () => {
        setIsPlaying(false);
        if (currentlyPlayingAudio === audio) {
          currentlyPlayingAudio = null;
          currentlyPlayingSetPlaying = null;
        }
      });
      audio.addEventListener("pause", () => {
        setIsPlaying(false);
      });
    }

    currentlyPlayingAudio = audioRef.current;
    currentlyPlayingSetPlaying = setIsPlaying;
    void audioRef.current.play().then(() => {
      setIsPlaying(true);
    });
  }

  if (!isActive) {
    return (
      <button
        type="button"
        aria-disabled="true"
        title={previewUnavailableLabel}
        className={cn(
          "inline-flex h-6 w-6 shrink-0 cursor-not-allowed items-center justify-center rounded-full",
          "text-text-subtle opacity-40"
        )}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        aria-label={previewUnavailableLabel}
      >
        <Play className="h-3 w-3" />
      </button>
    );
  }

  return (
    <button
      type="button"
      title={isPlaying ? `Pause preview: ${voiceLabel}` : `Play preview: ${voiceLabel}`}
      aria-label={isPlaying ? `Pause preview: ${voiceLabel}` : `Play preview: ${voiceLabel}`}
      onClick={handleClick}
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors",
        "border border-border bg-surface hover:bg-surface-raised text-accent"
      )}
    >
      {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
    </button>
  );
}
