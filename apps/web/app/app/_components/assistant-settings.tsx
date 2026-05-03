"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Sparkles,
  Rocket,
  RotateCcw,
  Trash2,
  CheckCircle2,
  Brain,
  ListTodo,
  Send,
  BarChart3,
  History,
  Loader2,
  AlertTriangle,
  Upload,
  Files,
  GraduationCap,
  SlidersHorizontal,
  ChevronRight
} from "lucide-react";
import type {
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
  postAssistantRollback,
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
  type WorkspaceMemoryItem,
  type AssistantSkillsState
} from "../assistant-api-client";
import { AssistantAvatar } from "./assistant-avatar";
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
import { AssistantKnowledgeManager } from "./assistant-knowledge-manager";
import { AssistantFilesManager } from "./assistant-files-manager";
import { AssistantSkillsManager } from "./assistant-skills-manager";
import { AndroidAppDownloadBanner } from "../../_components/android-app-download-banner";

interface AssistantSettingsProps {
  data: AppData;
  initialSection?: string | undefined;
  onOpenTelegramSettings?: (() => void) | undefined;
  onOpenPricingPage?: (() => void) | undefined;
}

type ActionFeedback = { type: "ok" | "err"; text: string } | null;

type QuotaBucketState = UserPlanVisibilityState["limits"]["quotaBuckets"][number];
type MonthlyMediaQuotaToolState =
  UserPlanVisibilityState["limits"]["monthlyMediaQuotas"]["tools"][number];
type ToolDailyLimitState = UserPlanVisibilityState["limits"]["toolDailyLimits"][number];
type SettingsSectionId =
  | "character"
  | "quickActions"
  | "knowledge"
  | "files"
  | "skills"
  | "memory"
  | "tasks"
  | "channels"
  | "limits"
  | "publishHistory";

function normalizeInitialSection(value: string | undefined): SettingsSectionId {
  switch (value) {
    case "quickActions":
    case "knowledge":
    case "files":
    case "skills":
    case "memory":
    case "tasks":
    case "channels":
    case "limits":
    case "publishHistory":
    case "character":
      return value;
    default:
      return "character";
  }
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
  onToggle
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [open]);

  return (
    <div ref={ref} className="border-b border-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-2.5 px-5 py-3.5 text-left transition-colors hover:bg-surface-hover"
      >
        <span className="text-text-muted">{icon}</span>
        <span className="flex-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
          {title}
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

function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  const maybeNative = window as unknown as {
    PersaiNative?: unknown;
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  return Boolean(
    maybeNative.PersaiNative ||
    (typeof maybeNative.Capacitor?.isNativePlatform === "function" &&
      maybeNative.Capacitor.isNativePlatform())
  );
}

function FeedbackLine({ fb }: { fb: ActionFeedback }) {
  if (!fb) return null;
  const sessionExpired = fb.type === "err" && isSessionExpiredText(fb.text);
  return (
    <p
      className={cn(
        "mt-2 flex flex-wrap items-center gap-2 text-xs",
        fb.type === "ok" ? "text-success" : "text-destructive"
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

const AVATAR_EMOJIS = ["🌟", "🧠", "⚡", "🧘", "🤖", "🌙", "🔥", "🔮", "🌊", "💎", "✨", "🪐"];

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
  onOpenPricingPage
}: AssistantSettingsProps) {
  const router = useRouter();
  const { getToken } = useAuth();
  const t = useTranslations("settings");
  const locale = useLocale();
  const tp = useTranslations("persona");
  const [nativeShell, setNativeShell] = useState(false);
  const [toolLimitsExpanded, setToolLimitsExpanded] = useState(false);
  const assistant = data.assistant;
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
  const monthlyMediaQuotaLabels: Record<MonthlyMediaQuotaToolState["toolCode"], string> = {
    image_generate: t("monthlyMediaImageGenerate"),
    image_edit: t("monthlyMediaImageEdit"),
    video_generate: t("monthlyMediaVideoGenerate")
  };
  const toolLimitLabels: Record<string, string> = {
    browser: t("toolLimitBrowser"),
    exec: t("toolLimitExec"),
    files: t("toolLimitFiles"),
    image_edit: t("toolLimitImageEdit"),
    image_generate: t("toolLimitImageGenerate"),
    knowledge_fetch: t("toolLimitKnowledgeFetch"),
    knowledge_search: t("toolLimitKnowledgeSearch"),
    scheduled_action: t("toolLimitScheduledAction"),
    shell: t("toolLimitShell"),
    text_to_speech: t("toolLimitTextToSpeech"),
    video_generate: t("toolLimitVideoGenerate"),
    web_fetch: t("toolLimitWebFetch"),
    web_search: t("toolLimitWebSearch")
  };
  const tokenBucket =
    data.plan?.limits.quotaBuckets.find((bucket) => bucket.bucketCode === "token_budget") ?? null;
  const compactQuotaBuckets =
    data.plan?.limits.quotaBuckets.filter((bucket) =>
      ["active_web_chats", "media_storage_bytes", "knowledge_storage_bytes"].includes(
        bucket.bucketCode
      )
    ) ?? [];
  const enabledToolCodes = new Set(
    (data.plan?.limits.toolDailyLimits ?? [])
      .filter((tool) => tool.active)
      .map((tool) => tool.toolCode)
  );
  const visibleMonthlyMediaQuotas =
    data.plan?.limits.monthlyMediaQuotas.tools.filter(
      (tool) => tool.limitUnits !== null && enabledToolCodes.has(tool.toolCode)
    ) ?? [];
  const allToolDailyLimits =
    [...(data.plan?.limits.toolDailyLimits ?? [])].sort((left, right) => {
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
  const formatMonthlyMediaQuotaValue = (tool: MonthlyMediaQuotaToolState): string => {
    return tool.limitUnits === null
      ? String(tool.usedUnits)
      : `${tool.usedUnits}/${tool.limitUnits}`;
  };
  const toMonthlyMediaQuotaPercent = (tool: MonthlyMediaQuotaToolState): number | null => {
    if (tool.limitUnits === null || tool.limitUnits <= 0) {
      return null;
    }
    return Math.max(0, Math.min(100, Math.round((tool.usedUnits / tool.limitUnits) * 100)));
  };

  const version = assistant?.latestPublishedVersion ?? null;
  const [draftName, setDraftName] = useState(assistant?.draft.displayName ?? "");
  const [draftInstructions, setDraftInstructions] = useState(assistant?.draft.instructions ?? "");
  const [editingPersonality, setEditingPersonality] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFb, setSaveFb] = useState<ActionFeedback>(null);

  const [draftTraits, setDraftTraits] = useState<Record<string, number>>(
    (assistant?.draft.traits as Record<string, number> | null) ?? DEFAULT_TRAITS
  );
  const [draftAvatarEmoji, setDraftAvatarEmoji] = useState<string | null>(
    assistant?.draft.avatarEmoji ?? null
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

  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackConfirm, setRollbackConfirm] = useState(false);
  const [rollbackFb, setRollbackFb] = useState<ActionFeedback>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
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
  const [openSection, setOpenSection] = useState<SettingsSectionId | null>(() =>
    normalizeInitialSection(initialSection)
  );

  useEffect(() => {
    setNativeShell(isNativeShell());
  }, []);

  useEffect(() => {
    setOpenSection(normalizeInitialSection(initialSection));
  }, [initialSection]);

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
        label: voice.name,
        gender: voice.gender
      })),
    [voiceSettings]
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
    setDraftAvatarEmoji(assistant?.draft.avatarEmoji ?? null);
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
        avatarEmoji: draftAvatarEmoji,
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
    draftAvatarEmoji,
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

  const handleRollback = useCallback(async () => {
    const token = await getToken({ skipCache: true });
    if (!token || !version) return;
    const targetVersion = version.version - 1;
    if (targetVersion < 1) return;
    setRollingBack(true);
    setRollbackFb(null);
    try {
      await postAssistantRollback(token, { targetVersion });
      setRollbackFb({ type: "ok", text: t("rolledBack", { v: targetVersion }) });
      setRollbackConfirm(false);
      data.reload();
    } catch (e) {
      setRollbackFb({ type: "err", text: e instanceof Error ? e.message : t("rollbackFailed") });
    }
    setRollingBack(false);
  }, [getToken, version, data]);

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
  }, [getToken, router]);

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
    <div>
      {/* 1. Character — hero */}
      <Section
        icon={<Sparkles className="h-4 w-4" />}
        title={t("character")}
        open={openSection === "character"}
        onToggle={() => setOpenSection((current) => (current === "character" ? null : "character"))}
      >
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl border border-border/70 bg-surface p-4">
            <div className="flex flex-col gap-4">
              <div className="grid min-w-0 gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
                <button
                  type="button"
                  onClick={() => setEmojiPickerOpen((o) => !o)}
                  className="flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl bg-accent/15 text-3xl transition-colors hover:bg-accent/25"
                  title={t("changeAvatar")}
                >
                  {avatarUploading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-accent" />
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
                    draftAvatarEmoji || <Sparkles className="h-7 w-7 text-accent" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <input
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder={t("assistantNamePlaceholder")}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
                  />
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[11px] text-text-muted">
                    <span className={cn("inline-block h-2 w-2 rounded-full", statusDot)} />
                    <span>{statusLabel}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                <ActionButton
                  icon={<Rocket className="h-3.5 w-3.5" />}
                  label={t("save")}
                  onClick={() => void handleSaveAndApply()}
                  busy={saving}
                  variant="primary"
                  className="min-w-0 flex-1 justify-center"
                />
                <ActionButton
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  label={editingPersonality ? t("hidePersonality") : t("editPersonality")}
                  onClick={() => setEditingPersonality(!editingPersonality)}
                  busy={false}
                  className="min-w-0 flex-1 justify-center"
                />
              </div>
            </div>
            {emojiPickerOpen && (
              <div className="mt-3 grid grid-cols-6 gap-1 rounded-lg border border-border bg-surface p-2">
                {AVATAR_EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => {
                      setDraftAvatarEmoji(em);
                      setDraftAvatarUrl(null);
                      setEmojiPickerOpen(false);
                    }}
                    className={cn(
                      "flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-xl transition-colors",
                      draftAvatarEmoji === em && !draftAvatarUrl
                        ? "bg-accent/20 ring-1 ring-accent"
                        : "hover:bg-surface-hover"
                    )}
                  >
                    {em}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition-colors",
                    draftAvatarUrl
                      ? "bg-accent/20 ring-1 ring-accent"
                      : "text-text-subtle hover:bg-surface-hover"
                  )}
                  title={t("uploadImage")}
                >
                  <Upload className="h-4 w-4" />
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
            setDraftAvatarEmoji(null);
            setEmojiPickerOpen(false);
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
                    className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-text outline-none focus:border-border-strong disabled:opacity-60"
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
                    className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-text outline-none focus:border-border-strong"
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
                    className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-text outline-none focus:border-border-strong"
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
          </div>
        )}
      </Section>

      {/* 2. Quick actions */}
      <Section
        icon={<Rocket className="h-4 w-4" />}
        title={t("quickActions")}
        open={openSection === "quickActions"}
        onToggle={() =>
          setOpenSection((current) => (current === "quickActions" ? null : "quickActions"))
        }
      >
        {version && (
          <p className="mb-3 text-xs text-text-muted">
            {t("version", { v: version.version, status: assistant.runtimeApply.status })}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {!rollbackConfirm ? (
            <ActionButton
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              label={t("rollback")}
              onClick={() => setRollbackConfirm(true)}
              busy={false}
              disabled={!version || version.version < 2}
            />
          ) : (
            <div className="flex items-center gap-2">
              <ActionButton
                icon={<RotateCcw className="h-3.5 w-3.5" />}
                label={t("rollbackTo", { v: (version?.version ?? 2) - 1 })}
                onClick={() => void handleRollback()}
                busy={rollingBack}
              />
              <button
                type="button"
                onClick={() => setRollbackConfirm(false)}
                className="cursor-pointer text-xs text-text-subtle hover:text-text-muted"
              >
                {t("cancel")}
              </button>
            </div>
          )}
          {!resetConfirm ? (
            <ActionButton
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label={t("reset")}
              variant="danger"
              onClick={() => setResetConfirm(true)}
              busy={false}
            />
          ) : (
            <div className="flex items-center gap-2">
              <ActionButton
                icon={<AlertTriangle className="h-3.5 w-3.5" />}
                label={t("confirmReset")}
                variant="danger"
                onClick={() => void handleReset()}
                busy={resetting}
              />
              <button
                type="button"
                onClick={() => setResetConfirm(false)}
                className="cursor-pointer text-xs text-text-subtle hover:text-text-muted"
              >
                {t("cancel")}
              </button>
            </div>
          )}
        </div>
        <FeedbackLine fb={rollbackFb} />
        <FeedbackLine fb={resetFb} />
        {resetConfirm && <p className="mt-2 text-xs text-destructive">{t("resetScopeWarning")}</p>}
      </Section>

      {/* 3. Knowledge */}
      <Section
        icon={<Upload className="h-4 w-4" />}
        title={t("knowledge")}
        open={openSection === "knowledge"}
        onToggle={() => setOpenSection((current) => (current === "knowledge" ? null : "knowledge"))}
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
      >
        <AssistantFilesManager />
      </Section>

      {/* 5. Skills */}
      <Section
        icon={<GraduationCap className="h-4 w-4" />}
        title={t("skills")}
        open={openSection === "skills"}
        onToggle={() => setOpenSection((current) => (current === "skills" ? null : "skills"))}
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
                          <p className="text-xs leading-relaxed text-text-muted">{item.summary}</p>
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
                        whatsapp: "channelWhatsApp",
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

      {/* 6. Limits & Plan */}
      <Section
        icon={<BarChart3 className="h-4 w-4" />}
        title={t("limitsAndPlan")}
        open={openSection === "limits"}
        onToggle={() => setOpenSection((current) => (current === "limits" ? null : "limits"))}
      >
        {data.plan ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-border/80 bg-surface-raised/40 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-text-subtle">
                  {t("currentPlan")}
                </p>
                <button
                  type="button"
                  onClick={() => onOpenPricingPage?.()}
                  className="inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border/80 bg-surface/70 px-3 text-[11px] font-medium text-text-muted transition-all hover:border-accent/25 hover:bg-surface hover:text-text"
                >
                  {t("changePlan")}
                </button>
              </div>

              <div className="mt-3 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xl font-semibold tracking-[-0.02em] text-text">
                    {data.plan.effectivePlan.displayName ??
                      data.plan.effectivePlan.code ??
                      t("freePlan")}
                  </p>
                  {billingSummary.dateKey && billingSummary.dateLabel && (
                    <p className="mt-1 text-[11px] text-text-muted">
                      {t(billingSummary.dateKey, { date: billingSummary.dateLabel })}
                    </p>
                  )}
                </div>
                {tokenBucket?.percent !== null && tokenBucket?.percent !== undefined ? (
                  <span className="shrink-0 text-sm font-medium text-text-muted">
                    {t("tokenPercentCompact", { pct: tokenBucket.percent })}
                  </span>
                ) : null}
              </div>

              {tokenBucket && (
                <div className="mt-4">
                  <LimitBar
                    label={quotaBucketLabels[tokenBucket.bucketCode] ?? tokenBucket.displayName}
                    pct={tokenBucket.percent}
                    valueLabel={formatQuotaBucketValue(tokenBucket)}
                    unavailable={!tokenBucket.usageAvailable}
                    size="lg"
                  />
                </div>
              )}

              <div className="mt-4 grid grid-cols-3 gap-2">
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
            </div>
            {visibleMonthlyMediaQuotas.length > 0 && (
              <div className="rounded-lg border border-border/80 bg-surface-raised/40 p-3">
                <p className="mb-2 text-xs font-medium text-text">{t("monthlyMediaQuotas")}</p>
                <div className="space-y-2">
                  {visibleMonthlyMediaQuotas.map((tool) => (
                    <LimitBar
                      key={tool.toolCode}
                      label={monthlyMediaQuotaLabels[tool.toolCode] ?? tool.displayName}
                      pct={toMonthlyMediaQuotaPercent(tool)}
                      valueLabel={formatMonthlyMediaQuotaValue(tool)}
                      unavailable={!tool.usageAvailable}
                    />
                  ))}
                </div>
                <p className="mt-2 text-[10px] text-text-subtle">
                  {t("monthlyMediaQuotaSettlementHint")}
                </p>
              </div>
            )}
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

      {/* 7. Publish history */}
      <Section
        icon={<History className="h-4 w-4" />}
        title={t("publishHistory")}
        open={openSection === "publishHistory"}
        onToggle={() =>
          setOpenSection((current) => (current === "publishHistory" ? null : "publishHistory"))
        }
      >
        {version ? (
          <div className="text-xs text-text-muted">
            <p>{t("latestVersion", { v: version.version })}</p>
            <p className="text-text-subtle">
              {t("published", { date: new Date(version.publishedAt).toLocaleString() })}
            </p>
          </div>
        ) : (
          <p className="text-xs text-text-subtle">{t("noVersions")}</p>
        )}
      </Section>

      <div className="flex justify-center px-5 pt-10 pb-12">
        <AndroidAppDownloadBanner
          className="min-w-[11rem] opacity-80"
          copy={{
            cta: nativeShell ? t("androidAppUpdateCta") : t("androidAppCta")
          }}
        />
      </div>
    </div>
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

function LimitBar({
  label,
  pct,
  valueLabel,
  unavailable = false,
  size = "sm"
}: {
  label: string;
  pct: number | null;
  valueLabel?: string;
  unavailable?: boolean;
  size?: "sm" | "lg";
}) {
  return (
    <div>
      <div className={cn("flex justify-between gap-3", size === "lg" ? "text-xs" : "text-[11px]")}>
        <span className={cn(size === "lg" ? "font-medium text-text" : "text-text-muted")}>
          {label}
        </span>
        <span className="text-text-subtle">{valueLabel ?? (pct === null ? "—" : `${pct}%`)}</span>
      </div>
      <div
        className={cn(
          "mt-1 overflow-hidden rounded-full bg-surface-raised/80",
          size === "lg" ? "h-2" : "h-1"
        )}
      >
        <div
          className={cn(
            "h-full rounded-full",
            unavailable ? "bg-text-subtle/60" : (pct ?? 0) >= 90 ? "bg-destructive" : "bg-accent"
          )}
          style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
        />
      </div>
    </div>
  );
}

function LimitMetricCard({
  label,
  value,
  secondary
}: {
  label: string;
  value: string;
  secondary?: string | null;
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-surface/70 p-2.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-subtle">
        {label}
      </p>
      <p className="mt-1 text-xs font-semibold text-text">{value}</p>
      {secondary ? <p className="mt-1 text-[10px] text-text-subtle">{secondary}</p> : null}
    </div>
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
