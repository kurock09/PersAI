"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Pause, Play } from "lucide-react";
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
  languageBucket?: VoiceLanguageBucket;
  onLanguageBucketChange?: (value: VoiceLanguageBucket) => void;
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
  labels,
  languageBucket: controlledLanguageBucket,
  onLanguageBucketChange
}: VoicePickerProps) {
  const selectedEntry = entries.find((entry) => entry.value === selectedValue);
  const [uncontrolledLanguageBucket, setUncontrolledLanguageBucket] = useState<VoiceLanguageBucket>(
    selectedEntry?.languageBucket ?? "en"
  );
  const languageBucket = controlledLanguageBucket ?? uncontrolledLanguageBucket;
  const [playingValue, setPlayingValue] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (controlledLanguageBucket === undefined && selectedEntry !== undefined) {
      setUncontrolledLanguageBucket(selectedEntry.languageBucket);
    }
  }, [controlledLanguageBucket, selectedEntry]);

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
        <div className="grid w-full grid-cols-3 rounded-full border border-border/60 bg-surface-raised/20 p-1">
          {LANGUAGE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => {
                if (onLanguageBucketChange) {
                  onLanguageBucketChange(tab.value);
                  return;
                }
                setUncontrolledLanguageBucket(tab.value);
              }}
              disabled={disabled}
              aria-pressed={languageBucket === tab.value}
              className={cn(
                "min-w-0 rounded-full px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-60",
                languageBucket === tab.value
                  ? "bg-accent/15 text-text"
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
        <div className="max-h-40 overflow-y-auto rounded-xl border border-border/60 bg-surface-raised/20">
          {visibleEntries.map((entry) => {
            const selected = entry.value === selectedValue;
            const isPlaying = playingValue === entry.value;
            return (
              <div
                key={entry.value}
                className={cn(
                  "flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-left text-xs transition-colors last:border-b-0 hover:bg-surface-raised",
                  selected && "bg-accent/10"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                    selected
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border/70 text-transparent"
                  )}
                >
                  <Check className="size-2.5" />
                </span>
                <button
                  type="button"
                  onClick={() => onSelect(entry.value)}
                  disabled={disabled}
                  aria-pressed={selected}
                  className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                >
                  <span className="block truncate font-medium text-text">{entry.label}</span>
                </button>
                {entry.previewUrl !== null && (
                  <button
                    type="button"
                    onClick={() => togglePreview(entry)}
                    disabled={disabled}
                    aria-label={isPlaying ? labels.stopPreview : labels.preview}
                    title={isPlaying ? labels.stopPreview : labels.preview}
                    className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-accent transition-colors hover:border-accent/40 hover:bg-accent/10 disabled:opacity-50"
                  >
                    {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
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
