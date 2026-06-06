"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
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
  UserCircle2
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
  getAssistantSkills,
  updateAssistantSkillAssignments,
  patchAssistantNotificationPreference,
  getAssistantMemoryItems,
  type AssistantVoiceSettingsState,
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
  getWorkspaceVoiceCatalog,
  createWorkspaceVideoPersona,
  deleteWorkspaceVideoPersona,
  ApiStructuredError,
  type PersonaListItemDto,
  type VoiceCatalogEntry
} from "../assistant-api-client";
import { AssistantAvatar } from "./assistant-avatar";
import { VoicePreviewButton } from "../../_components/voice-preview-button";
import { AssistantSupportSection } from "./assistant-support-section";
import { resolveBillingSummaryCopy } from "./billing-summary";
import {
  filterVoiceOptions,
  findVoiceOption,
  OPENAI_VOICE_OPTIONS,
  resolveDefaultOpenAiVoiceOption,
  resolveDefaultYandexVoiceOption,
  YANDEX_VOICE_OPTIONS,
  type VoiceOption
} from "./assistant-voice-options";
import {
  ASSISTANT_AVATAR_PRESETS,
  findAssistantAvatarPresetByUrl
} from "./assistant-avatar-presets";
import { AssistantKnowledgeManager } from "./assistant-knowledge-manager";
import { AssistantFilesManager } from "./assistant-files-manager";
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
type PersonaVoiceLanguageFilter = "ru" | "en" | "other";
type PersonaLightboxState = { src: string; name: string } | null;

const CHARACTERS_PRICING_URL = "https://persai.dev/app/pricing";
const DEMO_PERSONA_PORTRAIT_URL = "/landing/demo-persona-portrait.png";

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
    case "memory":
    case "tasks":
    case "channels":
    case "support":
    case "limits":
    case "character":
    case "characters":
      return value;
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

function isPaidRecurringSubscription(
  subscription: AssistantBillingSubscriptionManagementState | null
): boolean {
  if (
    subscription === null ||
    subscription.billingProvider !== "cloudpayments" ||
    subscription.providerSubscriptionRef === null
  ) {
    return false;
  }
  return ["active", "grace_period", "past_due", "paused", "canceled"].includes(
    subscription.subscriptionStatus
  );
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
          ? "text-success"
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
  className
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  busy: boolean;
  variant?: "default" | "primary" | "danger";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-50",
        variant === "danger"
          ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
          : variant === "primary"
            ? "bg-accent text-white shadow-sm shadow-accent/20 hover:bg-accent-hover"
            : "bg-surface-raised text-text-muted hover:bg-surface-hover hover:text-text",
        className
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </button>
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
  if (filter === "ru") {
    return (
      normalized === "ru" ||
      normalized.startsWith("ru-") ||
      normalized === "russian" ||
      normalized.startsWith("russian ")
    );
  }
  if (filter === "en") {
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
  const assistant = data.assistant;
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
  const billingSummary = resolveBillingSummaryCopy(data.plan?.effectivePlan, locale);
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
  const [avatarPreviewBlobUrl, setAvatarPreviewBlobUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetFb, setResetFb] = useState<ActionFeedback>(null);
  const [knowledgeManagerOpen, setKnowledgeManagerOpen] = useState(false);
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

  const [taskItems, setTaskItems] = useState<AssistantTaskRegistryItemState[]>([]);
  const [backgroundTaskItems, setBackgroundTaskItems] = useState<
    AssistantBackgroundTaskItemState[]
  >([]);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskActionId, setTaskActionId] = useState<string | null>(null);
  const [tasksFb, setTasksFb] = useState<ActionFeedback>(null);
  const [showUserTasks, setShowUserTasks] = useState(false);
  const [showAssistantActions, setShowAssistantActions] = useState(false);
  const [notificationChannel, setNotificationChannel] =
    useState<AssistantPreferredNotificationChannel>("web");
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationFb, setNotificationFb] = useState<ActionFeedback>(null);
  const [voiceSettings, setVoiceSettings] = useState<AssistantVoiceSettingsState | null>(null);
  const [voiceSettingsLoading, setVoiceSettingsLoading] = useState(false);
  const [voiceSettingsError, setVoiceSettingsError] = useState<string | null>(null);
  const [supportUnreadCount, setSupportUnreadCount] = useState(0);
  const [openSection, setOpenSection] = useState<SettingsSectionId | null>(() =>
    normalizeInitialSection(initialSection)
  );

  // ── Characters section state (ADR-109 Slice 9) ────────────────────────────
  const [personaList, setPersonaList] = useState<PersonaListItemDto[]>([]);
  const [personaLimit, setPersonaLimit] = useState<number>(3);
  const [personaCreationVcoinCost, setPersonaCreationVcoinCost] = useState<number>(0);
  const [personaListLoading, setPersonaListLoading] = useState(false);
  const [voiceCatalog, setVoiceCatalog] = useState<VoiceCatalogEntry[]>([]);
  const [voiceCatalogLoading, setVoiceCatalogLoading] = useState(false);
  const [voiceCatalogUnavailable, setVoiceCatalogUnavailable] = useState(false);
  const [voiceLanguageFilter, setVoiceLanguageFilter] = useState<PersonaVoiceLanguageFilter>(
    locale.toLowerCase().startsWith("ru") ? "ru" : "en"
  );
  const [otherVoiceLanguageSearch, setOtherVoiceLanguageSearch] = useState("");
  const [personaLightbox, setPersonaLightbox] = useState<PersonaLightboxState>(null);
  const [createPersonaOpen, setCreatePersonaOpen] = useState(false);
  const [createPersonaName, setCreatePersonaName] = useState("");
  const [createPersonaVoiceId, setCreatePersonaVoiceId] = useState<string | null>(null);
  const [createPersonaPortrait, setCreatePersonaPortrait] = useState<File | null>(null);
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
  const personaPortraitInputRef = useRef<HTMLInputElement>(null);

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
  const filteredVoiceCatalog = useMemo(() => {
    return voiceCatalog.filter((voice) => {
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
    });
  }, [otherVoiceLanguageSearch, voiceCatalog, voiceLanguageFilter]);
  const demoPersonaVoice = useMemo(() => {
    const preferredLanguage = locale.toLowerCase().startsWith("ru") ? "ru" : "en";
    return (
      voiceCatalog.find(
        (voice) =>
          normalizeVoiceLanguageBucket(voice.language) === preferredLanguage &&
          typeof voice.previewAudioUrl === "string" &&
          voice.previewAudioUrl.length > 0
      ) ??
      voiceCatalog.find(
        (voice) => typeof voice.previewAudioUrl === "string" && voice.previewAudioUrl.length > 0
      ) ??
      voiceCatalog.find(
        (voice) => normalizeVoiceLanguageBucket(voice.language) === preferredLanguage
      ) ??
      voiceCatalog[0] ??
      null
    );
  }, [voiceCatalog, locale]);

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
      void loadVoiceCatalog();
    }
  }, [openSection, loadPersonas, loadVoiceCatalog]);
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
  const shouldShowRecurringBillingControls = isPaidRecurringSubscription(billingSubscription);
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
  const billingAutoRenewLabel =
    billingSubscription !== null
      ? billingSubscription.autoRenewEnabled
        ? t("billingAutoRenewOn")
        : t("billingAutoRenewOff")
      : t("billingUnknownValue");
  const billingDateHeadingLabel =
    billingSubscription !== null
      ? billingSubscription.autoRenewEnabled &&
        ["active"].includes(billingSubscription.subscriptionStatus)
        ? t("billingNextCharge")
        : t("billingAccessUntil")
      : t("billingDateLabel");
  const billingDateValueLabel =
    billingSubscription !== null
      ? billingSubscription.autoRenewEnabled &&
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
  const billingSettingsDescription = shouldShowRecurringBillingControls
    ? t("paymentSettingsDescription")
    : t("paymentSettingsNonRecurringDescription");

  useEffect(() => {
    setOpenSection(normalizeInitialSection(initialSection));
  }, [initialSection]);

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
  const elevenLabsVoiceOptions = useMemo<VoiceOption<string>[]>(
    () =>
      (voiceSettings?.elevenlabs?.voices ?? []).map((voice) => ({
        value: voice.voiceId,
        label: formatElevenLabsVoiceLabel(voice.name, locale),
        gender: voice.gender
      })),
    [locale, voiceSettings]
  );
  const filteredElevenLabsVoiceOptions = useMemo(
    () => filterVoiceOptions(elevenLabsVoiceOptions, draftAssistantGender),
    [draftAssistantGender, elevenLabsVoiceOptions]
  );
  const selectedElevenLabsVoiceOption = findVoiceOption(
    elevenLabsVoiceOptions,
    draftVoiceProfile.elevenlabs.voiceId
  );
  const selectedElevenLabsVoiceAllowed = findVoiceOption(
    filteredElevenLabsVoiceOptions,
    draftVoiceProfile.elevenlabs.voiceId
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
  const elevenLabsSelectOptions = useMemo(
    () =>
      selectedElevenLabsVoiceOption !== null && selectedElevenLabsVoiceAllowed === null
        ? [
            {
              value: selectedElevenLabsVoiceOption.value,
              label: t("voiceSavedSelection", {
                name: selectedElevenLabsVoiceOption.label
              }),
              gender: selectedElevenLabsVoiceOption.gender
            },
            ...filteredElevenLabsVoiceOptions
          ]
        : filteredElevenLabsVoiceOptions,
    [
      filteredElevenLabsVoiceOptions,
      selectedElevenLabsVoiceAllowed,
      selectedElevenLabsVoiceOption,
      t
    ]
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

      const allowed = new Set(filteredElevenLabsVoiceOptions.map((option) => option.value));
      const nextVoiceId =
        prev.elevenlabs.voiceId !== null && allowed.has(prev.elevenlabs.voiceId)
          ? prev.elevenlabs.voiceId
          : null;
      if (nextVoiceId === prev.elevenlabs.voiceId) {
        return prev;
      }
      return {
        ...prev,
        elevenlabs: {
          voiceId: nextVoiceId
        }
      };
    });
  }, [
    draftAssistantGender,
    filteredElevenLabsVoiceOptions,
    openAiVoiceOptions,
    primaryVoiceProviderId,
    yandexVoiceOptions
  ]);

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
      setSaveFb({ type: "ok", text: t("saved") });
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
    setCreatePersonaPortraitPreview(url);
  }

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
            <div className="rounded-2xl border border-border/70 bg-surface p-4">
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
                    icon={<Rocket className="h-3.5 w-3.5" />}
                    label={t("save")}
                    onClick={() => void handleSaveAndApply()}
                    busy={saving}
                    variant="primary"
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
                <div className="mt-3 grid grid-cols-4 gap-1.5 rounded-[20px] border border-border/80 bg-surface/95 p-2 shadow-[0_14px_32px_rgba(0,0,0,0.16)] md:grid-cols-8 md:gap-2 md:p-2.5">
                  {ASSISTANT_AVATAR_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        setDraftAvatarUrl(preset.imagePath);
                        setAvatarPickerOpen(false);
                      }}
                      className={cn(
                        "flex aspect-square min-w-0 cursor-pointer items-center justify-center rounded-[15px] border bg-surface-raised/85 p-1 transition-all duration-200 shadow-[0_8px_18px_rgba(0,0,0,0.12)]",
                        findAssistantAvatarPresetByUrl(draftAvatarUrl)?.id === preset.id
                          ? "border-accent/70 bg-[linear-gradient(180deg,rgba(191,148,84,0.16),rgba(191,148,84,0.07))] ring-1 ring-accent/45 shadow-[0_0_0_1px_rgba(191,148,84,0.18),0_12px_24px_rgba(0,0,0,0.18)]"
                          : "border-border/70 hover:border-border-strong hover:bg-surface-hover hover:shadow-[0_10px_22px_rgba(0,0,0,0.16)]"
                      )}
                      aria-label={preset.label}
                    >
                      <img
                        src={preset.imagePath}
                        alt=""
                        className="h-full w-full rounded-[11px] object-cover"
                      />
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "flex aspect-square min-w-0 cursor-pointer items-center justify-center rounded-[15px] border border-dashed bg-surface-raised/70 p-1 transition-all duration-200 shadow-[0_8px_18px_rgba(0,0,0,0.12)]",
                      draftAvatarUrl && findAssistantAvatarPresetByUrl(draftAvatarUrl) === null
                        ? "border-accent/70 bg-[linear-gradient(180deg,rgba(191,148,84,0.16),rgba(191,148,84,0.07))] shadow-[0_0_0_1px_rgba(191,148,84,0.18),0_12px_24px_rgba(0,0,0,0.18)]"
                        : "border-border-strong text-text-subtle hover:bg-surface-hover hover:shadow-[0_10px_22px_rgba(0,0,0,0.16)]"
                    )}
                    title={t("uploadImage")}
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-[12px] border border-border/70 bg-surface text-text-subtle md:h-7 md:w-7">
                      <Upload className="h-4 w-4" />
                    </div>
                  </button>
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
          <FeedbackLine fb={saveFb} />

          {editingPersonality && (
            <div className="mt-4 rounded-2xl border border-border/70 bg-surface px-5 py-5">
              <div>
                <p className="text-sm font-medium text-text">{t("behaviorTitle")}</p>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">{t("behaviorHelp")}</p>
                <textarea
                  value={draftInstructions}
                  onChange={(e) => setDraftInstructions(e.target.value)}
                  placeholder={t("behaviorPlaceholder")}
                  rows={8}
                  className="mt-3 min-h-[240px] w-full resize-y rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
                />
              </div>

              <div className="mt-5 border-t border-border/70 pt-5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
                  {t("assistantGenderLabel")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {ASSISTANT_GENDER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDraftAssistantGender(opt.value)}
                      className={cn(
                        "min-h-[40px] min-w-[120px] rounded-xl border px-4 py-2 text-sm font-medium transition-colors",
                        draftAssistantGender === opt.value
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-border bg-surface-raised text-text-muted hover:border-border-strong hover:text-text"
                      )}
                    >
                      {tp(opt.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-text">{t("voice")}</span>
                  {primaryVoiceProviderId === "elevenlabs" && (
                    <select
                      value={draftVoiceProfile.elevenlabs.voiceId ?? ""}
                      onChange={(e) =>
                        setDraftVoiceProfile((prev) => ({
                          ...prev,
                          elevenlabs: {
                            voiceId: e.target.value === "" ? null : e.target.value
                          }
                        }))
                      }
                      disabled={
                        voiceSettingsLoading || voiceSettings?.elevenlabs?.loadState !== "ready"
                      }
                      className="persai-select w-full"
                    >
                      <option value="">
                        {voiceSettingsLoading ? t("voiceLoading") : t("voiceChooseBaseVoice")}
                      </option>
                      {elevenLabsSelectOptions.map((voice) => (
                        <option key={voice.value} value={voice.value}>
                          {voice.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {primaryVoiceProviderId === "yandex" && (
                    <select
                      value={draftVoiceProfile.yandex.voice ?? ""}
                      onChange={(e) =>
                        setDraftVoiceProfile((prev) => ({
                          ...prev,
                          yandex: {
                            ...prev.yandex,
                            voice:
                              e.target.value === ""
                                ? null
                                : (e.target.value as (typeof YANDEX_VOICE_OPTIONS)[number]["value"])
                          }
                        }))
                      }
                      className="persai-select w-full"
                    >
                      {yandexVoiceOptions.map((voice) => (
                        <option key={voice.value} value={voice.value}>
                          {voice.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {primaryVoiceProviderId === "openai" && (
                    <select
                      value={draftVoiceProfile.openai.voice ?? ""}
                      onChange={(e) =>
                        setDraftVoiceProfile((prev) => ({
                          ...prev,
                          openai: {
                            voice:
                              e.target.value === ""
                                ? null
                                : (e.target.value as (typeof OPENAI_VOICE_OPTIONS)[number]["value"])
                          }
                        }))
                      }
                      className="persai-select w-full"
                    >
                      {openAiVoiceOptions.map((voice) => (
                        <option key={voice.value} value={voice.value}>
                          {voice.label}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
                {voiceSettingsError && (
                  <p className="mt-2 text-xs text-destructive">{voiceSettingsError}</p>
                )}
              </div>

              <div className="mt-5 border-t border-border/70 pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-text">{t("traitControlsTitle")}</p>
                    <p className="mt-1 text-xs text-text-muted">{t("traitControlsHelp")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowTraitControls((open) => !open)}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface-raised px-3 py-2 text-xs font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    {showTraitControls ? t("hideTraitControls") : t("showTraitControls")}
                  </button>
                </div>

                {showTraitControls && (
                  <div className="mt-4 divide-y divide-border/60 rounded-xl border border-border/70 bg-surface-raised px-4">
                    {TRAIT_SLIDERS.map(({ key, labelLeftKey, labelRightKey }) => (
                      <div key={key} className="py-3">
                        <div className="mb-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[11px]">
                          <span className="truncate text-text-muted">{tp(labelLeftKey)}</span>
                          <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-text-subtle">
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

              <div className="mt-5 border-t border-border/70 pt-5">
                <div className="rounded-2xl border border-destructive/15 bg-destructive/5 px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text">{t("reset")}</p>
                      <p className="mt-1 text-xs leading-relaxed text-text-muted">
                        {t("resetScopeWarning")}
                      </p>
                    </div>
                    {!resetConfirm ? (
                      <button
                        type="button"
                        onClick={() => setResetConfirm(true)}
                        className="inline-flex min-h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-destructive/20 bg-background/40 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                        {t("reset")}
                      </button>
                    ) : (
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleReset()}
                          disabled={resetting}
                          className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl bg-destructive px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-destructive/90 disabled:cursor-wait disabled:opacity-70"
                        >
                          {resetting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <AlertTriangle className="h-4 w-4" />
                          )}
                          {t("confirmReset")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setResetConfirm(false)}
                          className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-border bg-surface-raised px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
                        >
                          {t("cancel")}
                        </button>
                      </div>
                    )}
                  </div>
                  <FeedbackLine fb={resetFb} />
                </div>
              </div>
            </div>
          )}
        </Section>

        {/* 3. Knowledge */}
        <Section
          icon={<Upload className="h-4 w-4" />}
          title={t("knowledge")}
          open={openSection === "knowledge"}
          onToggle={() =>
            setOpenSection((current) => (current === "knowledge" ? null : "knowledge"))
          }
          className="order-6"
        >
          <div className="rounded-2xl border border-border/70 bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-text">{t("knowledgeTitle")}</p>
                <p className="mt-1 text-xs text-text-muted">{t("knowledgeDescription")}</p>
              </div>
              <ActionButton
                icon={<Upload className="h-3.5 w-3.5" />}
                label={t("knowledgeManage")}
                onClick={() => setKnowledgeManagerOpen(true)}
                busy={false}
              />
            </div>
          </div>
        </Section>

        {/* 4. Files */}
        <Section
          icon={<Files className="h-4 w-4" />}
          title={t("files")}
          open={openSection === "files"}
          onToggle={() => setOpenSection((current) => (current === "files" ? null : "files"))}
          className="order-7"
        >
          <AssistantFilesManager />
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

        {/* 6. Memory */}
        <Section
          icon={<Brain className="h-4 w-4" />}
          title={t("memory")}
          open={openSection === "memory"}
          onToggle={() => setOpenSection((current) => (current === "memory" ? null : "memory"))}
          className="order-5"
        >
          {/* ADR-074 Slice M3.3 — UX merge:
              - "Workspace" tab = curated structured memory: every
                workspace_memory_items row + every registry row whose
                kind ∈ {fact, preference, open_loop}, deduplicated by
                normalized text (registry rows win collisions because
                they carry kind/memoryClass/resolvedAt + close/forget
                buttons; the workspace echo is dropped on collision).
              - "History" tab = turn-derived echoes: registry rows where
                kind === null. No "Mark as closed" buttons here. */}
          <div className="mb-3 flex gap-1 rounded-lg bg-surface p-0.5">
            {(["workspace", "history"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setMemoryTab(tab)}
                className={cn(
                  "flex-1 cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  memoryTab === tab
                    ? "bg-surface-raised text-text shadow-sm"
                    : "text-text-muted hover:text-text"
                )}
              >
                {tab === "workspace" ? t("workspace") : t("history")}
              </button>
            ))}
          </div>

          {memoryTab === "workspace" && (
            <>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={wsMemorySearch}
                  onChange={(e) => setWsMemorySearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void loadWsMemory(wsMemorySearch || undefined);
                  }}
                  placeholder={t("searchMemories")}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-xs text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
                />
                <button
                  type="button"
                  onClick={() => void loadWsMemory(wsMemorySearch || undefined)}
                  className="shrink-0 cursor-pointer rounded-lg bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
                >
                  {t("search")}
                </button>
              </div>

              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={wsNewMemory}
                  onChange={(e) => setWsNewMemory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleAddWsMemory();
                  }}
                  placeholder={t("teachNew")}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-xs text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
                />
                <button
                  type="button"
                  disabled={wsMemoryAdding || !wsNewMemory.trim()}
                  onClick={() => void handleAddWsMemory()}
                  className="shrink-0 cursor-pointer rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
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
                    className="space-y-2"
                    data-testid="memory-center-workspace-list"
                    aria-label={t("workspace")}
                  >
                    {mergedWorkspaceMemoryView.slice(0, wsMemoryVisibleCount).map((row) => {
                      const { memoryClass, kind } = row.item;
                      const resolvedAt =
                        row.source === "registry"
                          ? row.item.resolvedAt
                          : (row.item.resolvedAt ?? null);
                      return (
                        <li
                          key={row.key}
                          data-testid={`memory-row-${row.source}`}
                          className="flex items-start gap-2 rounded-lg bg-surface-raised p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-xs leading-relaxed text-text-muted whitespace-pre-wrap">
                              {row.source === "registry" ? row.item.summary : row.item.content}
                            </p>
                            {memoryClass !== undefined && (
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wide text-text-subtle">
                                <span
                                  className={
                                    memoryClass === "core"
                                      ? "rounded bg-accent/15 px-1.5 py-0.5 font-medium text-accent"
                                      : "rounded bg-surface-hover px-1.5 py-0.5 font-medium text-text-subtle"
                                  }
                                >
                                  {memoryClass === "core"
                                    ? t("memoryClassCore")
                                    : t("memoryClassContextual")}
                                </span>
                                {/* ADR-074 Slice M3.3 — strict per-kind badges.
                                  Workspace rows can now arrive with the same
                                  metadata as registry rows, so render badges
                                  from either source while keeping actions
                                  source-specific. */}
                                {kind === "fact" && (
                                  <span className="rounded bg-surface-hover px-1.5 py-0.5 font-medium text-text-subtle">
                                    {t("memoryKindFact")}
                                  </span>
                                )}
                                {kind === "preference" && (
                                  <span className="rounded bg-surface-hover px-1.5 py-0.5 font-medium text-text-subtle">
                                    {t("memoryKindPreference")}
                                  </span>
                                )}
                                {kind === "open_loop" && (
                                  <span className="rounded bg-surface-hover px-1.5 py-0.5 font-medium text-text-subtle">
                                    {t("memoryKindOpenLoop")}
                                  </span>
                                )}
                                {resolvedAt !== null && (
                                  <span className="rounded bg-success/15 px-1.5 py-0.5 font-medium text-success">
                                    {t("memoryResolved")}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {kind === "open_loop" && resolvedAt === null && (
                              <button
                                type="button"
                                disabled={closingOpenLoopId === row.item.id}
                                onClick={() => void handleCloseOpenLoop(row.item.id)}
                                className="cursor-pointer rounded p-1 text-text-subtle transition-colors hover:bg-surface-hover hover:text-accent disabled:cursor-default disabled:opacity-50"
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
                                className="cursor-pointer rounded p-1 text-text-subtle transition-colors hover:bg-surface-hover hover:text-destructive disabled:cursor-default disabled:opacity-50"
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
                                className="cursor-pointer rounded p-1 text-text-subtle transition-colors hover:bg-surface-hover hover:text-destructive disabled:cursor-default disabled:opacity-50"
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
                        </li>
                      );
                    })}
                  </ul>
                  {wsMemoryVisibleCount < mergedWorkspaceMemoryView.length && (
                    <button
                      type="button"
                      onClick={() => setWsMemoryVisibleCount((count) => count + 5)}
                      className="mt-3 w-full cursor-pointer rounded-lg border border-border py-2 text-xs font-medium text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                    >
                      {t("loadMore")} ({mergedWorkspaceMemoryView.length - wsMemoryVisibleCount})
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
                    className="space-y-2"
                    data-testid="memory-center-history-list"
                    aria-label={t("history")}
                  >
                    {mergedHistoryMemoryView.slice(0, memoryVisibleCount).map((row) => {
                      if (row.source !== "registry") return null;
                      const item = row.item;
                      return (
                        <li
                          key={row.key}
                          data-testid="memory-row-history"
                          className="flex items-start gap-2 rounded-lg bg-surface-raised p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-xs leading-relaxed text-text-muted">
                              {item.summary}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wide text-text-subtle">
                              <span
                                className={
                                  item.memoryClass === "core"
                                    ? "rounded bg-accent/15 px-1.5 py-0.5 font-medium text-accent"
                                    : "rounded bg-surface-hover px-1.5 py-0.5 font-medium text-text-subtle"
                                }
                              >
                                {item.memoryClass === "core"
                                  ? t("memoryClassCore")
                                  : t("memoryClassContextual")}
                              </span>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              disabled={forgettingId === item.id}
                              onClick={() => void handleForget(item.id)}
                              className="cursor-pointer rounded p-1 text-text-subtle transition-colors hover:bg-surface-hover hover:text-destructive disabled:cursor-default disabled:opacity-50"
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
                        </li>
                      );
                    })}
                  </ul>
                  {memoryVisibleCount < mergedHistoryMemoryView.length && (
                    <button
                      type="button"
                      onClick={() => setMemoryVisibleCount((count) => count + 5)}
                      className="mt-3 w-full cursor-pointer rounded-lg border border-border py-2 text-xs font-medium text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                    >
                      {t("loadMore")} ({mergedHistoryMemoryView.length - memoryVisibleCount})
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </Section>

        <AssistantKnowledgeManager
          getToken={getToken}
          open={knowledgeManagerOpen}
          onClose={() => setKnowledgeManagerOpen(false)}
        />

        {/* 4. Tasks */}
        <Section
          icon={<ListTodo className="h-4 w-4" />}
          title={t("tasks")}
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
              <div className="rounded-xl border border-border/70 bg-surface-raised/35 p-3.5">
                <button
                  type="button"
                  onClick={() => setShowUserTasks((open) => !open)}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
                >
                  <div>
                    <p className="text-sm font-medium text-text">{t("userTasksTitle")}</p>
                    <p className="mt-1 text-[11px] text-text-subtle">{t("userTasksHelp")}</p>
                  </div>
                  <span className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-full bg-background px-2.5 text-sm font-bold tabular-nums text-text">
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

              <div className="rounded-xl border border-border/70 bg-surface-raised/35 p-3.5">
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
                  <span className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-full bg-background px-2.5 text-sm font-bold tabular-nums text-text">
                    {assistantTaskItems.length}
                  </span>
                </button>

                {showAssistantActions && (
                  <>
                    {assistantTaskItems.length === 0 ? (
                      <p className="mt-3 text-xs text-text-subtle">{t("noAssistantActions")}</p>
                    ) : (
                      <ul className="mt-3 space-y-2.5">
                        {assistantTaskItems.map((item) => {
                          const recentRuns = item.recentRuns.slice(0, 5);
                          const completed = item.status === "completed";
                          return (
                            <li
                              key={item.id}
                              className={cn(
                                completed
                                  ? "p-0"
                                  : "rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm"
                              )}
                            >
                              {!completed && (
                                <>
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
                                </>
                              )}
                              {recentRuns.length > 0 && (
                                <div
                                  className={cn(
                                    "rounded-lg border border-border/60 bg-surface-raised/40 p-2.5",
                                    completed ? "mt-0" : "mt-3"
                                  )}
                                >
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
                                    {t("runHistory")}
                                  </p>
                                  <ul className="mt-1.5 space-y-1">
                                    {recentRuns.map((run) => (
                                      <li key={run.id} className="text-[11px] text-text-subtle">
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
                              {!completed && (
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
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </Section>

        {/* 5. Channels */}
        <Section
          icon={<Send className="h-4 w-4" />}
          title={t("channels")}
          open={openSection === "channels"}
          onToggle={() => setOpenSection((current) => (current === "channels" ? null : "channels"))}
          className="order-8"
        >
          <div className="space-y-1.5">
            <ChannelRow
              name="Telegram"
              connected={
                data.telegram?.connectionStatus === "connected" ||
                data.telegram?.connectionStatus === "claim_required"
              }
              onClick={onOpenTelegramSettings}
            />
            <ChannelRow name="WhatsApp" comingSoon />
            <ChannelRow name="MAX" comingSoon />
          </div>
          <div className="mt-4 rounded-xl border border-border bg-surface-raised/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-text">{t("reminderDelivery")}</p>
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
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border bg-background text-text-muted hover:bg-surface-hover"
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
            // State A — locked-with-upsell
            <div className="flex flex-col gap-3">
              <p className="text-xs italic text-text-muted">
                {t("charactersLockedHint", { plan: data.plan?.effectivePlan.code ?? "Pro" })}{" "}
                <a
                  href={CHARACTERS_PRICING_URL}
                  className="text-text-muted underline underline-offset-2 opacity-70 hover:opacity-100"
                >
                  {t("changePlan")}
                </a>
              </p>
              <p className="rounded-xl border border-border/60 bg-surface-raised/30 px-3 py-2 text-xs text-text-subtle">
                {t("charactersLockedBanner")}
              </p>
              <div className="rounded-2xl border border-border/60 bg-surface-raised/20 p-3">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setPersonaLightbox({
                        src: DEMO_PERSONA_PORTRAIT_URL,
                        name: t("charactersDemoName")
                      })
                    }
                    className="shrink-0 rounded-2xl transition-transform hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-accent/30"
                    aria-label={t("charactersOpenPortrait", { name: t("charactersDemoName") })}
                  >
                    <img
                      src={DEMO_PERSONA_PORTRAIT_URL}
                      alt={t("charactersDemoName")}
                      className="h-24 w-24 rounded-2xl object-cover"
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-text">
                        {t("charactersDemoName")}
                      </p>
                      <span className="rounded-full border border-border/60 bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-subtle">
                        {t("charactersDemoBadge")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-text-subtle">
                      {t("charactersVoiceLabel", {
                        voice: demoPersonaVoice?.name ?? t("charactersDemoVoiceFallback")
                      })}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-text-muted">
                      {t("charactersUsageHint")}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <VoicePreviewButton
                        previewAudioUrl={demoPersonaVoice?.previewAudioUrl ?? null}
                        voiceLabel={demoPersonaVoice?.name ?? t("charactersDemoVoiceFallback")}
                        previewUnavailableLabel={t("charactersPreviewUnavailable")}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            // State B — unlocked
            <div className="flex flex-col gap-3">
              {personaFb !== null && (
                <p
                  className={cn(
                    "rounded-lg px-3 py-2 text-xs",
                    personaFb.type === "ok"
                      ? "bg-green-500/10 text-green-600"
                      : personaFb.type === "warn"
                        ? "bg-yellow-500/10 text-yellow-600"
                        : "bg-destructive/10 text-destructive"
                  )}
                >
                  {personaFb.text}
                </p>
              )}

              <p className="rounded-2xl border border-border/50 bg-surface-raised/20 px-3 py-2.5 text-xs leading-5 text-text-muted">
                {t("charactersUsageHint")}
              </p>

              {personaListLoading && personaList.length === 0 ? (
                <div className="flex items-center gap-2 py-4 text-xs text-text-subtle">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{t("charactersLoading")}</span>
                </div>
              ) : personaList.length === 0 ? (
                <p className="py-4 text-center text-xs text-text-subtle">{t("charactersEmpty")}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {personaList.map((persona) => {
                    const catalogEntry = voiceCatalog.find(
                      (v) => v.voiceId === persona.heygenVoiceId
                    );
                    return (
                      <div
                        key={persona.id}
                        className="flex items-center gap-3 rounded-xl border border-border/60 bg-surface p-3"
                      >
                        {persona.portraitImageUrl ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPersonaLightbox({
                                src: persona.portraitImageUrl,
                                name: persona.displayName
                              })
                            }
                            className="shrink-0 rounded-full transition-transform hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-accent/30"
                            aria-label={t("charactersOpenPortrait", { name: persona.displayName })}
                          >
                            <img
                              src={persona.portraitImageUrl}
                              alt={persona.displayName}
                              className="h-10 w-10 rounded-full object-cover"
                            />
                          </button>
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-medium text-accent">
                            {persona.displayName.charAt(0)}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-text">
                            {persona.displayName}
                          </p>
                          <p className="text-xs text-text-subtle">
                            {t("charactersVoiceLabel", { voice: persona.heygenVoiceLabel })}
                          </p>
                        </div>
                        <VoicePreviewButton
                          previewAudioUrl={catalogEntry?.previewAudioUrl ?? null}
                          voiceLabel={persona.heygenVoiceLabel}
                          previewUnavailableLabel={t("charactersPreviewUnavailable")}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setDeletePersonaId(persona.id);
                            setDeletePersonaName(persona.displayName);
                          }}
                          className="ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-destructive/10 hover:text-destructive"
                          aria-label={t("charactersDeleteTitle")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={personaList.length >= personaLimit}
                  title={
                    personaList.length >= personaLimit
                      ? t("charactersFormLimitReached", { n: personaLimit })
                      : undefined
                  }
                  onClick={() => {
                    setCreatePersonaName("");
                    setCreatePersonaVoiceId(null);
                    setCreatePersonaPortrait(null);
                    setCreatePersonaPortraitPreview(null);
                    setCreatePersonaError(null);
                    setCreatePersonaPortraitError(null);
                    setVoiceLanguageFilter(locale.toLowerCase().startsWith("ru") ? "ru" : "en");
                    setCreatePersonaOpen(true);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-text transition-all hover:border-accent/50 hover:bg-accent/14",
                    personaList.length >= personaLimit && "cursor-not-allowed opacity-50"
                  )}
                >
                  {t("charactersCreate")}
                </button>
              </div>

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
                                text:
                                  err instanceof Error ? err.message : t("charactersErrorGeneric")
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

              {/* Create persona modal */}
              {createPersonaOpen &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm"
                    onClick={(e) => {
                      if (e.target === e.currentTarget) setCreatePersonaOpen(false);
                    }}
                    role="dialog"
                    aria-modal="true"
                  >
                    <div className="relative mx-4 my-10 w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl">
                      <h2 className="mb-4 text-sm font-semibold text-text">
                        {t("charactersCreate")}
                      </h2>

                      {/* Portrait upload */}
                      <div className="mb-3">
                        <p className="mb-1 text-[11px] font-medium text-text-subtle">
                          {t("charactersFormPortrait")}
                        </p>
                        <div
                          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border/60 bg-surface-raised/30 py-5 transition-colors hover:border-border"
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
                              className="h-20 w-20 rounded-full object-cover"
                            />
                          ) : (
                            <>
                              <Upload className="mb-1 h-5 w-5 text-text-subtle" />
                              <p className="text-xs text-text-subtle">
                                {t("charactersFormPortraitDrop")}
                              </p>
                              <p className="mt-0.5 text-[10px] text-text-subtle/70">
                                {t("charactersFormPortraitHint")}
                              </p>
                            </>
                          )}
                        </div>
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
                      </div>

                      {/* Name */}
                      <div className="mb-3">
                        <label className="mb-1 block text-[11px] font-medium text-text-subtle">
                          {t("charactersFormName")}
                        </label>
                        <input
                          type="text"
                          maxLength={60}
                          value={createPersonaName}
                          onChange={(e) => setCreatePersonaName(e.target.value)}
                          placeholder={t("charactersFormNamePlaceholder")}
                          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-subtle outline-none transition-colors focus:border-border-strong"
                        />
                      </div>

                      {/* Voice picker */}
                      <div className="mb-3">
                        <p className="mb-1 text-[11px] font-medium text-text-subtle">
                          {t("charactersFormVoice")}
                        </p>
                        <div className="mb-2 inline-flex rounded-full border border-border/60 bg-surface-raised/20 p-1">
                          {(["ru", "en", "other"] as const).map((language) => (
                            <button
                              key={language}
                              type="button"
                              onClick={() => {
                                setVoiceLanguageFilter(language);
                                if (language !== "other") {
                                  setOtherVoiceLanguageSearch("");
                                }
                              }}
                              className={cn(
                                "rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
                                voiceLanguageFilter === language
                                  ? "bg-accent/15 text-text"
                                  : "text-text-subtle hover:text-text"
                              )}
                            >
                              {language === "other"
                                ? t("charactersFormVoiceFilterOther")
                                : language.toUpperCase()}
                            </button>
                          ))}
                        </div>
                        {voiceLanguageFilter === "other" ? (
                          <div className="mb-2 flex items-center gap-2">
                            <input
                              type="text"
                              value={otherVoiceLanguageSearch}
                              onChange={(event) => setOtherVoiceLanguageSearch(event.target.value)}
                              placeholder={t("charactersFormVoiceLanguageSearchPlaceholder")}
                              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text placeholder:text-text-subtle outline-none transition-colors focus:border-border-strong"
                            />
                          </div>
                        ) : null}
                        {voiceCatalogLoading ? (
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
                            {filteredVoiceCatalog.map((voice) => (
                              <div
                                key={voice.voiceId}
                                role="button"
                                tabIndex={0}
                                aria-pressed={createPersonaVoiceId === voice.voiceId}
                                onClick={() => setCreatePersonaVoiceId(voice.voiceId)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    setCreatePersonaVoiceId(voice.voiceId);
                                  }
                                }}
                                className={cn(
                                  "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/20",
                                  createPersonaVoiceId === voice.voiceId && "bg-accent/10"
                                )}
                              >
                                <span className="flex-1 truncate font-medium text-text">
                                  {voice.name}
                                </span>
                                <span className="shrink-0 text-text-subtle">
                                  {(voice.languageBucket ?? voice.language ?? "")
                                    .toString()
                                    .toUpperCase()}{" "}
                                  · {voice.gender}
                                </span>
                                <VoicePreviewButton
                                  previewAudioUrl={voice.previewAudioUrl}
                                  voiceLabel={voice.name}
                                  previewUnavailableLabel={t("charactersPreviewUnavailable")}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* VC cost line */}
                      {(() => {
                        const balance = data.plan?.workspaceVcoinBalance.balanceVc ?? 0;
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
                                    setCreatePersonaOpen(false);
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
                      })()}

                      {createPersonaError && (
                        <p className="mb-3 text-xs text-destructive">{createPersonaError}</p>
                      )}

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setCreatePersonaOpen(false)}
                          className="rounded-full border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-raised"
                        >
                          {t("charactersCancel")}
                        </button>
                        <button
                          type="button"
                          disabled={
                            createPersonaSubmitting ||
                            createPersonaName.trim().length === 0 ||
                            !createPersonaVoiceId ||
                            !createPersonaPortrait ||
                            (data.plan?.workspaceVcoinBalance.balanceVc ?? 0) <
                              personaCreationVcoinCost
                          }
                          onClick={async () => {
                            if (
                              !assistant?.workspaceId ||
                              !createPersonaVoiceId ||
                              !createPersonaPortrait
                            )
                              return;
                            const token = await getToken();
                            if (!token) return;
                            setCreatePersonaSubmitting(true);
                            setCreatePersonaError(null);
                            try {
                              const result = await createWorkspaceVideoPersona(
                                token,
                                assistant.workspaceId,
                                {
                                  displayName: createPersonaName.trim(),
                                  heygenVoiceId: createPersonaVoiceId,
                                  portrait: createPersonaPortrait
                                }
                              );
                              setCreatePersonaOpen(false);
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
                            "rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-white transition-opacity",
                            (createPersonaSubmitting ||
                              createPersonaName.trim().length === 0 ||
                              !createPersonaVoiceId ||
                              !createPersonaPortrait ||
                              (data.plan?.workspaceVcoinBalance.balanceVc ?? 0) <
                                personaCreationVcoinCost) &&
                              "cursor-not-allowed opacity-50"
                          )}
                        >
                          {createPersonaSubmitting ? (
                            <span className="flex items-center gap-1.5">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              {t("charactersFormSubmitting")}
                            </span>
                          ) : (
                            t("charactersFormSubmit")
                          )}
                        </button>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}
            </div>
          )}
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
              <div className="rounded-xl border border-border/80 bg-surface-raised/40 p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-text-subtle">
                    {t("currentPlan")}
                  </p>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    {shouldShowBillingSettingsEntry ? (
                      <button
                        type="button"
                        onClick={() => void openBillingSettings()}
                        className="inline-flex min-h-9 items-center justify-center rounded-full border border-accent/20 bg-accent/10 px-3.5 text-[11px] font-medium text-text transition-all hover:border-accent/35 hover:bg-accent/14 hover:shadow-[0_0_24px_var(--accent-glow)]"
                      >
                        {t("paymentSettings")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpenPricingPage?.()}
                        className="inline-flex min-h-9 items-center justify-center rounded-full border border-accent/20 bg-accent/10 px-3.5 text-[11px] font-medium text-text transition-all hover:border-accent/35 hover:bg-accent/14 hover:shadow-[0_0_24px_var(--accent-glow)]"
                      >
                        {t("changePlan")}
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  <p className="truncate text-xl font-semibold tracking-[-0.02em] text-text">
                    {data.plan.effectivePlan.displayName ??
                      data.plan.effectivePlan.code ??
                      t("freePlan")}
                  </p>
                  {!tokenBucket && billingSummary.dateKey ? (
                    <p className="mt-1 text-[11px] text-text-muted">
                      {billingSummary.dateLabel
                        ? t(billingSummary.dateKey, { date: billingSummary.dateLabel })
                        : t(billingSummary.dateKey)}
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
              <div className="rounded-lg border border-border/80 bg-surface-raised/40">
                <button
                  type="button"
                  onClick={() => setToolLimitsExpanded((value) => !value)}
                  className="flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left"
                  aria-expanded={toolLimitsExpanded}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-text">{t("toolLimits")}</p>
                    <p className="mt-0.5 text-[11px] text-text-subtle">
                      {t("toolLimitsCount", { count: activeToolCount })}
                    </p>
                  </div>
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 shrink-0 text-text-subtle transition-transform",
                      toolLimitsExpanded && "rotate-90"
                    )}
                  />
                </button>
                {toolLimitsExpanded && (
                  <div className="border-t border-border/80 px-3 py-3">
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

        {billingSettingsOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm sm:items-center sm:p-6"
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
                    <p className="mt-1 text-sm text-text-muted">{billingSettingsDescription}</p>
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
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.14em] text-text-subtle">
                            {t("currentPlan")}
                          </p>
                          <p className="mt-2 text-xl font-semibold tracking-[-0.02em] text-text">
                            {billingPlanLabel}
                          </p>
                        </div>
                        <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-medium text-text shadow-sm">
                          {billingStatusChipLabel}
                        </span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <div className="rounded-full border border-border/70 bg-background/50 px-3 py-1.5">
                          <p className="text-[10px] uppercase tracking-[0.14em] text-text-subtle">
                            {t("billingAutoRenew")}
                          </p>
                          <p className="mt-1 text-sm font-medium text-text">
                            {billingAutoRenewLabel}
                          </p>
                        </div>
                        <div className="rounded-full border border-border/70 bg-background/50 px-3 py-1.5">
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
                      <p className="mt-3 rounded-2xl border border-border/60 bg-background/35 px-3 py-2 text-xs text-text-subtle">
                        {billingPaymentMethodHint}
                      </p>
                    </div>
                    <div className="grid gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenPricingPage?.()}
                        className="inline-flex min-h-11 items-center justify-center rounded-full border border-accent/20 bg-accent/10 px-4 text-sm font-medium text-text transition-colors hover:bg-accent/15"
                      >
                        {t("changePlan")}
                      </button>
                      {billingSubscription?.managePaymentMethodUrl ? (
                        <button
                          type="button"
                          onClick={handleManagePaymentMethod}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-border/80 bg-surface-raised/60 px-4 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
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
                          className="inline-flex min-h-11 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 text-sm font-medium text-text transition-colors hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50"
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
                            className="inline-flex min-h-11 items-center justify-center rounded-full border border-accent/20 bg-accent/10 px-4 text-sm font-medium text-text transition-colors hover:bg-accent/15"
                          >
                            {t("billingConfirmCancel")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void confirmDisableAutoRenew()}
                            disabled={disableAutoRenewPending}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-border/80 bg-transparent px-4 text-sm font-medium text-text-subtle transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
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
          </div>
        ) : null}
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

function ChannelRow({
  name,
  connected,
  comingSoon,
  onClick
}: {
  name: string;
  connected?: boolean;
  comingSoon?: boolean;
  onClick?: (() => void) | undefined;
}) {
  const t = useTranslations("settings");
  const interactive = Boolean(onClick) && !comingSoon;
  const content = (
    <>
      <span
        className={cn(
          "inline-block h-2 w-2 rounded-full",
          connected ? "bg-success" : "bg-text-subtle"
        )}
      />
      <span className="text-xs text-text-muted">{name}</span>
      {comingSoon && <span className="text-[10px] text-text-subtle">{t("channelComingSoon")}</span>}
      {connected && <span className="text-[10px] text-success">{t("channelConnected")}</span>}
      {interactive && <ChevronRight className="ml-auto h-3.5 w-3.5 text-text-subtle" />}
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-hover"
      >
        {content}
      </button>
    );
  }

  return (
    <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2", comingSoon && "opacity-50")}>
      {content}
    </div>
  );
}

function LimitMetricCard({
  label,
  value,
  secondary,
  hasBonus,
  unavailable,
  buyChipLabel,
  onBuyClick
}: {
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
        "group relative flex h-full overflow-hidden rounded-xl border bg-surface/70 p-2.5 text-left transition-colors",
        "flex-row items-center gap-3",
        "sm:min-h-[6.25rem] sm:flex-col sm:items-stretch sm:gap-0",
        hasBonus
          ? "border-accent/30 bg-surface/80"
          : unavailable
            ? "border-border/60 bg-surface/40"
            : "border-border/80",
        interactive &&
          "cursor-pointer hover:border-accent/30 hover:bg-surface/85 focus:outline-none focus:ring-2 focus:ring-accent/30"
      )}
    >
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[10px] font-medium uppercase leading-4 tracking-[0.12em] sm:min-h-[2rem]",
            unavailable ? "text-text-subtle/80" : "text-text-subtle"
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
              "pointer-events-none inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] transition-colors",
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
  const hint = !tool.active
    ? t("toolLimitDisabled")
    : tool.dailyCallLimit === null
      ? t("toolLimitUnlimited")
      : t("toolLimitPerDay", { count: tool.dailyCallLimit });

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-xl border border-border/70 px-3 py-2.5",
        tool.active ? "bg-surface/70" : "bg-surface/30"
      )}
    >
      <span
        className={cn(
          "mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full",
          !tool.active
            ? "bg-text-subtle/50"
            : tool.dailyCallLimit !== null && tool.dailyCallsUsed >= tool.dailyCallLimit
              ? "bg-destructive"
              : "bg-accent"
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <span className={cn("text-[11px]", tool.active ? "text-text" : "text-text-muted")}>
            {label}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-text-subtle">{valueLabel}</span>
        </div>
        <p className="mt-1 text-[10px] text-text-subtle">{hint}</p>
      </div>
    </li>
  );
}
