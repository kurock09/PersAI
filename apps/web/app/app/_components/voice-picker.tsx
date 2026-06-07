"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Pause, Play, Search } from "lucide-react";
import { cn } from "@/app/lib/utils";
import {
  filterVoicePickerEntries,
  type VoiceLanguageBucket,
  type VoicePickerEntry
} from "./assistant-voice-options";

export type VoicePickerLabels = {
  searchPlaceholder: string;
  all: string;
  filterGender: string;
  filterLanguage: string;
  filterCategory: string;
  genderMale: string;
  genderFemale: string;
  genderNeutral: string;
  genderUnknown: string;
  langRu: string;
  langEn: string;
  langOther: string;
  empty: string;
  preview: string;
  stopPreview: string;
};

type GenderFilterValue = "all" | "male" | "female" | "neutral" | "unknown";
type LanguageFilterValue = "all" | VoiceLanguageBucket;

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

const GENDER_ORDER: ReadonlyArray<Exclude<GenderFilterValue, "all">> = [
  "female",
  "male",
  "neutral",
  "unknown"
];
const LANGUAGE_ORDER: ReadonlyArray<VoiceLanguageBucket> = ["ru", "en", "other"];

export function VoicePicker({
  entries,
  selectedValue,
  onSelect,
  showGenderFilter = false,
  showLanguageFilter = false,
  showCategoryFilter = false,
  disabled = false,
  labels
}: VoicePickerProps) {
  const [query, setQuery] = useState("");
  const [gender, setGender] = useState<GenderFilterValue>("all");
  const [languageBucket, setLanguageBucket] = useState<LanguageFilterValue>("all");
  const [category, setCategory] = useState<string>("all");
  const [playingValue, setPlayingValue] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const genderLabel = (value: Exclude<GenderFilterValue, "all">): string => {
    switch (value) {
      case "female":
        return labels.genderFemale;
      case "male":
        return labels.genderMale;
      case "neutral":
        return labels.genderNeutral;
      default:
        return labels.genderUnknown;
    }
  };

  const languageLabel = (value: VoiceLanguageBucket): string => {
    switch (value) {
      case "ru":
        return labels.langRu;
      case "en":
        return labels.langEn;
      default:
        return labels.langOther;
    }
  };

  const availableGenders = useMemo(
    () => GENDER_ORDER.filter((value) => entries.some((entry) => entry.gender === value)),
    [entries]
  );
  const availableLanguages = useMemo(
    () => LANGUAGE_ORDER.filter((value) => entries.some((entry) => entry.languageBucket === value)),
    [entries]
  );
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    for (const entry of entries) {
      if (entry.category !== null && entry.category.trim().length > 0) {
        set.add(entry.category);
      }
    }
    return [...set].sort((left, right) => left.localeCompare(right));
  }, [entries]);

  const showGender = showGenderFilter && availableGenders.length > 1;
  const showLanguage = showLanguageFilter && availableLanguages.length > 1;
  const showCategory = showCategoryFilter && availableCategories.length > 1;

  const filtered = useMemo(
    () =>
      filterVoicePickerEntries(entries, {
        query,
        gender: showGender ? gender : "all",
        languageBucket: showLanguage ? languageBucket : "all",
        category: showCategory ? category : "all"
      }),
    [category, entries, gender, languageBucket, query, showCategory, showGender, showLanguage]
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
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.searchPlaceholder}
          disabled={disabled}
          className="w-full rounded-xl border border-border bg-surface-raised py-2 pl-9 pr-3 text-sm text-text placeholder:text-text-subtle outline-none focus:border-border-strong disabled:opacity-60"
        />
      </div>

      {(showGender || showLanguage || showCategory) && (
        <div className="space-y-2">
          {showGender && (
            <FilterChipGroup
              title={labels.filterGender}
              allLabel={labels.all}
              value={gender}
              onChange={(next) => setGender(next as GenderFilterValue)}
              options={availableGenders.map((value) => ({ value, label: genderLabel(value) }))}
              disabled={disabled}
            />
          )}
          {showLanguage && (
            <FilterChipGroup
              title={labels.filterLanguage}
              allLabel={labels.all}
              value={languageBucket}
              onChange={(next) => setLanguageBucket(next as LanguageFilterValue)}
              options={availableLanguages.map((value) => ({ value, label: languageLabel(value) }))}
              disabled={disabled}
            />
          )}
          {showCategory && (
            <FilterChipGroup
              title={labels.filterCategory}
              allLabel={labels.all}
              value={category}
              onChange={setCategory}
              options={availableCategories.map((value) => ({ value, label: value }))}
              disabled={disabled}
            />
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 bg-surface px-4 py-6 text-center text-xs text-text-muted">
          {labels.empty}
        </p>
      ) : (
        <div className="grid max-h-[360px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {filtered.map((entry) => {
            const selected = entry.value === selectedValue;
            const isPlaying = playingValue === entry.value;
            return (
              <div
                key={entry.value}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 transition-colors",
                  selected
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface-raised hover:border-border-strong"
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(entry.value)}
                  disabled={disabled}
                  aria-pressed={selected}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border",
                      selected ? "border-accent bg-accent text-white" : "border-border"
                    )}
                  >
                    {selected && <Check className="size-3" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text">
                      {entry.label}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      <VoiceChip>{genderLabel(entry.gender)}</VoiceChip>
                      {entry.languageBucket !== "other" && (
                        <VoiceChip>{languageLabel(entry.languageBucket)}</VoiceChip>
                      )}
                      {entry.category !== null && <VoiceChip>{entry.category}</VoiceChip>}
                    </span>
                  </span>
                </button>
                {entry.previewUrl !== null && (
                  <button
                    type="button"
                    onClick={() => togglePreview(entry)}
                    disabled={disabled}
                    aria-label={isPlaying ? labels.stopPreview : labels.preview}
                    title={isPlaying ? labels.stopPreview : labels.preview}
                    className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-50"
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

function VoiceChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-subtle">
      {children}
    </span>
  );
}

function FilterChipGroup({
  title,
  allLabel,
  value,
  onChange,
  options,
  disabled
}: {
  title: string;
  allLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  disabled: boolean;
}) {
  const items = [{ value: "all", label: allLabel }, ...options];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
        {title}
      </span>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          disabled={disabled}
          aria-pressed={value === item.value}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60",
            value === item.value
              ? "border-accent bg-accent/10 text-accent"
              : "border-border bg-surface-raised text-text-muted hover:border-border-strong hover:text-text"
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
