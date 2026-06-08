"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/app/lib/utils";
import {
  filterVoicePickerEntries,
  type VoiceLanguageBucket,
  type VoicePickerEntry
} from "./assistant-voice-options";

export type VoicePickerLabels = {
  empty: string;
  preview: string;
  stopPreview: string;
};

export type VoicePickerProps = {
  entries: VoicePickerEntry[];
  selectedValue: string | null;
  onSelect: (value: string) => void;
  showGenderFilter?: boolean;
  showLanguageFilter?: boolean;
  showCategoryFilter?: boolean;
  disabled?: boolean;
  labels: VoicePickerLabels;
};

const LANGUAGE_TABS: ReadonlyArray<{ value: VoiceLanguageBucket; label: string }> = [
  { value: "ru", label: "RU" },
  { value: "en", label: "EN" },
  { value: "other", label: "OTHER" }
];

export function VoicePicker({
  entries,
  selectedValue,
  onSelect,
  showLanguageFilter = false,
  disabled = false,
  labels
}: VoicePickerProps) {
  const selectedEntry = entries.find((entry) => entry.value === selectedValue);
  const [languageBucket, setLanguageBucket] = useState<VoiceLanguageBucket>(
    selectedEntry?.languageBucket ?? "en"
  );
  const [playingValue, setPlayingValue] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (selectedEntry !== undefined) {
      setLanguageBucket(selectedEntry.languageBucket);
    }
  }, [selectedEntry]);

  const visibleEntries = useMemo(
    () =>
      showLanguageFilter
        ? filterVoicePickerEntries(entries, {
            query: "",
            gender: "all",
            languageBucket,
            category: "all"
          })
        : entries,
    [entries, languageBucket, showLanguageFilter]
  );

  const togglePreview = (entry: VoicePickerEntry) => {
    if (entry.previewUrl === null) {
      return;
    }
    if (playingValue === entry.value) {
      audioRef.current?.pause();
      setPlayingValue(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(entry.previewUrl);
    audio.onended = () => setPlayingValue(null);
    audio.onpause = () => {
      setPlayingValue((current) => (current === entry.value ? null : current));
    };
    audioRef.current = audio;
    void audio.play().catch(() => setPlayingValue(null));
    setPlayingValue(entry.value);
  };

  return (
    <div className="space-y-3" aria-disabled={disabled}>
      {showLanguageFilter ? (
        <div className="grid grid-cols-3 gap-1 rounded-2xl border border-border/70 bg-surface p-1">
          {LANGUAGE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setLanguageBucket(tab.value)}
              disabled={disabled}
              aria-pressed={languageBucket === tab.value}
              className={cn(
                "rounded-[18px] px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60",
                languageBucket === tab.value
                  ? "bg-surface-raised text-text"
                  : "text-text-muted hover:text-text"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      {visibleEntries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 bg-surface px-4 py-6 text-center text-xs text-text-muted">
          {labels.empty}
        </p>
      ) : (
        <div className="max-h-[360px] overflow-y-auto rounded-2xl border border-border/70 bg-surface">
          {visibleEntries.map((entry) => {
            const selected = entry.value === selectedValue;
            const isPlaying = playingValue === entry.value;
            return (
              <div
                key={entry.value}
                className={cn(
                  "flex items-center gap-3 border-b border-border/60 px-4 py-4 transition-colors last:border-b-0",
                  selected
                    ? "bg-surface-raised/70 ring-1 ring-inset ring-accent/25"
                    : "hover:bg-surface-raised/60"
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(entry.value)}
                  disabled={disabled}
                  aria-pressed={selected}
                  className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                >
                  <span className="block truncate text-base font-medium text-text">
                    {entry.label}
                  </span>
                </button>
                {entry.previewUrl !== null && (
                  <button
                    type="button"
                    onClick={() => togglePreview(entry)}
                    disabled={disabled}
                    aria-label={isPlaying ? labels.stopPreview : labels.preview}
                    title={isPlaying ? labels.stopPreview : labels.preview}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-accent transition-colors hover:border-accent/40 hover:bg-accent/10 disabled:opacity-50"
                  >
                    {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
