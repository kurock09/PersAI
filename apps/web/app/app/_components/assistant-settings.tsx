"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Sparkles,
  Rocket,
  Trash2,
  RotateCcw,
  CheckCircle2,
  Brain,
  ListTodo,
  Send,
  MessageCircle,
  BarChart3,
  Loader2,
  AlertTriangle,
  Upload,
  Files,
  GraduationCap,
  SlidersHorizontal,
  ChevronRight,
  CreditCard,
  ExternalLink,
  X,
  UserCircle2,
  Plus,
  Mic,
  Image as ImageIcon,
  Clapperboard
} from "lucide-react";
import type {
  AssistantLimitState,
  AssistantListItemState,
  AssistantMemoryRegistryItemState,
  AssistantTaskRegistryItemState,
  UserPlanVisibilityState
} from "@persai/contracts";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import type { AppData } from "./use-app-data";
import {
  ASSISTANT_GENDER_OPTIONS,
  DEFAULT_TRAITS,
  TRAIT_SLIDERS,
  normalizeAssistantGender,
  type AssistantGender
} from "./assistant-persona";
import {
  patchAssistantDraft,
  postAssistantPublish,
  postAssistantReset,
  getAssistantVoiceSettings,
  patchAssistantElevenLabsVoiceCuration,
  postAssistantElevenLabsVoiceCatalogRefresh,
  getAssistantSkills,
  updateAssistantSkillAssignments,
  patchAssistantNotificationPreference,
  getAssistantMemoryItems,
  type AssistantVoiceSettingsState,
  type AssistantAdminVoiceCatalogEntry,
  type AssistantPreferredNotificationChannel,
  getAssistantTaskItems,
  getAssistantBackgroundTaskItems,
  type AssistantBackgroundTaskItemState,
  postAssistantMemoryItemForget,
  postAssistantMemoryItemCloseOpenLoop,
  postAssistantTaskItemDisable,
  postAssistantTaskItemEnable,
  postAssistantTaskItemCancel,
  postAssistantBackgroundTaskItemDisable,
  postAssistantBackgroundTaskItemEnable,
  postAssistantBackgroundTaskItemCancel,
  getWorkspaceMemoryItems,
  addWorkspaceMemoryItem,
  forgetWorkspaceMemoryItem,
  searchWorkspaceMemory,
  uploadAssistantAvatar,
  getAssistantBillingSubscription,
  postAssistantBillingEnableAutoRenew,
  postAssistantBillingDisableAutoRenew,
  type AssistantBillingSubscriptionActionResult,
  type AssistantBillingSubscriptionManagementState,
  type WorkspaceMemoryItem,
  type AssistantSkillsState,
  getAssistantSupportTickets,
  getWorkspaceVideoPersonas,
  getWorkspaceVideoClonedVoices,
  getWorkspaceVoiceCatalog,
  getWorkspaceVideoPersonaPreviewUrl,
  getWorkspaceVideoClonedVoicePreviewUrl,
  getWorkspaceVoiceCatalogPreviewUrl,
  createWorkspaceVideoClonedVoice,
  createWorkspaceVideoPersona,
  updateWorkspaceVideoPersona,
  deleteWorkspaceVideoPersona,
  archiveWorkspaceVideoClonedVoice,
  setWorkspaceVideoClonedVoiceDefault,
  ApiStructuredError,
  type PersonaListItemDto,
  type VoiceCatalogEntry,
  type WorkspaceVideoClonedVoiceDto,
  deleteAssistantBrowserProfile,
  listAssistantBrowserProfiles,
  openAssistantBrowserProfileView,
  reconnectAssistantBrowserProfile,
  type AssistantBrowserProfileListItem,
  type PendingBrowserLoginState
} from "../assistant-api-client";
import { AssistantAvatar } from "./assistant-avatar";
import { BrowserLoginModal } from "./browser-login-modal";
import { hideNativeBrowserBridgeView, isNativeBrowserBridgeShell } from "../browser-bridge-client";
import { pushBackHandler } from "./back-handler-stack";
import { VoicePreviewButton } from "../../_components/voice-preview-button";
import { AssistantSupportSection } from "./assistant-support-section";
import { userFieldClassName, userPillButtonClassName } from "./form-ui";
import { resolveBillingSummaryCopy } from "./billing-summary";
import {
  filterVoicePickerEntries,
  filterVoiceOptions,
  OPENAI_VOICE_OPTIONS,
  resolveDefaultOpenAiVoiceOption,
  resolveDefaultYandexVoiceOption,
  YANDEX_VOICE_OPTIONS,
  type VoiceLanguageBucket,
  type VoicePickerEntry
} from "./assistant-voice-options";
import { VoicePicker, type VoicePickerLabels } from "./voice-picker";
import {
  ASSISTANT_AVATAR_PRESETS,
  findAssistantAvatarPresetByUrl
} from "./assistant-avatar-presets";
import { AssistantKnowledgeManager } from "./assistant-knowledge-manager";
import { WorkspaceFilesGallery } from "./workspace-files-gallery";
import { AssistantSkillsManager } from "./assistant-skills-manager";

interface AssistantSettingsProps {
  data: AppData;
  initialSection?: string | undefined;
  onOpenTelegramSettings?: (() => void) | undefined;
  onOpenPricingPage?: (() => void) | undefined;
  onOpenPackagesPage?: (() => void) | undefined;
  onStartBillingCheckout?: ((paymentIntentId: string) => void) | undefined;
  onSupportUnreadCountChange?: ((count: number) => void) | undefined;
}

type ActionFeedback = { type: "ok" | "err" | "warn"; text: string } | null;
type PersonaVoiceGenderFilter = "female" | "male" | "neutral";
type PersonaVoiceLanguageFilter = "ru" | "en" | "other" | "mine";
type PersonaLightboxState = { src: string; name: string } | null;
type PersonaModalMode = "create" | "edit";
type ClonedVoiceModalMode = "upload" | "record";
type PersonaVideoFormat = "16:9" | "9:16" | "1:1";
type PersonaVideoFormatChoice = "auto" | PersonaVideoFormat;

const CHARACTERS_PRICING_URL = "https://persai.dev/app/pricing";
const MEMORY_INLINE_EXPAND_MIN_CHARS = 72;

function detectPersonaVideoFormatFromDimensions(width: number, height: number): PersonaVideoFormat {
  if (width <= 0 || height <= 0) {
    return "1:1";
  }
  const ratio = width / height;
  if (Math.abs(ratio - 1) <= 0.08) {
    return "1:1";
  }
  return ratio > 1 ? "16:9" : "9:16";
}

function formatPersonaVideoFormatLabel(
  t: (key: string, params?: Record<string, string | number>) => string,
  format: PersonaVideoFormat
): string {
  if (format === "16:9") return t("charactersFormVideoFormatLandscape");
  if (format === "9:16") return t("charactersFormVideoFormatPortrait");
  return t("charactersFormVideoFormatSquare");
}

function encodeAudioBufferAsWav(audioBuffer: AudioBuffer): Blob {
  const channelCount = Math.min(audioBuffer.numberOfChannels, 2);
  const sampleRate = audioBuffer.sampleRate;
  const samplesPerChannel = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = samplesPerChannel * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channelData = Array.from({ length: channelCount }, (_, index) =>
    audioBuffer.getChannelData(index)
  );
  let offset = 44;
  for (let sampleIndex = 0; sampleIndex < samplesPerChannel; sampleIndex += 1) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channelIndex]?.[sampleIndex] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function convertRecordedVoiceBlobToWavFile(blob: Blob): Promise<File> {
  const AudioContextCtor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("AudioContext is not available for recorded voice conversion.");
  }

  const audioContext = new AudioContextCtor();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer);
    const wavBlob = encodeAudioBufferAsWav(decoded);
    return new File([wavBlob], `voice-clone-${Date.now()}.wav`, { type: "audio/wav" });
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}

type CharacterCardProps = {
  name: string;
  voiceLabel: string;
  portraitImageUrl: string | null;
  previewAudioUrl?: string | null | undefined;
  previewVoiceLabel?: string | undefined;
  previewUnavailableLabel: string;
  fallbackInitial: string;
  badgeLabel?: string | undefined;
  disabled?: boolean | undefined;
  showPreview?: boolean | undefined;
  openPortraitLabel?: string | undefined;
  deleteLabel?: string | undefined;
  onOpenPortrait?: (() => void) | undefined;
  onSelect?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  testId?: string | undefined;
};

function CharacterCard({
  name,
  voiceLabel,
  portraitImageUrl,
  previewAudioUrl,
  previewVoiceLabel,
  previewUnavailableLabel,
  fallbackInitial,
  badgeLabel,
  disabled = false,
  showPreview = false,
  openPortraitLabel,
  deleteLabel,
  onOpenPortrait,
  onSelect,
  onDelete,
  testId = "character-card"
}: CharacterCardProps) {
  const interactive = !disabled && typeof onSelect === "function";

  return (
    <div
      data-testid={testId}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-disabled={disabled ? "true" : undefined}
      onClick={interactive ? onSelect : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect?.();
              }
            }
          : undefined
      }
      className={cn(
        "flex min-h-[84px] items-center gap-3 rounded-xl border border-border/45 bg-background/35 p-3 text-left transition-colors",
        interactive
          ? "cursor-pointer hover:bg-surface-raised/45 focus:outline-none focus:ring-2 focus:ring-accent/20"
          : "opacity-75"
      )}
    >
      {portraitImageUrl ? (
        onOpenPortrait && !disabled ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenPortrait();
            }}
            className="shrink-0 rounded-2xl transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-accent/30"
            aria-label={openPortraitLabel}
          >
            <img src={portraitImageUrl} alt={name} className="h-14 w-14 rounded-2xl object-cover" />
          </button>
        ) : (
          <img
            src={portraitImageUrl}
            alt={name}
            className="h-14 w-14 shrink-0 rounded-2xl object-cover"
          />
        )
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-sm font-medium text-accent">
          {fallbackInitial}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-text">{name}</p>
          {badgeLabel ? (
            <span className="rounded-full border border-border/60 bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-subtle">
              {badgeLabel}
            </span>
          ) : null}
        </div>
        <p className="mt-1 truncate text-xs text-text-muted">{voiceLabel}</p>
      </div>

      {showPreview || onDelete ? (
        <div
          className="flex shrink-0 items-center gap-1.5"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {showPreview ? (
            <VoicePreviewButton
              previewAudioUrl={previewAudioUrl ?? null}
              voiceLabel={previewVoiceLabel ?? name}
              previewUnavailableLabel={previewUnavailableLabel}
            />
          ) : null}
          {onDelete && !disabled ? (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-destructive/10 hover:text-destructive"
              aria-label={deleteLabel}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CharacterCreateCard({
  label,
  helperText,
  disabled,
  title,
  onClick
}: {
  label: string;
  helperText: string;
  disabled: boolean;
  title?: string | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="character-create-slot"
      aria-label={label}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "flex min-h-[84px] w-full items-center gap-3 rounded-xl border border-border/45 bg-background/35 p-3 text-left transition-colors",
        disabled
          ? "cursor-not-allowed opacity-60"
          : "cursor-pointer hover:bg-surface-raised/45 focus:outline-none focus:ring-2 focus:ring-accent/20"
      )}
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-text-subtle">
        <Plus className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-text">{label}</p>
        <p className="mt-1 truncate text-xs text-text-muted">{helperText}</p>
      </div>
    </button>
  );
}

function VoiceCloneCard({
  voice,
  voiceLabel,
  previewAudioUrl,
  statusLabel,
  statusTone,
  previewUnavailableLabel,
  linkedSummary,
  archiveLabel,
  defaultLabel,
  makeDefaultLabel,
  onArchive,
  onMakeDefault
}: {
  voice: WorkspaceVideoClonedVoiceDto;
  voiceLabel: string;
  previewAudioUrl: string | null;
  statusLabel: string;
  statusTone: "default" | "warn" | "success" | "error";
  previewUnavailableLabel: string;
  linkedSummary: string | null;
  archiveLabel: string;
  defaultLabel: string;
  makeDefaultLabel: string;
  onArchive?: (() => void) | undefined;
  onMakeDefault?: (() => void) | undefined;
}) {
  return (
    <div
      data-testid={`voice-clone-card-${voice.status}`}
      className="flex items-center gap-3 rounded-xl border-b border-border/45 px-1 py-3 last:border-b-0"
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 truncate text-sm font-medium text-text" title={voice.displayName}>
            {voice.displayName}
          </p>
          {voice.isDefault ? (
            <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
              {defaultLabel}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-muted">
          <span>{voiceLabel}</span>
          <span
            className={cn(
              "font-medium",
              statusTone === "success"
                ? "text-accent"
                : statusTone === "warn"
                  ? "text-yellow-600"
                  : statusTone === "error"
                    ? "text-destructive"
                    : "text-text-subtle"
            )}
          >
            {statusLabel}
          </span>
          {linkedSummary ? (
            <span className="truncate text-text-subtle" title={linkedSummary}>
              {linkedSummary}
            </span>
          ) : null}
          {onMakeDefault ? (
            <button
              type="button"
              onClick={onMakeDefault}
              className="text-[11px] font-medium text-text-subtle underline-offset-4 transition-colors hover:text-text hover:underline"
            >
              {makeDefaultLabel}
            </button>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <VoicePreviewButton
          previewAudioUrl={previewAudioUrl}
          voiceLabel={voice.displayName}
          previewUnavailableLabel={previewUnavailableLabel}
        />
        {onArchive ? (
          <button
            type="button"
            onClick={onArchive}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-destructive/10 hover:text-destructive"
            aria-label={archiveLabel}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

type QuotaBucketState = UserPlanVisibilityState["limits"]["quotaBuckets"][number];
type MonthlyToolQuotaSnapshot = UserPlanVisibilityState["limits"]["monthlyToolQuotas"];
type MonthlyToolQuotaToolCode = MonthlyToolQuotaSnapshot["tools"][number]["toolCode"] | "document";
type MonthlyToolQuotaToolState = Omit<MonthlyToolQuotaSnapshot["tools"][number], "toolCode"> & {
  toolCode: MonthlyToolQuotaToolCode;
};
type ToolDailyLimitState = UserPlanVisibilityState["limits"]["toolDailyLimits"][number];
type SettingsSectionId =
  | "character"
  | "characters"
  | "knowledge"
  | "files"
  | "skills"
  | "memory"
  | "tasks"
  | "channels"
  | "support"
  | "limits";

function normalizeInitialSection(value: string | undefined): SettingsSectionId {
  switch (value) {
    case "knowledge":
    case "files":
    case "skills":
    case "tasks":
    case "channels":
    case "support":
    case "limits":
    case "character":
    case "characters":
      return value;
    case "memory":
      return "character";
    default:
      return "character";
  }
}

function formatAssistantListLabel(
  assistant: AssistantListItemState,
  index: number,
  fallbackLabel: string
): string {
  const displayName = assistant.displayName?.trim();
  if (displayName && displayName.length > 0) {
    return displayName;
  }
  return `${fallbackLabel} ${index + 1}`;
}

function AssistantSwitcherModal({
  open,
  assistants,
  activeAssistantId,
  assistantLimit,
  switchBusyId,
  createBusy,
  error,
  onClose,
  onSwitch,
  onCreate
}: {
  open: boolean;
  assistants: AssistantListItemState[];
  activeAssistantId: string | null;
  assistantLimit: AssistantLimitState | null;
  switchBusyId: string | null;
  createBusy: boolean;
  error: string | null;
  onClose: () => void;
  onSwitch: (assistantId: string) => Promise<void>;
  onCreate: (() => Promise<void>) | null;
}) {
  const t = useTranslations("settings");

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const orderedAssistants = useMemo(
    () =>
      [...assistants].sort(
        (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
      ),
    [assistants]
  );
  const canAddAssistant =
    onCreate !== null &&
    assistantLimit !== null &&
    assistantLimit.usedAssistants < assistantLimit.maxAssistants;

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="assistant-switcher-title"
      className="fixed inset-0 z-[9000] flex items-center justify-center bg-bg/80 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-[28px] border border-border-strong/70 bg-surface-raised/95 p-5 text-text shadow-[0_24px_70px_rgba(0,0,0,0.42)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="assistant-switcher-title"
              className="text-base font-semibold tracking-tight text-text"
            >
              {t("switchAssistantTitle")}
            </h2>
            <p className="mt-1 text-sm text-text-muted">{t("switchAssistantSubtitle")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-full p-2 text-text-subtle transition-colors hover:bg-surface hover:text-text"
            aria-label={t("closeAssistantSwitcher")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {orderedAssistants.map((assistant, index) => {
            const isActive = assistant.id === activeAssistantId;
            const label = formatAssistantListLabel(assistant, index, t("assistantItemFallback"));
            return (
              <div
                key={assistant.id}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border px-3 py-3 transition-colors",
                  isActive
                    ? "border-accent/45 bg-accent/8"
                    : "border-border/70 bg-surface hover:border-border-strong"
                )}
              >
                <AssistantAvatar
                  avatarUrl={assistant.avatarUrl ?? undefined}
                  avatarEmoji={assistant.avatarEmoji ?? undefined}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text">{label}</p>
                  <p className="mt-1 truncate text-[11px] text-text-subtle">
                    {t("assistantSpecialtyPlaceholder")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void onSwitch(assistant.id)}
                  disabled={switchBusyId !== null || createBusy || isActive}
                  className={cn(
                    "inline-flex h-9 min-w-[104px] items-center justify-center rounded-full border px-4 text-sm font-medium transition-colors",
                    isActive
                      ? "cursor-default border-border bg-surface text-text-subtle"
                      : "cursor-pointer border-border-strong/80 bg-bg text-text hover:border-accent/45 hover:text-accent disabled:cursor-wait disabled:opacity-70"
                  )}
                >
                  {switchBusyId === assistant.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isActive ? (
                    t("selectedAssistant")
                  ) : (
                    t("chooseAssistant")
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {error ? (
          <p className="mt-3 rounded-2xl border border-destructive/35 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="mt-4 rounded-2xl border border-border/70 bg-surface px-4 py-3">
          {canAddAssistant ? (
            <button
              type="button"
              onClick={() => void onCreate?.()}
              disabled={switchBusyId !== null || createBusy}
              className="inline-flex h-10 cursor-pointer items-center justify-center rounded-full border border-border-strong/80 bg-bg px-4 text-sm font-medium text-text transition-colors hover:border-accent/45 hover:text-accent disabled:cursor-wait disabled:opacity-70"
            >
              {createBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("creatingAssistant")}
                </>
              ) : (
                t("addAssistant")
              )}
            </button>
          ) : (
            <p className="text-sm text-text-muted">{t("assistantLimitReachedNote")}</p>
          )}
          {assistantLimit ? (
            <p className="mt-2 text-[11px] text-text-subtle">
              {t("assistantSlotsSummary", {
                used: assistantLimit.usedAssistants,
                max: assistantLimit.maxAssistants
              })}
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

function formatQuotaNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatQuotaBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60)
    .toString()
    .padStart(2, "0");
  const remainingSeconds = (safeSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function formatQuotaBucketScalar(bucket: QuotaBucketState, value: number): string {
  return bucket.unit === "bytes" ? formatQuotaBytes(value) : formatQuotaNumber(value);
}

function Section({
  icon,
  title,
  children,
  open,
  onToggle,
  className,
  showActivityDot
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  className?: string;
  showActivityDot?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [open]);

  return (
    <div ref={ref} className={cn("border-b border-border", className)}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-2.5 px-5 py-3.5 text-left transition-colors hover:bg-surface-hover"
      >
        <span className="text-text-muted">{icon}</span>
        <span className="flex flex-1 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
          {title}
          {showActivityDot && !open && (
            <span className="inline-flex h-2 w-2 rounded-full bg-success" aria-hidden />
          )}
        </span>
        <span className="text-[10px] text-text-subtle">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-5 pt-2 pb-4">{children}</div>}
    </div>
  );
}

// ADR-074 Slice M3.3 follow-up — Memory Center inline error rendering.
// `Session expired` is the most common error class (Clerk JWT in the
// page cache outlived the API's accepted lifetime → 401 from the
// backend → `toErrorMessage` in `assistant-api-client.ts` returns the
// English literal). The mutation handlers below already force-refresh
// the Clerk session on every click, so this branch only fires when the
// founder is genuinely signed out. In that case offer a one-click
// recovery instead of leaving the user staring at a banner that does
// not get them anywhere.
function isSessionExpiredText(text: string): boolean {
  return text.includes("Session expired") || text.includes("Сессия истекла");
}

function resolveBillingManagementErrorMessage(
  error: unknown,
  t: ReturnType<typeof useTranslations>
): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Session expired")) {
    return t("billingSessionExpired");
  }
  if (
    message.includes("Only card binding is supported") ||
    message.includes("paymentMethodClass")
  ) {
    return t("billingPaymentMethodUnavailable");
  }
  if (message.includes("not found") || message.includes("required")) {
    return t("billingManagementUnavailable");
  }
  return t("billingActionFailed");
}

function applyBillingActionResult(
  result: AssistantBillingSubscriptionActionResult,
  router: ReturnType<typeof useRouter>,
  setBillingSubscription: (value: AssistantBillingSubscriptionManagementState) => void,
  onStartBillingCheckout?: ((paymentIntentId: string) => void) | undefined
): void {
  if (result.mode === "checkout") {
    if (onStartBillingCheckout) {
      onStartBillingCheckout(result.paymentIntent.id);
    } else {
      router.push(`/app/billing/checkout/${result.paymentIntent.id}` as Route);
    }
    return;
  }
  setBillingSubscription(result.subscription);
}

function FeedbackLine({ fb }: { fb: ActionFeedback }) {
  if (!fb) return null;
  const sessionExpired = fb.type === "err" && isSessionExpiredText(fb.text);
  return (
    <p
      className={cn(
        "mt-2 flex flex-wrap items-center gap-2 text-xs",
        fb.type === "ok"
          ? "text-accent"
          : fb.type === "warn"
            ? "text-yellow-600"
            : "text-destructive"
      )}
    >
      <span>{fb.text}</span>
      {sessionExpired && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="cursor-pointer rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/20"
        >
          {/* Rendered text intentionally not localized — same scope as
              the upstream English literal `Session expired. Sign in
              again and refresh the page.` from `assistant-api-client`. */}
          Reload
        </button>
      )}
    </p>
  );
}

function hasPaidBillingSettings(
  subscription: AssistantBillingSubscriptionManagementState | null
): boolean {
  return (
    subscription !== null &&
    subscription.currentPeriodEndsAt !== null &&
    ["active", "grace_period", "past_due", "paused", "canceled"].includes(
      subscription.subscriptionStatus
    )
  );
}

function isZeroPriceEffectivePlan(plan: UserPlanVisibilityState["effectivePlan"] | null): boolean {
  return plan?.price.amount === 0;
}

function ActionButton({
  icon,
  label,
  onClick,
  busy,
  variant = "default",
  disabled,
  className,
  pulse = false
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  busy: boolean;
  variant?: "default" | "primary" | "danger";
  disabled?: boolean;
  className?: string;
  pulse?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
      className={cn(
        userPillButtonClassName(
          variant === "default" ? "secondary" : variant,
          "cursor-pointer disabled:cursor-default"
        ),
        pulse &&
          "animate-pulse border-accent/25 bg-accent/12 text-accent shadow-[0_0_0_1px_rgba(191,148,84,0.16),0_0_18px_rgba(191,148,84,0.12)]",
        className
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}

function SegmentedChoice({
  options,
  value,
  onChange,
  className
}: {
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid w-full rounded-full border border-border/60 bg-surface-raised/20 p-1",
        className
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            "min-w-0 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors",
            value === option.value ? "bg-accent/15 text-text" : "text-text-muted hover:text-text"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type AssistantVoiceProfile = {
  schema: "persai.assistantVoiceProfile.v1";
  defaultLocale: string;
  deliveryKind: "voice_note" | "audio";
  elevenlabs: {
    voiceId: string | null;
  };
  yandex: {
    voice: (typeof YANDEX_VOICE_OPTIONS)[number]["value"] | null;
    role: (typeof YANDEX_TTS_ROLES)[number] | null;
  };
  openai: {
    voice: (typeof OPENAI_VOICE_OPTIONS)[number]["value"] | null;
  };
};

const ELEVENLABS_VOICE_LABEL_HINTS: Record<string, { en: string; ru: string }> = {
  Adam: { en: "dominant, firm", ru: "доминантный, уверенный" },
  Alice: { en: "clear, engaging educator", ru: "ясная, вовлекающая, как преподаватель" },
  Bella: { en: "professional, bright, warm", ru: "профессиональная, светлая, тёплая" },
  Bill: { en: "wise, mature, balanced", ru: "мудрый, зрелый, ровный" },
  Brian: { en: "deep, resonant, comforting", ru: "глубокий, резонансный, успокаивающий" },
  Callum: { en: "husky trickster", ru: "хриплый, с трикстерской подачей" },
  Charlie: { en: "deep, confident, energetic", ru: "глубокий, уверенный, энергичный" },
  Chris: { en: "charming, down-to-earth", ru: "обаятельный, приземлённый" },
  Daniel: { en: "steady broadcaster", ru: "ровный, дикторский" },
  Eric: { en: "smooth, trustworthy", ru: "мягкий, внушающий доверие" },
  George: { en: "warm, captivating storyteller", ru: "тёплый, увлекающий рассказчик" },
  Harry: { en: "fierce warrior", ru: "резкий, боевой" },
  Jessica: { en: "playful, bright, warm", ru: "игривая, светлая, тёплая" },
  Laura: { en: "enthusiastic, quirky attitude", ru: "с энтузиазмом, с характерной подачей" },
  Liam: { en: "energetic, social media creator", ru: "энергичный, современный креатор" },
  Lily: { en: "velvety actress", ru: "бархатная, артистичная" },
  Matilda: { en: "knowledgeable, professional", ru: "знающая, профессиональная" },
  Roger: { en: "laid-back, casual, resonant", ru: "расслабленный, неформальный, резонансный" },
  Sarah: { en: "mature, reassuring, confident", ru: "зрелая, успокаивающая, уверенная" },
  Will: { en: "relaxed optimist", ru: "спокойный оптимист" }
};

function formatElevenLabsVoiceLabel(name: string, locale: string): string {
  const trimmed = name.trim();
  const hint = ELEVENLABS_VOICE_LABEL_HINTS[trimmed];
  if (!hint) {
    return trimmed;
  }
  return `${trimmed} (${locale === "ru" ? hint.ru : hint.en})`;
}

const DEFAULT_VOICE_PROFILE: AssistantVoiceProfile = {
  schema: "persai.assistantVoiceProfile.v1",
  defaultLocale: "ru-RU",
  deliveryKind: "voice_note",
  elevenlabs: {
    voiceId: null
  },
  yandex: {
    voice: "marina",
    role: null
  },
  openai: {
    voice: "marin"
  }
};

const YANDEX_TTS_ROLES = ["neutral", "good", "friendly", "strict", "whisper", "evil"] as const;

function normalizeVoiceProfile(value: unknown): AssistantVoiceProfile {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_VOICE_PROFILE;
  }
  const record = value as Record<string, unknown>;
  const elevenlabs =
    record.elevenlabs !== null &&
    typeof record.elevenlabs === "object" &&
    !Array.isArray(record.elevenlabs)
      ? (record.elevenlabs as Record<string, unknown>)
      : {};
  const yandex =
    record.yandex !== null && typeof record.yandex === "object" && !Array.isArray(record.yandex)
      ? (record.yandex as Record<string, unknown>)
      : {};
  const openai =
    record.openai !== null && typeof record.openai === "object" && !Array.isArray(record.openai)
      ? (record.openai as Record<string, unknown>)
      : {};

  return {
    schema: DEFAULT_VOICE_PROFILE.schema,
    defaultLocale:
      typeof record.defaultLocale === "string" && record.defaultLocale.trim().length > 0
        ? record.defaultLocale
        : DEFAULT_VOICE_PROFILE.defaultLocale,
    deliveryKind:
      record.deliveryKind === "audio" || record.deliveryKind === "voice_note"
        ? record.deliveryKind
        : DEFAULT_VOICE_PROFILE.deliveryKind,
    elevenlabs: {
      voiceId:
        typeof elevenlabs.voiceId === "string" && elevenlabs.voiceId.trim().length > 0
          ? elevenlabs.voiceId
          : null
    },
    yandex: {
      voice:
        typeof yandex.voice === "string" &&
        YANDEX_VOICE_OPTIONS.some((option) => option.value === yandex.voice)
          ? (yandex.voice as (typeof YANDEX_VOICE_OPTIONS)[number]["value"])
          : DEFAULT_VOICE_PROFILE.yandex.voice,
      role:
        typeof yandex.role === "string" && YANDEX_TTS_ROLES.includes(yandex.role as never)
          ? (yandex.role as (typeof YANDEX_TTS_ROLES)[number])
          : DEFAULT_VOICE_PROFILE.yandex.role
    },
    openai: {
      voice:
        typeof openai.voice === "string" &&
        OPENAI_VOICE_OPTIONS.some((option) => option.value === openai.voice)
          ? (openai.voice as (typeof OPENAI_VOICE_OPTIONS)[number]["value"])
          : DEFAULT_VOICE_PROFILE.openai.voice
    }
  };
}

function trimToNull(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ADR-074 Slice M3.3 — Memory Center merge: normalize a memory line so a
// workspace-row that says e.g. "PERSAI в реале для user." collapses with a
// registry-row that emits the same fact as "PERSAI в реале для user". The
// rule is intentionally conservative (no stemming, no language-aware
// punctuation): lowercase, trim, collapse internal whitespace, strip a
// single trailing dot. Reused by `mergedWorkspaceMemoryView` and the test.
function normalizeMemoryText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.+$/u, "");
}

function matchesVoiceLanguageFilter(
  language: string | null | undefined,
  filter: PersonaVoiceLanguageFilter
): boolean {
  const normalized = language?.trim().toLowerCase() ?? "";
  const isMultilingual =
    normalized === "multi" ||
    normalized === "multilingual" ||
    normalized === "multi-language" ||
    normalized === "multi language" ||
    normalized === "multilanguage" ||
    normalized.includes("multilingual") ||
    normalized.includes("multi-language") ||
    normalized.includes("multi language");
  if (filter === "mine") {
    return false;
  }
  if (filter === "ru") {
    if (isMultilingual) {
      return true;
    }
    return (
      normalized === "ru" ||
      normalized.startsWith("ru-") ||
      normalized === "russian" ||
      normalized.startsWith("russian ")
    );
  }
  if (filter === "en") {
    if (isMultilingual) {
      return true;
    }
    return (
      normalized === "en" ||
      normalized.startsWith("en-") ||
      normalized === "english" ||
      normalized.startsWith("english ")
    );
  }
  return !matchesVoiceLanguageFilter(language, "ru") && !matchesVoiceLanguageFilter(language, "en");
}

function normalizeVoiceLanguageBucket(language: string | null | undefined): "ru" | "en" | "other" {
  if (matchesVoiceLanguageFilter(language, "ru")) {
    return "ru";
  }
  if (matchesVoiceLanguageFilter(language, "en")) {
    return "en";
  }
  return "other";
}

function matchesOtherVoiceLanguageSearch(
  language: string | null | undefined,
  search: string
): boolean {
  const normalizedSearch = search.trim().toLowerCase();
  if (normalizedSearch.length === 0) {
    return true;
  }
  const normalizedLanguage = language?.trim().toLowerCase() ?? "";
  return normalizedLanguage.includes(normalizedSearch);
}

function resolveCatalogPreviewUrl(
  workspaceId: string | null | undefined,
  voice: Pick<VoiceCatalogEntry, "voiceId" | "previewAudioUrl" | "previewAvailable">
): string | null {
  if (!voice.previewAudioUrl) {
    return null;
  }
  if ("previewAvailable" in voice && voice.previewAvailable === false) {
    return null;
  }
  return workspaceId
    ? getWorkspaceVoiceCatalogPreviewUrl(workspaceId, voice.voiceId)
    : voice.previewAudioUrl;
}

function resolveClonedVoicePreviewUrl(
  workspaceId: string | null | undefined,
  voice: Pick<WorkspaceVideoClonedVoiceDto, "id" | "previewAudioUrl">
): string | null {
  if (!voice.previewAudioUrl) {
    return null;
  }
  return workspaceId
    ? getWorkspaceVideoClonedVoicePreviewUrl(workspaceId, voice.id)
    : voice.previewAudioUrl;
}

function formatVoiceLanguageLabel(voice: VoiceCatalogEntry): string {
  const language = voice.language?.trim();
  if (language && language.length > 0) {
    return language;
  }
  const bucket = voice.languageBucket;
  if (bucket === "ru") {
    return "RU";
  }
  if (bucket === "en") {
    return "EN";
  }
  return "OTHER";
}

function voiceCatalogRowKey(voice: VoiceCatalogEntry): string {
  return voice.catalogId?.trim() || `${voice.voiceId}:${voice.language ?? "unknown"}:${voice.name}`;
}

function voiceQualityBadgeLabels(voice: VoiceCatalogEntry): string[] {
  const labels: string[] = [];
  if (voice.source === "elevenlabs") {
    labels.push("ElevenLabs");
  }
  for (const tag of voice.qualityTags ?? []) {
    if (tag === "professional") labels.push("Pro");
    if (tag === "natural") labels.push("Natural");
    if (tag === "lifelike") labels.push("Lifelike");
  }
  return labels;
}

function voiceCatalogSortRank(voice: VoiceCatalogEntry): number {
  if (typeof voice.qualityRank === "number") {
    return voice.qualityRank;
  }
  let rank = 0;
  if (voice.previewAvailable !== false && voice.previewAudioUrl) rank += 20;
  if (voice.source === "elevenlabs") rank += 100;
  if ((voice.qualityTags ?? []).length > 0) rank += 60;
  if (voice.pauseSupport === true) rank += 8;
  if (voice.localeControl === true) rank += 4;
  if (voice.source === "gemini" && voice.previewAvailable === false) rank -= 80;
  return rank;
}

function voiceMultilingualSignature(voice: VoiceCatalogEntry): string {
  return [
    voice.voiceId.trim().toLowerCase(),
    voice.name.trim().toLowerCase(),
    voice.gender.trim().toLowerCase()
  ].join(":");
}

// ADR-074 Slice M3.3 — Memory Center merged view row. The Workspace tab
// renders both registry rows (structured `kind ∈ {fact, preference,
// open_loop}`) and workspace rows; deduplicated by normalized text with
// registry rows winning collisions because they carry close/resolved actions.
// Both sources may carry memoryClass/kind badges. The History tab only renders
// registry rows with `kind === null` (turn-derived echoes), so it is a single source.
type MergedMemoryRow =
  | {
      readonly source: "registry";
      readonly key: string;
      readonly normalizedText: string;
      readonly item: AssistantMemoryRegistryItemState;
    }
  | {
      readonly source: "workspace";
      readonly key: string;
      readonly normalizedText: string;
      readonly item: WorkspaceMemoryItem;
    };

// ADR-074 Slice M3.3 — kinds that count as "structured / curated" and
// therefore belong on the merged Workspace tab. Anything else
// (`kind === null` in particular) belongs on the History tab.
const STRUCTURED_REGISTRY_KINDS = new Set<NonNullable<AssistantMemoryRegistryItemState["kind"]>>([
  "fact",
  "preference",
  "open_loop"
]);

export function mergeMemoryViews(
  registryItems: readonly AssistantMemoryRegistryItemState[],
  workspaceItems: readonly WorkspaceMemoryItem[]
): { workspace: MergedMemoryRow[]; history: MergedMemoryRow[] } {
  const workspace: MergedMemoryRow[] = [];
  const history: MergedMemoryRow[] = [];
  const workspaceTabKeys = new Set<string>();

  for (const item of registryItems) {
    const normalizedText = normalizeMemoryText(item.summary);
    if (item.kind !== null && STRUCTURED_REGISTRY_KINDS.has(item.kind)) {
      workspace.push({
        source: "registry",
        key: `registry:${item.id}`,
        normalizedText,
        item
      });
      if (normalizedText.length > 0) {
        workspaceTabKeys.add(normalizedText);
      }
    } else if (item.kind === null) {
      history.push({
        source: "registry",
        key: `registry:${item.id}`,
        normalizedText,
        item
      });
    }
  }

  for (const item of workspaceItems) {
    const normalizedText = normalizeMemoryText(item.content);
    if (normalizedText.length > 0 && workspaceTabKeys.has(normalizedText)) {
      // Registry row already covers this fact with `kind` + close/forget
      // buttons; skip the workspace echo so we don't render the same line
      // twice.
      continue;
    }
    workspace.push({
      source: "workspace",
      key: `workspace:${item.id}`,
      normalizedText,
      item
    });
  }

  return { workspace, history };
}

export function AssistantSettings({
  data,
  initialSection,
  onOpenTelegramSettings,
  onOpenPricingPage,
  onOpenPackagesPage,
  onStartBillingCheckout,
  onSupportUnreadCountChange
}: AssistantSettingsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { getToken, isLoaded } = useAuth();
  const t = useTranslations("settings");
  const locale = useLocale();
  const tp = useTranslations("persona");
  const [toolLimitsExpanded, setToolLimitsExpanded] = useState(false);
  const [billingSettingsOpen, setBillingSettingsOpen] = useState(false);
  const [billingSubscription, setBillingSubscription] =
    useState<AssistantBillingSubscriptionManagementState | null>(null);
  const [billingSubscriptionLoading, setBillingSubscriptionLoading] = useState(false);
  const [billingSubscriptionFb, setBillingSubscriptionFb] = useState<ActionFeedback>(null);
  const [billingSubscriptionLoaded, setBillingSubscriptionLoaded] = useState(false);
  const [enableAutoRenewPending, setEnableAutoRenewPending] = useState(false);
  const [disableAutoRenewPending, setDisableAutoRenewPending] = useState(false);
  const [disableAutoRenewConfirmOpen, setDisableAutoRenewConfirmOpen] = useState(false);
  const [browserProfiles, setBrowserProfiles] = useState<AssistantBrowserProfileListItem[]>([]);
  const [browserProfilesLoading, setBrowserProfilesLoading] = useState(false);
  const [browserProfilesActionId, setBrowserProfilesActionId] = useState<string | null>(null);
  const [settingsBrowserLogin, setSettingsBrowserLogin] = useState<PendingBrowserLoginState | null>(
    null
  );
  const [nativeAssistProfileKey, setNativeAssistProfileKey] = useState<string | null>(null);
  const assistant = data.assistant;
  const latestWebChatId =
    [...data.chats]
      .map((item) => item.chat)
      .filter((chat) => chat.surface === "web" && chat.archivedAt === null)
      .sort((left, right) => {
        const leftTs = left.lastMessageAt ? Date.parse(left.lastMessageAt) : 0;
        const rightTs = right.lastMessageAt ? Date.parse(right.lastMessageAt) : 0;
        return rightTs - leftTs;
      })[0]?.id ?? null;
  const activeWebThreadKey =
    pathname?.startsWith("/app/chat") === true
      ? (() => {
          const value = searchParams.get("thread");
          return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
        })()
      : null;
  const activeGalleryChatId =
    activeWebThreadKey === null
      ? null
      : (data.chats.find(
          (item) =>
            item.chat.surface === "web" &&
            item.chat.archivedAt === null &&
            item.chat.surfaceThreadKey === activeWebThreadKey
        )?.chat.id ?? null);
  const galleryChatId = activeGalleryChatId ?? latestWebChatId;
  const galleryDefaultScope = activeGalleryChatId === null ? "assistant" : "session";
  const galleryAllowSessionScope = activeGalleryChatId !== null;
  const hasAssistantSwitcher = (data.assistantLimit?.maxAssistants ?? 1) > 1;
  const [assistantSwitcherOpen, setAssistantSwitcherOpen] = useState(false);
  const [assistantSwitchBusyId, setAssistantSwitchBusyId] = useState<string | null>(null);
  const [assistantCreateBusy, setAssistantCreateBusy] = useState(false);
  const [assistantSwitcherError, setAssistantSwitcherError] = useState<string | null>(null);
  const statusLabel = t(
    (
      {
        live: "live",
        applying: "applying",
        draft: "draft",
        failed: "failed",
        degraded: "degraded",
        none: "notCreated"
      } as Record<string, string>
    )[data.assistantStatus] ?? "notCreated"
  );
  const statusDot = STATUS_LABELS[data.assistantStatus]?.dot ?? "bg-text-subtle";
  const quotaBucketLabels: Record<QuotaBucketState["bucketCode"], string> = {
    token_budget: t("tokenBudget"),
    active_web_chats: t("activeChats"),
    media_storage_bytes: t("mediaStorage"),
    knowledge_storage_bytes: t("knowledgeStorage")
  };
  // Keys here MUST match the canonical `toolCode` values persisted in the
  // backend tool catalog (see apps/api/prisma/tool-catalog-data.ts), not the
  // historical human-readable names. Mismatches silently fall back to the
  // english `displayName` and leak untranslated tool labels into ru UI.
  const toolLimitLabels: Record<string, string> = {
    background_task: t("toolLimitBackgroundTask"),
    browser: t("toolLimitBrowser"),
    document: t("toolLimitDocument"),
    exec: t("toolLimitExec"),
    files: t("toolLimitFiles"),
    image_edit: t("toolLimitImageEdit"),
    image_generate: t("toolLimitImageGenerate"),
    memory_get: t("toolLimitKnowledgeFetch"),
    memory_search: t("toolLimitKnowledgeSearch"),
    scheduled_action: t("toolLimitScheduledAction"),
    shell: t("toolLimitShell"),
    tts: t("toolLimitTextToSpeech"),
    video_generate: t("toolLimitVideoGenerate"),
    web_fetch: t("toolLimitWebFetch"),
    web_search: t("toolLimitWebSearch")
  };
  const tokenBucket =
    data.plan?.limits.quotaBuckets.find((bucket) => bucket.bucketCode === "token_budget") ?? null;
  const compactQuotaBuckets =
    data.plan?.limits.quotaBuckets.filter((bucket) =>
      ["media_storage_bytes", "knowledge_storage_bytes"].includes(bucket.bucketCode)
    ) ?? [];
  const monthlyToolQuotaSnapshot =
    data.plan?.limits.monthlyToolQuotas ??
    (
      data.plan?.limits as {
        monthlyMediaQuotas?: MonthlyToolQuotaSnapshot;
      } | null
    )?.monthlyMediaQuotas ??
    null;
  const allToolDailyLimits =
    [...(data.plan?.limits.toolDailyLimits ?? [])]
      .filter(
        (tool) =>
          !["image_generate", "image_edit", "video_generate", "document"].includes(tool.toolCode)
      )
      .sort((left, right) => {
        if (left.active !== right.active) {
          return left.active ? -1 : 1;
        }
        const leftLabel = toolLimitLabels[left.toolCode] ?? left.displayName;
        const rightLabel = toolLimitLabels[right.toolCode] ?? right.displayName;
        return leftLabel.localeCompare(rightLabel, locale);
      }) ?? [];
  const activeToolCount = allToolDailyLimits.filter((tool) => tool.active).length;
  const billingSummary = resolveBillingSummaryCopy(
    data.plan?.effectivePlan,
    locale,
    billingSubscription?.scheduledPlanChange ?? data.billingSubscription?.scheduledPlanChange
  );
  const formatQuotaBucketValue = (bucket: QuotaBucketState): string => {
    const limitLabel =
      bucket.limit === null ? "∞" : formatQuotaBucketScalar(bucket, Math.max(0, bucket.limit));
    if (!bucket.usageAvailable || bucket.used === null) {
      return bucket.limit === null
        ? t("usageUnavailable")
        : t("usageUnavailableWithLimit", { limit: limitLabel });
    }
    const usedLabel = formatQuotaBucketScalar(bucket, Math.max(0, bucket.used));
    return bucket.limit === null ? usedLabel : `${usedLabel}/${limitLabel}`;
  };
  const formatMonthlyMediaQuotaValue = (tool: MonthlyToolQuotaToolState): string => {
    const base = tool.limitUnits;
    const bonus = tool.bonusLimitUnits ?? 0;
    const effectiveLimit = tool.effectiveLimitUnits ?? base ?? null;
    if (effectiveLimit === null) {
      return String(tool.usedUnits);
    }
    if (base !== null && bonus > 0) {
      return `${tool.usedUnits} / ${base} +${bonus}`;
    }
    return `${tool.usedUnits} / ${effectiveLimit}`;
  };
  const formatMonthlyMediaRemainingSubline = (tool: MonthlyToolQuotaToolState): string | null => {
    const effectiveLimit = tool.effectiveLimitUnits ?? tool.limitUnits ?? null;
    if (effectiveLimit === null) {
      return null;
    }
    return t("monthlyMediaRemainingSubline", {
      remaining: Math.max(0, effectiveLimit - tool.usedUnits)
    });
  };

  type MonthlyCardData = {
    toolCode: string;
    label: string;
    value: string;
    secondary: string | null;
    hasBonus: boolean;
    unavailable: boolean;
    buyChipLabel: string;
    onBuyClick: (() => void) | null;
  };
  const buildMonthlyCard = (toolCode: string): MonthlyCardData | null => {
    const snapshot =
      (monthlyToolQuotaSnapshot?.tools as MonthlyToolQuotaToolState[] | undefined)?.find(
        (entry) => entry.toolCode === toolCode
      ) ?? null;
    const daily =
      data.plan?.limits.toolDailyLimits.find((entry) => entry.toolCode === toolCode) ?? null;
    if (snapshot === null && daily === null) {
      return null;
    }
    // `daily.active === false` is the authoritative "disabled on plan" signal.
    // When daily is missing we trust the snapshot's presence as active.
    const isActive = daily !== null ? daily.active === true : snapshot !== null;
    const label =
      toolLimitLabels[toolCode] ?? snapshot?.displayName ?? daily?.displayName ?? toolCode;
    if (!isActive) {
      return {
        toolCode,
        label,
        value: t("limitUnavailable"),
        secondary: null,
        hasBonus: false,
        unavailable: true,
        buyChipLabel: t("changePlan"),
        onBuyClick: onOpenPricingPage ?? null
      };
    }
    // VC override for video_generate: renders wallet balance instead of per-unit count.
    // workspaceVcoinBalance is a required field on UserPlanVisibilityState (Slice 6a contract),
    // so the undefined guard is purely defensive for the unexpected absent-data case.
    const vcBalance = data.plan?.workspaceVcoinBalance;
    if (toolCode === "video_generate" && vcBalance !== undefined) {
      return {
        toolCode,
        label,
        value: t("monthlyVideoVcRemaining", { count: vcBalance.balanceVc }),
        secondary: `1 VC ≈ $${(1 / vcBalance.vcoinExchangeRate).toFixed(2)}`,
        hasBonus: snapshot !== null ? (snapshot.bonusLimitUnits ?? 0) > 0 : false,
        unavailable: false,
        buyChipLabel: t("monthlyMediaBuyChip"),
        onBuyClick: onOpenPackagesPage ?? null
      };
    }
    if (snapshot === null) {
      return {
        toolCode,
        label,
        value: "—",
        secondary: null,
        hasBonus: false,
        unavailable: false,
        buyChipLabel: t("monthlyMediaBuyChip"),
        onBuyClick: onOpenPackagesPage ?? null
      };
    }
    return {
      toolCode,
      label,
      value: formatMonthlyMediaQuotaValue(snapshot),
      secondary: formatMonthlyMediaRemainingSubline(snapshot),
      hasBonus: (snapshot.bonusLimitUnits ?? 0) > 0,
      unavailable: false,
      buyChipLabel: t("monthlyMediaBuyChip"),
      onBuyClick: onOpenPackagesPage ?? null
    };
  };
  // Fixed visual order for media tools (edit -> create -> video), per UX.
  const MEDIA_TOOL_ORDER = ["image_edit", "image_generate", "video_generate"] as const;
  const orderedMonthlyMediaCards = MEDIA_TOOL_ORDER.map((code) => buildMonthlyCard(code)).filter(
    (card): card is MonthlyCardData => card !== null
  );
  const documentMonthlyCard = buildMonthlyCard("document");

  const [draftName, setDraftName] = useState(assistant?.draft.displayName ?? "");
  const [draftInstructions, setDraftInstructions] = useState(assistant?.draft.instructions ?? "");
  const [editingPersonality, setEditingPersonality] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFb, setSaveFb] = useState<ActionFeedback>(null);
  const [saveButtonState, setSaveButtonState] = useState<"idle" | "saved">("idle");
  const saveButtonResetTimerRef = useRef<number | null>(null);

  const [draftTraits, setDraftTraits] = useState<Record<string, number>>(
    (assistant?.draft.traits as Record<string, number> | null) ?? DEFAULT_TRAITS
  );
  const [draftAvatarUrl, setDraftAvatarUrl] = useState<string | null>(
    assistant?.draft.avatarUrl ?? null
  );
  const [draftAssistantGender, setDraftAssistantGender] = useState<AssistantGender>(
    normalizeAssistantGender(assistant?.draft.assistantGender)
  );
  const [draftVoiceProfile, setDraftVoiceProfile] = useState<AssistantVoiceProfile>(
    normalizeVoiceProfile(assistant?.draft.voiceProfile)
  );
  const [showTraitControls, setShowTraitControls] = useState(false);
  const [memoryDrawerOpen, setMemoryDrawerOpen] = useState(initialSection === "memory");
  const [avatarPreviewBlobUrl, setAvatarPreviewBlobUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetFb, setResetFb] = useState<ActionFeedback>(null);
  const [skillsState, setSkillsState] = useState<AssistantSkillsState | null>(null);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsSaving, setSkillsSaving] = useState(false);
  const [skillsFb, setSkillsFb] = useState<ActionFeedback>(null);

  const [memoryItems, setMemoryItems] = useState<AssistantMemoryRegistryItemState[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [forgettingId, setForgettingId] = useState<string | null>(null);
  const [closingOpenLoopId, setClosingOpenLoopId] = useState<string | null>(null);
  const [memoryVisibleCount, setMemoryVisibleCount] = useState(5);
  // ADR-074 Slice M3.3 — Memory Center inline-error feedback. Replaces
  // the silent `catch { /* non-critical */ }` blocks that previously
  // swallowed close/forget/load errors and made the "Mark as closed"
  // button look broken to the user.
  const [memoryFb, setMemoryFb] = useState<ActionFeedback>(null);

  const [wsMemoryItems, setWsMemoryItems] = useState<WorkspaceMemoryItem[]>([]);
  const [wsMemoryLoading, setWsMemoryLoading] = useState(false);
  const [wsMemorySearch, setWsMemorySearch] = useState("");
  const [wsMemoryAdding, setWsMemoryAdding] = useState(false);
  const [wsNewMemory, setWsNewMemory] = useState("");
  const [wsForgettingId, setWsForgettingId] = useState<string | null>(null);
  const [wsMemoryVisibleCount, setWsMemoryVisibleCount] = useState(5);
  const [wsMemoryFb, setWsMemoryFb] = useState<ActionFeedback>(null);
  const [memoryTab, setMemoryTab] = useState<"workspace" | "history">("workspace");
  const [expandedWorkspaceMemoryKeys, setExpandedWorkspaceMemoryKeys] = useState<string[]>([]);
  const [expandedHistoryMemoryKeys, setExpandedHistoryMemoryKeys] = useState<string[]>([]);

  const [taskItems, setTaskItems] = useState<AssistantTaskRegistryItemState[]>([]);
  const [backgroundTaskItems, setBackgroundTaskItems] = useState<
    AssistantBackgroundTaskItemState[]
  >([]);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskActionId, setTaskActionId] = useState<string | null>(null);
  const [tasksFb, setTasksFb] = useState<ActionFeedback>(null);
  const [showUserTasks, setShowUserTasks] = useState(false);
  const [showAssistantActions, setShowAssistantActions] = useState(false);
  const [showCompletedAssistantActions, setShowCompletedAssistantActions] = useState(false);
  const [notificationChannel, setNotificationChannel] =
    useState<AssistantPreferredNotificationChannel>("web");
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationFb, setNotificationFb] = useState<ActionFeedback>(null);
  const [voiceSettings, setVoiceSettings] = useState<AssistantVoiceSettingsState | null>(null);
  const [voiceSettingsLoading, setVoiceSettingsLoading] = useState(false);
  const [voiceSettingsError, setVoiceSettingsError] = useState<string | null>(null);
  const [voiceCurationSavingId, setVoiceCurationSavingId] = useState<string | null>(null);
  const [voiceCurationError, setVoiceCurationError] = useState<string | null>(null);
  const [voiceCatalogRefreshing, setVoiceCatalogRefreshing] = useState(false);
  const [elevenLabsLanguageBucket, setElevenLabsLanguageBucket] = useState<VoiceLanguageBucket>(
    locale.toLowerCase().startsWith("ru") ? "ru" : "en"
  );
  const [supportUnreadCount, setSupportUnreadCount] = useState(0);
  const [openSection, setOpenSection] = useState<SettingsSectionId | null>(() =>
    normalizeInitialSection(initialSection)
  );

  // ── Characters section state (ADR-109 Slice 9) ────────────────────────────
  const [personaList, setPersonaList] = useState<PersonaListItemDto[]>([]);
  const [personaLimit, setPersonaLimit] = useState<number>(3);
  const [personaCreationVcoinCost, setPersonaCreationVcoinCost] = useState<number>(0);
  const [personaListLoading, setPersonaListLoading] = useState(false);
  const [clonedVoiceList, setClonedVoiceList] = useState<WorkspaceVideoClonedVoiceDto[]>([]);
  const [clonedVoiceLimit, setClonedVoiceLimit] = useState<number>(5);
  const [clonedVoiceCreationVcoinCost, setClonedVoiceCreationVcoinCost] = useState<number>(50);
  const [clonedVoiceListLoading, setClonedVoiceListLoading] = useState(false);
  const [clonedVoiceSubmittingId, setClonedVoiceSubmittingId] = useState<string | null>(null);
  const [clonedVoicesExpanded, setClonedVoicesExpanded] = useState(false);
  const [voiceCatalog, setVoiceCatalog] = useState<VoiceCatalogEntry[]>([]);
  const [voiceCatalogLoading, setVoiceCatalogLoading] = useState(false);
  const [voiceCatalogUnavailable, setVoiceCatalogUnavailable] = useState(false);
  const [voiceGenderFilter, setVoiceGenderFilter] = useState<PersonaVoiceGenderFilter>("neutral");
  const [voiceLanguageFilter, setVoiceLanguageFilter] = useState<PersonaVoiceLanguageFilter>(
    locale.toLowerCase().startsWith("ru") ? "ru" : "en"
  );
  const [otherVoiceLanguageSearch, setOtherVoiceLanguageSearch] = useState("");
  const [personaLightbox, setPersonaLightbox] = useState<PersonaLightboxState>(null);
  const [createPersonaOpen, setCreatePersonaOpen] = useState(false);
  const [personaModalMode, setPersonaModalMode] = useState<PersonaModalMode>("create");
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const [createPersonaName, setCreatePersonaName] = useState("");
  const [createPersonaVoiceId, setCreatePersonaVoiceId] = useState<string | null>(null);
  const [createPersonaClonedVoiceId, setCreatePersonaClonedVoiceId] = useState<string | null>(null);
  const [createPersonaPortrait, setCreatePersonaPortrait] = useState<File | null>(null);
  const [createPersonaVideoFormatChoice, setCreatePersonaVideoFormatChoice] =
    useState<PersonaVideoFormatChoice>("auto");
  const [createPersonaAutoVideoFormat, setCreatePersonaAutoVideoFormat] =
    useState<PersonaVideoFormat>("1:1");
  const [createPersonaPortraitPreview, setCreatePersonaPortraitPreview] = useState<string | null>(
    null
  );
  const [createPersonaSubmitting, setCreatePersonaSubmitting] = useState(false);
  const [createPersonaError, setCreatePersonaError] = useState<string | null>(null);
  const [createPersonaPortraitError, setCreatePersonaPortraitError] = useState<string | null>(null);
  const [deletePersonaId, setDeletePersonaId] = useState<string | null>(null);
  const [deletePersonaName, setDeletePersonaName] = useState<string | null>(null);
  const [deletePersonaSubmitting, setDeletePersonaSubmitting] = useState(false);
  const [personaFb, setPersonaFb] = useState<ActionFeedback>(null);
  const [clonedVoiceFb, setClonedVoiceFb] = useState<ActionFeedback>(null);
  const personaPortraitInputRef = useRef<HTMLInputElement>(null);
  const [createClonedVoiceOpen, setCreateClonedVoiceOpen] = useState(false);
  const [createClonedVoiceAttachToPersona, setCreateClonedVoiceAttachToPersona] = useState(false);
  const [createClonedVoiceMode, setCreateClonedVoiceMode] =
    useState<ClonedVoiceModalMode>("upload");
  const [createClonedVoiceName, setCreateClonedVoiceName] = useState("");
  const [createClonedVoiceLanguageHint, setCreateClonedVoiceLanguageHint] = useState("");
  const [createClonedVoiceRightsConfirmed, setCreateClonedVoiceRightsConfirmed] = useState(false);
  const [createClonedVoiceAudio, setCreateClonedVoiceAudio] = useState<File | null>(null);
  const [createClonedVoiceAudioPreviewUrl, setCreateClonedVoiceAudioPreviewUrl] = useState<
    string | null
  >(null);
  const [createClonedVoiceSubmitting, setCreateClonedVoiceSubmitting] = useState(false);
  const [createClonedVoiceError, setCreateClonedVoiceError] = useState<string | null>(null);
  const [createClonedVoiceRecordingState, setCreateClonedVoiceRecordingState] = useState<
    "idle" | "recording"
  >("idle");
  const [createClonedVoiceRecordingSeconds, setCreateClonedVoiceRecordingSeconds] = useState(0);
  const [createClonedVoiceMicError, setCreateClonedVoiceMicError] = useState<string | null>(null);
  const clonedVoiceRecorderRef = useRef<MediaRecorder | null>(null);
  const clonedVoiceRecorderStreamRef = useRef<MediaStream | null>(null);
  const clonedVoiceRecorderChunksRef = useRef<Blob[]>([]);
  const clonedVoiceRecorderTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clonedVoiceRecordingAttemptIdRef = useRef(0);

  const revokeBlobUrl = useCallback((url: string | null) => {
    if (typeof url === "string" && url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }, []);

  const replacePersonaPortraitPreview = useCallback(
    (nextUrl: string | null) => {
      setCreatePersonaPortraitPreview((current) => {
        if (current && current !== nextUrl) {
          revokeBlobUrl(current);
        }
        return nextUrl;
      });
    },
    [revokeBlobUrl]
  );

  const resetPersonaModal = useCallback(
    (mode: PersonaModalMode, persona?: PersonaListItemDto | null) => {
      setPersonaModalMode(mode);
      setEditingPersonaId(mode === "edit" ? (persona?.id ?? null) : null);
      setCreatePersonaName(mode === "edit" ? (persona?.displayName ?? "") : "");
      setCreatePersonaVoiceId(mode === "edit" ? (persona?.heygenVoiceId ?? null) : null);
      setCreatePersonaClonedVoiceId(mode === "edit" ? (persona?.clonedVoiceId ?? null) : null);
      setCreatePersonaPortrait(null);
      setCreatePersonaVideoFormatChoice("auto");
      setCreatePersonaAutoVideoFormat(mode === "edit" ? (persona?.videoFormat ?? "1:1") : "1:1");
      replacePersonaPortraitPreview(mode === "edit" ? (persona?.portraitImageUrl ?? null) : null);
      setCreatePersonaError(null);
      setCreatePersonaPortraitError(null);
      setOtherVoiceLanguageSearch("");
      setVoiceGenderFilter("neutral");
      setVoiceLanguageFilter(locale.toLowerCase().startsWith("ru") ? "ru" : "en");
      setCreatePersonaOpen(true);
    },
    [locale, replacePersonaPortraitPreview]
  );

  const cleanupClonedVoiceRecorder = useCallback(() => {
    if (clonedVoiceRecorderTimerRef.current) {
      clearInterval(clonedVoiceRecorderTimerRef.current);
      clonedVoiceRecorderTimerRef.current = null;
    }
    clonedVoiceRecorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    clonedVoiceRecorderStreamRef.current = null;
    clonedVoiceRecorderRef.current = null;
  }, []);

  const clearClonedVoiceAudioPreview = useCallback(() => {
    setCreateClonedVoiceAudioPreviewUrl((current) => {
      if (current) {
        revokeBlobUrl(current);
      }
      return null;
    });
  }, [revokeBlobUrl]);

  const cancelClonedVoiceRecordingAttempt = useCallback(() => {
    clonedVoiceRecordingAttemptIdRef.current += 1;
    cleanupClonedVoiceRecorder();
  }, [cleanupClonedVoiceRecorder]);

  const closePersonaModal = useCallback(() => {
    setCreatePersonaOpen(false);
    setCreatePersonaPortrait(null);
    setCreatePersonaVideoFormatChoice("auto");
    replacePersonaPortraitPreview(null);
  }, [replacePersonaPortraitPreview]);

  const closeClonedVoiceModal = useCallback(() => {
    cancelClonedVoiceRecordingAttempt();
    clearClonedVoiceAudioPreview();
    setCreateClonedVoiceAudio(null);
    setCreateClonedVoiceRecordingState("idle");
    setCreateClonedVoiceRecordingSeconds(0);
    setCreateClonedVoiceMicError(null);
    setCreateClonedVoiceError(null);
    setCreateClonedVoiceOpen(false);
  }, [cancelClonedVoiceRecordingAttempt, clearClonedVoiceAudioPreview]);

  const setClonedVoiceAudioFile = useCallback(
    (file: File | null) => {
      clearClonedVoiceAudioPreview();
      setCreateClonedVoiceAudio(file);
      if (file) {
        setCreateClonedVoiceAudioPreviewUrl(URL.createObjectURL(file));
      }
    },
    [clearClonedVoiceAudioPreview]
  );

  const resetClonedVoiceModal = useCallback(
    (attachToPersona: boolean) => {
      cancelClonedVoiceRecordingAttempt();
      clearClonedVoiceAudioPreview();
      setCreateClonedVoiceAttachToPersona(attachToPersona);
      setCreateClonedVoiceMode("upload");
      setCreateClonedVoiceName("");
      setCreateClonedVoiceLanguageHint("");
      setCreateClonedVoiceRightsConfirmed(false);
      setCreateClonedVoiceAudio(null);
      setCreateClonedVoiceSubmitting(false);
      setCreateClonedVoiceError(null);
      setCreateClonedVoiceMicError(null);
      setCreateClonedVoiceRecordingState("idle");
      setCreateClonedVoiceRecordingSeconds(0);
      setCreateClonedVoiceOpen(true);
    },
    [cancelClonedVoiceRecordingAttempt, clearClonedVoiceAudioPreview]
  );

  const loadPersonas = useCallback(async () => {
    const workspaceId = assistant?.workspaceId;
    if (!workspaceId) return;
    const token = await getToken();
    if (!token) return;
    setPersonaListLoading(true);
    try {
      const result = await getWorkspaceVideoPersonas(token, workspaceId);
      setPersonaList(result.personas);
      setPersonaLimit(result.limit);
      setPersonaCreationVcoinCost(result.creationVcoinCost);
    } catch {
      // Keep last known list on refresh failure
    } finally {
      setPersonaListLoading(false);
    }
  }, [assistant?.workspaceId, getToken]);

  const loadClonedVoices = useCallback(async () => {
    const workspaceId = assistant?.workspaceId;
    if (!workspaceId) return;
    const token = await getToken();
    if (!token) return;
    setClonedVoiceListLoading(true);
    try {
      const result = await getWorkspaceVideoClonedVoices(token, workspaceId);
      setClonedVoiceList(result.clonedVoices);
      setClonedVoiceLimit(result.limit);
      setClonedVoiceCreationVcoinCost(result.creationVcoinCost);
    } catch {
      // Keep last known voice list on refresh failure
    } finally {
      setClonedVoiceListLoading(false);
    }
  }, [assistant?.workspaceId, getToken]);

  const loadVoiceCatalog = useCallback(async () => {
    const workspaceId = assistant?.workspaceId;
    if (!workspaceId) return;
    const token = await getToken();
    if (!token) return;
    setVoiceCatalogLoading(true);
    try {
      const result = await getWorkspaceVoiceCatalog(token, workspaceId);
      setVoiceCatalog(result.voices);
      setVoiceCatalogUnavailable(result.voices.length === 0);
    } catch {
      setVoiceCatalogUnavailable(true);
    } finally {
      setVoiceCatalogLoading(false);
    }
  }, [assistant?.workspaceId, getToken]);

  const talkingVideoEnabled = data.plan?.entitlements?.talkingVideoEnabled === true;
  const multilingualVoiceSignatures = useMemo(() => {
    const languagesBySignature = new Map<string, Set<string>>();
    for (const voice of voiceCatalog) {
      const language = voice.language?.trim().toLowerCase();
      if (language !== "ru" && language !== "en") {
        continue;
      }
      const signature = voiceMultilingualSignature(voice);
      const languages = languagesBySignature.get(signature) ?? new Set<string>();
      languages.add(language);
      languagesBySignature.set(signature, languages);
    }
    const signatures = new Set<string>();
    for (const [signature, languages] of languagesBySignature) {
      if (languages.has("ru") && languages.has("en")) {
        signatures.add(signature);
      }
    }
    return signatures;
  }, [voiceCatalog]);
  const filteredVoiceCatalog = useMemo(() => {
    return voiceCatalog
      .filter((voice) => {
        if (
          voiceGenderFilter !== "neutral" &&
          voice.gender.trim().toLowerCase() !== voiceGenderFilter
        ) {
          return false;
        }
        const derivedBucket = normalizeVoiceLanguageBucket(voice.language);
        const bucket =
          voice.languageBucket === "ru" ||
          voice.languageBucket === "en" ||
          voice.languageBucket === "other"
            ? voice.languageBucket === derivedBucket
              ? voice.languageBucket
              : derivedBucket
            : derivedBucket;
        if (bucket !== voiceLanguageFilter) {
          return false;
        }
        if (voiceLanguageFilter !== "other") {
          return true;
        }
        return matchesOtherVoiceLanguageSearch(voice.language, otherVoiceLanguageSearch);
      })
      .sort((left, right) => {
        const rankDelta = voiceCatalogSortRank(right) - voiceCatalogSortRank(left);
        if (rankDelta !== 0) {
          return rankDelta;
        }
        return left.name.localeCompare(right.name);
      });
  }, [otherVoiceLanguageSearch, voiceCatalog, voiceGenderFilter, voiceLanguageFilter]);
  const charactersPlanGateLabel = t("charactersLockedHint", {
    plan: data.plan?.effectivePlan.code ?? "Pro"
  });
  const createPersonaDisabledReason = !talkingVideoEnabled
    ? charactersPlanGateLabel
    : personaList.length >= personaLimit
      ? t("charactersFormLimitReached", { n: personaLimit })
      : null;
  const charactersHelperText = !talkingVideoEnabled
    ? t("charactersLockedBanner")
    : personaList.length === 0
      ? t("charactersEmpty")
      : t("charactersUsageHint");
  const clonedVoiceCreateDisabledReason = !talkingVideoEnabled
    ? charactersPlanGateLabel
    : clonedVoiceList.length >= clonedVoiceLimit
      ? t("voicesFormLimitReached", { n: clonedVoiceLimit })
      : null;
  const readyClonedVoices = useMemo(
    () => clonedVoiceList.filter((voice) => voice.status === "ready"),
    [clonedVoiceList]
  );
  const activePersonaVoiceOption = useMemo(() => {
    if (!createPersonaClonedVoiceId) {
      return null;
    }
    return readyClonedVoices.find((voice) => voice.id === createPersonaClonedVoiceId) ?? null;
  }, [createPersonaClonedVoiceId, readyClonedVoices]);
  const personaFallbackVoiceId =
    createPersonaVoiceId ??
    (createPersonaClonedVoiceId ? (voiceCatalog[0]?.voiceId ?? null) : null);
  const cloneLinkedSummaryById = useMemo(() => {
    const map = new Map<string, string>();
    for (const voice of clonedVoiceList) {
      const linked = personaList.filter((persona) => persona.clonedVoiceId === voice.id);
      if (linked.length === 0) {
        continue;
      }
      map.set(
        voice.id,
        linked.length === 1
          ? t("voicesLinkedOne", { name: linked[0]!.displayName })
          : t("voicesLinkedMany", {
              count: linked.length
            })
      );
    }
    return map;
  }, [clonedVoiceList, personaList, t]);

  const refreshSupportUnreadCount = useCallback(async () => {
    if (!assistant?.id) {
      setSupportUnreadCount(0);
      return;
    }
    const token = await getToken();
    if (!token) return;
    try {
      const rows = await getAssistantSupportTickets(token, assistant.id);
      setSupportUnreadCount(rows.filter((row) => row.hasUnread).length);
    } catch {
      // Keep the last known count when the background refresh fails.
    }
  }, [assistant?.id, getToken]);

  const refreshBrowserProfiles = useCallback(
    async (options?: { background?: boolean }) => {
      if (!assistant?.id) {
        setBrowserProfiles([]);
        return;
      }
      const token = await getToken();
      if (!token) return;
      if (options?.background !== true) {
        setBrowserProfilesLoading(true);
      }
      try {
        const profiles = await listAssistantBrowserProfiles(token, assistant.id);
        setBrowserProfiles(profiles);
      } catch {
        // Keep the last known list when refresh fails.
      } finally {
        if (options?.background !== true) {
          setBrowserProfilesLoading(false);
        }
      }
    },
    [assistant?.id, getToken]
  );

  const handleDeleteBrowserProfile = useCallback(
    async (profileId: string) => {
      if (!assistant?.id) return;
      const token = await getToken();
      if (!token) return;
      setBrowserProfilesActionId(profileId);
      try {
        await deleteAssistantBrowserProfile(token, assistant.id, profileId);
        await refreshBrowserProfiles({ background: true });
      } finally {
        setBrowserProfilesActionId(null);
      }
    },
    [assistant?.id, getToken, refreshBrowserProfiles]
  );

  const handleOpenBrowserProfile = useCallback(
    async (profile: AssistantBrowserProfileListItem) => {
      if (!assistant?.id) return;
      const token = await getToken();
      if (!token) return;
      setBrowserProfilesActionId(profile.id);
      try {
        if (profile.status === "active") {
          const nativeSurface = isNativeBrowserBridgeShell();
          if (nativeSurface) {
            setNativeAssistProfileKey(profile.profileKey);
          }
          try {
            const pending = await openAssistantBrowserProfileView(token, assistant.id, profile.id);
            // Configured sessions open their browser surface directly. The
            // one-time web modal is reserved for login/reconnect or an honest
            // open failure; keeping it closed also prevents two visible
            // desktop windows.
            setSettingsBrowserLogin(null);
            if (pending.bridgeClientKind === "capacitor") {
              setNativeAssistProfileKey(profile.profileKey);
            } else {
              setNativeAssistProfileKey(null);
            }
          } catch {
            setNativeAssistProfileKey(null);
            setSettingsBrowserLogin({
              profileId: profile.id,
              profileKey: profile.profileKey,
              displayName: profile.displayName,
              loginUrl: profile.loginUrl,
              workspaceId: assistant.workspaceId,
              bridgeClientKind: nativeSurface ? "capacitor" : "extension",
              completionMode: "assist"
            });
          }
        } else {
          const pending = await reconnectAssistantBrowserProfile(token, assistant.id, profile.id);
          setSettingsBrowserLogin(pending);
        }
        await refreshBrowserProfiles({ background: true });
      } finally {
        setBrowserProfilesActionId(null);
      }
    },
    [assistant?.id, assistant?.workspaceId, getToken, refreshBrowserProfiles]
  );

  useEffect(() => {
    if (nativeAssistProfileKey === null) {
      return;
    }
    return pushBackHandler(
      () => {
        void hideNativeBrowserBridgeView(nativeAssistProfileKey).catch(() => undefined);
        setNativeAssistProfileKey(null);
      },
      { priority: 100 }
    );
  }, [nativeAssistProfileKey]);

  useEffect(() => {
    if (openSection === "channels") {
      void refreshBrowserProfiles();
    }
  }, [openSection, refreshBrowserProfiles]);

  useEffect(() => {
    void refreshSupportUnreadCount();
    const intervalId = window.setInterval(() => {
      void refreshSupportUnreadCount();
    }, 20_000);
    return () => window.clearInterval(intervalId);
  }, [refreshSupportUnreadCount]);

  useEffect(() => {
    onSupportUnreadCountChange?.(supportUnreadCount);
  }, [onSupportUnreadCountChange, supportUnreadCount]);

  // Load personas whenever the Characters section is open; voice catalog only when unlocked
  useEffect(() => {
    if (openSection === "characters") {
      void loadPersonas();
      void loadClonedVoices();
      void loadVoiceCatalog();
    }
  }, [openSection, loadClonedVoices, loadPersonas, loadVoiceCatalog]);

  useEffect(() => {
    return () => {
      cleanupClonedVoiceRecorder();
      clearClonedVoiceAudioPreview();
    };
  }, [cleanupClonedVoiceRecorder, clearClonedVoiceAudioPreview]);

  useEffect(() => {
    return () => {
      revokeBlobUrl(createPersonaPortraitPreview);
    };
  }, [createPersonaPortraitPreview, revokeBlobUrl]);
  const billingStatusLabel = useCallback(
    (
      status: AssistantBillingSubscriptionManagementState["subscriptionStatus"] | null | undefined
    ) => {
      switch (status) {
        case "trialing":
          return t("billingStatusTrial");
        case "active":
          return t("billingStatusActive");
        case "grace_period":
        case "past_due":
          return t("billingStatusGrace");
        case "paused":
          return t("billingStatusPaused");
        case "canceled":
          return t("billingStatusCanceled");
        case "expired":
        case "expired_fallback":
          return t("billingStatusExpired");
        default:
          return t("billingStatusFree");
      }
    },
    [t]
  );
  const formatBillingDate = useCallback((value: string | null): string | null => {
    if (value === null) {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    });
  }, []);
  const resolveBillingToken = useCallback(async (): Promise<string | null> => {
    if (!isLoaded) {
      return null;
    }
    return (await getToken({ skipCache: true })) ?? (await getToken()) ?? null;
  }, [getToken, isLoaded]);
  const loadBillingSubscription = useCallback(
    async (mode: "silent" | "blocking" = "blocking") => {
      const token = await resolveBillingToken();
      if (!token) {
        if (isLoaded) {
          setBillingSubscriptionFb({
            type: "err",
            text: t("billingSessionExpired")
          });
          setBillingSubscriptionLoaded(true);
          if (mode === "blocking") {
            setBillingSubscriptionLoading(false);
          }
        }
        return;
      }
      if (mode === "blocking") {
        setBillingSubscriptionLoading(true);
      }
      try {
        const nextState = await getAssistantBillingSubscription(token);
        setBillingSubscription(nextState);
        setBillingSubscriptionFb(null);
      } catch (error) {
        setBillingSubscriptionFb({
          type: "err",
          text:
            error instanceof Error
              ? resolveBillingManagementErrorMessage(error, t)
              : t("billingSettingsLoadFailed")
        });
      } finally {
        setBillingSubscriptionLoaded(true);
        if (mode === "blocking") {
          setBillingSubscriptionLoading(false);
        }
      }
    },
    [isLoaded, resolveBillingToken, t]
  );
  const openBillingSettings = useCallback(async () => {
    setBillingSettingsOpen(true);
    if (!billingSubscriptionLoaded || billingSubscription === null) {
      await loadBillingSubscription("blocking");
      return;
    }
    void loadBillingSubscription("silent");
  }, [billingSubscription, billingSubscriptionLoaded, loadBillingSubscription]);
  const scheduledFreeChangePending =
    billingSubscription?.scheduledPlanChange?.changeKind === "free" &&
    billingSubscription.canEnableAutoRenew;
  const handleEnableAutoRenew = useCallback(async () => {
    const token = await resolveBillingToken();
    if (!token) {
      if (isLoaded) {
        setBillingSubscriptionFb({
          type: "err",
          text: t("billingSessionExpired")
        });
      }
      return;
    }
    setEnableAutoRenewPending(true);
    setBillingSubscriptionFb(null);
    try {
      const result = await postAssistantBillingEnableAutoRenew(token, {
        paymentMethodClass: "card",
        idempotencyKey: `settings:enable-auto-renew:${Date.now()}`,
        returnUrl: "/app/chat"
      });
      applyBillingActionResult(result, router, setBillingSubscription, onStartBillingCheckout);
      setBillingSubscriptionFb({
        type: "ok",
        text:
          result.mode === "checkout"
            ? scheduledFreeChangePending
              ? t("billingRestoreSubscriptionBindStarted")
              : t("billingAutoRenewBindStarted")
            : scheduledFreeChangePending
              ? t("billingSubscriptionRestored")
              : t("billingAutoRenewEnabled")
      });
    } catch (error) {
      setBillingSubscriptionFb({
        type: "err",
        text: resolveBillingManagementErrorMessage(error, t)
      });
    } finally {
      setEnableAutoRenewPending(false);
    }
  }, [
    isLoaded,
    onStartBillingCheckout,
    resolveBillingToken,
    router,
    scheduledFreeChangePending,
    t
  ]);
  const confirmDisableAutoRenew = useCallback(async () => {
    const token = await resolveBillingToken();
    if (!token) {
      if (isLoaded) {
        setBillingSubscriptionFb({
          type: "err",
          text: t("billingSessionExpired")
        });
      }
      return;
    }
    setDisableAutoRenewPending(true);
    setBillingSubscriptionFb(null);
    try {
      const nextState = await postAssistantBillingDisableAutoRenew(token);
      setBillingSubscription(nextState);
      setDisableAutoRenewConfirmOpen(false);
      setBillingSubscriptionFb({
        type: "ok",
        text: t("billingAutoRenewDisabled")
      });
    } catch (error) {
      setBillingSubscriptionFb({
        type: "err",
        text: resolveBillingManagementErrorMessage(error, t)
      });
    } finally {
      setDisableAutoRenewPending(false);
    }
  }, [isLoaded, resolveBillingToken, t]);
  const handleManagePaymentMethod = useCallback(() => {
    const url = billingSubscription?.managePaymentMethodUrl;
    if (!url) {
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }, [billingSubscription]);
  const isEffectivePlanZeroPrice = isZeroPriceEffectivePlan(data.plan?.effectivePlan ?? null);
  const effectivePlanCanHaveBillingSettings =
    !isEffectivePlanZeroPrice &&
    ["active", "grace_period", "past_due", "paused", "canceled"].includes(
      data.plan?.effectivePlan.subscriptionStatus ?? "unconfigured"
    ) &&
    data.plan?.effectivePlan.currentPeriodEndsAt !== null;
  const shouldShowPaymentSettings =
    !isEffectivePlanZeroPrice && hasPaidBillingSettings(billingSubscription);
  const shouldShowBillingSettingsEntry =
    shouldShowPaymentSettings ||
    ((!billingSubscriptionLoaded || billingSubscriptionFb?.type === "err") &&
      effectivePlanCanHaveBillingSettings);
  const nextChargeLabel = formatBillingDate(billingSubscription?.nextChargeAt ?? null);
  const currentPeriodEndsLabel = formatBillingDate(
    billingSubscription?.currentPeriodEndsAt ?? null
  );
  const billingSubscriptionTruthUnknown =
    !billingSubscriptionLoading &&
    billingSubscription === null &&
    billingSubscriptionFb?.type === "err";
  const billingPlanLabel =
    billingSubscription?.planDisplayName ??
    data.plan?.effectivePlan.displayName ??
    (billingSubscriptionTruthUnknown ? t("billingUnknownValue") : t("freePlan"));
  const billingStatusChipLabel =
    billingSubscription !== null
      ? billingStatusLabel(billingSubscription.subscriptionStatus)
      : t("billingStatusUnknown");
  const graceBadgeActive =
    data.plan?.effectivePlan.subscriptionStatus === "grace_period" ||
    data.plan?.effectivePlan.subscriptionStatus === "past_due";
  const billingAutoRenewLabel =
    billingSubscription !== null
      ? billingSubscription.autoRenewEnabled
        ? t("billingAutoRenewOn")
        : t("billingAutoRenewOff")
      : t("billingUnknownValue");
  const billingDateHeadingLabel =
    billingSubscription !== null
      ? graceBadgeActive
        ? t("billingRetryAttemptLabel")
        : billingSubscription.scheduledPlanChange?.changeKind === "downgrade"
          ? t("billingPlanChangeLabel")
          : billingSubscription.autoRenewEnabled &&
              ["active"].includes(billingSubscription.subscriptionStatus)
            ? t("billingNextCharge")
            : t("billingAccessUntil")
      : t("billingDateLabel");
  const billingDateValueLabel =
    billingSubscription !== null
      ? graceBadgeActive
        ? (nextChargeLabel ?? currentPeriodEndsLabel ?? t("billingDateUnavailable"))
        : billingSubscription.scheduledPlanChange?.changeKind === "downgrade"
          ? (resolveBillingSummaryCopy(
              data.plan?.effectivePlan,
              locale,
              billingSubscription.scheduledPlanChange
            ).dateLabel ?? t("billingDateUnavailable"))
          : billingSubscription.autoRenewEnabled &&
              ["active"].includes(billingSubscription.subscriptionStatus)
            ? (nextChargeLabel ?? currentPeriodEndsLabel ?? t("billingDateUnavailable"))
            : (currentPeriodEndsLabel ?? nextChargeLabel ?? t("billingDateUnavailable"))
      : t("billingUnknownValue");
  const billingLastPaymentMethodValue =
    billingSubscription !== null
      ? (billingSubscription.lastPaymentMethodLabel ?? t("billingPaymentMethodUnknown"))
      : t("billingUnknownValue");
  const billingAutoRenewPaymentMethodValue =
    billingSubscription !== null
      ? billingSubscription.autoRenewEnabled
        ? (billingSubscription.autoRenewMethodLabel ?? t("billingPaymentMethodUnknown"))
        : t("billingRecurringMethodNotActive")
      : t("billingUnknownValue");
  const billingRecurringMigrationHint =
    billingSubscription?.recurringMigration.status === "in_progress"
      ? t("billingRecurringMigrationInProgress")
      : billingSubscription?.recurringMigration.status === "failed"
        ? billingSubscription.recurringMigration.failureReason ===
          "provider_sbp_recurring_not_confirmed"
          ? t("billingRecurringMigrationFailedSbpFallback")
          : t("billingRecurringMigrationFailedGeneric")
        : null;
  const billingPaymentMethodHint =
    billingSubscription !== null
      ? (billingRecurringMigrationHint ??
        billingSubscription.warning ??
        t("billingSettingsQuietHint"))
      : t("billingSettingsUnknownHint");
  const billingIssueInlineLabel = graceBadgeActive ? t("billingPaymentIssueInline") : null;
  const billingPlanTransitionHint =
    billingSubscription?.scheduledPlanChange?.changeKind === "downgrade"
      ? t("billingPlanTransitionHint")
      : billingPaymentMethodHint;
  const paymentSettingsShouldBePrimary =
    graceBadgeActive ||
    billingSubscription?.canEnableAutoRenew === true ||
    billingSubscription?.autoRenewEnabled === false ||
    billingSubscription?.scheduledPlanChange != null ||
    billingSubscription?.managePaymentMethodMode === "provider_managed_recovery" ||
    billingSubscription?.recurringMigration.status === "in_progress" ||
    billingSubscription?.recurringMigration.status === "failed" ||
    (billingSubscription?.warning ?? null) !== null;
  useEffect(() => {
    setOpenSection(normalizeInitialSection(initialSection));
    if (initialSection === "memory") {
      setEditingPersonality(true);
      setMemoryDrawerOpen(true);
    }
  }, [initialSection]);

  useEffect(() => {
    return () => {
      if (saveButtonResetTimerRef.current !== null) {
        window.clearTimeout(saveButtonResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }
    if (data.plan === null) {
      return;
    }
    void loadBillingSubscription("blocking");
  }, [data.plan, isLoaded, loadBillingSubscription]);

  useEffect(() => {
    let cancelled = false;

    if (assistant === null) {
      setSkillsState(null);
      setSelectedSkillIds([]);
      setSkillsLoading(false);
      return;
    }

    void (async () => {
      const token = await getToken({ skipCache: true });
      if (!token || cancelled) {
        return;
      }
      setSkillsLoading(true);
      setSkillsFb(null);
      try {
        const nextState = await getAssistantSkills(token);
        if (!cancelled) {
          setSkillsState(nextState);
          setSelectedSkillIds(nextState.assignedSkillIds);
        }
      } catch (error) {
        if (!cancelled) {
          setSkillsFb({
            type: "err",
            text: error instanceof Error ? error.message : t("skillsLoadFailed")
          });
        }
      } finally {
        if (!cancelled) {
          setSkillsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [assistant, getToken, t]);

  const primaryVoiceProviderId = voiceSettings?.primaryProviderId ?? null;
  const yandexVoiceOptions = useMemo(
    () => filterVoiceOptions(YANDEX_VOICE_OPTIONS, draftAssistantGender),
    [draftAssistantGender]
  );
  const openAiVoiceOptions = useMemo(
    () => filterVoiceOptions(OPENAI_VOICE_OPTIONS, draftAssistantGender),
    [draftAssistantGender]
  );
  const getTaskScheduleKind = useCallback(
    (sourceLabel: string | null): "one_time" | "recurring" | "scheduled" => {
      const normalized = sourceLabel?.trim().toLowerCase() ?? "";
      if (normalized.includes("one-time")) return "one_time";
      if (normalized.includes("recurring")) return "recurring";
      return "scheduled";
    },
    []
  );

  const getTaskScheduleKindLabel = useCallback(
    (sourceLabel: string | null): string => {
      const kind = getTaskScheduleKind(sourceLabel);
      if (kind === "one_time") return t("oneTime");
      if (kind === "recurring") return t("recurring");
      return t("scheduled");
    },
    [getTaskScheduleKind, t]
  );

  const getTaskTimingLabel = useCallback(
    (item: AssistantTaskRegistryItemState): string => {
      if (item.controlStatus === "disabled") {
        return t("paused");
      }
      if (item.controlStatus === "cancelled") {
        return t("stopped");
      }
      if (item.nextRunAt === null) {
        return t("timeNotSet");
      }
      const time = new Date(item.nextRunAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      });
      return getTaskScheduleKind(item.sourceLabel) === "one_time"
        ? t("runsAt", { time })
        : t("nextRun", { time });
    },
    [getTaskScheduleKind, t]
  );

  const getTaskStatusLabel = useCallback(
    (controlStatus: AssistantTaskRegistryItemState["controlStatus"]) => {
      if (controlStatus === "active") return t("active");
      if (controlStatus === "disabled") return t("paused");
      return t("stopped");
    },
    [t]
  );

  const getBackgroundTaskStatusLabel = useCallback(
    (status: AssistantBackgroundTaskItemState["status"]) => {
      if (status === "active") return t("active");
      if (status === "disabled") return t("paused");
      if (status === "completed") return t("completed");
      if (status === "failed") return t("failed");
      return t("stopped");
    },
    [t]
  );

  const getBackgroundTaskTimingLabel = useCallback(
    (item: AssistantBackgroundTaskItemState): string => {
      if (item.status === "disabled") return t("paused");
      if (item.status === "completed") return t("completed");
      if (item.status === "failed") return item.lastErrorMessage ?? t("failed");
      if (item.nextRunAt === null) return t("timeNotSet");
      return t("nextRun", {
        time: new Date(item.nextRunAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short"
        })
      });
    },
    [t]
  );

  const formatBackgroundRunLine = useCallback(
    (run: AssistantBackgroundTaskItemState["recentRuns"][number]): string => {
      const time = new Date(run.scheduledRunAt).toLocaleString(undefined, {
        dateStyle: "short",
        timeStyle: "short"
      });
      const status = t(`backgroundRun_${run.status}`);
      const suffix = run.deliveryTarget
        ? ` · ${run.deliveryTarget}`
        : run.errorMessage
          ? ` · ${run.errorMessage}`
          : "";
      return `${time} · ${status}${suffix}`;
    },
    [t]
  );

  const activeTaskItems = taskItems.filter((item) => item.controlStatus === "active");
  const userTaskItems = activeTaskItems.filter((item) => item.audience === "user");
  const assistantTaskItems = backgroundTaskItems
    .filter((item) => item.status !== "cancelled")
    .reduce<AssistantBackgroundTaskItemState[]>((items, item) => {
      if (item.status === "completed" && item.recentRuns.length === 0) {
        return items;
      }
      if (
        item.status === "completed" &&
        items.filter((candidate) => candidate.status === "completed").length >= 5
      ) {
        return items;
      }
      return [...items, item];
    }, []);
  // ADR-074 Slice M3.3 — Memory Center UX merge. The Workspace tab shows
  // workspace_memory_items + structured registry rows (kind ∈ {fact,
  // preference, open_loop}) deduplicated by normalized text; the History
  // tab shows only `kind === null` registry rows (turn-derived echoes).
  // Dedup is UI-side because the spec explicitly forbids a backend
  // migration for this slice.
  const mergedMemoryViews = useMemo(
    () => mergeMemoryViews(memoryItems, wsMemoryItems),
    [memoryItems, wsMemoryItems]
  );
  const mergedWorkspaceMemoryView = mergedMemoryViews.workspace;
  const mergedHistoryMemoryView = mergedMemoryViews.history;
  const memoryPanel = (
    <>
      <div className="mb-4 border-b border-border/45 pb-3">
        <SegmentedChoice
          options={[
            { value: "workspace", label: t("workspace") },
            { value: "history", label: t("history") }
          ]}
          value={memoryTab}
          onChange={(value) => setMemoryTab(value as "workspace" | "history")}
          className="grid-cols-2"
        />
      </div>

      {memoryTab === "workspace" && (
        <>
          <div className="mb-2 flex items-center gap-2">
            <input
              type="text"
              value={wsMemorySearch}
              onChange={(e) => setWsMemorySearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void loadWsMemory(wsMemorySearch || undefined);
              }}
              placeholder={t("searchMemories")}
              className={userFieldClassName("min-h-[42px] min-w-0 flex-1")}
            />
            <button
              type="button"
              onClick={() => void loadWsMemory(wsMemorySearch || undefined)}
              className={userPillButtonClassName("secondary", "shrink-0")}
            >
              {t("search")}
            </button>
          </div>

          <div className="mb-4 flex items-center gap-2">
            <input
              type="text"
              value={wsNewMemory}
              onChange={(e) => setWsNewMemory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAddWsMemory();
              }}
              placeholder={t("teachNew")}
              className={userFieldClassName("min-h-[42px] min-w-0 flex-1")}
            />
            <button
              type="button"
              disabled={wsMemoryAdding || !wsNewMemory.trim()}
              onClick={() => void handleAddWsMemory()}
              className={userPillButtonClassName("primary", "shrink-0 disabled:opacity-50")}
            >
              {wsMemoryAdding ? <Loader2 className="h-3 w-3 animate-spin" /> : t("add")}
            </button>
          </div>

          <FeedbackLine fb={wsMemoryFb} />
          <FeedbackLine fb={memoryFb} />

          {wsMemoryLoading || memoryLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
            </div>
          ) : mergedWorkspaceMemoryView.length === 0 ? (
            <p className="text-xs text-text-subtle">{t("noWorkspaceMemories")}</p>
          ) : (
            <>
              <ul
                className="divide-y divide-border/45 border-t border-border/35"
                data-testid="memory-center-workspace-list"
                aria-label={t("workspace")}
              >
                {mergedWorkspaceMemoryView.slice(0, wsMemoryVisibleCount).map((row) => {
                  const { memoryClass, kind } = row.item;
                  const resolvedAt =
                    row.source === "registry" ? row.item.resolvedAt : (row.item.resolvedAt ?? null);
                  const rowText = row.source === "registry" ? row.item.summary : row.item.content;
                  const expanded = expandedWorkspaceMemoryKeys.includes(row.key);
                  const canExpand = rowText.length > MEMORY_INLINE_EXPAND_MIN_CHARS;
                  return (
                    <li key={row.key} data-testid={`memory-row-${row.source}`} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-3">
                            <p
                              className={cn(
                                "min-w-0 flex-1 text-sm leading-6 text-text",
                                expanded ? "whitespace-pre-wrap" : "truncate"
                              )}
                            >
                              {rowText}
                            </p>
                            {canExpand ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedWorkspaceMemoryKeys((prev) =>
                                    prev.includes(row.key)
                                      ? prev.filter((key) => key !== row.key)
                                      : [...prev, row.key]
                                  )
                                }
                                className="shrink-0 text-xs font-medium leading-6 text-text-subtle transition-colors hover:text-text"
                              >
                                {expanded ? t("memoryCollapse") : t("memoryExpand")}
                              </button>
                            ) : null}
                          </div>
                          {memoryClass !== undefined && (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-text-subtle">
                              <span
                                className={
                                  memoryClass === "core"
                                    ? "rounded-full bg-accent/12 px-2 py-0.5 font-medium text-accent"
                                    : "rounded-full bg-surface-raised/45 px-2 py-0.5 font-medium text-text-subtle"
                                }
                              >
                                {memoryClass === "core"
                                  ? t("memoryClassCore")
                                  : t("memoryClassContextual")}
                              </span>
                              {kind === "fact" && (
                                <span className="rounded-full bg-surface-raised/45 px-2 py-0.5 font-medium text-text-subtle">
                                  {t("memoryKindFact")}
                                </span>
                              )}
                              {kind === "preference" && (
                                <span className="rounded-full bg-surface-raised/45 px-2 py-0.5 font-medium text-text-subtle">
                                  {t("memoryKindPreference")}
                                </span>
                              )}
                              {kind === "open_loop" && (
                                <span className="rounded-full bg-surface-raised/45 px-2 py-0.5 font-medium text-text-subtle">
                                  {t("memoryKindOpenLoop")}
                                </span>
                              )}
                              {resolvedAt !== null && (
                                <span className="rounded-full bg-success/12 px-2 py-0.5 font-medium text-success">
                                  {t("memoryResolved")}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-start gap-1 pt-0.5">
                          {kind === "open_loop" && resolvedAt === null && (
                            <button
                              type="button"
                              disabled={closingOpenLoopId === row.item.id}
                              onClick={() => void handleCloseOpenLoop(row.item.id)}
                              className="cursor-pointer rounded-full p-1 text-text-subtle transition-colors hover:bg-surface-raised/60 hover:text-accent disabled:cursor-default disabled:opacity-50"
                              title={t("markAsClosed")}
                              aria-label={t("markAsClosed")}
                              data-testid={`close-open-loop-${row.item.id}`}
                            >
                              {closingOpenLoopId === row.item.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3" />
                              )}
                            </button>
                          )}
                          {row.source === "registry" ? (
                            <button
                              type="button"
                              disabled={forgettingId === row.item.id}
                              onClick={() => void handleForget(row.item.id)}
                              className="cursor-pointer rounded-full p-1 text-text-subtle transition-colors hover:bg-surface-raised/60 hover:text-destructive disabled:cursor-default disabled:opacity-50"
                              title={t("forget")}
                              aria-label={t("forget")}
                              data-testid={`forget-registry-${row.item.id}`}
                            >
                              {forgettingId === row.item.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Trash2 className="h-3 w-3" />
                              )}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={wsForgettingId === row.item.id}
                              onClick={() => void handleForgetWsMemory(row.item.id)}
                              className="cursor-pointer rounded-full p-1 text-text-subtle transition-colors hover:bg-surface-raised/60 hover:text-destructive disabled:cursor-default disabled:opacity-50"
                              title={t("forget")}
                              aria-label={t("forget")}
                              data-testid={`forget-workspace-${row.item.id}`}
                            >
                              {wsForgettingId === row.item.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Trash2 className="h-3 w-3" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {wsMemoryVisibleCount < mergedWorkspaceMemoryView.length && (
                <button
                  type="button"
                  onClick={() => setWsMemoryVisibleCount((count) => count + 5)}
                  className={userPillButtonClassName("secondary", "mt-4 flex w-full")}
                >
                  {t("memoryLoadMoreButton")} (
                  {mergedWorkspaceMemoryView.length - wsMemoryVisibleCount})
                </button>
              )}
            </>
          )}
        </>
      )}

      {memoryTab === "history" && (
        <>
          <FeedbackLine fb={memoryFb} />
          {memoryLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
            </div>
          ) : mergedHistoryMemoryView.length === 0 ? (
            <p className="text-xs text-text-subtle">{t("noMemoriesStored")}</p>
          ) : (
            <>
              <ul
                className="divide-y divide-border/45 border-t border-border/35"
                data-testid="memory-center-history-list"
                aria-label={t("history")}
              >
                {mergedHistoryMemoryView.slice(0, memoryVisibleCount).map((row) => {
                  if (row.source !== "registry") return null;
                  const item = row.item;
                  const expanded = expandedHistoryMemoryKeys.includes(row.key);
                  const canExpand = item.summary.length > MEMORY_INLINE_EXPAND_MIN_CHARS;
                  return (
                    <li key={row.key} data-testid="memory-row-history" className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-3">
                            <p
                              className={cn(
                                "min-w-0 flex-1 text-sm leading-6 text-text",
                                expanded ? "whitespace-pre-wrap" : "truncate"
                              )}
                            >
                              {item.summary}
                            </p>
                            {canExpand ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedHistoryMemoryKeys((prev) =>
                                    prev.includes(row.key)
                                      ? prev.filter((key) => key !== row.key)
                                      : [...prev, row.key]
                                  )
                                }
                                className="shrink-0 text-xs font-medium leading-6 text-text-subtle transition-colors hover:text-text"
                              >
                                {expanded ? t("memoryCollapse") : t("memoryExpand")}
                              </button>
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-text-subtle">
                            <span
                              className={
                                item.memoryClass === "core"
                                  ? "rounded-full bg-accent/12 px-2 py-0.5 font-medium text-accent"
                                  : "rounded-full bg-surface-raised/45 px-2 py-0.5 font-medium text-text-subtle"
                              }
                            >
                              {item.memoryClass === "core"
                                ? t("memoryClassCore")
                                : t("memoryClassContextual")}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-start gap-1 pt-0.5">
                          <button
                            type="button"
                            disabled={forgettingId === item.id}
                            onClick={() => void handleForget(item.id)}
                            className="cursor-pointer rounded-full p-1 text-text-subtle transition-colors hover:bg-surface-raised/60 hover:text-destructive disabled:cursor-default disabled:opacity-50"
                            title={t("forget")}
                            aria-label={t("forget")}
                            data-testid={`forget-history-${item.id}`}
                          >
                            {forgettingId === item.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {memoryVisibleCount < mergedHistoryMemoryView.length && (
                <button
                  type="button"
                  onClick={() => setMemoryVisibleCount((count) => count + 5)}
                  className={userPillButtonClassName("secondary", "mt-4 flex w-full")}
                >
                  {t("memoryLoadMoreButton")} ({mergedHistoryMemoryView.length - memoryVisibleCount}
                  )
                </button>
              )}
            </>
          )}
        </>
      )}
    </>
  );
  const elevenLabsAdminVoices = voiceSettings?.elevenlabs?.admin?.voices ?? [];
  const elevenLabsPublicVoices =
    voiceSettings?.elevenlabs?.admin?.publicVoices ?? voiceSettings?.elevenlabs?.voices ?? [];
  const elevenLabsPickerEntries = useMemo<VoicePickerEntry[]>(() => {
    const selectedId = draftVoiceProfile.elevenlabs.voiceId;
    return elevenLabsPublicVoices
      .filter(
        (voice) =>
          draftAssistantGender === "neutral" ||
          voice.gender === draftAssistantGender ||
          voice.voiceId === selectedId
      )
      .map((voice) => ({
        value: voice.voiceId,
        label: formatElevenLabsVoiceLabel(voice.name, locale),
        gender: voice.gender,
        language: voice.language,
        languageBucket: voice.languageBucket,
        category: voice.category,
        previewUrl: voice.previewUrl
      }));
  }, [elevenLabsPublicVoices, draftAssistantGender, draftVoiceProfile.elevenlabs.voiceId, locale]);
  const elevenLabsFilteredAdminVoices = useMemo<AssistantAdminVoiceCatalogEntry[]>(() => {
    const byId = new Map(elevenLabsAdminVoices.map((voice) => [voice.voiceId, voice]));
    return filterVoicePickerEntries(
      elevenLabsAdminVoices.map((voice) => ({
        value: voice.voiceId,
        label: formatElevenLabsVoiceLabel(voice.name, locale),
        gender: voice.gender,
        language: voice.language,
        languageBucket: voice.languageBucket,
        category: voice.category,
        previewUrl: voice.previewUrl
      })),
      {
        query: "",
        gender:
          draftAssistantGender === "male" || draftAssistantGender === "female"
            ? draftAssistantGender
            : "all",
        languageBucket: elevenLabsLanguageBucket,
        category: "all"
      }
    )
      .map((entry) => byId.get(entry.value) ?? null)
      .filter((voice): voice is AssistantAdminVoiceCatalogEntry => voice !== null);
  }, [draftAssistantGender, elevenLabsAdminVoices, elevenLabsLanguageBucket, locale]);
  const elevenLabsVisiblePublicVoices = useMemo(() => {
    const byId = new Map(elevenLabsPublicVoices.map((voice) => [voice.voiceId, voice]));
    return filterVoicePickerEntries(
      elevenLabsPublicVoices.map((voice) => ({
        value: voice.voiceId,
        label: formatElevenLabsVoiceLabel(voice.name, locale),
        gender: voice.gender,
        language: voice.language,
        languageBucket: voice.languageBucket,
        category: voice.category,
        previewUrl: voice.previewUrl
      })),
      {
        query: "",
        gender:
          draftAssistantGender === "male" || draftAssistantGender === "female"
            ? draftAssistantGender
            : "all",
        languageBucket: elevenLabsLanguageBucket,
        category: "all"
      }
    )
      .map((entry) => byId.get(entry.value) ?? null)
      .filter((voice): voice is (typeof elevenLabsPublicVoices)[number] => voice !== null);
  }, [draftAssistantGender, elevenLabsLanguageBucket, elevenLabsPublicVoices, locale]);
  const yandexPickerEntries = useMemo<VoicePickerEntry[]>(
    () =>
      yandexVoiceOptions.map((option) => ({
        value: option.value,
        label: option.label,
        gender: option.gender,
        language: null,
        languageBucket: "other" as const,
        category: null,
        previewUrl: null
      })),
    [yandexVoiceOptions]
  );
  const openAiPickerEntries = useMemo<VoicePickerEntry[]>(
    () =>
      openAiVoiceOptions.map((option) => ({
        value: option.value,
        label: option.label,
        gender: option.gender,
        language: null,
        languageBucket: "other" as const,
        category: null,
        previewUrl: null
      })),
    [openAiVoiceOptions]
  );
  const voicePickerLabels = useMemo<VoicePickerLabels>(
    () => ({
      empty: t("voicePickerEmpty"),
      preview: t("voicePickerPreview"),
      stopPreview: t("voicePickerStopPreview")
    }),
    [t]
  );
  useEffect(() => {
    setDraftName(assistant?.draft.displayName ?? "");
    setDraftInstructions(assistant?.draft.instructions ?? "");
    const traits = assistant?.draft.traits as Record<string, number> | null | undefined;
    if (traits) setDraftTraits(traits);
    else setDraftTraits(DEFAULT_TRAITS);
    setDraftAvatarUrl(assistant?.draft.avatarUrl ?? null);
    setDraftAssistantGender(normalizeAssistantGender(assistant?.draft.assistantGender));
    setDraftVoiceProfile(normalizeVoiceProfile(assistant?.draft.voiceProfile));
    setShowTraitControls(false);
    setAvatarPreviewBlobUrl(null);
  }, [assistant]);

  useEffect(() => {
    let cancelled = false;

    if (assistant === null) {
      setVoiceSettings(null);
      setVoiceSettingsLoading(false);
      setVoiceSettingsError(null);
      return;
    }

    void (async () => {
      const token = await getToken();
      if (!token || cancelled) {
        return;
      }
      setVoiceSettingsLoading(true);
      try {
        const nextSettings = await getAssistantVoiceSettings(token);
        if (!cancelled) {
          setVoiceSettings(nextSettings);
          setVoiceSettingsError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setVoiceSettingsError(
            error instanceof Error ? error.message : "Failed to load assistant voice settings."
          );
        }
      } finally {
        if (!cancelled) {
          setVoiceSettingsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [assistant, getToken]);

  useEffect(() => {
    if (primaryVoiceProviderId === null) {
      return;
    }

    setDraftVoiceProfile((prev) => {
      if (primaryVoiceProviderId === "yandex") {
        const allowed = new Set(yandexVoiceOptions.map((option) => option.value));
        const nextVoice =
          prev.yandex.voice !== null && allowed.has(prev.yandex.voice)
            ? prev.yandex.voice
            : resolveDefaultYandexVoiceOption(draftAssistantGender);
        if (nextVoice === prev.yandex.voice && prev.yandex.role === null) {
          return prev;
        }
        return {
          ...prev,
          yandex: {
            voice: nextVoice,
            role: null
          }
        };
      }

      if (primaryVoiceProviderId === "openai") {
        const allowed = new Set(openAiVoiceOptions.map((option) => option.value));
        const nextVoice =
          prev.openai.voice !== null && allowed.has(prev.openai.voice)
            ? prev.openai.voice
            : resolveDefaultOpenAiVoiceOption(draftAssistantGender);
        if (nextVoice === prev.openai.voice) {
          return prev;
        }
        return {
          ...prev,
          openai: {
            voice: nextVoice
          }
        };
      }

      return prev;
    });
  }, [draftAssistantGender, openAiVoiceOptions, primaryVoiceProviderId, yandexVoiceOptions]);

  useEffect(() => {
    setNotificationChannel(data.notificationPreference?.selectedChannel ?? "web");
  }, [data.notificationPreference]);

  const loadMemory = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setMemoryLoading(true);
    setMemoryVisibleCount(5);
    setMemoryFb(null);
    try {
      setMemoryItems(await getAssistantMemoryItems(token));
    } catch (error) {
      console.error("[memory-center] loadMemory failed", error);
      setMemoryFb({
        type: "err",
        text: error instanceof Error ? error.message : t("memoryLoadFailed")
      });
    }
    setMemoryLoading(false);
  }, [getToken, t]);

  const loadTasks = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setTaskLoading(true);
    setTasksFb(null);
    try {
      const [tasks, backgroundTasks] = await Promise.all([
        getAssistantTaskItems(token),
        getAssistantBackgroundTaskItems(token)
      ]);
      setTaskItems(tasks);
      setBackgroundTaskItems(backgroundTasks);
    } catch (error) {
      console.error("[memory-center] loadTasks failed", error);
      setTasksFb({
        type: "err",
        text: error instanceof Error ? error.message : t("tasksLoadFailed")
      });
    }
    setTaskLoading(false);
  }, [getToken, t]);

  const loadWsMemory = useCallback(
    async (query?: string) => {
      const token = await getToken();
      if (!token) return;
      setWsMemoryLoading(true);
      setWsMemoryVisibleCount(5);
      setWsMemoryFb(null);
      try {
        const items = query
          ? await searchWorkspaceMemory(token, query)
          : await getWorkspaceMemoryItems(token);
        setWsMemoryItems(items);
      } catch (error) {
        console.error("[memory-center] loadWsMemory failed", error);
        setWsMemoryFb({
          type: "err",
          text: error instanceof Error ? error.message : t("wsMemoryLoadFailed")
        });
      }
      setWsMemoryLoading(false);
    },
    [getToken, t]
  );

  const handleAddWsMemory = useCallback(async () => {
    // ADR-074 Slice M3.3 follow-up — force-fresh Clerk JWT for
    // mutations. The default `getToken()` returns the cached token,
    // which can be older than the API's accepted lifetime when the tab
    // has sat open for hours. `skipCache: true` performs the small
    // refresh round-trip so the founder does not see a "Session
    // expired" inline error on a click that should have just worked.
    const token = await getToken({ skipCache: true });
    if (!token || !wsNewMemory.trim()) return;
    setWsMemoryAdding(true);
    setWsMemoryFb(null);
    try {
      const item = await addWorkspaceMemoryItem(token, wsNewMemory.trim());
      setWsMemoryItems((prev) => [...prev, item]);
      setWsNewMemory("");
    } catch (error) {
      console.error("[memory-center] handleAddWsMemory failed", error);
      setWsMemoryFb({
        type: "err",
        text: error instanceof Error ? error.message : t("wsMemoryAddFailed")
      });
    }
    setWsMemoryAdding(false);
  }, [getToken, wsNewMemory, t]);

  const handleForgetWsMemory = useCallback(
    async (itemId: string) => {
      const token = await getToken({ skipCache: true });
      if (!token) return;
      setWsForgettingId(itemId);
      setWsMemoryFb(null);
      try {
        await forgetWorkspaceMemoryItem(token, itemId);
        setWsMemoryItems((prev) => prev.filter((m) => m.id !== itemId));
      } catch (error) {
        console.error("[memory-center] handleForgetWsMemory failed", error);
        setWsMemoryFb({
          type: "err",
          text: error instanceof Error ? error.message : t("wsMemoryForgetFailed")
        });
      }
      setWsForgettingId(null);
    },
    [getToken, t]
  );

  useEffect(() => {
    if (assistant) {
      void loadMemory();
      void loadTasks();
      void loadWsMemory();
    }
  }, [assistant, loadMemory, loadTasks, loadWsMemory]);

  const resetAssistantThreadRoute = useCallback(() => {
    if (pathname === "/app/chat") {
      router.replace("/app/chat" as Route);
    }
  }, [pathname, router]);

  const handleSwitchAssistant = useCallback(
    async (assistantId: string) => {
      if (assistantId === data.activeAssistantId) {
        setAssistantSwitcherOpen(false);
        return;
      }
      setAssistantSwitchBusyId(assistantId);
      setAssistantSwitcherError(null);
      try {
        await data.switchAssistant(assistantId);
        resetAssistantThreadRoute();
        setAssistantSwitcherOpen(false);
      } catch (error) {
        setAssistantSwitcherError(
          error instanceof Error ? error.message : t("switchAssistantFailed")
        );
      } finally {
        setAssistantSwitchBusyId(null);
      }
    },
    [data, resetAssistantThreadRoute, t]
  );

  const handleCreateAssistant = useCallback(async () => {
    setAssistantCreateBusy(true);
    setAssistantSwitcherError(null);
    try {
      await data.createAssistant();
      setAssistantSwitcherOpen(false);
      router.replace("/app/setup?entry=assistant-only&intent=create" as Route);
    } catch (error) {
      setAssistantSwitcherError(
        error instanceof Error ? error.message : t("createAssistantFailed")
      );
    } finally {
      setAssistantCreateBusy(false);
    }
  }, [data, router, t]);

  const handleSaveAndApply = useCallback(async () => {
    const token = await getToken({ skipCache: true });
    if (!token) return;
    setSaving(true);
    setSaveFb(null);
    setSaveButtonState("idle");
    try {
      await patchAssistantDraft(token, {
        displayName: draftName || null,
        instructions: draftInstructions || null,
        traits: draftTraits,
        avatarEmoji: null,
        avatarUrl: draftAvatarUrl,
        assistantGender: draftAssistantGender,
        voiceProfile: {
          ...draftVoiceProfile,
          elevenlabs: {
            voiceId: trimToNull(draftVoiceProfile.elevenlabs.voiceId)
          },
          yandex: {
            voice: draftVoiceProfile.yandex.voice,
            role: null
          }
        },
        archetypeKey: assistant?.draft.archetypeKey ?? null
      });
      await postAssistantPublish(token);
      setSaveButtonState("saved");
      if (saveButtonResetTimerRef.current !== null) {
        window.clearTimeout(saveButtonResetTimerRef.current);
      }
      saveButtonResetTimerRef.current = window.setTimeout(() => {
        setSaveButtonState("idle");
        saveButtonResetTimerRef.current = null;
      }, 1800);
      data.reload();
    } catch (e) {
      setSaveFb({ type: "err", text: e instanceof Error ? e.message : t("saveFailed") });
    }
    setSaving(false);
  }, [
    getToken,
    draftName,
    draftInstructions,
    draftTraits,
    draftAvatarUrl,
    draftAssistantGender,
    draftVoiceProfile,
    data
  ]);

  const handleElevenLabsCurationChange = useCallback(
    async (
      voice: Pick<AssistantAdminVoiceCatalogEntry, "voiceId" | "approved" | "hidden" | "previewOk">,
      patch: { approved?: boolean; hidden?: boolean; previewOk?: boolean | null }
    ) => {
      const token = await getToken({ skipCache: true });
      if (!token) return;
      setVoiceCurationSavingId(voice.voiceId);
      setVoiceCurationError(null);
      try {
        const nextSettings = await patchAssistantElevenLabsVoiceCuration(token, [
          {
            voiceId: voice.voiceId,
            approved: patch.approved ?? voice.approved,
            hidden: patch.hidden ?? voice.hidden,
            previewOk: patch.previewOk === undefined ? voice.previewOk : patch.previewOk
          }
        ]);
        setVoiceSettings(nextSettings);
      } catch (error) {
        setVoiceCurationError(
          error instanceof Error ? error.message : "Failed to update voice curation."
        );
      } finally {
        setVoiceCurationSavingId(null);
      }
    },
    [getToken]
  );

  const handleElevenLabsCatalogRefresh = useCallback(async () => {
    const token = await getToken({ skipCache: true });
    if (!token) return;
    setVoiceCatalogRefreshing(true);
    setVoiceCurationError(null);
    try {
      const nextSettings = await postAssistantElevenLabsVoiceCatalogRefresh(token);
      setVoiceSettings(nextSettings);
    } catch (error) {
      setVoiceCurationError(
        error instanceof Error ? error.message : "Failed to refresh voice catalog."
      );
    } finally {
      setVoiceCatalogRefreshing(false);
    }
  }, [getToken]);

  const handleSkillsChange = useCallback(
    async (nextSkillIds: string[]) => {
      setSelectedSkillIds(nextSkillIds);
      const token = await getToken({ skipCache: true });
      if (!token) return;
      setSkillsSaving(true);
      setSkillsFb(null);
      try {
        const nextState = await updateAssistantSkillAssignments(token, { skillIds: nextSkillIds });
        setSkillsState(nextState);
        setSelectedSkillIds(nextState.assignedSkillIds);
        setSkillsFb({ type: "ok", text: t("skillsSaved") });
      } catch (error) {
        setSkillsFb({
          type: "err",
          text: error instanceof Error ? error.message : t("skillsSaveFailed")
        });
      } finally {
        setSkillsSaving(false);
      }
    },
    [getToken, t]
  );

  const handleReset = useCallback(async () => {
    const token = await getToken({ skipCache: true });
    if (!token) return;
    setResetting(true);
    setResetFb(null);
    try {
      await postAssistantReset(token);
      router.replace("/app/setup" as Route);
    } catch (e) {
      setResetFb({ type: "err", text: e instanceof Error ? e.message : t("resetFailed") });
      setResetting(false);
    }
  }, [getToken, router, t]);

  const handleForget = useCallback(
    async (itemId: string) => {
      const token = await getToken({ skipCache: true });
      if (!token) return;
      setForgettingId(itemId);
      setMemoryFb(null);
      try {
        await postAssistantMemoryItemForget(token, itemId);
        setMemoryItems((prev) => prev.filter((m) => m.id !== itemId));
      } catch (error) {
        console.error("[memory-center] handleForget failed", error);
        setMemoryFb({
          type: "err",
          text: error instanceof Error ? error.message : t("memoryForgetFailed")
        });
      }
      setForgettingId(null);
    },
    [getToken, t]
  );

  // ADR-074 Slice M3.1 + M3.3 — Memory Center "Mark as closed" button.
  // Closes one open-loop registry item by id and drops it from the active
  // list. The server treats `closed` and `already_closed` as success.
  // Slice M3.3 hotfix: surface failures inline instead of swallowing
  // them — the previous silent-catch made the button look unresponsive
  // when the call failed for any reason (404 assistant mismatch / 400
  // kind != open_loop / 409 envelope / 500 backend).
  const handleCloseOpenLoop = useCallback(
    async (itemId: string) => {
      const token = await getToken({ skipCache: true });
      if (!token) return;
      setClosingOpenLoopId(itemId);
      setMemoryFb(null);
      try {
        await postAssistantMemoryItemCloseOpenLoop(token, itemId);
        setMemoryItems((prev) => prev.filter((m) => m.id !== itemId));
        setWsMemoryItems((prev) => prev.filter((m) => m.id !== itemId));
      } catch (error) {
        console.error("[memory-center] handleCloseOpenLoop failed", error);
        setMemoryFb({
          type: "err",
          text: error instanceof Error ? error.message : t("memoryCloseOpenLoopFailed")
        });
      }
      setClosingOpenLoopId(null);
    },
    [getToken, t]
  );

  const handleTaskAction = useCallback(
    async (itemId: string, action: "disable" | "enable" | "cancel") => {
      const token = await getToken({ skipCache: true });
      if (!token) return;
      setTaskActionId(itemId);
      setTasksFb(null);
      try {
        if (action === "disable") await postAssistantTaskItemDisable(token, itemId);
        else if (action === "enable") await postAssistantTaskItemEnable(token, itemId);
        else await postAssistantTaskItemCancel(token, itemId);
        await loadTasks();
      } catch (error) {
        console.error("[memory-center] handleTaskAction failed", error);
        setTasksFb({
          type: "err",
          text: error instanceof Error ? error.message : t("tasksActionFailed")
        });
      }
      setTaskActionId(null);
    },
    [getToken, loadTasks, t]
  );

  const handleBackgroundTaskAction = useCallback(
    async (itemId: string, action: "disable" | "enable" | "cancel") => {
      const token = await getToken({ skipCache: true });
      if (!token) return;
      setTaskActionId(itemId);
      setTasksFb(null);
      try {
        if (action === "disable") await postAssistantBackgroundTaskItemDisable(token, itemId);
        else if (action === "enable") await postAssistantBackgroundTaskItemEnable(token, itemId);
        else await postAssistantBackgroundTaskItemCancel(token, itemId);
        await loadTasks();
      } catch (error) {
        console.error("[memory-center] handleBackgroundTaskAction failed", error);
        setTasksFb({
          type: "err",
          text: error instanceof Error ? error.message : t("tasksActionFailed")
        });
      }
      setTaskActionId(null);
    },
    [getToken, loadTasks, t]
  );

  const handleNotificationPreferenceChange = useCallback(
    async (channel: AssistantPreferredNotificationChannel) => {
      const token = await getToken({ skipCache: true });
      if (!token) return;
      setNotificationSaving(true);
      setNotificationFb(null);
      try {
        const updated = await patchAssistantNotificationPreference(token, channel);
        setNotificationChannel(updated.selectedChannel);
        setNotificationFb({ type: "ok", text: t("reminderUpdated") });
        data.reload();
      } catch (error) {
        setNotificationFb({
          type: "err",
          text: error instanceof Error ? error.message : t("reminderUpdateFailed")
        });
      }
      setNotificationSaving(false);
    },
    [getToken, data]
  );

  function handlePersonaPortraitFile(file: File): void {
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setCreatePersonaPortraitError(t("charactersFormPortraitSizeError"));
      return;
    }
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setCreatePersonaPortraitError(t("charactersFormPortraitTypeError"));
      return;
    }
    setCreatePersonaPortraitError(null);
    setCreatePersonaPortrait(file);
    const url = URL.createObjectURL(file);
    replacePersonaPortraitPreview(url);
    if (typeof window !== "undefined") {
      const image = new window.Image();
      image.onload = () => {
        const detectedFormat = detectPersonaVideoFormatFromDimensions(
          image.naturalWidth,
          image.naturalHeight
        );
        setCreatePersonaAutoVideoFormat(detectedFormat);
        setCreatePersonaVideoFormatChoice(detectedFormat);
      };
      image.src = url;
    }
  }

  function handleClonedVoiceAudioFile(file: File): void {
    const MAX_SIZE = 25 * 1024 * 1024;
    const lowerName = file.name.toLowerCase();
    const accepted =
      file.type.startsWith("audio/") ||
      lowerName.endsWith(".webm") ||
      lowerName.endsWith(".wav") ||
      lowerName.endsWith(".mp3") ||
      lowerName.endsWith(".m4a");
    if (!accepted) {
      setCreateClonedVoiceError(t("voicesFormAudioTypeError"));
      return;
    }
    if (file.size > MAX_SIZE) {
      setCreateClonedVoiceError(t("voicesFormAudioSizeError"));
      return;
    }
    setCreateClonedVoiceError(null);
    setCreateClonedVoiceMicError(null);
    setClonedVoiceAudioFile(file);
  }

  const startClonedVoiceRecording = useCallback(async () => {
    const attemptId = clonedVoiceRecordingAttemptIdRef.current + 1;
    clonedVoiceRecordingAttemptIdRef.current = attemptId;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (attemptId !== clonedVoiceRecordingAttemptIdRef.current) {
          return;
        }
        setCreateClonedVoiceMicError(t("voicesRecordPermissionFallback"));
        return;
      }
      setCreateClonedVoiceMicError(null);
      setCreateClonedVoiceError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (attemptId !== clonedVoiceRecordingAttemptIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      clonedVoiceRecorderStreamRef.current = stream;
      clonedVoiceRecorderRef.current = recorder;
      clonedVoiceRecorderChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          clonedVoiceRecorderChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        void (async () => {
          if (attemptId !== clonedVoiceRecordingAttemptIdRef.current) {
            clonedVoiceRecorderChunksRef.current = [];
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          const blob = new Blob(clonedVoiceRecorderChunksRef.current, { type: mimeType });
          clonedVoiceRecorderChunksRef.current = [];
          cleanupClonedVoiceRecorder();
          setCreateClonedVoiceRecordingState("idle");
          setCreateClonedVoiceRecordingSeconds(0);
          if (blob.size < 500) {
            setCreateClonedVoiceMicError(t("voicesRecordTooShort"));
            return;
          }
          try {
            handleClonedVoiceAudioFile(await convertRecordedVoiceBlobToWavFile(blob));
          } catch {
            setCreateClonedVoiceMicError(t("voicesRecordPermissionFallback"));
          }
        })();
      };
      recorder.start(250);
      setCreateClonedVoiceRecordingState("recording");
      setCreateClonedVoiceRecordingSeconds(0);
      clonedVoiceRecorderTimerRef.current = setInterval(() => {
        setCreateClonedVoiceRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch {
      if (attemptId !== clonedVoiceRecordingAttemptIdRef.current) {
        return;
      }
      cleanupClonedVoiceRecorder();
      setCreateClonedVoiceRecordingState("idle");
      setCreateClonedVoiceRecordingSeconds(0);
      setCreateClonedVoiceMicError(t("voicesRecordPermissionFallback"));
    }
  }, [cleanupClonedVoiceRecorder, handleClonedVoiceAudioFile, t]);

  const stopClonedVoiceRecording = useCallback(() => {
    const recorder = clonedVoiceRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    cleanupClonedVoiceRecorder();
    setCreateClonedVoiceRecordingState("idle");
    setCreateClonedVoiceRecordingSeconds(0);
  }, [cleanupClonedVoiceRecorder]);

  const submitClonedVoice = useCallback(async () => {
    if (!assistant?.workspaceId || !createClonedVoiceAudio) {
      return;
    }
    const trimmedName = createClonedVoiceName.trim();
    if (trimmedName.length === 0) {
      setCreateClonedVoiceError(t("voicesFormNameRequired"));
      return;
    }
    if (!createClonedVoiceRightsConfirmed) {
      setCreateClonedVoiceError(t("voicesFormRightsRequired"));
      return;
    }
    const token = (await getToken({ skipCache: true })) ?? (await getToken());
    if (!token) {
      return;
    }
    setCreateClonedVoiceSubmitting(true);
    setCreateClonedVoiceError(null);
    try {
      const result = await createWorkspaceVideoClonedVoice(
        token,
        assistant.workspaceId,
        {
          displayName: trimmedName,
          audio: createClonedVoiceAudio,
          languageHint: createClonedVoiceLanguageHint.trim() || null,
          removeBackgroundNoise: true
        },
        {
          hardTimeoutMs: 180_000
        }
      );
      closeClonedVoiceModal();
      setClonedVoiceFb({
        type: "ok",
        text: t("voicesCreateSuccess", { name: result.clonedVoice.displayName })
      });
      if (createClonedVoiceAttachToPersona && result.clonedVoice.status === "ready") {
        setCreatePersonaClonedVoiceId(result.clonedVoice.id);
        setCreatePersonaError(null);
      }
      await loadClonedVoices();
    } catch (error) {
      const code = error instanceof ApiStructuredError ? error.code : null;
      setCreateClonedVoiceError(
        code === "cloned_voice_limit_reached"
          ? t("voicesErrorLimitReached")
          : code === "cloned_voice_duplicate_name"
            ? t("voicesErrorDuplicateName")
            : code === "provider_plan_upgrade_required"
              ? t("voicesErrorPlanUpgradeRequired")
              : code === "provider_resource_limit_reached"
                ? t("voicesErrorProviderLimitReached")
                : code === "vcoin_balance_exhausted"
                  ? t("voicesErrorInsufficientBalance")
                  : code === "voice_clone_audio_format_unsupported"
                    ? t("voicesErrorUnsupportedAudioFormat")
                    : t("voicesErrorGeneric")
      );
    } finally {
      setCreateClonedVoiceSubmitting(false);
    }
  }, [
    assistant?.workspaceId,
    createClonedVoiceAttachToPersona,
    createClonedVoiceAudio,
    createClonedVoiceLanguageHint,
    createClonedVoiceName,
    createClonedVoiceRightsConfirmed,
    closeClonedVoiceModal,
    getToken,
    loadClonedVoices,
    t
  ]);

  if (resetting) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-accent" />
        <p className="text-sm font-medium text-text-muted">{t("resettingAssistant")}</p>
        <p className="text-xs text-text-subtle">{t("resetClearing")}</p>
      </div>
    );
  }

  if (!assistant) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <Sparkles className="mb-4 h-10 w-10 text-text-subtle" />
        <p className="text-sm text-text-muted">{t("noAssistant")}</p>
        <p className="mt-1 text-xs text-text-subtle">{t("createFromMain")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full min-h-full flex-col">
        {/* 1. Character — hero */}
        <Section
          icon={<Sparkles className="h-4 w-4" />}
          title={t("character")}
          open={openSection === "character"}
          onToggle={() =>
            setOpenSection((current) => (current === "character" ? null : "character"))
          }
          className="order-1"
        >
          <div className="flex flex-col gap-3">
            <div className="px-1 py-1">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_14rem] lg:items-center">
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setAvatarPickerOpen((o) => !o)}
                    className="flex h-20 w-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl bg-accent/15 text-3xl transition-colors hover:bg-accent/25"
                    title={t("changeAvatar")}
                  >
                    {avatarUploading ? (
                      <Loader2 className="h-7 w-7 animate-spin text-accent" />
                    ) : avatarPreviewBlobUrl ? (
                      <img
                        src={avatarPreviewBlobUrl}
                        alt="Avatar"
                        className="h-full w-full object-cover"
                      />
                    ) : draftAvatarUrl ? (
                      <AssistantAvatar
                        avatarUrl={draftAvatarUrl}
                        size="md"
                        className="h-full w-full rounded-2xl"
                      />
                    ) : (
                      <Sparkles className="h-8 w-8 text-accent" />
                    )}
                  </button>
                  <div className="min-w-0">
                    <input
                      type="text"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      placeholder={t("assistantNamePlaceholder")}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-subtle outline-none transition-colors focus:border-border-strong"
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[11px] text-text-muted">
                        <span className={cn("inline-block h-2 w-2 rounded-full", statusDot)} />
                        <span>{statusLabel}</span>
                      </div>
                      {hasAssistantSwitcher ? (
                        <button
                          type="button"
                          onClick={() => {
                            setAssistantSwitcherError(null);
                            setAssistantSwitcherOpen(true);
                          }}
                          aria-label={t("switchAssistantDesktop")}
                          className="inline-flex cursor-pointer items-center justify-center bg-transparent px-0 py-0 text-[11px] font-medium text-text-muted/90 transition-colors hover:text-accent hover:underline hover:underline-offset-4"
                        >
                          <span aria-hidden="true" className="hidden sm:inline">
                            {t("switchAssistantDesktop")}
                          </span>
                          <span aria-hidden="true" className="sm:hidden">
                            {t("switchAssistantMobile")}
                          </span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
                  <ActionButton
                    icon={
                      saveButtonState === "saved" ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <Rocket className="h-3.5 w-3.5" />
                      )
                    }
                    label={saveButtonState === "saved" ? t("saved") : t("save")}
                    onClick={() => void handleSaveAndApply()}
                    busy={saving}
                    variant="primary"
                    pulse={saveButtonState === "saved"}
                    className="h-9 min-w-0 justify-center"
                  />
                  <ActionButton
                    icon={<Sparkles className="h-3.5 w-3.5" />}
                    label={editingPersonality ? t("hidePersonality") : t("editPersonality")}
                    onClick={() => setEditingPersonality(!editingPersonality)}
                    busy={false}
                    className="h-9 min-w-0 justify-center"
                  />
                </div>
              </div>
              {avatarPickerOpen && (
                <div className="mt-3 overflow-x-auto pb-1">
                  <div className="flex min-w-max items-center gap-2 pr-1">
                    {ASSISTANT_AVATAR_PRESETS.map((preset, index) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setDraftAvatarUrl(preset.imagePath);
                          setAvatarPickerOpen(false);
                        }}
                        className={cn(
                          "animate-fade-in flex h-[68px] w-[68px] shrink-0 cursor-pointer items-center justify-center rounded-[18px] border-[0.5px] bg-surface-raised/72 p-[3px] transition-all duration-200",
                          findAssistantAvatarPresetByUrl(draftAvatarUrl)?.id === preset.id
                            ? "border-accent/60 bg-[linear-gradient(180deg,rgba(191,148,84,0.14),rgba(191,148,84,0.05))] shadow-[0_0_0_0.5px_rgba(191,148,84,0.22),0_10px_20px_rgba(0,0,0,0.12)]"
                            : "border-border/35 hover:border-border/60 hover:bg-surface-hover/90 hover:shadow-[0_8px_18px_rgba(0,0,0,0.10)]"
                        )}
                        style={{
                          animationDelay: `${index * 40}ms`,
                          animationDuration: "280ms",
                          animationFillMode: "both"
                        }}
                        aria-label={preset.label}
                      >
                        <img
                          src={preset.imagePath}
                          alt=""
                          className="h-full w-full rounded-[14px] object-cover"
                        />
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        "animate-fade-in flex h-[68px] w-[68px] shrink-0 cursor-pointer items-center justify-center rounded-[18px] border-[0.5px] border-dashed bg-surface-raised/60 p-[3px] text-text-subtle transition-all duration-200",
                        draftAvatarUrl && findAssistantAvatarPresetByUrl(draftAvatarUrl) === null
                          ? "border-accent/60 bg-[linear-gradient(180deg,rgba(191,148,84,0.14),rgba(191,148,84,0.05))] shadow-[0_0_0_0.5px_rgba(191,148,84,0.22),0_10px_20px_rgba(0,0,0,0.12)]"
                          : "border-border/45 hover:border-border/65 hover:bg-surface-hover/85 hover:shadow-[0_8px_18px_rgba(0,0,0,0.10)]"
                      )}
                      style={{
                        animationDelay: `${ASSISTANT_AVATAR_PRESETS.length * 40}ms`,
                        animationDuration: "280ms",
                        animationFillMode: "both"
                      }}
                      title={t("uploadImage")}
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-[12px] border-[0.5px] border-border/55 bg-surface/80 text-text-subtle md:h-7 md:w-7">
                        <Upload className="h-4 w-4" />
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file || !file.type.startsWith("image/")) return;
              const localBlob = URL.createObjectURL(file);
              setAvatarPreviewBlobUrl(localBlob);
              setAvatarPickerOpen(false);
              setAvatarUploading(true);
              void (async () => {
                try {
                  const token = await getToken({ skipCache: true });
                  if (!token) return;
                  const result = await uploadAssistantAvatar(token, file);
                  setDraftAvatarUrl(result.avatarUrl);
                } catch {
                  setSaveFb({ type: "err", text: t("avatarUploadFailed") });
                  setAvatarPreviewBlobUrl(null);
                } finally {
                  setAvatarUploading(false);
                }
              })();
            }}
          />
          <FeedbackLine fb={saveFb?.type === "err" ? saveFb : null} />

          {editingPersonality && (
            <div className="mt-4 border-t border-border/45 px-1 pt-4">
              <div>
                <p className="text-sm font-medium text-text">{t("behaviorTitle")}</p>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">{t("behaviorHelp")}</p>
                <textarea
                  value={draftInstructions}
                  onChange={(e) => setDraftInstructions(e.target.value)}
                  placeholder={t("behaviorPlaceholder")}
                  rows={5}
                  className="mt-3 min-h-[144px] w-full resize-y rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
                />
              </div>

              <div className="mt-5 border-t border-border/70 pt-5">
                <p className="mb-2 block text-sm font-medium text-text">
                  {t("assistantGenderLabel")}
                </p>
                <SegmentedChoice
                  options={ASSISTANT_GENDER_OPTIONS.map((opt) => ({
                    value: opt.value,
                    label: tp(opt.labelKey)
                  }))}
                  value={draftAssistantGender ?? "neutral"}
                  onChange={(value) => setDraftAssistantGender(value as AssistantGender)}
                  className="grid-cols-3"
                />
              </div>

              <div className="mt-4">
                <span className="mb-2 block text-sm font-medium text-text">{t("voice")}</span>
                {primaryVoiceProviderId === "elevenlabs" &&
                  (voiceSettingsLoading ? (
                    <p className="rounded-xl border border-border/70 bg-surface px-4 py-3 text-xs text-text-muted">
                      {t("voiceElevenlabsLoading")}
                    </p>
                  ) : voiceSettings?.elevenlabs?.loadState === "not_configured" ? (
                    <p className="rounded-xl border border-border/70 bg-surface px-4 py-3 text-xs text-text-muted">
                      {t("voiceElevenlabsNotConfigured")}
                    </p>
                  ) : voiceSettings?.elevenlabs?.loadState === "unavailable" ? (
                    <p className="rounded-xl border border-border/70 bg-surface px-4 py-3 text-xs text-text-muted">
                      {voiceSettings.elevenlabs.warning ?? t("voiceElevenlabsUnavailable")}
                    </p>
                  ) : (
                    <>
                      <VoicePicker
                        entries={elevenLabsPickerEntries}
                        selectedValue={draftVoiceProfile.elevenlabs.voiceId}
                        onSelect={(value) =>
                          setDraftVoiceProfile((prev) => ({
                            ...prev,
                            elevenlabs: { voiceId: value }
                          }))
                        }
                        showGenderFilter
                        showLanguageFilter
                        showCategoryFilter
                        labels={voicePickerLabels}
                        languageBucket={elevenLabsLanguageBucket}
                        onLanguageBucketChange={setElevenLabsLanguageBucket}
                      />
                      {data.isAdmin && elevenLabsAdminVoices.length > 0 ? (
                        <div className="mt-3 rounded-xl border border-border/60 bg-surface-raised/20 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
                                Admin curation
                              </p>
                              <p className="text-[11px] text-text-muted">
                                Public voices: {elevenLabsVisiblePublicVoices.length}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleElevenLabsCatalogRefresh()}
                              disabled={voiceCatalogRefreshing}
                              className="rounded-full border border-border px-2.5 py-1 text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-60"
                            >
                              {voiceCatalogRefreshing ? "Refreshing..." : "Refresh cache"}
                            </button>
                          </div>
                          <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-border/50">
                            {elevenLabsFilteredAdminVoices.length > 0 ? (
                              elevenLabsFilteredAdminVoices.map((voice) => (
                                <div
                                  key={voice.voiceId}
                                  className="flex items-center gap-2 border-b border-border/40 px-2.5 py-1.5 text-xs last:border-b-0"
                                >
                                  <label className="flex min-w-0 flex-1 items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={voice.approved && !voice.hidden}
                                      disabled={voiceCurationSavingId === voice.voiceId}
                                      onChange={(event) =>
                                        void handleElevenLabsCurationChange(voice, {
                                          approved: event.currentTarget.checked,
                                          hidden: false
                                        })
                                      }
                                    />
                                    <span className="truncate text-text">
                                      {formatElevenLabsVoiceLabel(voice.name, locale)}
                                    </span>
                                  </label>
                                  <VoicePreviewButton
                                    previewAudioUrl={voice.previewUrl}
                                    voiceLabel={formatElevenLabsVoiceLabel(voice.name, locale)}
                                  />
                                  <button
                                    type="button"
                                    disabled={voiceCurationSavingId === voice.voiceId}
                                    onClick={() =>
                                      void handleElevenLabsCurationChange(voice, {
                                        hidden: !voice.hidden,
                                        approved: voice.approved
                                      })
                                    }
                                    className={cn(
                                      "rounded-full border px-2 py-0.5 text-[10px]",
                                      voice.hidden
                                        ? "border-destructive/30 text-destructive"
                                        : "border-border text-text-muted"
                                    )}
                                  >
                                    {voice.hidden ? "Hidden" : "Hide"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={voiceCurationSavingId === voice.voiceId}
                                    onClick={() =>
                                      void handleElevenLabsCurationChange(voice, {
                                        previewOk: voice.previewOk === false ? true : false
                                      })
                                    }
                                    className={cn(
                                      "rounded-full border px-2 py-0.5 text-[10px]",
                                      voice.previewOk === false
                                        ? "border-warning/40 text-warning"
                                        : "border-border text-text-muted"
                                    )}
                                  >
                                    {voice.previewUrl === null
                                      ? "No demo"
                                      : voice.previewOk === false
                                        ? "Demo bad"
                                        : "Demo ok"}
                                  </button>
                                  <span
                                    className={cn(
                                      "rounded-full px-2 py-0.5 text-[10px]",
                                      voice.public
                                        ? "bg-accent/10 text-accent"
                                        : "bg-surface text-text-subtle"
                                    )}
                                  >
                                    {voice.public ? "Public" : "Draft"}
                                  </span>
                                </div>
                              ))
                            ) : (
                              <p className="px-3 py-4 text-xs text-text-muted">
                                No voices for the current gender/language filter.
                              </p>
                            )}
                          </div>
                          {elevenLabsVisiblePublicVoices.length > 0 ? (
                            <p className="mt-2 truncate text-[11px] text-text-muted">
                              Public:{" "}
                              {elevenLabsVisiblePublicVoices
                                .map((voice) => formatElevenLabsVoiceLabel(voice.name, locale))
                                .join(", ")}
                            </p>
                          ) : null}
                          {voiceCurationError ? (
                            <p className="mt-2 text-xs text-destructive">{voiceCurationError}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ))}
                {primaryVoiceProviderId === "yandex" && (
                  <VoicePicker
                    entries={yandexPickerEntries}
                    selectedValue={draftVoiceProfile.yandex.voice}
                    onSelect={(value) =>
                      setDraftVoiceProfile((prev) => ({
                        ...prev,
                        yandex: {
                          ...prev.yandex,
                          voice: value as (typeof YANDEX_VOICE_OPTIONS)[number]["value"]
                        }
                      }))
                    }
                    showGenderFilter
                    labels={voicePickerLabels}
                  />
                )}
                {primaryVoiceProviderId === "openai" && (
                  <VoicePicker
                    entries={openAiPickerEntries}
                    selectedValue={draftVoiceProfile.openai.voice}
                    onSelect={(value) =>
                      setDraftVoiceProfile((prev) => ({
                        ...prev,
                        openai: {
                          voice: value as (typeof OPENAI_VOICE_OPTIONS)[number]["value"]
                        }
                      }))
                    }
                    showGenderFilter
                    labels={voicePickerLabels}
                  />
                )}
                {voiceSettingsError && (
                  <p className="mt-2 text-xs text-destructive">{voiceSettingsError}</p>
                )}
              </div>

              <div className="mt-5 border-t border-border/70 pt-5 pb-2">
                <p className="mb-3 text-sm font-medium text-text">{t("quickActions")}</p>
                <div className="flex flex-wrap items-center gap-2.5">
                  <ActionButton
                    icon={<Brain className="h-3.5 w-3.5" />}
                    label={t("memory")}
                    onClick={() => setMemoryDrawerOpen(true)}
                    busy={false}
                    className="min-w-[140px] justify-center"
                  />
                  <ActionButton
                    icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
                    label={showTraitControls ? t("hideTraitControls") : t("showTraitControls")}
                    onClick={() => setShowTraitControls((open) => !open)}
                    busy={false}
                    className="min-w-[170px] justify-center"
                  />
                  <ActionButton
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    label={t("reset")}
                    onClick={() => setResetConfirmOpen(true)}
                    busy={false}
                    variant="danger"
                    className="min-w-[160px] justify-center"
                  />
                </div>

                {showTraitControls && (
                  <div className="mt-4 divide-y divide-border/60">
                    {TRAIT_SLIDERS.map(({ key, labelLeftKey, labelRightKey }) => (
                      <div key={key} className="py-3">
                        <div className="mb-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[11px]">
                          <span className="truncate text-text-muted">{tp(labelLeftKey)}</span>
                          <span className="rounded-full bg-surface-raised/40 px-2 py-0.5 text-[10px] text-text-subtle">
                            {draftTraits[key] ?? 50}
                          </span>
                          <span className="truncate text-right text-text-muted">
                            {tp(labelRightKey)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={10}
                          value={draftTraits[key] ?? 50}
                          onChange={(e) =>
                            setDraftTraits((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                          }
                          className="w-full accent-accent"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <FeedbackLine fb={resetFb} />
            </div>
          )}
        </Section>

        {/* 3. Knowledge */}
        <Section
          icon={<Upload className="h-4 w-4" />}
          title={t("knowledgeTitle")}
          open={openSection === "knowledge"}
          onToggle={() =>
            setOpenSection((current) => (current === "knowledge" ? null : "knowledge"))
          }
          className="order-6"
        >
          <AssistantKnowledgeManager getToken={getToken} mode="inline" />
        </Section>

        {/* 4. Files */}
        <Section
          icon={<Files className="h-4 w-4" />}
          title={t("files")}
          open={openSection === "files"}
          onToggle={() => setOpenSection((current) => (current === "files" ? null : "files"))}
          className="order-7"
        >
          <WorkspaceFilesGallery
            chatId={galleryChatId}
            workspaceId={assistant?.workspaceId ?? null}
            defaultScope={galleryDefaultScope}
            allowSessionScope={galleryAllowSessionScope}
          />
        </Section>

        {/* 5. Skills */}
        <Section
          icon={<GraduationCap className="h-4 w-4" />}
          title={t("skills")}
          open={openSection === "skills"}
          onToggle={() => setOpenSection((current) => (current === "skills" ? null : "skills"))}
          className="order-4"
        >
          <AssistantSkillsManager
            state={skillsState}
            selectedSkillIds={selectedSkillIds}
            onChange={(nextSkillIds) => void handleSkillsChange(nextSkillIds)}
            loading={skillsLoading}
            saving={skillsSaving}
            error={skillsFb?.type === "err" ? skillsFb.text : null}
            collapsible
            initialVisibleCount={4}
          />
          {skillsFb?.type === "ok" ? <FeedbackLine fb={skillsFb} /> : null}
        </Section>

        {memoryDrawerOpen && typeof document !== "undefined"
          ? createPortal(
              <div
                className="fixed inset-0 z-[130] flex justify-end bg-black/40 backdrop-blur-sm"
                onClick={() => setMemoryDrawerOpen(false)}
                role="dialog"
                aria-modal="true"
                aria-label={t("memory")}
              >
                <div
                  className="h-full w-full max-w-2xl overflow-y-auto border-l border-border/70 bg-[color:var(--surface)] shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="sticky top-0 z-10 border-b border-border/70 bg-[color:var(--surface)]/95 px-5 py-4 backdrop-blur">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-xl font-semibold tracking-[-0.02em] text-text">
                          {t("memory")}
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMemoryDrawerOpen(false)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/80 bg-surface-raised/60 text-text-muted transition-colors hover:text-text"
                        aria-label={t("closeBillingSettings")}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="px-5 py-5">{memoryPanel}</div>
                </div>
              </div>,
              document.body
            )
          : null}

        {resetConfirmOpen && typeof document !== "undefined"
          ? createPortal(
              <div
                className="fixed inset-0 z-[140] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
                onClick={() => {
                  if (!resetting) {
                    setResetConfirmOpen(false);
                  }
                }}
                role="dialog"
                aria-modal="true"
                aria-label={t("reset")}
              >
                <div
                  className="w-full max-w-md rounded-2xl border border-border/80 bg-[color:var(--surface)] p-5 shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-full bg-destructive/10 p-2 text-destructive">
                      {resetting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <AlertTriangle className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold text-text">{t("reset")}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-text-muted">
                        {t("resetScopeWarning")}
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-text-muted">
                        {t("resetClearing")}
                      </p>
                    </div>
                  </div>
                  <FeedbackLine fb={resetFb} />
                  <div className="mt-5 flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={resetting}
                      onClick={() => setResetConfirmOpen(false)}
                      className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-surface-raised px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-50"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      disabled={resetting}
                      onClick={() => void handleReset()}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-destructive px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-destructive/90 disabled:cursor-wait disabled:opacity-70"
                    >
                      {resetting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <AlertTriangle className="h-4 w-4" />
                      )}
                      {t("confirmReset")}
                    </button>
                  </div>
                </div>
              </div>,
              document.body
            )
          : null}

        {/* 4. Tasks */}
        <Section
          icon={<ListTodo className="h-4 w-4" />}
          title={t("tasksAndReminders")}
          open={openSection === "tasks"}
          onToggle={() => setOpenSection((current) => (current === "tasks" ? null : "tasks"))}
          className="order-3"
        >
          <FeedbackLine fb={tasksFb} />
          {taskLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl bg-surface-raised/[0.18] p-3.5">
                <button
                  type="button"
                  onClick={() => setShowUserTasks((open) => !open)}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
                >
                  <div>
                    <p className="text-sm font-medium text-text">{t("userTasksTitle")}</p>
                    <p className="mt-1 text-[11px] text-text-subtle">{t("userTasksHelp")}</p>
                  </div>
                  <span className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-full bg-background/70 px-2.5 text-sm font-semibold tabular-nums text-text">
                    {userTaskItems.length}
                  </span>
                </button>

                {showUserTasks && (
                  <>
                    {userTaskItems.length === 0 ? (
                      <p className="mt-3 text-xs text-text-subtle">{t("noCurrentTasks")}</p>
                    ) : (
                      <ul className="mt-3 space-y-2.5">
                        {userTaskItems.map((item) => (
                          <li
                            key={item.id}
                            className="rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm"
                          >
                            <div className="flex flex-wrap items-start gap-2">
                              <span className="min-w-0 flex-1 text-sm font-semibold leading-snug text-text">
                                {item.title}
                              </span>
                              <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                                {getTaskScheduleKindLabel(item.sourceLabel)}
                              </span>
                              <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                                {getTaskStatusLabel(item.controlStatus)}
                              </span>
                            </div>
                            <p className="mt-1.5 text-[11px] text-text-subtle">
                              {getTaskTimingLabel(item)}
                            </p>
                            <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5 border-t border-border/60 pt-3">
                              <div className="flex gap-1.5">
                                <ActionButton
                                  icon={<RotateCcw className="h-3 w-3" />}
                                  label={t("disable")}
                                  onClick={() => void handleTaskAction(item.id, "disable")}
                                  busy={taskActionId === item.id}
                                  className="px-2.5 py-1.5"
                                />
                                <ActionButton
                                  icon={<Trash2 className="h-3 w-3" />}
                                  label={t("cancel")}
                                  variant="danger"
                                  onClick={() => void handleTaskAction(item.id, "cancel")}
                                  busy={taskActionId === item.id}
                                  className="px-2.5 py-1.5"
                                />
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>

              <div className="rounded-xl bg-surface-raised/[0.18] p-3.5">
                <button
                  type="button"
                  onClick={() => setShowAssistantActions((open) => !open)}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
                >
                  <div>
                    <p className="text-sm font-medium text-text">{t("assistantActions")}</p>
                    <p className="mt-1 text-[11px] text-text-subtle">
                      {t("assistantActionsDescription")}
                    </p>
                  </div>
                  <span className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-full bg-background/70 px-2.5 text-sm font-semibold tabular-nums text-text">
                    {assistantTaskItems.length}
                  </span>
                </button>

                {showAssistantActions && (
                  <>
                    {(() => {
                      const activeAssistantActions = backgroundTaskItems.filter(
                        (item) => item.status !== "completed"
                      );
                      const completedAssistantActions = backgroundTaskItems.filter(
                        (item) => item.status === "completed"
                      );

                      if (backgroundTaskItems.length === 0) {
                        return (
                          <p className="mt-3 text-xs text-text-subtle">{t("noAssistantActions")}</p>
                        );
                      }

                      return (
                        <>
                          {activeAssistantActions.length > 0 ? (
                            <ul className="mt-3 space-y-2.5">
                              {activeAssistantActions.map((item) => {
                                const recentRuns = item.recentRuns.slice(0, 5);
                                return (
                                  <li
                                    key={item.id}
                                    className="rounded-xl border border-border/55 bg-background/55 p-3 shadow-sm"
                                  >
                                    <div className="flex flex-wrap items-start gap-2">
                                      <span className="min-w-0 flex-1 text-sm font-semibold leading-snug text-text">
                                        {item.title}
                                      </span>
                                      <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold text-text-subtle">
                                        {t("assistantAction")}
                                      </span>
                                      <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold text-text-subtle">
                                        {getBackgroundTaskStatusLabel(item.status)}
                                      </span>
                                    </div>
                                    <p className="mt-1.5 text-[11px] text-text-subtle">
                                      {getBackgroundTaskTimingLabel(item)}
                                    </p>
                                    <p className="mt-2 text-xs leading-relaxed text-text-muted">
                                      {item.brief}
                                    </p>
                                    {recentRuns.length > 0 && (
                                      <div className="mt-3 rounded-lg bg-surface-raised/30 p-2.5">
                                        <p className="text-[10px] font-medium text-text-subtle">
                                          {t("runHistory")}
                                        </p>
                                        <ul className="mt-1.5 space-y-1">
                                          {recentRuns.map((run) => (
                                            <li
                                              key={run.id}
                                              className="text-[11px] text-text-subtle"
                                            >
                                              {formatBackgroundRunLine(run)}
                                              {run.pushText && (
                                                <span className="mt-0.5 block text-text-muted">
                                                  {run.pushText}
                                                </span>
                                              )}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5 border-t border-border/60 pt-3">
                                      <div className="flex gap-1.5">
                                        {item.status === "active" && (
                                          <ActionButton
                                            icon={<RotateCcw className="h-3 w-3" />}
                                            label={t("disable")}
                                            onClick={() =>
                                              void handleBackgroundTaskAction(item.id, "disable")
                                            }
                                            busy={taskActionId === item.id}
                                            className="px-2.5 py-1.5"
                                          />
                                        )}
                                        {item.status === "disabled" && (
                                          <ActionButton
                                            icon={<RotateCcw className="h-3 w-3" />}
                                            label={t("enable")}
                                            onClick={() =>
                                              void handleBackgroundTaskAction(item.id, "enable")
                                            }
                                            busy={taskActionId === item.id}
                                            className="px-2.5 py-1.5"
                                          />
                                        )}
                                        <ActionButton
                                          icon={<Trash2 className="h-3 w-3" />}
                                          label={t("cancel")}
                                          variant="danger"
                                          onClick={() =>
                                            void handleBackgroundTaskAction(item.id, "cancel")
                                          }
                                          busy={taskActionId === item.id}
                                          className="px-2.5 py-1.5"
                                        />
                                      </div>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <p className="mt-3 text-xs text-text-subtle">
                              {t("noAssistantActions")}
                            </p>
                          )}

                          {completedAssistantActions.length > 0 ? (
                            <div className="mt-3">
                              <button
                                type="button"
                                onClick={() => setShowCompletedAssistantActions((open) => !open)}
                                className="text-xs font-medium text-text-muted transition-colors hover:text-text"
                              >
                                {showCompletedAssistantActions
                                  ? t("assistantActionsHideCompleted")
                                  : t("assistantActionsShowCompleted", {
                                      count: completedAssistantActions.length
                                    })}
                              </button>
                              {showCompletedAssistantActions ? (
                                <ul className="mt-2 divide-y divide-border/45 border-t border-border/35">
                                  {completedAssistantActions.map((item) => {
                                    const lastRun = item.recentRuns[0] ?? null;
                                    return (
                                      <li key={item.id} className="py-2.5">
                                        <div className="flex items-baseline gap-3">
                                          <span className="min-w-0 flex-1 truncate text-sm font-medium leading-6 text-text">
                                            {item.title}
                                          </span>
                                          <span className="shrink-0 text-[11px] font-medium text-text-subtle">
                                            {getBackgroundTaskStatusLabel(item.status)}
                                          </span>
                                        </div>
                                        {lastRun ? (
                                          <div className="mt-1 min-w-0 text-[11px] leading-5 text-text-subtle">
                                            <p className="truncate">
                                              {formatBackgroundRunLine(lastRun)}
                                            </p>
                                            {lastRun.pushText ? (
                                              <p className="truncate text-text-muted">
                                                {lastRun.pushText}
                                              </p>
                                            ) : null}
                                          </div>
                                        ) : null}
                                      </li>
                                    );
                                  })}
                                </ul>
                              ) : null}
                            </div>
                          ) : null}
                        </>
                      );
                    })()}
                  </>
                )}
              </div>

              <div className="rounded-xl bg-surface-raised/[0.18] p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-text">{t("reminderDelivery")}</p>
                    <p className="mt-1 text-[11px] text-text-subtle">{t("reminderDescription")}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(data.notificationPreference?.availableChannels ?? ["web"]).map((channel) => {
                    const active = notificationChannel === channel;
                    return (
                      <button
                        key={channel}
                        type="button"
                        disabled={notificationSaving}
                        onClick={() => void handleNotificationPreferenceChange(channel)}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-50",
                          active
                            ? "border-accent/45 bg-accent/10 text-accent"
                            : "border-border/50 bg-background/45 text-text-muted hover:bg-surface-hover"
                        )}
                      >
                        {t(
                          (
                            {
                              telegram: "channelTelegram",
                              web: "channelWeb"
                            } as Record<string, string>
                          )[channel] ?? "channelWeb"
                        )}
                      </button>
                    );
                  })}
                </div>
                <FeedbackLine fb={notificationFb} />
              </div>
            </div>
          )}
        </Section>

        {/* 5. Integrations */}
        <Section
          icon={<Send className="h-4 w-4" />}
          title={t("integrations")}
          open={openSection === "channels"}
          onToggle={() => setOpenSection((current) => (current === "channels" ? null : "channels"))}
          className="order-8"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <IntegrationCard
              name="Telegram"
              logoSrc="/integrations/telegram-logo.png"
              statusLabel={
                data.telegram?.connectionStatus === "connected" ||
                data.telegram?.connectionStatus === "claim_required"
                  ? t("channelConnected")
                  : t("telegramReadyToConnect")
              }
              active
              onClick={onOpenTelegramSettings}
            />
            <IntegrationCard
              name="WhatsApp"
              logoSrc="/integrations/whatsapp-logo.png"
              statusLabel={t("channelComingSoon")}
              comingSoon
            />
            <IntegrationCard
              name="MAX"
              logoSrc="/integrations/max-logo.png"
              statusLabel={t("channelComingSoon")}
              comingSoon
            />
          </div>
          <div className="my-4 border-t border-border/60" />
          <div className="mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {t("connectedSites")}
            </h3>
          </div>
          {browserProfilesLoading ? (
            <div className="flex items-center gap-2 py-2 text-xs text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("connectedSitesLoading")}
            </div>
          ) : browserProfiles.length === 0 ? (
            <p className="text-xs text-text-muted">{t("connectedSitesEmpty")}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {browserProfiles.map((profile) => (
                <BrowserSiteCard
                  key={profile.id}
                  profile={profile}
                  busy={browserProfilesActionId === profile.id}
                  onDelete={() => void handleDeleteBrowserProfile(profile.id)}
                  onOpen={() => void handleOpenBrowserProfile(profile)}
                />
              ))}
            </div>
          )}
        </Section>

        {assistant?.id ? (
          <Section
            icon={<MessageCircle className="h-4 w-4" />}
            title={t("support")}
            open={openSection === "support"}
            onToggle={() => {
              setOpenSection((current) => {
                const next = current === "support" ? null : "support";
                if (current === "support") {
                  void refreshSupportUnreadCount();
                }
                return next;
              });
            }}
            className="order-9"
            showActivityDot={supportUnreadCount > 0}
          >
            <AssistantSupportSection
              assistantId={assistant.id}
              onActivityChange={({ unreadCount }) => setSupportUnreadCount(unreadCount)}
            />
          </Section>
        ) : null}

        {/* Characters — video personas */}
        <Section
          icon={<UserCircle2 className="h-4 w-4" />}
          title={t("charactersTitle")}
          open={openSection === "characters"}
          onToggle={() =>
            setOpenSection((current) => (current === "characters" ? null : "characters"))
          }
          className="order-10"
        >
          {!talkingVideoEnabled ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs italic text-text-muted">
                {charactersPlanGateLabel}{" "}
                <a
                  href={CHARACTERS_PRICING_URL}
                  className="text-text-muted underline underline-offset-2 opacity-70 hover:opacity-100"
                >
                  {t("changePlan")}
                </a>
              </p>
            </div>
          ) : null}
          <div className="flex flex-col gap-3">
            {talkingVideoEnabled && personaFb !== null && (
              <p
                className={cn(
                  "rounded-lg px-3 py-2 text-xs",
                  personaFb.type === "ok"
                    ? "border border-accent/18 bg-accent/8 text-accent"
                    : personaFb.type === "warn"
                      ? "bg-yellow-500/10 text-yellow-600"
                      : "bg-destructive/10 text-destructive"
                )}
              >
                {personaFb.text}
              </p>
            )}
            {talkingVideoEnabled && clonedVoiceFb !== null && (
              <p
                className={cn(
                  "rounded-lg px-3 py-2 text-xs",
                  clonedVoiceFb.type === "ok"
                    ? "border border-accent/18 bg-accent/8 text-accent"
                    : clonedVoiceFb.type === "warn"
                      ? "bg-yellow-500/10 text-yellow-600"
                      : "bg-destructive/10 text-destructive"
                )}
              >
                {clonedVoiceFb.text}
              </p>
            )}

            <p className="text-xs leading-5 text-text-muted">{charactersHelperText}</p>

            {personaListLoading && personaList.length === 0 ? (
              <div className="flex items-center gap-2 py-1 text-xs text-text-subtle">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{t("charactersLoading")}</span>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              {personaList.map((persona) => {
                const clonedVoice = clonedVoiceList.find(
                  (voice) => voice.id === persona.clonedVoiceId
                );
                const catalogEntry = voiceCatalog.find((v) => v.voiceId === persona.heygenVoiceId);
                const activeVoiceLabel = persona.clonedVoiceDisplayName ?? persona.heygenVoiceLabel;
                return (
                  <CharacterCard
                    key={persona.id}
                    name={persona.displayName}
                    voiceLabel={t("charactersVoiceLabel", { voice: activeVoiceLabel })}
                    portraitImageUrl={persona.portraitImageUrl || null}
                    fallbackInitial={persona.displayName.charAt(0)}
                    previewAudioUrl={
                      assistant?.workspaceId
                        ? getWorkspaceVideoPersonaPreviewUrl(assistant.workspaceId, persona.id)
                        : (clonedVoice?.previewAudioUrl ?? catalogEntry?.previewAudioUrl ?? null)
                    }
                    previewVoiceLabel={activeVoiceLabel}
                    previewUnavailableLabel={t("charactersPreviewUnavailable")}
                    showPreview={talkingVideoEnabled}
                    disabled={!talkingVideoEnabled}
                    openPortraitLabel={
                      talkingVideoEnabled
                        ? t("charactersOpenPortrait", { name: persona.displayName })
                        : undefined
                    }
                    deleteLabel={t("charactersDeleteTitle")}
                    onOpenPortrait={
                      talkingVideoEnabled && persona.portraitImageUrl
                        ? () =>
                            setPersonaLightbox({
                              src: persona.portraitImageUrl,
                              name: persona.displayName
                            })
                        : undefined
                    }
                    onSelect={
                      talkingVideoEnabled ? () => resetPersonaModal("edit", persona) : undefined
                    }
                    onDelete={
                      talkingVideoEnabled
                        ? () => {
                            setDeletePersonaId(persona.id);
                            setDeletePersonaName(persona.displayName);
                          }
                        : undefined
                    }
                  />
                );
              })}

              <CharacterCreateCard
                label={t("charactersCreate")}
                helperText={createPersonaDisabledReason ?? t("charactersUsageHint")}
                disabled={createPersonaDisabledReason !== null}
                title={createPersonaDisabledReason ?? undefined}
                onClick={() => {
                  if (createPersonaDisabledReason !== null) {
                    return;
                  }
                  resetPersonaModal("create");
                }}
              />
            </div>

            {talkingVideoEnabled ? (
              <div className="border-t border-border/45 pt-3">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    aria-expanded={clonedVoicesExpanded}
                    onClick={() => setClonedVoicesExpanded((open) => !open)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1 py-1.5 text-left transition-colors hover:bg-surface-raised/30"
                  >
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 shrink-0 text-text-subtle transition-transform",
                        clonedVoicesExpanded && "rotate-90"
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text">{t("voicesTitle")}</p>
                      <p className="truncate text-[11px] text-text-muted">
                        {t("voicesCostSummary", {
                          n: clonedVoiceCreationVcoinCost,
                          m: data.plan?.workspaceVcoinBalance?.balanceVc ?? 0,
                          limit: clonedVoiceLimit
                        })}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-border/45 bg-background/55 px-2 py-0.5 text-[10px] font-medium text-text-subtle">
                      {clonedVoiceList.length}/{clonedVoiceLimit}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={clonedVoiceCreateDisabledReason !== null}
                    title={clonedVoiceCreateDisabledReason ?? undefined}
                    onClick={() => {
                      if (clonedVoiceCreateDisabledReason !== null) {
                        return;
                      }
                      resetClonedVoiceModal(false);
                    }}
                    className={userPillButtonClassName(
                      "secondary",
                      cn(
                        "shrink-0",
                        clonedVoiceCreateDisabledReason !== null && "cursor-not-allowed opacity-60"
                      )
                    )}
                  >
                    {t("voicesCreate")}
                  </button>
                </div>

                {clonedVoicesExpanded ? (
                  <div className="mt-3 border-t border-border/50 pt-3">
                    {clonedVoiceListLoading && clonedVoiceList.length === 0 ? (
                      <div className="flex items-center gap-2 py-1 text-xs text-text-subtle">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>{t("charactersLoading")}</span>
                      </div>
                    ) : clonedVoiceList.length === 0 ? (
                      <p className="text-xs text-text-subtle">{t("voicesEmpty")}</p>
                    ) : (
                      <div className="divide-y divide-border/45">
                        {clonedVoiceList.map((voice) => {
                          const busy = clonedVoiceSubmittingId === voice.id;
                          const statusLabel =
                            voice.status === "ready"
                              ? t("voicesStatusReady")
                              : voice.status === "pending"
                                ? t("voicesStatusPending")
                                : t("voicesStatusFailed");
                          const statusTone =
                            voice.status === "ready"
                              ? "success"
                              : voice.status === "pending"
                                ? "warn"
                                : "error";
                          return (
                            <VoiceCloneCard
                              key={voice.id}
                              voice={voice}
                              voiceLabel={t("voicesCardMeta", {
                                language: voice.languageHint || t("voicesLanguageAuto")
                              })}
                              previewAudioUrl={resolveClonedVoicePreviewUrl(
                                assistant?.workspaceId,
                                voice
                              )}
                              statusLabel={statusLabel}
                              statusTone={statusTone}
                              previewUnavailableLabel={t("charactersPreviewUnavailable")}
                              linkedSummary={cloneLinkedSummaryById.get(voice.id) ?? null}
                              archiveLabel={t("voicesArchive")}
                              defaultLabel={t("voicesDefault")}
                              makeDefaultLabel={
                                busy ? t("voicesSubmittingShort") : t("voicesMakeDefault")
                              }
                              onArchive={
                                voice.status === "pending" || busy
                                  ? undefined
                                  : async () => {
                                      if (!assistant?.workspaceId) return;
                                      const token = await getToken({ skipCache: true });
                                      if (!token) return;
                                      setClonedVoiceSubmittingId(voice.id);
                                      try {
                                        await archiveWorkspaceVideoClonedVoice(
                                          token,
                                          assistant.workspaceId,
                                          voice.id
                                        );
                                        setClonedVoiceFb({
                                          type: "ok",
                                          text: t("voicesArchiveSuccess", {
                                            name: voice.displayName
                                          })
                                        });
                                        if (createPersonaClonedVoiceId === voice.id) {
                                          setCreatePersonaClonedVoiceId(null);
                                        }
                                        await loadClonedVoices();
                                      } catch (error) {
                                        setClonedVoiceFb({
                                          type: "err",
                                          text:
                                            error instanceof Error
                                              ? error.message
                                              : t("voicesErrorGeneric")
                                        });
                                      } finally {
                                        setClonedVoiceSubmittingId(null);
                                      }
                                    }
                              }
                              onMakeDefault={
                                voice.status === "ready" && !voice.isDefault && !busy
                                  ? async () => {
                                      if (!assistant?.workspaceId) return;
                                      const token = await getToken({ skipCache: true });
                                      if (!token) return;
                                      setClonedVoiceSubmittingId(voice.id);
                                      try {
                                        await setWorkspaceVideoClonedVoiceDefault(
                                          token,
                                          assistant.workspaceId,
                                          voice.id
                                        );
                                        setClonedVoiceFb({
                                          type: "ok",
                                          text: t("voicesDefaultSuccess", {
                                            name: voice.displayName
                                          })
                                        });
                                        await loadClonedVoices();
                                      } catch (error) {
                                        setClonedVoiceFb({
                                          type: "err",
                                          text:
                                            error instanceof Error
                                              ? error.message
                                              : t("voicesErrorGeneric")
                                        });
                                      } finally {
                                        setClonedVoiceSubmittingId(null);
                                      }
                                    }
                                  : undefined
                              }
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Delete confirm modal */}
            {deletePersonaId !== null &&
              typeof document !== "undefined" &&
              createPortal(
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
                  onClick={(e) => {
                    if (e.target === e.currentTarget) {
                      setDeletePersonaId(null);
                      setDeletePersonaName(null);
                    }
                  }}
                  role="dialog"
                  aria-modal="true"
                >
                  <div className="mx-4 w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-xl">
                    <h2 className="text-sm font-semibold text-text">
                      {t("charactersDeleteTitle")}
                    </h2>
                    <p className="mt-2 text-xs text-text-muted">
                      {t("charactersDeleteConfirm", { name: deletePersonaName ?? "" })}
                    </p>
                    <div className="mt-4 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDeletePersonaId(null);
                          setDeletePersonaName(null);
                        }}
                        className="rounded-full border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-raised"
                      >
                        {t("charactersCancel")}
                      </button>
                      <button
                        type="button"
                        disabled={deletePersonaSubmitting}
                        onClick={async () => {
                          if (!deletePersonaId || !assistant?.workspaceId) return;
                          const token = await getToken();
                          if (!token) return;
                          setDeletePersonaSubmitting(true);
                          try {
                            await deleteWorkspaceVideoPersona(
                              token,
                              assistant.workspaceId,
                              deletePersonaId
                            );
                            setDeletePersonaId(null);
                            setDeletePersonaName(null);
                            setPersonaFb({ type: "ok", text: t("charactersDeleteSuccess") });
                            void loadPersonas();
                          } catch (err) {
                            setPersonaFb({
                              type: "err",
                              text: err instanceof Error ? err.message : t("charactersErrorGeneric")
                            });
                          } finally {
                            setDeletePersonaSubmitting(false);
                          }
                        }}
                        className={cn(
                          "rounded-full bg-destructive px-3 py-1.5 text-xs font-medium text-white transition-opacity",
                          deletePersonaSubmitting && "opacity-60"
                        )}
                      >
                        {deletePersonaSubmitting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          t("charactersDelete")
                        )}
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )}

            {personaLightbox !== null &&
              typeof document !== "undefined" &&
              createPortal(
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
                  onClick={(e) => {
                    if (e.target === e.currentTarget) {
                      setPersonaLightbox(null);
                    }
                  }}
                  role="dialog"
                  aria-modal="true"
                >
                  <div className="relative w-full max-w-3xl">
                    <button
                      type="button"
                      onClick={() => setPersonaLightbox(null)}
                      className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white transition-colors hover:bg-black/55"
                      aria-label={t("charactersLightboxClose")}
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <img
                      src={personaLightbox.src}
                      alt={personaLightbox.name}
                      className="max-h-[85vh] w-full rounded-3xl object-contain shadow-2xl"
                    />
                  </div>
                </div>,
                document.body
              )}

            {/* Create / edit persona modal */}
            {createPersonaOpen &&
              typeof document !== "undefined" &&
              createPortal(
                <div
                  className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm"
                  onClick={(e) => {
                    if (e.target === e.currentTarget) closePersonaModal();
                  }}
                  role="dialog"
                  aria-modal="true"
                >
                  <div className="relative mx-4 my-10 w-full min-w-0 max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl">
                    <h2 className="mb-4 text-sm font-semibold text-text">
                      {personaModalMode === "edit" ? t("charactersEdit") : t("charactersCreate")}
                    </h2>

                    {/* Portrait */}
                    <div className="mb-3">
                      <p className="mb-1 text-xs font-semibold text-text">
                        {t("charactersFormPortrait")}
                      </p>
                      {personaModalMode === "edit" ? (
                        <div className="rounded-xl border border-border/60 bg-surface-raised/20 p-3">
                          <div className="flex items-center gap-3">
                            {createPersonaPortraitPreview ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setPersonaLightbox({
                                    src: createPersonaPortraitPreview,
                                    name: createPersonaName.trim() || t("charactersEdit")
                                  })
                                }
                                className="shrink-0 rounded-2xl transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-accent/20"
                                aria-label={t("charactersOpenPortrait", {
                                  name: createPersonaName.trim() || t("charactersEdit")
                                })}
                              >
                                <img
                                  src={createPersonaPortraitPreview}
                                  alt="Portrait preview"
                                  className="h-20 w-20 rounded-2xl object-cover"
                                />
                              </button>
                            ) : (
                              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-sm font-medium text-accent">
                                {createPersonaName.trim().charAt(0) || "?"}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-text-muted">
                                {t("charactersAvatarEditHint")}
                              </p>
                              <p className="mt-2 text-xs text-text-subtle">
                                {t("charactersFormVideoFormatReadonly", {
                                  format: formatPersonaVideoFormatLabel(
                                    t,
                                    createPersonaAutoVideoFormat
                                  )
                                })}
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-border/60 bg-surface-raised/20 p-3">
                          <div className="grid gap-3 sm:grid-cols-[112px_minmax(0,1fr)] sm:items-start">
                            <div
                              className={cn(
                                "flex aspect-square w-full cursor-pointer items-center justify-center rounded-2xl transition-colors sm:w-28",
                                createPersonaPortraitPreview
                                  ? "overflow-hidden bg-transparent p-0"
                                  : "border-2 border-dashed border-border/60 bg-surface-raised/30 p-3 hover:border-border"
                              )}
                              onClick={() => personaPortraitInputRef.current?.click()}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                e.preventDefault();
                                const file = e.dataTransfer.files?.[0];
                                if (file) handlePersonaPortraitFile(file);
                              }}
                            >
                              {createPersonaPortraitPreview ? (
                                <img
                                  src={createPersonaPortraitPreview}
                                  alt="Portrait preview"
                                  className="h-full w-full rounded-2xl object-cover"
                                />
                              ) : (
                                <div className="flex flex-col items-center text-center">
                                  <Upload className="mb-1 h-5 w-5 text-text-subtle" />
                                  <p className="text-xs text-text-subtle">
                                    {t("charactersFormPortraitDrop")}
                                  </p>
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs text-text-muted">
                                {t("charactersAvatarCreateHint")}
                              </p>
                              <div className="mt-3">
                                <p className="mb-1 text-[11px] font-medium text-text-muted">
                                  {t("charactersFormVideoFormat")}
                                </p>
                                <div className="grid grid-cols-4 gap-1 rounded-full border border-border/60 bg-surface p-1">
                                  {(["auto", "9:16", "1:1", "16:9"] as const).map((option) => {
                                    const selected = createPersonaVideoFormatChoice === option;
                                    const label =
                                      option === "auto"
                                        ? t("charactersFormVideoFormatAuto")
                                        : formatPersonaVideoFormatLabel(t, option);
                                    return (
                                      <button
                                        key={option}
                                        type="button"
                                        onClick={() => setCreatePersonaVideoFormatChoice(option)}
                                        className={cn(
                                          "rounded-full px-2 py-1.5 text-[11px] font-medium transition-colors",
                                          selected
                                            ? "bg-accent text-accent-foreground"
                                            : "text-text-subtle hover:bg-surface-raised hover:text-text"
                                        )}
                                      >
                                        {label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {personaModalMode === "create" ? (
                        <>
                          <input
                            ref={personaPortraitInputRef}
                            type="file"
                            accept="image/jpeg,image/png"
                            className="sr-only"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handlePersonaPortraitFile(file);
                            }}
                          />
                          {createPersonaPortraitError && (
                            <p className="mt-1 text-[11px] text-destructive">
                              {createPersonaPortraitError}
                            </p>
                          )}
                        </>
                      ) : null}
                    </div>

                    {/* Name */}
                    <div className="mb-3">
                      <label className="mb-1 block text-xs font-semibold text-text">
                        {t("charactersFormName")}
                      </label>
                      <input
                        type="text"
                        maxLength={60}
                        value={createPersonaName}
                        onChange={(e) => setCreatePersonaName(e.target.value)}
                        placeholder={t("charactersFormNamePlaceholder")}
                        className={userFieldClassName()}
                      />
                    </div>

                    {/* Voice picker */}
                    <div className="mb-3">
                      <p className="mb-1.5 text-xs font-semibold text-text">
                        {t("charactersFormVoice")}
                      </p>
                      <SegmentedChoice
                        options={[
                          { value: "female", label: t("genderFemale") },
                          { value: "male", label: t("genderMale") },
                          { value: "neutral", label: t("genderNeutral") }
                        ]}
                        value={voiceGenderFilter}
                        onChange={(value) =>
                          setVoiceGenderFilter(value as PersonaVoiceGenderFilter)
                        }
                        className="grid-cols-3"
                      />
                      <div className="mt-3">
                        <p className="mb-1.5 text-[11px] font-medium text-text-muted">
                          {t("charactersFormVoiceLanguage")}
                        </p>
                        <SegmentedChoice
                          options={[
                            { value: "ru", label: "RU" },
                            { value: "en", label: "EN" },
                            { value: "other", label: t("charactersFormVoiceFilterOther") },
                            { value: "mine", label: t("charactersFormVoiceFilterMine") }
                          ]}
                          value={voiceLanguageFilter}
                          onChange={(value) => {
                            const next = value as PersonaVoiceLanguageFilter;
                            setVoiceLanguageFilter(next);
                            if (next !== "other") {
                              setOtherVoiceLanguageSearch("");
                            }
                          }}
                          className="grid-cols-4"
                        />
                        {voiceLanguageFilter === "other" ? (
                          <div className="mt-2">
                            <input
                              type="text"
                              value={otherVoiceLanguageSearch}
                              onChange={(event) => setOtherVoiceLanguageSearch(event.target.value)}
                              placeholder={t("charactersFormVoiceLanguageSearchPlaceholder")}
                              className={userFieldClassName("text-xs")}
                            />
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-3">
                        {voiceLanguageFilter === "mine" ? (
                          <div className="space-y-2">
                            {readyClonedVoices.length === 0 ? (
                              <p className="py-2 text-xs text-text-muted">
                                {t("charactersFormNoClonedVoices")}
                              </p>
                            ) : (
                              <div className="max-h-40 overflow-y-auto rounded-xl border border-border/60 bg-surface-raised/20">
                                {readyClonedVoices.map((voice) => (
                                  <div
                                    key={voice.id}
                                    role="button"
                                    tabIndex={0}
                                    aria-pressed={createPersonaClonedVoiceId === voice.id}
                                    onClick={() => setCreatePersonaClonedVoiceId(voice.id)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        setCreatePersonaClonedVoiceId(voice.id);
                                      }
                                    }}
                                    className={cn(
                                      "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/20",
                                      createPersonaClonedVoiceId === voice.id && "bg-accent/10"
                                    )}
                                  >
                                    <span className="flex-1 truncate font-medium text-text">
                                      {voice.displayName}
                                    </span>
                                    <span className="shrink-0 text-text-subtle">
                                      {voice.languageHint || t("voicesLanguageAuto")}
                                      {voice.isDefault ? ` · ${t("voicesDefault")}` : ""}
                                    </span>
                                    <VoicePreviewButton
                                      previewAudioUrl={resolveClonedVoicePreviewUrl(
                                        assistant?.workspaceId,
                                        voice
                                      )}
                                      voiceLabel={voice.displayName}
                                      previewUnavailableLabel={t("charactersPreviewUnavailable")}
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => resetClonedVoiceModal(true)}
                              className="text-[11px] font-medium text-accent transition-opacity hover:opacity-80"
                            >
                              {t("voicesCreateInline")}
                            </button>
                            {activePersonaVoiceOption ? (
                              <p className="text-[11px] text-accent">
                                {t("charactersFormClonedVoiceSelected", {
                                  name: activePersonaVoiceOption.displayName
                                })}
                              </p>
                            ) : null}
                          </div>
                        ) : voiceCatalogLoading ? (
                          <div className="flex items-center gap-2 py-2 text-xs text-text-subtle">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>{t("charactersLoading")}</span>
                          </div>
                        ) : voiceCatalogUnavailable || voiceCatalog.length === 0 ? (
                          <p className="py-2 text-xs text-text-muted">
                            {t("charactersFormVoiceUnavailable")}
                          </p>
                        ) : filteredVoiceCatalog.length === 0 ? (
                          <p className="py-2 text-xs text-text-muted">
                            {voiceLanguageFilter === "other" &&
                            otherVoiceLanguageSearch.trim().length > 0
                              ? t("charactersFormVoiceEmptyForLanguageSearch")
                              : t("charactersFormVoiceEmptyForFilter")}
                          </p>
                        ) : (
                          <div className="max-h-40 overflow-y-auto rounded-xl border border-border/60 bg-surface-raised/20">
                            {filteredVoiceCatalog.map((voice) => {
                              const qualityBadges = voiceQualityBadgeLabels(voice);
                              return (
                                <div
                                  key={voiceCatalogRowKey(voice)}
                                  role="button"
                                  tabIndex={0}
                                  aria-pressed={createPersonaVoiceId === voice.voiceId}
                                  onClick={() => {
                                    setCreatePersonaVoiceId(voice.voiceId);
                                    setCreatePersonaClonedVoiceId(null);
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      setCreatePersonaVoiceId(voice.voiceId);
                                      setCreatePersonaClonedVoiceId(null);
                                    }
                                  }}
                                  className={cn(
                                    "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/20",
                                    createPersonaVoiceId === voice.voiceId && "bg-accent/10"
                                  )}
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium text-text">
                                      {voice.name}
                                    </span>
                                    {qualityBadges.length > 0 ? (
                                      <span className="mt-0.5 block truncate text-[10px] font-medium text-accent/80">
                                        {qualityBadges.join(" · ")}
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="shrink-0 text-text-subtle">
                                    {multilingualVoiceSignatures.has(
                                      voiceMultilingualSignature(voice)
                                    )
                                      ? t("charactersFormVoiceLanguageMulti")
                                      : formatVoiceLanguageLabel(voice)}{" "}
                                    · {voice.gender}
                                  </span>
                                  <VoicePreviewButton
                                    previewAudioUrl={resolveCatalogPreviewUrl(
                                      assistant?.workspaceId,
                                      voice
                                    )}
                                    voiceLabel={voice.name}
                                    previewUnavailableLabel={t("charactersPreviewUnavailable")}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* VC cost line */}
                    {personaModalMode === "create"
                      ? (() => {
                          const balance = data.plan?.workspaceVcoinBalance?.balanceVc ?? 0;
                          const cost = personaCreationVcoinCost;
                          const remaining = balance - cost;
                          const insufficient = balance < cost;
                          return (
                            <div className="mb-4 rounded-xl border border-border/50 bg-surface-raised/30 px-3 py-2 text-xs text-text-muted">
                              {t("charactersFormCost", {
                                n: cost,
                                m: balance,
                                remaining: Math.max(0, remaining)
                              })}
                              {insufficient && (
                                <div className="mt-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      closePersonaModal();
                                      onOpenPackagesPage?.();
                                    }}
                                    className="text-accent underline underline-offset-2"
                                  >
                                    {t("charactersFormInsufficient")}
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })()
                      : null}

                    {createPersonaError && (
                      <p className="mb-3 text-xs text-destructive">{createPersonaError}</p>
                    )}

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={closePersonaModal}
                        className={userPillButtonClassName("secondary", "min-h-9 px-4")}
                      >
                        {t("charactersCancel")}
                      </button>
                      <button
                        type="button"
                        disabled={
                          createPersonaSubmitting ||
                          createPersonaName.trim().length === 0 ||
                          !personaFallbackVoiceId ||
                          (personaModalMode === "create" &&
                            (!createPersonaPortrait ||
                              (data.plan?.workspaceVcoinBalance?.balanceVc ?? 0) <
                                personaCreationVcoinCost))
                        }
                        onClick={async () => {
                          if (!assistant?.workspaceId || !personaFallbackVoiceId) return;
                          const token = await getToken();
                          if (!token) return;
                          const resolvedPersonaVideoFormat: PersonaVideoFormat =
                            createPersonaVideoFormatChoice === "auto"
                              ? createPersonaAutoVideoFormat
                              : createPersonaVideoFormatChoice;
                          setCreatePersonaSubmitting(true);
                          setCreatePersonaError(null);
                          try {
                            if (personaModalMode === "create") {
                              if (!createPersonaPortrait) return;
                              const result = await createWorkspaceVideoPersona(
                                token,
                                assistant.workspaceId,
                                {
                                  displayName: createPersonaName.trim(),
                                  videoFormat: resolvedPersonaVideoFormat,
                                  heygenVoiceId: personaFallbackVoiceId,
                                  clonedVoiceId: createPersonaClonedVoiceId,
                                  portrait: createPersonaPortrait
                                }
                              );
                              closePersonaModal();
                              if (result.storageWarning === "persona_created_storage_failed") {
                                setPersonaFb({
                                  type: "warn",
                                  text: t("charactersWarnStorageFailedMessage", {
                                    name: createPersonaName.trim()
                                  })
                                });
                              } else {
                                setPersonaFb({
                                  type: "ok",
                                  text: t("charactersCreateSuccess")
                                });
                              }
                            } else {
                              if (!editingPersonaId) return;
                              await updateWorkspaceVideoPersona(
                                token,
                                assistant.workspaceId,
                                editingPersonaId,
                                {
                                  displayName: createPersonaName.trim(),
                                  videoFormat: resolvedPersonaVideoFormat,
                                  heygenVoiceId: personaFallbackVoiceId,
                                  clonedVoiceId: createPersonaClonedVoiceId
                                }
                              );
                              closePersonaModal();
                              setPersonaFb({
                                type: "ok",
                                text: t("charactersEditSuccess")
                              });
                            }
                            void loadPersonas();
                          } catch (err) {
                            const code = err instanceof ApiStructuredError ? err.code : null;
                            setCreatePersonaError(
                              code === "persona_duplicate_name"
                                ? t("charactersErrorDuplicateName")
                                : code === "voice_not_found"
                                  ? t("charactersErrorVoiceNotFound")
                                  : code === "heygen_unavailable"
                                    ? t("charactersErrorHeygenUnavailable")
                                    : code === "heygen_avatar_create_failed"
                                      ? t("charactersErrorHeygenAvatarCreateFailed")
                                      : code === "persona_limit_reached"
                                        ? t("charactersErrorPersonaLimitReached")
                                        : code === "vcoin_balance_exhausted"
                                          ? t("charactersErrorInsufficientBalance")
                                          : t("charactersErrorGeneric")
                            );
                          } finally {
                            setCreatePersonaSubmitting(false);
                          }
                        }}
                        className={cn(
                          userPillButtonClassName("primary", "min-h-9 px-4"),
                          (createPersonaSubmitting ||
                            createPersonaName.trim().length === 0 ||
                            !personaFallbackVoiceId ||
                            (personaModalMode === "create" &&
                              (!createPersonaPortrait ||
                                (data.plan?.workspaceVcoinBalance?.balanceVc ?? 0) <
                                  personaCreationVcoinCost))) &&
                            "cursor-not-allowed opacity-50"
                        )}
                      >
                        {createPersonaSubmitting ? (
                          <span className="flex items-center gap-1.5">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {personaModalMode === "edit"
                              ? t("charactersFormSubmittingEdit")
                              : t("charactersFormSubmitting")}
                          </span>
                        ) : personaModalMode === "edit" ? (
                          t("charactersFormSubmitEdit")
                        ) : (
                          t("charactersFormSubmit")
                        )}
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )}

            {createClonedVoiceOpen &&
              typeof document !== "undefined" &&
              createPortal(
                <div
                  className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm"
                  onClick={(event) => {
                    if (event.target === event.currentTarget) {
                      closeClonedVoiceModal();
                    }
                  }}
                  role="dialog"
                  aria-modal="true"
                >
                  <div className="relative mx-4 my-10 w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-xl">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="text-sm font-semibold text-text">{t("voicesCreateTitle")}</h2>
                      <button
                        type="button"
                        onClick={closeClonedVoiceModal}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                        aria-label={t("charactersCancel")}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mt-4">
                      <label className="mb-1 block text-xs font-semibold text-text">
                        {t("voicesFormName")}
                      </label>
                      <input
                        type="text"
                        maxLength={60}
                        value={createClonedVoiceName}
                        onChange={(event) => setCreateClonedVoiceName(event.target.value)}
                        placeholder={t("voicesFormNamePlaceholder")}
                        className={userFieldClassName()}
                      />
                    </div>

                    <div className="mt-4 grid w-full grid-cols-2 rounded-full border border-border/60 bg-surface-raised/20 p-1">
                      {(["upload", "record"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            cancelClonedVoiceRecordingAttempt();
                            setCreateClonedVoiceRecordingState("idle");
                            setCreateClonedVoiceRecordingSeconds(0);
                            setCreateClonedVoiceMode(mode);
                            setCreateClonedVoiceMicError(null);
                          }}
                          className={cn(
                            "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                            createClonedVoiceMode === mode
                              ? "bg-accent/15 text-text"
                              : "text-text-subtle hover:text-text"
                          )}
                        >
                          {mode === "upload" ? t("voicesModeUpload") : t("voicesModeRecord")}
                        </button>
                      ))}
                    </div>

                    {createClonedVoiceMode === "upload" ? (
                      <div className="mt-4">
                        <div
                          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border/60 bg-surface-raised/30 py-5 transition-colors hover:border-border"
                          onClick={() =>
                            (
                              document.getElementById(
                                "voice-clone-audio-input"
                              ) as HTMLInputElement | null
                            )?.click()
                          }
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            const file = event.dataTransfer.files?.[0];
                            if (file) handleClonedVoiceAudioFile(file);
                          }}
                        >
                          <Upload className="mb-1 h-5 w-5 text-text-subtle" />
                          <p className="text-xs text-text-subtle">{t("voicesFormAudioDrop")}</p>
                          <p className="mt-0.5 max-w-[28rem] text-center text-[10px] text-text-subtle/70">
                            {t("voicesFormAudioHint")}
                          </p>
                        </div>
                        <input
                          id="voice-clone-audio-input"
                          type="file"
                          accept="audio/mpeg,audio/wav,audio/wave,audio/x-wav,.mp3,.wav"
                          className="sr-only"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) handleClonedVoiceAudioFile(file);
                          }}
                        />
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl border border-border/60 bg-surface-raised/20 p-3">
                        <p className="text-xs font-medium text-text">
                          {t("voicesRecordPromptTitle")}
                        </p>
                        <ul className="mt-2 space-y-1.5 text-xs leading-5 text-text-muted">
                          <li>{t("voicesRecordInstructionOne")}</li>
                          <li>{t("voicesRecordInstructionTwo")}</li>
                          <li>{t("voicesRecordInstructionThree")}</li>
                          <li>{t("voicesRecordInstructionFour")}</li>
                        </ul>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {createClonedVoiceRecordingState === "recording" ? (
                            <button
                              type="button"
                              onClick={stopClonedVoiceRecording}
                              className={userPillButtonClassName("primary")}
                            >
                              {t("voicesRecordStop", {
                                duration: formatDuration(createClonedVoiceRecordingSeconds)
                              })}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void startClonedVoiceRecording()}
                              className={userPillButtonClassName("secondary")}
                            >
                              <Mic className="h-4 w-4" />
                              {createClonedVoiceAudio
                                ? t("voicesRecordRetry")
                                : t("voicesRecordStart")}
                            </button>
                          )}
                          {createClonedVoiceAudio ? (
                            <button
                              type="button"
                              onClick={() => {
                                setClonedVoiceAudioFile(null);
                                setCreateClonedVoiceMicError(null);
                              }}
                              className={userPillButtonClassName(
                                "secondary",
                                "min-h-9 px-3 text-xs"
                              )}
                            >
                              {t("voicesRecordClear")}
                            </button>
                          ) : null}
                        </div>
                        {createClonedVoiceMicError ? (
                          <p className="mt-2 text-xs text-text-muted">
                            {createClonedVoiceMicError}
                          </p>
                        ) : null}
                      </div>
                    )}

                    {createClonedVoiceAudioPreviewUrl ? (
                      <div className="mt-4 rounded-xl border border-border/60 bg-surface-raised/20 p-3">
                        <p className="text-xs font-medium text-text">{t("voicesPreviewTitle")}</p>
                        <audio
                          controls
                          className="mt-2 w-full"
                          src={createClonedVoiceAudioPreviewUrl}
                        />
                      </div>
                    ) : null}

                    <label className="mt-4 flex items-start gap-2 rounded-xl border border-border/60 bg-surface-raised/20 p-3 text-xs text-text-muted">
                      <input
                        type="checkbox"
                        checked={createClonedVoiceRightsConfirmed}
                        onChange={(event) =>
                          setCreateClonedVoiceRightsConfirmed(event.target.checked)
                        }
                        className="mt-0.5"
                      />
                      <span>{t("voicesRightsConfirmation")}</span>
                    </label>

                    <div className="mt-4 rounded-xl border border-border/50 bg-surface-raised/30 px-3 py-2 text-xs text-text-muted">
                      {t("voicesCostSummary", {
                        n: clonedVoiceCreationVcoinCost,
                        m: data.plan?.workspaceVcoinBalance?.balanceVc ?? 0,
                        limit: clonedVoiceLimit
                      })}
                      {(data.plan?.workspaceVcoinBalance?.balanceVc ?? 0) <
                      clonedVoiceCreationVcoinCost ? (
                        <div className="mt-1">
                          <button
                            type="button"
                            onClick={() => {
                              closeClonedVoiceModal();
                              onOpenPackagesPage?.();
                            }}
                            className="text-sm font-medium text-accent underline underline-offset-2"
                          >
                            {t("voicesErrorInsufficientBalance")}
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {createClonedVoiceError ? (
                      <p className="mt-3 text-xs text-destructive">{createClonedVoiceError}</p>
                    ) : null}

                    <div className="mt-4 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={closeClonedVoiceModal}
                        className={userPillButtonClassName("secondary")}
                      >
                        {t("charactersCancel")}
                      </button>
                      <button
                        type="button"
                        disabled={
                          createClonedVoiceSubmitting ||
                          createClonedVoiceName.trim().length === 0 ||
                          createClonedVoiceAudio === null ||
                          !createClonedVoiceRightsConfirmed ||
                          (data.plan?.workspaceVcoinBalance?.balanceVc ?? 0) <
                            clonedVoiceCreationVcoinCost
                        }
                        onClick={() => void submitClonedVoice()}
                        className={cn(
                          userPillButtonClassName("primary"),
                          (createClonedVoiceSubmitting ||
                            createClonedVoiceName.trim().length === 0 ||
                            createClonedVoiceAudio === null ||
                            !createClonedVoiceRightsConfirmed ||
                            (data.plan?.workspaceVcoinBalance?.balanceVc ?? 0) <
                              clonedVoiceCreationVcoinCost) &&
                            "cursor-not-allowed opacity-50"
                        )}
                      >
                        {createClonedVoiceSubmitting ? t("voicesSubmitting") : t("voicesSubmit")}
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )}
          </div>
        </Section>

        {/* 6. Limits & Plan */}
        <Section
          icon={<BarChart3 className="h-4 w-4" />}
          title={t("limitsAndPlan")}
          open={openSection === "limits"}
          onToggle={() => setOpenSection((current) => (current === "limits" ? null : "limits"))}
          className="order-2"
        >
          {data.plan ? (
            <div className="space-y-3">
              <div className="px-1 py-1">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-xl font-semibold tracking-[-0.02em] text-text">
                      {data.plan.effectivePlan.displayName ??
                        data.plan.effectivePlan.code ??
                        t("freePlan")}
                    </p>
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      {shouldShowBillingSettingsEntry ? (
                        <button
                          type="button"
                          onClick={() => void openBillingSettings()}
                          className={userPillButtonClassName(
                            paymentSettingsShouldBePrimary ? "primary" : "secondary",
                            undefined
                          )}
                        >
                          {t("paymentSettings")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onOpenPricingPage?.()}
                          className={userPillButtonClassName("secondary", "min-h-10 px-4")}
                        >
                          {t("changePlan")}
                        </button>
                      )}
                    </div>
                  </div>
                  {!tokenBucket && billingSummary.dateKey ? (
                    <p className="mt-1 text-[11px] text-text-muted">
                      {billingSummary.dateLabel
                        ? t(billingSummary.dateKey, { date: billingSummary.dateLabel })
                        : t(billingSummary.dateKey)}
                    </p>
                  ) : null}
                  {billingIssueInlineLabel ? (
                    <p className="mt-1.5 text-[11px] font-medium text-[#b65c4a]">
                      {billingIssueInlineLabel}
                    </p>
                  ) : null}
                </div>

                {tokenBucket && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-text">
                        {quotaBucketLabels[tokenBucket.bucketCode] ?? tokenBucket.displayName}
                      </span>
                      <span className="shrink-0 text-xs text-text-muted">
                        {tokenBucket.percent !== null && tokenBucket.percent !== undefined
                          ? t("tokenPercentCompact", { pct: tokenBucket.percent })
                          : tokenBucket.usageAvailable
                            ? "—"
                            : t("usageUnavailable")}
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-raised/80">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          !tokenBucket.usageAvailable
                            ? "bg-text-subtle/60"
                            : (tokenBucket.percent ?? 0) >= 90
                              ? "bg-destructive"
                              : "bg-accent"
                        )}
                        style={{ width: `${Math.min(tokenBucket.percent ?? 0, 100)}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="truncate text-[11px] text-text-muted">
                        {billingSummary.dateKey
                          ? billingSummary.dateLabel
                            ? t(billingSummary.dateKey, { date: billingSummary.dateLabel })
                            : t(billingSummary.dateKey)
                          : ""}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-text-subtle">
                        {formatQuotaBucketValue(tokenBucket)}
                      </span>
                    </div>
                  </div>
                )}

                {orderedMonthlyMediaCards.length > 0 ? (
                  <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {orderedMonthlyMediaCards.map((card) => (
                      <LimitMetricCard
                        key={card.toolCode}
                        toolCode={card.toolCode}
                        label={card.label}
                        value={card.value}
                        secondary={card.secondary}
                        hasBonus={card.hasBonus}
                        unavailable={card.unavailable}
                        {...(card.onBuyClick
                          ? { buyChipLabel: card.buyChipLabel, onBuyClick: card.onBuyClick }
                          : {})}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="border-t border-border/45 pt-3">
                <button
                  type="button"
                  onClick={() => setToolLimitsExpanded((value) => !value)}
                  className="group flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-3 text-left transition-colors hover:bg-surface-hover/40"
                  aria-expanded={toolLimitsExpanded}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-text">{t("toolLimits")}</p>
                    <p className="mt-0.5 text-[11px] text-text-subtle">
                      {t("toolLimitsCount", { count: activeToolCount })}
                    </p>
                  </div>
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/50 bg-surface-raised/50 text-text-subtle transition-all group-hover:border-border/70 group-hover:bg-surface-raised/80 group-hover:text-text">
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 transition-transform",
                        toolLimitsExpanded && "rotate-90"
                      )}
                    />
                  </span>
                </button>
                {toolLimitsExpanded && (
                  <div className="mt-1 border-t border-border/45 px-2 py-3">
                    {documentMonthlyCard !== null || compactQuotaBuckets.length > 0 ? (
                      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {documentMonthlyCard !== null ? (
                          <LimitMetricCard
                            key={documentMonthlyCard.toolCode}
                            label={documentMonthlyCard.label}
                            value={documentMonthlyCard.value}
                            secondary={documentMonthlyCard.secondary}
                            hasBonus={documentMonthlyCard.hasBonus}
                            unavailable={documentMonthlyCard.unavailable}
                            {...(documentMonthlyCard.onBuyClick
                              ? {
                                  buyChipLabel: documentMonthlyCard.buyChipLabel,
                                  onBuyClick: documentMonthlyCard.onBuyClick
                                }
                              : {})}
                          />
                        ) : null}
                        {compactQuotaBuckets.map((bucket) => (
                          <LimitMetricCard
                            key={bucket.bucketCode}
                            label={quotaBucketLabels[bucket.bucketCode] ?? bucket.displayName}
                            value={formatQuotaBucketValue(bucket)}
                            secondary={
                              bucket.percent === null
                                ? null
                                : t("tokenPercentCompact", { pct: bucket.percent })
                            }
                          />
                        ))}
                      </div>
                    ) : null}
                    {allToolDailyLimits.length === 0 ? (
                      <p className="text-[11px] text-text-subtle">{t("noToolLimits")}</p>
                    ) : (
                      <ul className="space-y-2">
                        {allToolDailyLimits.map((tool) => (
                          <ToolLimitRow
                            key={tool.toolCode}
                            label={toolLimitLabels[tool.toolCode] ?? tool.displayName}
                            tool={tool}
                            t={t}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-text-subtle">{t("planUnavailable")}</p>
          )}
        </Section>

        {billingSettingsOpen
          ? createPortal(
              <div
                className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm sm:items-center sm:p-6"
                onClick={() => {
                  setBillingSettingsOpen(false);
                  setDisableAutoRenewConfirmOpen(false);
                }}
              >
                <div
                  className="w-full max-w-lg overflow-hidden rounded-[28px] border border-white/10 bg-[color:var(--surface)] shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="border-b border-border/70 px-5 py-4 sm:px-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-subtle">
                          {t("paymentSettingsEyebrow")}
                        </p>
                        <h3 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-text">
                          {t("paymentSettings")}
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setBillingSettingsOpen(false);
                          setDisableAutoRenewConfirmOpen(false);
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/80 bg-surface-raised/60 text-text-muted transition-colors hover:text-text"
                        aria-label={t("closeBillingSettings")}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-4 px-5 py-5 sm:px-6">
                    {billingSubscriptionLoading ? (
                      <div className="flex items-center gap-2 rounded-2xl border border-border/80 bg-surface-raised/40 px-4 py-4 text-sm text-text-muted">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{t("billingSettingsLoading")}</span>
                      </div>
                    ) : (
                      <>
                        <div className="rounded-[24px] border border-border/70 bg-gradient-to-b from-surface-raised/70 to-surface-raised/30 p-4 sm:p-5">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xl font-semibold tracking-[-0.02em] text-text">
                              {billingPlanLabel}
                            </p>
                            <div className="flex flex-wrap justify-end gap-2">
                              {graceBadgeActive ? (
                                <span className="rounded-full border border-warning/35 bg-warning/10 px-3 py-1 text-[11px] font-medium text-warning shadow-sm">
                                  {billingStatusChipLabel}
                                </span>
                              ) : null}
                              {!graceBadgeActive ? (
                                <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-medium text-text shadow-sm">
                                  {billingStatusChipLabel}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-4">
                            <div className="min-w-[140px] px-1 py-1">
                              <p className="text-[10px] uppercase tracking-[0.14em] text-text-subtle">
                                {t("billingAutoRenew")}
                              </p>
                              <p className="mt-1 text-sm font-medium text-text">
                                {billingAutoRenewLabel}
                              </p>
                            </div>
                            <div className="min-w-[140px] px-1 py-1">
                              <p className="text-[10px] uppercase tracking-[0.14em] text-text-subtle">
                                {billingDateHeadingLabel}
                              </p>
                              <p className="mt-1 text-sm font-medium text-text">
                                {billingDateValueLabel}
                              </p>
                            </div>
                          </div>
                          <div className="mt-4 overflow-hidden rounded-2xl border border-border/70 bg-background/45">
                            <div className="px-4 py-3">
                              <p className="text-[11px] uppercase tracking-[0.14em] text-text-subtle">
                                {t("billingLastPaymentMethod")}
                              </p>
                              <div className="mt-1 flex items-center gap-2 text-text">
                                <CreditCard className="h-4 w-4 shrink-0 text-text-muted" />
                                <span className="text-sm font-medium">
                                  {billingLastPaymentMethodValue}
                                </span>
                              </div>
                            </div>
                            <div className="border-t border-border/70 px-4 py-3">
                              <p className="text-[11px] uppercase tracking-[0.14em] text-text-subtle">
                                {t("billingAutoRenewPaymentMethod")}
                              </p>
                              <div className="mt-1 flex items-center gap-2 text-text">
                                <CreditCard className="h-4 w-4 shrink-0 text-text-muted" />
                                <span className="text-sm font-medium">
                                  {billingAutoRenewPaymentMethodValue}
                                </span>
                              </div>
                            </div>
                          </div>
                          <p className="mt-3 px-1 text-xs leading-5 text-text-subtle">
                            {billingPlanTransitionHint}
                          </p>
                        </div>
                        <div className="grid gap-2">
                          <button
                            type="button"
                            onClick={() => onOpenPricingPage?.()}
                            className={userPillButtonClassName("secondary", "w-full")}
                          >
                            {t("changePlan")}
                          </button>
                          {billingSubscription?.managePaymentMethodUrl ? (
                            <button
                              type="button"
                              onClick={handleManagePaymentMethod}
                              className={userPillButtonClassName("secondary", "w-full")}
                            >
                              <span>{t("billingManagePaymentMethod")}</span>
                              <ExternalLink className="h-4 w-4" />
                            </button>
                          ) : null}
                          {billingSubscription?.canEnableAutoRenew ? (
                            <button
                              type="button"
                              onClick={() => void handleEnableAutoRenew()}
                              disabled={enableAutoRenewPending}
                              className={cn(
                                userPillButtonClassName("primary", "w-full"),
                                "disabled:cursor-not-allowed disabled:opacity-50"
                              )}
                            >
                              {enableAutoRenewPending ? (
                                <span className="inline-flex items-center gap-2">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  {t("billingEnabling")}
                                </span>
                              ) : scheduledFreeChangePending ? (
                                t("billingRestoreSubscription")
                              ) : (
                                t("billingEnableAutoRenew")
                              )}
                            </button>
                          ) : null}
                          {billingSubscription?.canDisableAutoRenew ? (
                            <button
                              type="button"
                              onClick={() => {
                                setDisableAutoRenewConfirmOpen(true);
                                setBillingSubscriptionFb(null);
                              }}
                              disabled={
                                disableAutoRenewPending || !billingSubscription.autoRenewEnabled
                              }
                              className="inline-flex min-h-8 items-center justify-center self-center px-2 text-sm font-medium text-text-subtle transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {disableAutoRenewPending ? (
                                <span className="inline-flex items-center gap-2">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  {t("billingDisabling")}
                                </span>
                              ) : (
                                t("billingDisableAutoRenew")
                              )}
                            </button>
                          ) : null}
                        </div>
                        {disableAutoRenewConfirmOpen ? (
                          <div className="space-y-3 rounded-2xl border border-border/80 bg-surface-raised/40 p-4">
                            <p className="text-sm font-medium text-text">
                              {t("billingDisableAutoRenewConfirm")}
                            </p>
                            <p className="text-xs text-text-muted">
                              {t("billingDisableAutoRenewConfirmHelp")}
                            </p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <button
                                type="button"
                                onClick={() => setDisableAutoRenewConfirmOpen(false)}
                                className={userPillButtonClassName(
                                  "secondary",
                                  "border-accent/18 bg-accent/8 hover:bg-accent/12"
                                )}
                              >
                                {t("billingConfirmCancel")}
                              </button>
                              <button
                                type="button"
                                onClick={() => void confirmDisableAutoRenew()}
                                disabled={disableAutoRenewPending}
                                className={userPillButtonClassName(
                                  "secondary",
                                  "gap-2 border-border/60 bg-surface-raised/52 text-text-subtle hover:text-text"
                                )}
                              >
                                {disableAutoRenewPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : null}
                                {t("billingConfirmDisableAutoRenew")}
                              </button>
                            </div>
                          </div>
                        ) : null}
                        <FeedbackLine fb={billingSubscriptionFb} />
                      </>
                    )}
                  </div>
                </div>
              </div>,
              document.body
            )
          : null}
      </div>
      <AssistantSwitcherModal
        open={assistantSwitcherOpen}
        assistants={data.assistants}
        activeAssistantId={data.activeAssistantId}
        assistantLimit={data.assistantLimit}
        switchBusyId={assistantSwitchBusyId}
        createBusy={assistantCreateBusy}
        error={assistantSwitcherError}
        onClose={() => setAssistantSwitcherOpen(false)}
        onSwitch={handleSwitchAssistant}
        onCreate={hasAssistantSwitcher ? handleCreateAssistant : null}
      />
      <BrowserLoginModal
        open={settingsBrowserLogin !== null}
        assistantId={assistant?.id}
        pendingBrowserLogin={settingsBrowserLogin}
        onDismiss={() => setSettingsBrowserLogin(null)}
        onCancel={() => setSettingsBrowserLogin(null)}
        onCompleted={() => {
          setSettingsBrowserLogin(null);
          void refreshBrowserProfiles();
        }}
      />
    </>
  );
}

const STATUS_LABELS: Record<string, { label: string; dot: string }> = {
  live: { label: "Live", dot: "bg-success" },
  applying: { label: "Applying...", dot: "bg-warning" },
  draft: { label: "Draft", dot: "bg-text-subtle" },
  failed: { label: "Failed", dot: "bg-destructive" },
  degraded: { label: "Degraded", dot: "bg-warning" },
  none: { label: "Not created", dot: "bg-text-subtle" }
};

function BrowserSiteCard({
  profile,
  busy,
  onDelete,
  onOpen
}: {
  profile: AssistantBrowserProfileListItem;
  busy?: boolean;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const t = useTranslations("settings");
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(profile.originHost)}&sz=64`;
  const statusLabel =
    profile.status === "expired"
      ? t("browserProfileStatusExpired")
      : profile.status === "pending_login"
        ? t("browserProfileStatusPending")
        : null;
  const statusDot =
    profile.status === "active"
      ? "bg-success"
      : profile.status === "expired"
        ? "bg-destructive"
        : "bg-warning";

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={busy}
      className={cn(
        "group flex w-full rounded-2xl border px-3.5 py-3 text-left transition-all",
        profile.status === "active"
          ? "border-accent/25 bg-accent/[0.07]"
          : "border-border/60 bg-background/50",
        "cursor-pointer hover:-translate-y-[1px] hover:border-accent/30",
        busy && "opacity-70"
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <img src={faviconUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl object-contain" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text">{profile.displayName}</p>
          <p className="mt-0.5 truncate text-xs text-text-subtle">{profile.originHost}</p>
          {statusLabel !== null ? (
            <p
              className={cn(
                "mt-0.5 text-xs",
                profile.status === "expired" ? "text-destructive" : "text-text-subtle"
              )}
            >
              {statusLabel}
            </p>
          ) : null}
          <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-text-subtle transition-colors group-hover:text-text">
            {profile.status === "active"
              ? t("browserProfileOpenView")
              : t("browserProfileReconnect")}
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
      <div className="ml-3 flex w-7 shrink-0 flex-col items-center justify-between self-stretch py-0.5">
        <span className={cn("inline-block h-2.5 w-2.5 rounded-full", statusDot)} />
        <span
          role="button"
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onDelete();
            }
          }}
          aria-label={t("browserProfileDelete")}
          aria-disabled={busy}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/70 bg-background/80 text-text-muted transition hover:border-destructive/30 hover:text-destructive aria-disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </span>
      </div>
    </button>
  );
}

function IntegrationCard({
  name,
  logoSrc,
  statusLabel,
  active,
  comingSoon,
  onClick
}: {
  name: string;
  logoSrc: string;
  statusLabel: string;
  active?: boolean;
  comingSoon?: boolean;
  onClick?: (() => void) | undefined;
}) {
  const t = useTranslations("settings");
  const interactive = Boolean(onClick) && !comingSoon;
  const Comp = interactive ? "button" : "div";
  return (
    <Comp
      type={interactive ? "button" : undefined}
      onClick={interactive ? onClick : undefined}
      className={cn(
        "group flex rounded-2xl border px-3.5 py-3 text-left transition-all",
        active
          ? "border-accent/25 bg-accent/[0.07] shadow-[0_12px_24px_-20px_rgba(29,161,242,0.28)] hover:border-accent/40 hover:bg-accent/[0.1]"
          : "border-border/60 bg-background/50",
        comingSoon && "opacity-55",
        interactive && "cursor-pointer hover:-translate-y-[1px]"
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <img src={logoSrc} alt="" className="h-10 w-10 shrink-0 rounded-xl object-contain" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-text">{name}</p>
            <span
              className={cn(
                "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
                active ? "bg-success" : "bg-text-subtle/55"
              )}
            />
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <p
              className={cn(
                "min-w-0 flex-1 truncate text-xs",
                active ? "text-success" : "text-text-subtle"
              )}
            >
              {comingSoon ? t("channelComingSoon") : statusLabel}
            </p>
            {interactive ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-text-subtle transition-colors group-hover:text-text">
                {t("openIntegration")}
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Comp>
  );
}

function LimitMetricCard({
  toolCode,
  label,
  value,
  secondary,
  hasBonus,
  unavailable,
  buyChipLabel,
  onBuyClick
}: {
  toolCode?: string;
  label: React.ReactNode;
  value: string;
  secondary?: string | null;
  hasBonus?: boolean;
  unavailable?: boolean;
  buyChipLabel?: string | null;
  onBuyClick?: () => void;
}) {
  const interactive = typeof onBuyClick === "function";
  const Comp = interactive ? "button" : "div";
  const showChip = interactive && typeof buyChipLabel === "string" && buyChipLabel.length > 0;
  const watermark =
    toolCode === "image_edit"
      ? {
          icon: ImageIcon,
          className: "right-7 top-6 h-14 w-14 rotate-[-12deg] sm:right-6 sm:top-7 sm:h-16 sm:w-16"
        }
      : toolCode === "image_generate"
        ? {
            icon: Sparkles,
            className: "right-8 top-6 h-12 w-12 rotate-[8deg] sm:right-7 sm:top-7 sm:h-14 sm:w-14"
          }
        : toolCode === "video_generate"
          ? {
              icon: Clapperboard,
              className:
                "right-6 top-6 h-14 w-14 rotate-[-8deg] sm:right-5 sm:top-7 sm:h-16 sm:w-16"
            }
          : toolCode === "document"
            ? {
                icon: Files,
                className:
                  "right-6 top-6 h-14 w-14 rotate-[-7deg] sm:right-5 sm:top-7 sm:h-16 sm:w-16"
              }
            : null;
  const WatermarkIcon = watermark?.icon ?? null;

  return (
    <Comp
      type={interactive ? "button" : undefined}
      onClick={onBuyClick}
      className={cn(
        // Responsive layout:
        // - Mobile (<sm): compact single-row card — title+value+secondary
        //   on the left, chip pinned to the right. Auto-height so the cards
        //   feel dense rather than tall/empty when stacked vertically.
        // - Desktop (sm+): keep the 3-slot vertical layout (header / value+
        //   secondary / chip-slot) so a row of 3 sibling cards stays
        //   visually aligned regardless of which slots are populated.
        "group relative flex h-full overflow-hidden rounded-xl border bg-surface-raised/50 p-2.5 text-left transition-colors",
        "flex-row items-center gap-3",
        "sm:min-h-[6.25rem] sm:flex-col sm:items-stretch sm:gap-0",
        hasBonus
          ? "border-accent/30 bg-surface-raised/62"
          : unavailable
            ? "border-border/60 bg-surface-raised/34"
            : "border-border/75",
        interactive &&
          "cursor-pointer hover:border-accent/28 hover:bg-surface-raised/68 focus:outline-none focus:ring-2 focus:ring-accent/30"
      )}
    >
      {WatermarkIcon ? (
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute opacity-[0.11] text-text-subtle/95 transition-all duration-200 ease-out",
            "drop-shadow-[0_1px_0_rgba(255,255,255,0.28)] group-hover:opacity-[0.2] group-hover:text-accent/75",
            watermark?.className
          )}
        >
          <WatermarkIcon strokeWidth={1.7} className="h-full w-full" />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[10px] font-medium uppercase leading-4 tracking-[0.12em] sm:min-h-[2rem]",
            unavailable ? "text-text/80" : "text-text"
          )}
        >
          {label}
        </p>
        <div className="mt-1 sm:mt-3">
          <p
            className={cn(
              "text-xs font-semibold tabular-nums",
              unavailable ? "text-text-muted" : "text-text"
            )}
          >
            {value}
          </p>
          {secondary ? <p className="mt-0.5 text-[10px] text-text-subtle">{secondary}</p> : null}
        </div>
      </div>
      <div
        className={cn(
          "shrink-0 self-center",
          "sm:mt-auto sm:flex sm:h-[1.25rem] sm:items-end sm:justify-end sm:self-auto sm:pt-3"
        )}
      >
        {showChip ? (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-medium tracking-[0.02em] transition-colors",
              hasBonus
                ? "border-accent/30 bg-accent/[0.06] text-accent/80 group-hover:bg-accent/10 group-hover:text-accent"
                : "border-border/70 bg-bg/50 text-text-subtle group-hover:border-accent/30 group-hover:bg-accent/[0.06] group-hover:text-accent"
            )}
          >
            {buyChipLabel}
          </span>
        ) : null}
      </div>
    </Comp>
  );
}

function ToolLimitRow({
  label,
  tool,
  t
}: {
  label: string;
  tool: ToolDailyLimitState;
  t: ReturnType<typeof useTranslations<"settings">>;
}) {
  const valueLabel =
    tool.active && tool.dailyCallLimit !== null
      ? `${tool.dailyCallsUsed}/${tool.dailyCallLimit}`
      : tool.active
        ? t("toolStatusEnabled")
        : t("toolStatusDisabled");

  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-xl border border-border/70 px-3 py-3",
        tool.active ? "bg-surface/70" : "bg-surface/30"
      )}
    >
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
          !tool.active
            ? "bg-text-subtle/50"
            : tool.dailyCallLimit !== null && tool.dailyCallsUsed >= tool.dailyCallLimit
              ? "bg-destructive"
              : "bg-accent"
        )}
      />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span className={cn("truncate text-[11px]", tool.active ? "text-text" : "text-text-muted")}>
          {label}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-text-subtle">{valueLabel}</span>
      </div>
    </li>
  );
}
