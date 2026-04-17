"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { motion, AnimatePresence } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import type { AssistantLifecycleState } from "@persai/contracts";
import {
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Loader2,
  ChevronRight,
  RefreshCcw,
  Upload,
  Globe,
  ChevronDown,
  Calendar,
  User
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import { LandingLocaleSwitcher } from "@/app/_components/landing-locale-switcher";
import { useAppDataContext } from "../_components/app-shell";
import {
  getAssistant,
  getAssistantVoiceSettings,
  patchAssistantDraft,
  postAssistantCreate,
  postAssistantPublish,
  postAssistantSetupPreview,
  uploadAssistantAvatar,
  type AssistantVoiceSettingsState
} from "../assistant-api-client";
import { getMe, postOnboarding } from "../me-api-client";
import {
  ASSISTANT_GENDER_OPTIONS,
  DEFAULT_TRAITS,
  PERSONA_PRESETS,
  TRAIT_SLIDERS,
  type AssistantGender,
  type PersonaPreset,
  type TraitKey
} from "../_components/assistant-persona";
import {
  filterVoiceOptions,
  OPENAI_VOICE_OPTIONS,
  resolveDefaultOpenAiVoiceOption,
  resolveDefaultYandexVoiceOption,
  YANDEX_VOICE_OPTIONS
} from "../_components/assistant-voice-options";

const AVATARS = [
  { id: "nova", emoji: "🌟", label: "Nova" },
  { id: "sage", emoji: "🧠", label: "Sage" },
  { id: "spark", emoji: "⚡", label: "Spark" },
  { id: "zen", emoji: "🧘", label: "Zen" },
  { id: "pixel", emoji: "🤖", label: "Pixel" },
  { id: "luna", emoji: "🌙", label: "Luna" },
  { id: "blaze", emoji: "🔥", label: "Blaze" },
  { id: "echo", emoji: "🔮", label: "Echo" },
  { id: "drift", emoji: "🌊", label: "Drift" },
  { id: "prism", emoji: "💎", label: "Prism" },
  { id: "flux", emoji: "✨", label: "Flux" },
  { id: "orbit", emoji: "🪐", label: "Orbit" }
];

type Gender = "male" | "female" | "other" | null;
type SetupMode = "create" | "recover" | "recreate";

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" }
];

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

const STEP_COUNT = 4;
const DEFAULT_SETUP_VOICE_PROFILE: AssistantLifecycleState["draft"]["voiceProfile"] = {
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
    voice: "sage"
  }
};

function normalizeBirthdayForDateInput(value: string | null | undefined): string {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : value.slice(0, 10);
}

function findAvatarIdByEmoji(emoji: string | null | undefined): string | null {
  if (!emoji) return null;
  return AVATARS.find((avatar) => avatar.emoji === emoji)?.id ?? null;
}

function resolveSetupMode(assistant: AssistantLifecycleState | null): SetupMode {
  if (assistant === null) return "create";
  const draft = assistant.draft;
  const hasDraftContent =
    (draft.displayName?.trim().length ?? 0) > 0 ||
    (draft.instructions?.trim().length ?? 0) > 0 ||
    draft.avatarEmoji !== null ||
    draft.avatarUrl !== null ||
    draft.assistantGender !== null ||
    (draft.traits !== null && draft.traits !== undefined && Object.keys(draft.traits).length > 0);
  return hasDraftContent ? "recover" : "recreate";
}

function resolveSetupVoiceProfile(input: {
  assistantGender: AssistantGender;
  existingVoiceProfile: AssistantLifecycleState["draft"]["voiceProfile"] | null | undefined;
  voiceSettings: AssistantVoiceSettingsState | null;
}): AssistantLifecycleState["draft"]["voiceProfile"] {
  const base = input.existingVoiceProfile ?? DEFAULT_SETUP_VOICE_PROFILE;
  const allowedYandexVoices = filterVoiceOptions(YANDEX_VOICE_OPTIONS, input.assistantGender);
  const allowedOpenAiVoices = filterVoiceOptions(OPENAI_VOICE_OPTIONS, input.assistantGender);
  const nextYandexVoice = allowedYandexVoices.some((voice) => voice.value === base.yandex.voice)
    ? base.yandex.voice
    : resolveDefaultYandexVoiceOption(input.assistantGender);
  const nextOpenAiVoice = allowedOpenAiVoices.some((voice) => voice.value === base.openai.voice)
    ? base.openai.voice
    : resolveDefaultOpenAiVoiceOption(input.assistantGender);

  const loadedElevenLabsVoices = input.voiceSettings?.elevenlabs?.voices ?? [];
  const allowedElevenLabsVoices =
    input.assistantGender === "neutral"
      ? loadedElevenLabsVoices
      : loadedElevenLabsVoices.filter((voice) => voice.gender === input.assistantGender);
  const fallbackElevenLabsVoice =
    allowedElevenLabsVoices[0]?.voiceId ?? loadedElevenLabsVoices[0]?.voiceId ?? null;
  const currentElevenLabsVoiceId = base.elevenlabs.voiceId;
  const nextElevenLabsVoiceId =
    currentElevenLabsVoiceId &&
    loadedElevenLabsVoices.some((voice) => voice.voiceId === currentElevenLabsVoiceId) &&
    (input.assistantGender === "neutral" ||
      allowedElevenLabsVoices.some((voice) => voice.voiceId === currentElevenLabsVoiceId))
      ? currentElevenLabsVoiceId
      : fallbackElevenLabsVoice;

  return {
    schema: "persai.assistantVoiceProfile.v1",
    defaultLocale: base.defaultLocale?.trim()
      ? base.defaultLocale
      : DEFAULT_SETUP_VOICE_PROFILE.defaultLocale,
    deliveryKind: base.deliveryKind === "audio" ? "audio" : "voice_note",
    elevenlabs: {
      voiceId: nextElevenLabsVoiceId
    },
    yandex: {
      voice: nextYandexVoice,
      role: null
    },
    openai: {
      voice: nextOpenAiVoice
    }
  };
}

/* ------------------------------------------------------------------ */
/*  Wizard component                                                   */
/* ------------------------------------------------------------------ */

export default function SetupWizardPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const appData = useAppDataContext();
  const t = useTranslations("setup");
  const tp = useTranslations("persona");
  const locale = useLocale();

  const [step, setStep] = useState(0);

  // Step 0 — about user
  const [userName, setUserName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [gender, setGender] = useState<Gender>(null);
  const [timezone, setTimezone] = useState("");

  // Step 1 — assistant identity
  const [assistantName, setAssistantName] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);
  const [customAvatarFile, setCustomAvatarFile] = useState<File | null>(null);
  const [customAvatarPreviewUrl, setCustomAvatarPreviewUrl] = useState<string | null>(null);
  const [persistedAvatarUrl, setPersistedAvatarUrl] = useState<string | null>(null);
  const [assistantGender, setAssistantGender] = useState<AssistantGender>("neutral");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2 — personality
  const [traits, setTraits] = useState<Record<TraitKey, number>>(DEFAULT_TRAITS);
  const [assistantNotes, setAssistantNotes] = useState("");
  const [selectedPresetKey, setSelectedPresetKey] = useState<string | null>(null);
  const presetInitGenderRef = useRef<string | null>(null);

  // Step 3 — create
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runtimePreview, setRuntimePreview] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewDraftPersistedRef = useRef(false);
  const autoPreviewStepRef = useRef<number | null>(null);
  const [existingAssistant, setExistingAssistant] = useState<AssistantLifecycleState | null>(null);
  const [voiceSettings, setVoiceSettings] = useState<AssistantVoiceSettingsState | null>(null);
  const [setupMode, setSetupMode] = useState<SetupMode>("create");
  const currentAvatarPreviewUrl = customAvatarPreviewUrl ?? persistedAvatarUrl;
  const setupVoiceProfile = useMemo(
    () =>
      resolveSetupVoiceProfile({
        assistantGender,
        existingVoiceProfile: existingAssistant?.draft.voiceProfile,
        voiceSettings
      }),
    [assistantGender, existingAssistant?.draft.voiceProfile, voiceSettings]
  );

  useEffect(() => {
    setTimezone(detectTimezone());

    void (async () => {
      try {
        const token = await getToken();
        if (!token) return;

        const existing = await getAssistant(token);
        if (existing && existing.runtimeApply.status === "succeeded") {
          await appData.reload();
          router.replace("/app");
          return;
        }
        setExistingAssistant(existing);
        setSetupMode(resolveSetupMode(existing));
        if (existing?.draft.displayName) {
          setAssistantName(existing.draft.displayName);
        }
        if (existing?.draft.instructions) {
          setAssistantNotes(existing.draft.instructions);
          setSelectedPresetKey("custom");
        }
        if (existing?.draft.traits) {
          setTraits(existing.draft.traits as Record<TraitKey, number>);
        }
        if (existing?.draft.assistantGender) {
          setAssistantGender(existing.draft.assistantGender as AssistantGender);
        }
        if (existing?.draft.avatarEmoji) {
          setSelectedAvatar(findAvatarIdByEmoji(existing.draft.avatarEmoji));
        }
        if (existing?.draft.avatarUrl) {
          setPersistedAvatarUrl(existing.draft.avatarUrl);
        }
        try {
          const nextVoiceSettings = await getAssistantVoiceSettings(token);
          setVoiceSettings(nextVoiceSettings);
        } catch {
          setVoiceSettings(null);
        }

        const me = await getMe(token);
        const u = me.me.appUser;
        if (u.displayName) setUserName(u.displayName);
        if (u.birthday) setBirthday(normalizeBirthdayForDateInput(u.birthday));
        if (u.gender) setGender(u.gender as Gender);
        if (me.me.workspace?.timezone) setTimezone(me.me.workspace.timezone);
      } catch {
        // Pre-fill is best-effort; ignore errors.
      }
    })();
  }, [appData, getToken, router]);

  // Auto-apply first preset when entering step 2, reset when gender changes
  useEffect(() => {
    if (step !== 2) return;
    if (setupMode === "recover") return;
    const genderKey = assistantGender ?? "neutral";
    if (presetInitGenderRef.current === genderKey && selectedPresetKey !== null) return;
    presetInitGenderRef.current = genderKey;
    const presets = PERSONA_PRESETS[genderKey];
    const first = presets[0];
    if (!first) return;
    setSelectedPresetKey(first.key);
    setTraits({ ...first.traits });
    setAssistantNotes(
      first.buildInstructions(
        assistantName.trim() || "your assistant",
        userName.trim() || "you",
        locale
      )
    );
  }, [assistantGender, setupMode, step]); // intentionally omits preset deps — runs only on step/gender change

  useEffect(() => {
    return () => {
      if (customAvatarPreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(customAvatarPreviewUrl);
      }
    };
  }, [customAvatarPreviewUrl]);

  const canProceed = useMemo(() => {
    if (step === 0) return userName.trim().length >= 2 && gender !== null && timezone.length > 0;
    if (step === 1)
      return (
        assistantName.trim().length >= 2 &&
        (selectedAvatar !== null || currentAvatarPreviewUrl !== null)
      );
    return true;
  }, [step, userName, gender, timezone, assistantName, selectedAvatar, currentAvatarPreviewUrl]);

  const avatarObj = useMemo(() => AVATARS.find((a) => a.id === selectedAvatar), [selectedAvatar]);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      if (customAvatarPreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(customAvatarPreviewUrl);
      }
      setCustomAvatarFile(file);
      setCustomAvatarPreviewUrl(URL.createObjectURL(file));
      setPersistedAvatarUrl(null);
      setSelectedAvatar(null);
    },
    [customAvatarPreviewUrl]
  );

  const updateTrait = useCallback((key: TraitKey, value: number) => {
    setTraits((prev) => ({ ...prev, [key]: value }));
  }, []);

  const currentPresets = useMemo(
    () => PERSONA_PRESETS[assistantGender ?? "neutral"],
    [assistantGender]
  );

  const applyPreset = useCallback(
    (preset: PersonaPreset) => {
      setSelectedPresetKey(preset.key);
      setTraits({ ...preset.traits });
      setAssistantNotes(
        preset.buildInstructions(
          assistantName.trim() || "your assistant",
          userName.trim() || "you",
          locale
        )
      );
    },
    [assistantName, userName, locale]
  );

  const handleCustomPreset = useCallback(() => {
    setSelectedPresetKey("custom");
    setAssistantNotes("");
  }, []);

  const resolveSetupToken = useCallback(
    async (fresh = false) => {
      const tokenResolver = getToken as (options?: {
        skipCache?: boolean;
      }) => Promise<string | null>;
      const token = await tokenResolver(fresh ? { skipCache: true } : undefined);
      if (!token) {
        throw new Error(t("sessionExpired"));
      }
      return token;
    },
    [getToken, t]
  );

  const buildOnboardingPayload = useCallback(
    () => ({
      displayName: userName.trim(),
      workspaceName: `${userName.trim()}'s workspace`,
      locale: navigator.language ?? "en",
      timezone: timezone || "UTC",
      birthday: birthday || null,
      gender: gender ?? null,
      acceptTermsOfService: true,
      acceptPrivacyPolicy: true
    }),
    [birthday, gender, timezone, userName]
  );

  const persistDraftForPreview = useCallback(async () => {
    await postOnboarding(await resolveSetupToken(true), buildOnboardingPayload());

    if (existingAssistant === null) {
      const createdAssistant = await postAssistantCreate(await resolveSetupToken(true));
      setExistingAssistant(createdAssistant);
    }

    await patchAssistantDraft(await resolveSetupToken(true), {
      displayName: assistantName.trim(),
      instructions: assistantNotes.trim(),
      traits,
      avatarEmoji: customAvatarFile ? null : (avatarObj?.emoji ?? null),
      avatarUrl: customAvatarFile ? null : avatarObj?.emoji ? null : persistedAvatarUrl,
      assistantGender,
      voiceProfile: setupVoiceProfile
    });
    previewDraftPersistedRef.current = true;
  }, [
    assistantGender,
    assistantName,
    assistantNotes,
    avatarObj,
    buildOnboardingPayload,
    customAvatarFile,
    existingAssistant,
    persistedAvatarUrl,
    resolveSetupToken,
    setupVoiceProfile,
    traits
  ]);

  const loadRuntimePreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    previewDraftPersistedRef.current = false;
    try {
      await persistDraftForPreview();
      const preview = await postAssistantSetupPreview(await resolveSetupToken(true));
      setRuntimePreview(preview.message);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : t("createFailed"));
    } finally {
      setPreviewLoading(false);
    }
  }, [persistDraftForPreview, resolveSetupToken, t]);

  useEffect(() => {
    if (step !== 3) {
      autoPreviewStepRef.current = null;
      return;
    }
    if (autoPreviewStepRef.current === step) return;
    autoPreviewStepRef.current = step;
    void loadRuntimePreview();
  }, [loadRuntimePreview, step]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setError(null);

    try {
      if (!previewDraftPersistedRef.current) {
        await persistDraftForPreview();
      }

      if (customAvatarFile) {
        const uploaded = await uploadAssistantAvatar(
          await resolveSetupToken(true),
          customAvatarFile
        );
        await patchAssistantDraft(await resolveSetupToken(true), {
          avatarEmoji: null,
          avatarUrl: uploaded.avatarUrl
        });
      }

      await postAssistantPublish(await resolveSetupToken(true));
      await appData.reload();
      router.replace("/app/chat?thread=welcome&welcome=1");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("createFailed"));
      setCreating(false);
    }
  }, [appData, customAvatarFile, persistDraftForPreview, resolveSetupToken, router, t]);

  const setupModeTitle = setupMode === "recover" ? t("recoverModeTitle") : t("recreateModeTitle");
  const setupModeBody = setupMode === "recover" ? t("recoverModeBody") : t("recreateModeBody");
  const submitActionLabel =
    setupMode === "recover"
      ? t("recoverAssistant")
      : setupMode === "recreate"
        ? t("recreateAssistant")
        : t("createAssistant");

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-bg">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between px-6 py-4">
        <span className="text-lg font-bold tracking-tight text-text">
          Pers<span className="text-accent">AI</span>
        </span>
        <div className="flex items-center gap-4">
          <LandingLocaleSwitcher />
          <div className="flex items-center gap-1.5">
            {Array.from({ length: STEP_COUNT }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === step
                    ? "w-6 bg-accent"
                    : i < step
                      ? "w-3 bg-accent/50"
                      : "w-3 bg-surface-raised"
                )}
              />
            ))}
          </div>
        </div>
      </header>

      {/* Content — scrollable only inside */}
      <div className="flex flex-1 items-start justify-center overflow-y-auto px-6 py-8">
        <div className="w-full max-w-5xl">
          {setupMode !== "create" && (
            <div className="mx-auto mb-6 max-w-4xl rounded-2xl border border-accent/25 bg-accent/8 px-4 py-3 text-left">
              <p className="text-sm font-semibold text-text">{setupModeTitle}</p>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">{setupModeBody}</p>
            </div>
          )}
          <AnimatePresence mode="wait">
            {/* ===== Step 0: About you ===== */}
            {step === 0 && (
              <StepContainer key="step-0">
                <h1 className="text-3xl font-bold text-text sm:text-4xl">{t("step0Title")}</h1>
                <p className="mt-3 text-base text-text-muted">{t("step0Subtitle")}</p>

                <div className="mt-8 w-full max-w-sm space-y-4">
                  {/* User name */}
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-muted">
                      <User className="h-3.5 w-3.5" />
                      {t("yourName")}
                    </label>
                    <input
                      type="text"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      placeholder={t("namePlaceholder")}
                      maxLength={40}
                      autoFocus
                      className="w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm text-text placeholder:text-text-subtle outline-none transition-colors focus:border-accent"
                    />
                  </div>

                  {/* Birthday */}
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-muted">
                      <Calendar className="h-3.5 w-3.5" />
                      {t("birthday")}
                    </label>
                    <input
                      type="date"
                      value={birthday}
                      onChange={(e) => setBirthday(e.target.value)}
                      className="w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm text-text outline-none transition-colors focus:border-accent [color-scheme:dark]"
                    />
                  </div>

                  {/* Gender */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-text-muted">
                      {t("gender")}
                    </label>
                    <div className="flex gap-2">
                      {GENDER_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setGender(opt.value)}
                          className={cn(
                            "flex-1 cursor-pointer rounded-xl border py-2.5 text-sm font-medium transition-all",
                            gender === opt.value
                              ? "border-accent bg-accent/10 text-accent"
                              : "border-border bg-surface-raised text-text-muted hover:border-border-strong hover:text-text"
                          )}
                        >
                          {t(
                            opt.value === "male"
                              ? "genderMale"
                              : opt.value === "female"
                                ? "genderFemale"
                                : "genderOther"
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Timezone */}
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-muted">
                      <Globe className="h-3.5 w-3.5" />
                      {t("timezone")}
                    </label>
                    <TimezoneSelect value={timezone} onChange={setTimezone} />
                  </div>
                </div>
              </StepContainer>
            )}

            {/* ===== Step 1: Assistant identity ===== */}
            {step === 1 && (
              <StepContainer key="step-1">
                <h1 className="text-3xl font-bold text-text sm:text-4xl">{t("step1Title")}</h1>
                <p className="mt-3 text-base text-text-muted">{t("step1Subtitle")}</p>

                {/* Assistant name */}
                <input
                  type="text"
                  value={assistantName}
                  onChange={(e) => setAssistantName(e.target.value)}
                  placeholder={t("assistantNamePlaceholder")}
                  maxLength={40}
                  autoFocus
                  className="mt-8 w-full max-w-sm rounded-xl border border-border bg-surface-raised px-5 py-3.5 text-center text-lg font-medium text-text placeholder:text-text-subtle outline-none transition-colors focus:border-accent"
                />

                {/* Avatars */}
                <div className="mt-6 grid grid-cols-4 gap-2.5 sm:grid-cols-7">
                  {AVATARS.map((av) => (
                    <button
                      key={av.id}
                      type="button"
                      onClick={() => {
                        setSelectedAvatar(av.id);
                        setPersistedAvatarUrl(null);
                        if (customAvatarPreviewUrl?.startsWith("blob:")) {
                          URL.revokeObjectURL(customAvatarPreviewUrl);
                        }
                        setCustomAvatarFile(null);
                        setCustomAvatarPreviewUrl(null);
                      }}
                      className={cn(
                        "flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 p-2.5 transition-all",
                        selectedAvatar === av.id && customAvatarPreviewUrl === null
                          ? "border-accent bg-accent/10 scale-105"
                          : "border-transparent bg-surface-raised hover:bg-surface-hover hover:border-border-strong"
                      )}
                    >
                      <span className="text-2xl">{av.emoji}</span>
                      <span className="text-[9px] font-medium text-text-muted">{av.label}</span>
                    </button>
                  ))}

                  {/* Upload */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-2.5 transition-all",
                      currentAvatarPreviewUrl
                        ? "border-accent bg-accent/10"
                        : "border-border-strong bg-surface-raised hover:bg-surface-hover hover:border-accent/50"
                    )}
                  >
                    {currentAvatarPreviewUrl ? (
                      <img
                        src={currentAvatarPreviewUrl}
                        alt="Custom"
                        className="h-7 w-7 rounded-full object-cover"
                      />
                    ) : (
                      <Upload className="h-5 w-5 text-text-subtle" />
                    )}
                    <span className="text-[9px] font-medium text-text-muted">
                      {currentAvatarPreviewUrl ? t("yours") : t("upload")}
                    </span>
                  </button>
                </div>

                <div className="mt-6 w-full max-w-md space-y-2">
                  <label className="block text-xs font-medium text-text-muted">
                    {t("assistantGender")}
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {ASSISTANT_GENDER_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setAssistantGender(opt.value)}
                        className={cn(
                          "rounded-xl border px-3 py-2.5 text-sm font-medium transition-all",
                          assistantGender === opt.value
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-border bg-surface-raised text-text-muted hover:border-border-strong hover:text-text"
                        )}
                      >
                        {tp(opt.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </StepContainer>
            )}

            {/* ===== Step 2: Personality ===== */}
            {step === 2 && (
              <StepContainer key="step-2" className="max-w-5xl">
                <div className="w-full">
                  <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
                    <div className="relative mb-1 inline-flex flex-col items-center lg:items-start">
                      <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface text-4xl shadow-[0_0_48px_rgba(102,187,106,0.18)]">
                        {currentAvatarPreviewUrl ? (
                          <img
                            src={currentAvatarPreviewUrl}
                            alt={assistantName}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span>{avatarObj?.emoji ?? "🤖"}</span>
                        )}
                      </div>
                      <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-bg bg-accent">
                        <span className="h-1.5 w-1.5 rounded-full bg-white" />
                      </span>
                    </div>
                    {assistantName && (
                      <p className="mt-2.5 text-sm font-medium text-text-muted">{assistantName}</p>
                    )}
                    <h1 className="mt-5 text-3xl font-bold text-text sm:text-4xl">
                      {t("step2Title")}
                    </h1>
                    <p className="mt-2 max-w-2xl text-base text-text-muted">
                      {t("step2Subtitle", { name: assistantName })}
                    </p>
                  </div>

                  <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(320px,1.05fr)] lg:items-end">
                    <div className="space-y-6">
                      <div className="rounded-2xl border border-border bg-surface-raised/70 p-5 text-left">
                        <p className="mb-2.5 text-xs font-medium text-text-muted">
                          {t("presetSectionLabel")}
                        </p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {currentPresets.map((preset) => (
                            <button
                              key={preset.key}
                              type="button"
                              onClick={() => applyPreset(preset)}
                              className={cn(
                                "truncate rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all",
                                selectedPresetKey === preset.key
                                  ? "border-accent bg-accent/10 text-accent shadow-[0_0_20px_rgba(102,187,106,0.12)]"
                                  : "border-border bg-surface text-text-muted hover:border-border-strong hover:text-text"
                              )}
                            >
                              {tp(preset.labelKey)}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={handleCustomPreset}
                            className={cn(
                              "truncate rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all",
                              selectedPresetKey === "custom"
                                ? "border-accent bg-accent/10 text-accent shadow-[0_0_20px_rgba(102,187,106,0.12)]"
                                : "border-border bg-surface text-text-muted hover:border-border-strong hover:text-text"
                            )}
                          >
                            {t("presetCustom")}
                          </button>
                        </div>
                        <p className="mt-2 min-h-[1.25rem] text-[11px] text-text-subtle">
                          {selectedPresetKey === "custom"
                            ? t("presetCustomDesc")
                            : currentPresets.find((p) => p.key === selectedPresetKey)?.descKey
                              ? tp(currentPresets.find((p) => p.key === selectedPresetKey)!.descKey)
                              : ""}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-border bg-surface-raised/70 p-5 text-left">
                        <p className="mb-4 text-xs font-medium text-text-muted">{t("fineTune")}</p>
                        <div className="space-y-4">
                          {TRAIT_SLIDERS.map((trait) => (
                            <div key={trait.key}>
                              <div className="mb-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs font-medium">
                                <span className="truncate text-text-muted">
                                  {tp(trait.labelLeftKey)}
                                </span>
                                <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-text-subtle">
                                  {traits[trait.key]}
                                </span>
                                <span className="truncate text-right text-text-muted">
                                  {tp(trait.labelRightKey)}
                                </span>
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={100}
                                step={10}
                                value={traits[trait.key]}
                                onChange={(e) => updateTrait(trait.key, Number(e.target.value))}
                                className="w-full cursor-pointer accent-accent"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-surface-raised/70 p-5 text-left">
                      <label className="block text-xs font-medium text-text-muted">
                        {t("describeCharacter")}
                      </label>
                      <textarea
                        value={assistantNotes}
                        onChange={(e) => setAssistantNotes(e.target.value)}
                        rows={10}
                        className="mt-2 min-h-[320px] w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-text outline-none transition-colors focus:border-accent"
                        placeholder={t("instructionPlaceholder")}
                      />
                      <p className="mt-2 text-[11px] text-text-subtle">{t("instructionHint")}</p>
                    </div>
                  </div>
                </div>
              </StepContainer>
            )}

            {/* ===== Step 3: Preview ===== */}
            {step === 3 && (
              <StepContainer key="step-3" className="max-w-4xl">
                <h1 className="text-3xl font-bold text-text sm:text-4xl">
                  {t("step3Title", { name: assistantName })}
                </h1>
                <p className="mt-3 text-base text-text-muted">{t("step3Subtitle")}</p>
                <p className="mt-2 max-w-md text-center text-xs text-text-subtle">
                  {t("previewPromptHint")}
                </p>

                {/* Simulated chat */}
                <div className="mt-8 w-full max-w-3xl rounded-3xl border border-border bg-surface p-6 text-left shadow-[0_0_0_1px_rgba(255,255,255,0.02)] sm:p-7">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xl overflow-hidden">
                      {currentAvatarPreviewUrl ? (
                        <img
                          src={currentAvatarPreviewUrl}
                          alt={assistantName}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span>{avatarObj?.emoji ?? "🤖"}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-text">{assistantName}</p>
                      <p className="text-[10px] text-text-subtle">
                        {t("introducingTo", { user: userName || "you" })}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-surface-raised px-5 py-4 sm:px-6 sm:py-5">
                    {previewLoading ? (
                      <div className="flex min-h-[120px] items-center gap-3 py-2">
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
                        <p className="text-sm text-text-muted">{t("previewLoading")}</p>
                      </div>
                    ) : (
                      <p className="min-h-[120px] text-base leading-relaxed text-text sm:min-h-[140px]">
                        {runtimePreview || t("previewNotReady")}
                      </p>
                    )}
                  </div>
                </div>

                {assistantGender && (
                  <p className="mt-3 text-xs text-text-subtle">
                    {t("identity", { gender: assistantGender })}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => void loadRuntimePreview()}
                  disabled={previewLoading || creating}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-hover disabled:opacity-50"
                >
                  <RefreshCcw className={cn("h-4 w-4", previewLoading && "animate-spin")} />
                  {t("refreshPreview")}
                </button>

                {(previewError || error) && (
                  <p className="mt-4 text-sm text-destructive">{previewError ?? error}</p>
                )}

                <p className="mt-6 text-[10px] text-text-subtle/60 max-w-xs">{t("termsNotice")}</p>
              </StepContainer>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Footer */}
      <footer className="flex shrink-0 items-center justify-between border-t border-border px-6 py-4">
        <div>
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              disabled={creating}
              className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-surface-raised px-5 py-2.5 text-sm font-medium text-text transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("back")}
            </button>
          )}
        </div>
        <div>
          {step < STEP_COUNT - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canProceed}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-xl px-6 py-2.5 text-sm font-semibold transition-all",
                canProceed
                  ? "bg-accent text-white shadow-lg shadow-accent-glow hover:bg-accent-hover"
                  : "cursor-default bg-surface-raised text-text-subtle"
              )}
            >
              {t("continue")}
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : runtimePreview && !previewLoading ? (
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              className="flex cursor-pointer items-center gap-2 rounded-xl bg-accent px-8 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent-glow transition-all hover:bg-accent-hover disabled:opacity-70"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("creating")}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  {submitActionLabel}
                  <ChevronRight className="h-4 w-4" />
                </>
              )}
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-xl bg-surface-raised px-6 py-2.5 text-sm text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
              {t("preparingPreview")}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared step container                                              */
/* ------------------------------------------------------------------ */

function StepContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      className={cn("flex w-full max-w-lg flex-col items-center text-center", className)}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -24 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Custom timezone dropdown (dark, no page scroll)                    */
/* ------------------------------------------------------------------ */

const ALL_TIMEZONES = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
})();

function TimezoneSelect({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  const t = useTranslations("setup");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return ALL_TIMEZONES;
    const q = search.toLowerCase().replace(/\s+/g, "_");
    return ALL_TIMEZONES.filter((tz) => tz.toLowerCase().includes(q));
  }, [search]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      setSearch("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const select = useCallback(
    (tz: string) => {
      onChange(tz);
      setOpen(false);
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "Enter" && filtered.length > 0) {
        select(filtered[0]!);
      }
    },
    [filtered, select]
  );

  const display = value ? value.replace(/_/g, " ") : t("selectTimezone");

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 rounded-xl border bg-surface-raised px-4 py-3 text-left transition-colors",
          open ? "border-accent" : "border-border hover:border-border-strong"
        )}
      >
        <span className={cn("flex-1 text-sm", value ? "text-text" : "text-text-subtle")}>
          {display}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 text-text-subtle transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 bottom-full z-20 mb-1 rounded-xl border border-border bg-surface shadow-2xl">
          <div className="border-b border-border px-3 py-2.5">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("searchTimezone")}
              className="w-full bg-transparent text-sm text-text placeholder:text-text-subtle outline-none"
            />
          </div>
          <div className="custom-scrollbar max-h-44 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-text-subtle">{t("noMatches")}</p>
            ) : (
              filtered.slice(0, 100).map((tz) => (
                <button
                  key={tz}
                  type="button"
                  onClick={() => select(tz)}
                  className={cn(
                    "flex w-full cursor-pointer px-3 py-1.5 text-left text-sm transition-colors",
                    tz === value
                      ? "bg-accent/10 text-accent"
                      : "text-text-muted hover:bg-surface-hover hover:text-text"
                  )}
                >
                  {tz.replace(/_/g, " ")}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
