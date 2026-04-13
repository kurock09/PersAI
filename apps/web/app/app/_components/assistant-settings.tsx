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
  Brain,
  ListTodo,
  Send,
  BarChart3,
  History,
  Loader2,
  AlertTriangle,
  Upload
} from "lucide-react";
import type {
  AssistantMemoryRegistryItemState,
  AssistantTaskRegistryItemState
} from "@persai/contracts";
import { useTranslations } from "next-intl";
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
  patchAssistantNotificationPreference,
  getAssistantMemoryItems,
  type AssistantVoiceSettingsState,
  type AssistantPreferredNotificationChannel,
  getAssistantTaskItems,
  postAssistantMemoryItemForget,
  postAssistantTaskItemDisable,
  postAssistantTaskItemCancel,
  getWorkspaceMemoryItems,
  addWorkspaceMemoryItem,
  forgetWorkspaceMemoryItem,
  searchWorkspaceMemory,
  uploadAssistantAvatar,
  type WorkspaceMemoryItem
} from "../assistant-api-client";
import { AssistantAvatar } from "./assistant-avatar";
import {
  filterVoiceOptions,
  findVoiceOption,
  OPENAI_VOICE_OPTIONS,
  resolveDefaultOpenAiVoiceOption,
  resolveDefaultYandexVoiceOption,
  YANDEX_VOICE_OPTIONS,
  type VoiceOption
} from "./assistant-voice-options";

interface AssistantSettingsProps {
  data: AppData;
  initialSection?: string | undefined;
}

type ActionFeedback = { type: "ok" | "err"; text: string } | null;

function Section({
  icon,
  title,
  children,
  defaultOpen = true,
  forceOpen = false
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || forceOpen);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (forceOpen && !open) {
      setOpen(true);
    }
  }, [forceOpen]);

  useEffect(() => {
    if (forceOpen && open && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [forceOpen, open]);

  return (
    <div ref={ref} className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-2.5 px-5 py-3.5 text-left transition-colors hover:bg-surface-hover"
      >
        <span className="text-text-muted">{icon}</span>
        <span className="flex-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
          {title}
        </span>
        <span className="text-[10px] text-text-subtle">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  );
}

function FeedbackLine({ fb }: { fb: ActionFeedback }) {
  if (!fb) return null;
  return (
    <p className={cn("mt-2 text-xs", fb.type === "ok" ? "text-success" : "text-destructive")}>
      {fb.text}
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
  disabled
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  busy: boolean;
  variant?: "default" | "danger";
  disabled?: boolean;
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
          : "bg-surface-raised text-text-muted hover:bg-surface-hover hover:text-text"
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

export function AssistantSettings({ data, initialSection }: AssistantSettingsProps) {
  const router = useRouter();
  const { getToken } = useAuth();
  const t = useTranslations("settings");
  const tp = useTranslations("persona");
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

  const [memoryItems, setMemoryItems] = useState<AssistantMemoryRegistryItemState[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [forgettingId, setForgettingId] = useState<string | null>(null);
  const [memoryVisibleCount, setMemoryVisibleCount] = useState(10);

  const [wsMemoryItems, setWsMemoryItems] = useState<WorkspaceMemoryItem[]>([]);
  const [wsMemoryLoading, setWsMemoryLoading] = useState(false);
  const [wsMemorySearch, setWsMemorySearch] = useState("");
  const [wsMemoryAdding, setWsMemoryAdding] = useState(false);
  const [wsNewMemory, setWsNewMemory] = useState("");
  const [wsForgettingId, setWsForgettingId] = useState<string | null>(null);
  const [memoryTab, setMemoryTab] = useState<"workspace" | "registry">("workspace");

  const [taskItems, setTaskItems] = useState<AssistantTaskRegistryItemState[]>([]);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskActionId, setTaskActionId] = useState<string | null>(null);
  const [notificationChannel, setNotificationChannel] =
    useState<AssistantPreferredNotificationChannel>("web");
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationFb, setNotificationFb] = useState<ActionFeedback>(null);
  const [voiceSettings, setVoiceSettings] = useState<AssistantVoiceSettingsState | null>(null);
  const [voiceSettingsLoading, setVoiceSettingsLoading] = useState(false);
  const [voiceSettingsError, setVoiceSettingsError] = useState<string | null>(null);

  const primaryVoiceProviderId = voiceSettings?.primaryProviderId ?? null;
  const primaryVoiceProviderLabel =
    primaryVoiceProviderId === "elevenlabs"
      ? t("voiceProviderElevenlabs")
      : primaryVoiceProviderId === "yandex"
        ? t("voiceProviderYandex")
        : primaryVoiceProviderId === "openai"
          ? t("voiceProviderOpenai")
          : t("voiceLoading");
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

  const getAssistantActionTypeLabel = useCallback(
    (item: AssistantTaskRegistryItemState): string => {
      const raw = item.actionType?.trim();
      if (!raw) {
        return t("assistantAction");
      }
      return raw
        .split(/[_\s-]+/)
        .filter((part) => part.length > 0)
        .map((part) => part[0]!.toUpperCase() + part.slice(1))
        .join(" ");
    },
    [t]
  );

  const activeTaskItems = taskItems.filter((item) => item.controlStatus === "active");
  const userTaskItems = activeTaskItems.filter((item) => item.audience === "user");
  const assistantTaskItems = activeTaskItems.filter((item) => item.audience === "assistant");
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
  const voiceProviderHint =
    primaryVoiceProviderId === null
      ? t("voiceLoading")
      : t("voicePrimaryProviderHint", { provider: primaryVoiceProviderLabel });

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
    setMemoryVisibleCount(10);
    try {
      setMemoryItems(await getAssistantMemoryItems(token));
    } catch {
      /* non-critical */
    }
    setMemoryLoading(false);
  }, [getToken]);

  const loadTasks = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setTaskLoading(true);
    try {
      setTaskItems(await getAssistantTaskItems(token));
    } catch {
      /* non-critical */
    }
    setTaskLoading(false);
  }, [getToken]);

  const loadWsMemory = useCallback(
    async (query?: string) => {
      const token = await getToken();
      if (!token) return;
      setWsMemoryLoading(true);
      try {
        const items = query
          ? await searchWorkspaceMemory(token, query)
          : await getWorkspaceMemoryItems(token);
        setWsMemoryItems(items);
      } catch {
        /* non-critical */
      }
      setWsMemoryLoading(false);
    },
    [getToken]
  );

  const handleAddWsMemory = useCallback(async () => {
    const token = await getToken();
    if (!token || !wsNewMemory.trim()) return;
    setWsMemoryAdding(true);
    try {
      const item = await addWorkspaceMemoryItem(token, wsNewMemory.trim());
      setWsMemoryItems((prev) => [...prev, item]);
      setWsNewMemory("");
    } catch {
      /* non-critical */
    }
    setWsMemoryAdding(false);
  }, [getToken, wsNewMemory]);

  const handleForgetWsMemory = useCallback(
    async (itemId: string) => {
      const token = await getToken();
      if (!token) return;
      setWsForgettingId(itemId);
      try {
        await forgetWorkspaceMemoryItem(token, itemId);
        setWsMemoryItems((prev) => prev.filter((m) => m.id !== itemId));
      } catch {
        /* non-critical */
      }
      setWsForgettingId(null);
    },
    [getToken]
  );

  useEffect(() => {
    if (assistant) {
      void loadMemory();
      void loadTasks();
      void loadWsMemory();
    }
  }, [assistant, loadMemory, loadTasks, loadWsMemory]);

  const handleSaveAndApply = useCallback(async () => {
    const token = await getToken();
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
        }
      });
      await postAssistantPublish(token);
      setSaveFb({ type: "ok", text: t("savedAndApplied") });
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

  const handleRollback = useCallback(async () => {
    const token = await getToken();
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
    const token = await getToken();
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
      const token = await getToken();
      if (!token) return;
      setForgettingId(itemId);
      try {
        await postAssistantMemoryItemForget(token, itemId);
        setMemoryItems((prev) => prev.filter((m) => m.id !== itemId));
      } catch {
        /* non-critical */
      }
      setForgettingId(null);
    },
    [getToken]
  );

  const handleTaskAction = useCallback(
    async (itemId: string, action: "disable" | "cancel") => {
      const token = await getToken();
      if (!token) return;
      setTaskActionId(itemId);
      try {
        if (action === "disable") await postAssistantTaskItemDisable(token, itemId);
        else await postAssistantTaskItemCancel(token, itemId);
        await loadTasks();
      } catch {
        /* non-critical */
      }
      setTaskActionId(null);
    },
    [getToken, loadTasks]
  );

  const handleNotificationPreferenceChange = useCallback(
    async (channel: AssistantPreferredNotificationChannel) => {
      const token = await getToken();
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
      <Section icon={<Sparkles className="h-4 w-4" />} title={t("character")}>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setEmojiPickerOpen((o) => !o)}
            className="flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center rounded-2xl bg-accent/15 text-3xl overflow-hidden transition-colors hover:bg-accent/25"
            title={t("changeAvatar")}
          >
            {avatarUploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
            ) : avatarPreviewBlobUrl ? (
              <img src={avatarPreviewBlobUrl} alt="Avatar" className="h-full w-full object-cover" />
            ) : draftAvatarUrl ? (
              <AssistantAvatar avatarUrl={draftAvatarUrl} size="md" />
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
              className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
            />
            <span className="mt-1.5 flex items-center gap-1.5">
              <span className={cn("inline-block h-2 w-2 rounded-full", statusDot)} />
              <span className="text-xs text-text-muted">{statusLabel}</span>
            </span>
          </div>
        </div>
        {emojiPickerOpen && (
          <div className="mt-2 grid grid-cols-6 gap-1 rounded-lg border border-border bg-surface-raised p-2">
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
                  : "hover:bg-surface-hover text-text-subtle"
              )}
              title={t("uploadImage")}
            >
              <Upload className="h-4 w-4" />
            </button>
          </div>
        )}
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
                const token = await getToken();
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

        <div className="mt-3 flex items-center gap-2">
          <ActionButton
            icon={<Rocket className="h-3.5 w-3.5" />}
            label={t("saveAndApply")}
            onClick={() => void handleSaveAndApply()}
            busy={saving}
          />
          <ActionButton
            icon={<Sparkles className="h-3.5 w-3.5" />}
            label={editingPersonality ? t("hidePersonality") : t("editPersonality")}
            onClick={() => setEditingPersonality(!editingPersonality)}
            busy={false}
          />
        </div>
        <FeedbackLine fb={saveFb} />

        {editingPersonality && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ASSISTANT_GENDER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDraftAssistantGender(opt.value)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                    draftAssistantGender === opt.value
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border bg-surface-raised text-text-muted hover:border-border-strong hover:text-text"
                  )}
                >
                  {tp(opt.labelKey)}
                </button>
              ))}
            </div>
            <div className="mt-4 rounded-xl border border-border bg-surface-raised p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-text">{t("voice")}</p>
                  <p className="mt-1 text-xs text-text-muted">{t("voiceDescription")}</p>
                </div>
                <span className="rounded-full bg-surface px-2 py-1 text-[10px] text-text-muted">
                  {t("voiceLocale", { locale: draftVoiceProfile.defaultLocale })}
                </span>
              </div>
              <p className="mt-2 text-[11px] text-text-subtle">{t("voiceToneNote")}</p>
              <p className="mt-2 text-[11px] text-text-subtle">{voiceProviderHint}</p>
              {voiceSettingsError && (
                <p className="mt-2 text-[11px] text-destructive">{voiceSettingsError}</p>
              )}
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-text-muted">
                    {t("voiceDelivery")}
                  </span>
                  <select
                    value={draftVoiceProfile.deliveryKind}
                    onChange={(e) =>
                      setDraftVoiceProfile((prev) => ({
                        ...prev,
                        deliveryKind: e.target.value as AssistantVoiceProfile["deliveryKind"]
                      }))
                    }
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
                  >
                    <option value="voice_note">{t("voiceDeliveryVoiceNote")}</option>
                    <option value="audio">{t("voiceDeliveryAudio")}</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-text-muted">
                    {t("voicePrimaryProvider")}
                  </span>
                  <div className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text">
                    {primaryVoiceProviderLabel}
                  </div>
                </label>
                {primaryVoiceProviderId === "elevenlabs" && (
                  <label className="block md:col-span-2">
                    <span className="mb-1 block text-[11px] text-text-muted">
                      {t("voiceBaseVoice")}
                    </span>
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
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-border-strong disabled:opacity-60"
                    >
                      <option value="">{t("voiceChooseBaseVoice")}</option>
                      {elevenLabsSelectOptions.map((voice) => (
                        <option key={voice.value} value={voice.value}>
                          {voice.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-[11px] text-text-subtle">
                      {voiceSettingsLoading
                        ? t("voiceElevenlabsLoading")
                        : voiceSettings?.elevenlabs?.loadState === "not_configured"
                          ? t("voiceElevenlabsNotConfigured")
                          : voiceSettings?.elevenlabs?.loadState === "unavailable"
                            ? (voiceSettings.elevenlabs.warning ?? t("voiceElevenlabsUnavailable"))
                            : filteredElevenLabsVoiceOptions.length === 0
                              ? t("voiceNoVoicesForGender")
                              : t("voiceGenderFilterHint")}
                    </p>
                  </label>
                )}
                {primaryVoiceProviderId === "yandex" && (
                  <label className="block md:col-span-2">
                    <span className="mb-1 block text-[11px] text-text-muted">
                      {t("voiceBaseVoice")}
                    </span>
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
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
                    >
                      {yandexVoiceOptions.map((voice) => (
                        <option key={voice.value} value={voice.value}>
                          {voice.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-[11px] text-text-subtle">
                      {t("voiceGenderFilterHint")}
                    </p>
                  </label>
                )}
                {primaryVoiceProviderId === "openai" && (
                  <label className="block md:col-span-2">
                    <span className="mb-1 block text-[11px] text-text-muted">
                      {t("voiceBaseVoice")}
                    </span>
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
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
                    >
                      {openAiVoiceOptions.map((voice) => (
                        <option key={voice.value} value={voice.value}>
                          {voice.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-[11px] text-text-subtle">
                      {t("voiceGenderFilterHint")}
                    </p>
                  </label>
                )}
              </div>
            </div>
            <div className="mt-3 space-y-3">
              {TRAIT_SLIDERS.map(({ key, labelLeftKey, labelRightKey }) => (
                <div key={key}>
                  <div className="flex justify-between text-[11px] text-text-muted mb-1">
                    <span>{tp(labelLeftKey)}</span>
                    <span>{tp(labelRightKey)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={draftTraits[key] ?? 50}
                    onChange={(e) =>
                      setDraftTraits((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                    }
                    className="w-full accent-accent"
                  />
                </div>
              ))}
            </div>
            <textarea
              value={draftInstructions}
              onChange={(e) => setDraftInstructions(e.target.value)}
              placeholder={t("customInstructions")}
              rows={4}
              className="mt-3 w-full resize-y rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
            />
          </>
        )}
      </Section>

      {/* 2. Quick actions */}
      <Section icon={<Rocket className="h-4 w-4" />} title={t("quickActions")}>
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
      </Section>

      {/* 3. Memory */}
      <Section icon={<Brain className="h-4 w-4" />} title={t("memory")} defaultOpen={false}>
        <div className="mb-3 flex gap-1 rounded-lg bg-surface p-0.5">
          {(["workspace", "registry"] as const).map((tab) => (
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

            {wsMemoryLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
              </div>
            ) : wsMemoryItems.length === 0 ? (
              <p className="text-xs text-text-subtle">{t("noWorkspaceMemories")}</p>
            ) : (
              <ul className="space-y-2">
                {wsMemoryItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start gap-2 rounded-lg bg-surface-raised p-3"
                  >
                    <p className="min-w-0 flex-1 text-xs leading-relaxed text-text-muted whitespace-pre-wrap">
                      {item.content}
                    </p>
                    <button
                      type="button"
                      disabled={wsForgettingId === item.id}
                      onClick={() => void handleForgetWsMemory(item.id)}
                      className="shrink-0 cursor-pointer rounded p-1 text-text-subtle transition-colors hover:bg-surface-hover hover:text-destructive disabled:cursor-default disabled:opacity-50"
                      title={t("forget")}
                    >
                      {wsForgettingId === item.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {memoryTab === "registry" && (
          <>
            {memoryLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
              </div>
            ) : memoryItems.length === 0 ? (
              <p className="text-xs text-text-subtle">{t("noMemoriesStored")}</p>
            ) : (
              <>
                <ul className="space-y-2">
                  {memoryItems.slice(0, memoryVisibleCount).map((item) => (
                    <li
                      key={item.id}
                      className="flex items-start gap-2 rounded-lg bg-surface-raised p-3"
                    >
                      <p className="min-w-0 flex-1 text-xs leading-relaxed text-text-muted">
                        {item.summary}
                      </p>
                      <button
                        type="button"
                        disabled={forgettingId === item.id}
                        onClick={() => void handleForget(item.id)}
                        className="shrink-0 cursor-pointer rounded p-1 text-text-subtle transition-colors hover:bg-surface-hover hover:text-destructive disabled:cursor-default disabled:opacity-50"
                        title={t("forget")}
                      >
                        {forgettingId === item.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
                {memoryVisibleCount < memoryItems.length && (
                  <button
                    type="button"
                    onClick={() => setMemoryVisibleCount((c) => c + 10)}
                    className="mt-3 w-full cursor-pointer rounded-lg border border-border py-2 text-xs font-medium text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                  >
                    {t("loadMore")} ({memoryItems.length - memoryVisibleCount})
                  </button>
                )}
              </>
            )}
          </>
        )}
      </Section>

      {/* 4. Tasks */}
      <Section icon={<ListTodo className="h-4 w-4" />} title={t("tasks")} defaultOpen={false}>
        {taskLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
          </div>
        ) : (
          <div className="space-y-4">
            {userTaskItems.length === 0 ? (
              <p className="text-xs text-text-subtle">{t("noCurrentTasks")}</p>
            ) : (
              <ul className="space-y-2">
                {userTaskItems.map((item) => (
                  <li key={item.id} className="rounded-lg bg-surface-raised p-3">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-text">
                        {item.title}
                      </span>
                      <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                        {getTaskScheduleKindLabel(item.sourceLabel)}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          "bg-success/15 text-success"
                        )}
                      >
                        {getTaskStatusLabel(item.controlStatus)}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-text-subtle">{getTaskTimingLabel(item)}</p>
                    <div className="mt-2 flex gap-1.5">
                      <ActionButton
                        icon={<RotateCcw className="h-3 w-3" />}
                        label={t("disable")}
                        onClick={() => void handleTaskAction(item.id, "disable")}
                        busy={taskActionId === item.id}
                      />
                      <ActionButton
                        icon={<Trash2 className="h-3 w-3" />}
                        label={t("cancel")}
                        variant="danger"
                        onClick={() => void handleTaskAction(item.id, "cancel")}
                        busy={taskActionId === item.id}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="rounded-xl border border-border/70 bg-surface-raised/35 p-3">
              <div className="flex items-center gap-2">
                <Brain className="h-3.5 w-3.5 text-text-subtle" />
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
                  {t("assistantActions")}
                </p>
              </div>
              <p className="mt-1 text-[11px] text-text-subtle">
                {t("assistantActionsDescription")}
              </p>
              {assistantTaskItems.length === 0 ? (
                <p className="mt-3 text-xs text-text-subtle">{t("noAssistantActions")}</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {assistantTaskItems.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-lg border border-border/60 bg-background/40 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-muted">
                          {item.title}
                        </span>
                        <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold text-text-subtle">
                          {getAssistantActionTypeLabel(item)}
                        </span>
                        <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold text-text-subtle">
                          {t("assistantAction")}
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] text-text-subtle">
                        {getTaskTimingLabel(item)}
                      </p>
                      <div className="mt-2 flex gap-1.5">
                        <ActionButton
                          icon={<RotateCcw className="h-3 w-3" />}
                          label={t("disable")}
                          onClick={() => void handleTaskAction(item.id, "disable")}
                          busy={taskActionId === item.id}
                        />
                        <ActionButton
                          icon={<Trash2 className="h-3 w-3" />}
                          label={t("cancel")}
                          variant="danger"
                          onClick={() => void handleTaskAction(item.id, "cancel")}
                          busy={taskActionId === item.id}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Section>

      {/* 5. Channels */}
      <Section icon={<Send className="h-4 w-4" />} title={t("channels")} defaultOpen={false}>
        <div className="space-y-1.5">
          <ChannelRow
            name="Telegram"
            connected={
              data.telegram?.connectionStatus === "connected" ||
              data.telegram?.connectionStatus === "claim_required"
            }
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
        defaultOpen={false}
        forceOpen={initialSection === "limits"}
      >
        {data.plan ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-text">
                {data.plan.effectivePlan.displayName ?? t("freePlan")}
              </p>
              {data.plan.effectivePlan.code && (
                <span className="text-[11px] text-text-muted">{data.plan.effectivePlan.code}</span>
              )}
            </div>
            <LimitBar
              label={t("tokenBudget")}
              pct={data.plan.limits.tokenBudgetPercent}
              valueLabel={
                data.plan.limits.tokenBudgetLimit === null
                  ? String(data.plan.limits.tokenBudgetUsed)
                  : `${data.plan.limits.tokenBudgetUsed}/${data.plan.limits.tokenBudgetLimit}`
              }
            />
            <LimitBar
              label={t("activeChats")}
              pct={data.plan.limits.activeWebChatsPercent}
              valueLabel={
                data.plan.limits.activeWebChatsLimit === null
                  ? String(data.plan.limits.activeWebChatsUsed)
                  : `${data.plan.limits.activeWebChatsUsed}/${data.plan.limits.activeWebChatsLimit}`
              }
            />
            {data.plan.limits.toolDailyLimits.length > 0 && (
              <div className="rounded-lg border border-border/80 bg-surface-raised/40 p-3">
                <p className="mb-2 text-xs font-medium text-text">{t("toolLimits")}</p>
                <ul className="space-y-1.5">
                  {data.plan.limits.toolDailyLimits.map((tool) => (
                    <li key={tool.toolCode} className="flex items-center gap-2 text-[11px]">
                      <span
                        className={cn(
                          "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                          tool.dailyCallLimit !== null && tool.dailyCallsUsed >= tool.dailyCallLimit
                            ? "bg-destructive"
                            : "bg-accent"
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-text">{tool.displayName}</span>
                      <span className="shrink-0 tabular-nums text-text-muted">
                        {tool.dailyCallLimit === null
                          ? "∞"
                          : `${tool.dailyCallsUsed}/${tool.dailyCallLimit}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-text-subtle">{t("planUnavailable")}</p>
        )}
      </Section>

      {/* 7. Publish history */}
      <Section
        icon={<History className="h-4 w-4" />}
        title={t("publishHistory")}
        defaultOpen={false}
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
  comingSoon
}: {
  name: string;
  connected?: boolean;
  comingSoon?: boolean;
}) {
  const t = useTranslations("settings");
  return (
    <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2", comingSoon && "opacity-50")}>
      <span
        className={cn(
          "inline-block h-2 w-2 rounded-full",
          connected ? "bg-success" : "bg-text-subtle"
        )}
      />
      <span className="text-xs text-text-muted">{name}</span>
      {comingSoon && <span className="text-[10px] text-text-subtle">{t("channelComingSoon")}</span>}
      {connected && <span className="text-[10px] text-success">{t("channelConnected")}</span>}
    </div>
  );
}

function LimitBar({ label, pct, valueLabel }: { label: string; pct: number; valueLabel?: string }) {
  return (
    <div>
      <div className="flex justify-between text-[11px]">
        <span className="text-text-muted">{label}</span>
        <span className="text-text-subtle">{valueLabel ?? `${pct}%`}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-raised/80">
        <div
          className={cn("h-full rounded-full", pct >= 90 ? "bg-destructive" : "bg-accent")}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}
