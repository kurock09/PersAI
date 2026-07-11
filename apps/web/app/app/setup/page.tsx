"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { motion, AnimatePresence } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import type { AssistantLifecycleState } from "@persai/contracts";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
import { userFieldClassName, userTextareaClassName } from "../_components/form-ui";
import { LandingLocaleSwitcher } from "@/app/_components/landing-locale-switcher";
import { useAppDataContext } from "../_components/app-shell";
import {
  getAssistant,
  getAssistantPersonaArchetypes,
  getAssistantSkills,
  getAssistantVoiceSettings,
  patchAssistantDraft,
  postAssistantCreate,
  postAssistantPublish,
  postAssistantSetupPreview,
  updateAssistantSkillAssignments,
  uploadAssistantAvatar,
  type AssistantSkillsState,
  type AssistantPersonaArchetypeState,
  type AssistantVoiceSettingsState
} from "../assistant-api-client";
import { getMe, postOnboarding } from "../me-api-client";
import {
  ASSISTANT_GENDER_OPTIONS,
  DEFAULT_TRAITS,
  DEFAULT_VOICE_DNA_ARCHETYPE_KEY,
  TRAIT_SLIDERS,
  type AssistantGender,
  type TraitKey,
  type VoiceDnaArchetypeKey
} from "../_components/assistant-persona";
import {
  filterVoiceOptions,
  OPENAI_VOICE_OPTIONS,
  resolveDefaultOpenAiVoiceOption,
  resolveDefaultYandexVoiceOption,
  YANDEX_VOICE_OPTIONS
} from "../_components/assistant-voice-options";
import { AssistantSkillsManager } from "../_components/assistant-skills-manager";
import {
  ASSISTANT_AVATAR_PRESETS,
  findAssistantAvatarPresetByUrl
} from "../_components/assistant-avatar-presets";
import { useHistoryBackToClose } from "../_components/use-history-back-to-close";
import { getCountryOptions } from "./country-options";

type Gender = "male" | "female" | "other" | null;
type SetupMode = "create" | "recover" | "recreate";
type SetupEntryMode = "default" | "assistant-only";
type SetupIntent = "default" | "create";

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

async function fetchGeoHint(): Promise<string | null> {
  try {
    const response = await fetch("/api/v1/public/geo-hint", { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      hint?: { suggestedCountryCode?: string | null };
    };
    const value = payload.hint?.suggestedCountryCode;
    return typeof value === "string" && /^[A-Z]{2}$/.test(value) ? value : null;
  } catch {
    return null;
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
const COMPLETION_TRANSITION_MS = 650;
const COMPLETION_TRANSITION_DELAY_MS =
  process.env.NODE_ENV === "test" ? 0 : COMPLETION_TRANSITION_MS;
type LocalizedString = { ru: string; en: string };

function normalizeBirthdayForDateInput(value: string | null | undefined): string {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : value.slice(0, 10);
}

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function resolveLocalizedString(value: LocalizedString, locale: string): string {
  if (locale.toLowerCase().startsWith("ru")) {
    return value.ru || value.en;
  }
  return value.en || value.ru;
}

function toTraitRecord(
  traits: Record<string, number> | null | undefined
): Record<TraitKey, number> {
  return {
    formality: traits?.formality ?? DEFAULT_TRAITS.formality,
    verbosity: traits?.verbosity ?? DEFAULT_TRAITS.verbosity,
    playfulness: traits?.playfulness ?? DEFAULT_TRAITS.playfulness,
    initiative: traits?.initiative ?? DEFAULT_TRAITS.initiative,
    warmth: traits?.warmth ?? DEFAULT_TRAITS.warmth
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function hasAssistantDraftContent(assistant: AssistantLifecycleState): boolean {
  const draft = assistant.draft;
  return (
    (draft.displayName?.trim().length ?? 0) > 0 ||
    (draft.instructions?.trim().length ?? 0) > 0 ||
    draft.avatarEmoji !== null ||
    draft.avatarUrl !== null ||
    draft.assistantGender !== null ||
    (draft.traits !== null && draft.traits !== undefined && Object.keys(draft.traits).length > 0)
  );
}

function resolveSetupMode(
  assistant: AssistantLifecycleState | null,
  options?: { preferCreateForBlankDraft?: boolean }
): SetupMode {
  if (assistant === null) return "create";
  const hasDraftContent = hasAssistantDraftContent(assistant);
  if (!hasDraftContent && options?.preferCreateForBlankDraft) {
    return "create";
  }
  return hasDraftContent ? "recover" : "recreate";
}

function parseSetupEntryMode(value: string | null): SetupEntryMode {
  return value === "assistant-only" ? "assistant-only" : "default";
}

function parseSetupIntent(value: string | null): SetupIntent {
  return value === "create" ? "create" : "default";
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
  const searchParams = useSearchParams();
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const appData = useAppDataContext();
  const t = useTranslations("setup");
  const tp = useTranslations("persona");
  const locale = useLocale();
  const setupEntryMode = parseSetupEntryMode(searchParams.get("entry"));
  const setupIntent = parseSetupIntent(searchParams.get("intent"));
  const startsInAssistantOnlyMode = setupEntryMode === "assistant-only";
  const preferCreateForBlankDraft = startsInAssistantOnlyMode && setupIntent === "create";

  const [step, setStep] = useState(() => (startsInAssistantOnlyMode ? 1 : 0));

  // Step 0 — about user
  const [userName, setUserName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [gender, setGender] = useState<Gender>(null);
  const [countryCode, setCountryCode] = useState<string>("");
  const [timezone, setTimezone] = useState("");

  // Step 1 — assistant identity
  const [assistantName, setAssistantName] = useState("");
  const [selectedAvatarPresetId, setSelectedAvatarPresetId] = useState<string | null>(
    ASSISTANT_AVATAR_PRESETS[0]?.id ?? null
  );
  const [customAvatarFile, setCustomAvatarFile] = useState<File | null>(null);
  const [customAvatarPreviewUrl, setCustomAvatarPreviewUrl] = useState<string | null>(null);
  const [persistedAvatarUrl, setPersistedAvatarUrl] = useState<string | null>(null);
  const [assistantNameTouched, setAssistantNameTouched] = useState(false);
  const [assistantGender, setAssistantGender] = useState<AssistantGender>("neutral");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2 — personality
  const [traits, setTraits] = useState<Record<TraitKey, number>>(DEFAULT_TRAITS);
  const [assistantNotes, setAssistantNotes] = useState("");
  const [archetypes, setArchetypes] = useState<AssistantPersonaArchetypeState[]>([]);
  const [selectedArchetypeKey, setSelectedArchetypeKey] = useState<VoiceDnaArchetypeKey | null>(
    null
  );

  // Step 3 — create
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runtimePreview, setRuntimePreview] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [skillsState, setSkillsState] = useState<AssistantSkillsState | null>(null);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const previewDraftPersistedRef = useRef(false);
  const autoPreviewStepRef = useRef<number | null>(null);
  const skillsLoadAttemptedRef = useRef(false);
  const setupPrerequisitesRef = useRef({ onboarding: false, assistant: false });
  const setupPrerequisitesPromiseRef = useRef<Promise<void> | null>(null);
  const [existingAssistant, setExistingAssistant] = useState<AssistantLifecycleState | null>(null);
  const [voiceSettings, setVoiceSettings] = useState<AssistantVoiceSettingsState | null>(null);
  const [setupMode, setSetupMode] = useState<SetupMode>("create");
  const [hasCompletedOnboardingProfile, setHasCompletedOnboardingProfile] = useState<
    boolean | null
  >(null);
  const [completionScreen, setCompletionScreen] = useState<{
    title: string;
    body: string;
  } | null>(null);
  const reloadAppDataRef = useRef(appData.reload);
  const selectedAvatarPreset = useMemo(
    () => ASSISTANT_AVATAR_PRESETS.find((avatar) => avatar.id === selectedAvatarPresetId) ?? null,
    [selectedAvatarPresetId]
  );
  const currentAvatarPreviewUrl =
    customAvatarPreviewUrl ?? persistedAvatarUrl ?? selectedAvatarPreset?.imagePath ?? null;
  const isUsingCustomAvatar = selectedAvatarPresetId === null && currentAvatarPreviewUrl !== null;
  const draftAvatarUrl = persistedAvatarUrl ?? selectedAvatarPreset?.imagePath ?? null;
  const setupVoiceProfile = useMemo(
    () =>
      resolveSetupVoiceProfile({
        assistantGender,
        existingVoiceProfile: existingAssistant?.draft.voiceProfile,
        voiceSettings
      }),
    [assistantGender, existingAssistant?.draft.voiceProfile, voiceSettings]
  );
  const shouldSkipProfileStep = startsInAssistantOnlyMode && hasCompletedOnboardingProfile === true;
  const firstAccessibleStep = shouldSkipProfileStep ? 1 : 0;
  const visibleStepCount = shouldSkipProfileStep ? STEP_COUNT - 1 : STEP_COUNT;
  const visibleStepIndex = shouldSkipProfileStep ? Math.max(0, step - 1) : step;

  useEffect(() => {
    reloadAppDataRef.current = appData.reload;
  }, [appData.reload]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      return;
    }

    setTimezone(detectTimezone());

    void (async () => {
      try {
        const token = await getToken();
        if (!token) {
          return;
        }

        try {
          const runtimeArchetypes = await getAssistantPersonaArchetypes(token);
          setArchetypes(runtimeArchetypes);
        } catch {
          setArchetypes([]);
        }

        try {
          const existing = await getAssistant(token);
          if (existing && existing.runtimeApply.status === "succeeded") {
            await reloadAppDataRef.current();
            router.replace("/app");
            return;
          }
          setExistingAssistant(existing);
          if (existing !== null) {
            setupPrerequisitesRef.current.assistant = true;
          }
          const nextSetupMode = resolveSetupMode(existing, {
            preferCreateForBlankDraft
          });
          setSetupMode(nextSetupMode);
          if (existing?.draft.displayName) {
            setAssistantName(existing.draft.displayName);
            setAssistantNameTouched(true);
          }
          if (existing?.draft.instructions) {
            setAssistantNotes(existing.draft.instructions);
          }
          if (existing?.draft.traits) {
            setTraits(toTraitRecord(existing.draft.traits));
          }
          if (existing?.draft.archetypeKey) {
            setSelectedArchetypeKey(existing.draft.archetypeKey as VoiceDnaArchetypeKey);
          }
          if (existing?.draft.assistantGender) {
            setAssistantGender(existing.draft.assistantGender as AssistantGender);
          }
          if (existing?.draft.avatarUrl) {
            setPersistedAvatarUrl(existing.draft.avatarUrl);
            setSelectedAvatarPresetId(
              findAssistantAvatarPresetByUrl(existing.draft.avatarUrl)?.id ?? null
            );
          } else if (!existing?.draft.displayName && nextSetupMode !== "recover") {
            setSelectedAvatarPresetId(ASSISTANT_AVATAR_PRESETS[0]?.id ?? null);
            setAssistantName(ASSISTANT_AVATAR_PRESETS[0]?.defaultName ?? "");
          }
        } catch {
          setExistingAssistant(null);
          setSetupMode(resolveSetupMode(null, { preferCreateForBlankDraft }));
        }

        try {
          const nextVoiceSettings = await getAssistantVoiceSettings(token);
          setVoiceSettings(nextVoiceSettings);
        } catch {
          setVoiceSettings(null);
        }

        try {
          const me = await getMe(token);
          const u = me.me.appUser;
          const onboardingComplete = me.me.onboarding.isComplete;
          setHasCompletedOnboardingProfile(onboardingComplete);
          if (startsInAssistantOnlyMode) {
            setStep(onboardingComplete ? 1 : 0);
          }
          if (u.displayName) setUserName(u.displayName);
          if (u.birthday) setBirthday(normalizeBirthdayForDateInput(u.birthday));
          if (u.gender) setGender(u.gender as Gender);
          if (u.countryCode) {
            setCountryCode(u.countryCode);
          } else {
            const suggestedCountryCode = await fetchGeoHint();
            if (suggestedCountryCode) {
              setCountryCode(suggestedCountryCode);
            }
          }
          if (me.me.workspace?.timezone) setTimezone(me.me.workspace.timezone);
        } catch {
          // Profile pre-fill is best-effort before onboarding completes.
        }
      } catch {
        // Pre-fill is best-effort; ignore errors.
      }
    })();
  }, [
    getToken,
    isLoaded,
    isSignedIn,
    preferCreateForBlankDraft,
    router,
    startsInAssistantOnlyMode
  ]);

  useEffect(() => {
    if (!countryCode) {
      return;
    }
    try {
      document.cookie = `persai-country=${encodeURIComponent(countryCode)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
      // jsdom test environment may not provide a full cookie URL context.
    }
  }, [countryCode]);

  useEffect(() => {
    if (setupMode === "recover") {
      return;
    }
    if (assistantNameTouched || assistantName.trim().length > 0) {
      return;
    }
    const defaultPreset = ASSISTANT_AVATAR_PRESETS[0];
    if (!defaultPreset) {
      return;
    }
    setSelectedAvatarPresetId((current) => current ?? defaultPreset.id);
    setAssistantName(defaultPreset.defaultName);
  }, [assistantName, assistantNameTouched, setupMode]);

  useEffect(() => {
    if (step !== 2 || archetypes.length === 0 || selectedArchetypeKey !== null) {
      return;
    }
    const fallbackArchetypeKey =
      (existingAssistant?.draft.archetypeKey as VoiceDnaArchetypeKey | null) ??
      (archetypes[0]?.key as VoiceDnaArchetypeKey | undefined) ??
      DEFAULT_VOICE_DNA_ARCHETYPE_KEY;
    const fallbackArchetype = archetypes.find((entry) => entry.key === fallbackArchetypeKey);
    setSelectedArchetypeKey(fallbackArchetypeKey);
    if (!existingAssistant?.draft.traits && fallbackArchetype) {
      setTraits(toTraitRecord(fallbackArchetype.defaultTraits));
    }
  }, [
    archetypes,
    existingAssistant?.draft.archetypeKey,
    existingAssistant?.draft.traits,
    selectedArchetypeKey,
    step
  ]);

  useEffect(() => {
    return () => {
      if (customAvatarPreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(customAvatarPreviewUrl);
      }
    };
  }, [customAvatarPreviewUrl]);

  const canProceed = useMemo(() => {
    if (step === 0) {
      return (
        userName.trim().length >= 2 &&
        gender !== null &&
        countryCode.length === 2 &&
        timezone.length > 0
      );
    }
    if (step === 1)
      return (
        assistantName.trim().length >= 2 &&
        (selectedAvatarPresetId !== null || currentAvatarPreviewUrl !== null)
      );
    return true;
  }, [
    step,
    userName,
    gender,
    countryCode,
    timezone,
    assistantName,
    selectedAvatarPresetId,
    currentAvatarPreviewUrl
  ]);

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
      setSelectedAvatarPresetId(null);
    },
    [customAvatarPreviewUrl]
  );

  const handleSelectAvatarPreset = useCallback(
    (presetId: string) => {
      const nextPreset = ASSISTANT_AVATAR_PRESETS.find((preset) => preset.id === presetId);
      const currentPreset = ASSISTANT_AVATAR_PRESETS.find(
        (preset) => preset.id === selectedAvatarPresetId
      );
      const currentName = assistantName.trim();
      setSelectedAvatarPresetId(presetId);
      setPersistedAvatarUrl(nextPreset?.imagePath ?? null);
      if (customAvatarPreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(customAvatarPreviewUrl);
      }
      setCustomAvatarFile(null);
      setCustomAvatarPreviewUrl(null);
      if (
        nextPreset &&
        (!assistantNameTouched ||
          currentName.length === 0 ||
          currentName === currentPreset?.defaultName)
      ) {
        setAssistantName(nextPreset.defaultName);
      }
    },
    [assistantName, assistantNameTouched, customAvatarPreviewUrl, selectedAvatarPresetId]
  );

  const updateTrait = useCallback((key: TraitKey, value: number) => {
    setTraits((prev) => ({ ...prev, [key]: value }));
  }, []);

  const currentArchetypes = useMemo(
    () => [...archetypes].sort((left, right) => left.displayOrder - right.displayOrder),
    [archetypes]
  );

  const selectedArchetype = useMemo(
    () => currentArchetypes.find((entry) => entry.key === selectedArchetypeKey) ?? null,
    [currentArchetypes, selectedArchetypeKey]
  );

  const applyArchetype = useCallback((archetype: AssistantPersonaArchetypeState) => {
    setSelectedArchetypeKey(archetype.key as VoiceDnaArchetypeKey);
    setTraits(toTraitRecord(archetype.defaultTraits));
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
      locale,
      timezone: timezone || "UTC",
      birthday: birthday || null,
      gender: gender ?? null,
      countryCode: countryCode || null,
      acceptTermsOfService: true,
      acceptPrivacyPolicy: true
    }),
    [birthday, countryCode, gender, locale, timezone, userName]
  );

  const ensureSetupPrerequisites = useCallback(async () => {
    if (setupPrerequisitesRef.current.onboarding && setupPrerequisitesRef.current.assistant) {
      return;
    }

    if (setupPrerequisitesPromiseRef.current !== null) {
      await setupPrerequisitesPromiseRef.current;
      return;
    }

    setupPrerequisitesPromiseRef.current = (async () => {
      if (!shouldSkipProfileStep && !setupPrerequisitesRef.current.onboarding) {
        await postOnboarding(await resolveSetupToken(true), buildOnboardingPayload());
        setupPrerequisitesRef.current.onboarding = true;
        setHasCompletedOnboardingProfile(true);
      }

      if (!setupPrerequisitesRef.current.assistant && existingAssistant === null) {
        const createdAssistant = await postAssistantCreate(await resolveSetupToken(true));
        setupPrerequisitesRef.current.assistant = true;
        setExistingAssistant(createdAssistant);
      }
    })();

    try {
      await setupPrerequisitesPromiseRef.current;
    } finally {
      setupPrerequisitesPromiseRef.current = null;
    }
  }, [buildOnboardingPayload, existingAssistant, resolveSetupToken, shouldSkipProfileStep]);

  const ensureSetupDraftReady = useCallback(async () => {
    await ensureSetupPrerequisites();

    const archetypeKeyForDraft: VoiceDnaArchetypeKey =
      selectedArchetypeKey ??
      (existingAssistant?.draft.archetypeKey as VoiceDnaArchetypeKey | null) ??
      DEFAULT_VOICE_DNA_ARCHETYPE_KEY;

    await patchAssistantDraft(await resolveSetupToken(true), {
      displayName: assistantName.trim(),
      instructions: trimToNull(assistantNotes),
      traits,
      avatarEmoji: null,
      avatarUrl: customAvatarFile ? null : draftAvatarUrl,
      assistantGender,
      voiceProfile: setupVoiceProfile,
      archetypeKey: archetypeKeyForDraft
    });
  }, [
    assistantGender,
    assistantName,
    assistantNotes,
    customAvatarFile,
    draftAvatarUrl,
    ensureSetupPrerequisites,
    existingAssistant?.draft.archetypeKey,
    resolveSetupToken,
    selectedArchetypeKey,
    setupVoiceProfile,
    traits
  ]);

  const persistDraftForPreview = useCallback(async () => {
    await ensureSetupDraftReady();
    previewDraftPersistedRef.current = true;
  }, [ensureSetupDraftReady]);

  const loadSkills = useCallback(async () => {
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      await ensureSetupPrerequisites();
      const nextState = await getAssistantSkills(await resolveSetupToken(true));
      setSkillsState(nextState);
      setSelectedSkillIds(nextState.assignedSkillIds);
    } catch (error) {
      setSkillsError(error instanceof Error ? error.message : t("skillsLoadFailed"));
    } finally {
      setSkillsLoading(false);
    }
  }, [ensureSetupPrerequisites, resolveSetupToken, t]);

  const retryLoadSkills = useCallback(() => {
    skillsLoadAttemptedRef.current = true;
    setSkillsError(null);
    void loadSkills();
  }, [loadSkills]);

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
    if (step !== 2) {
      skillsLoadAttemptedRef.current = false;
      return;
    }
    if (skillsState !== null || skillsLoading || skillsLoadAttemptedRef.current) {
      return;
    }
    skillsLoadAttemptedRef.current = true;
    void loadSkills();
  }, [loadSkills, skillsLoading, skillsState, step]);

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

      await updateAssistantSkillAssignments(await resolveSetupToken(true), {
        skillIds: selectedSkillIds
      });

      await postAssistantPublish(await resolveSetupToken(true));
      await appData.reload();
      await appData.reloadChats();
      const assistantDisplayName = assistantName.trim() || t("assistantFallbackName");
      const title =
        setupMode === "recover"
          ? t("recoverSuccessTitle", { name: assistantDisplayName })
          : setupMode === "recreate"
            ? t("recreateSuccessTitle", { name: assistantDisplayName })
            : t("createSuccessTitle", { name: assistantDisplayName });
      setCompletionScreen({
        title,
        body: t("createSuccessBody", { name: assistantDisplayName })
      });
      await sleep(COMPLETION_TRANSITION_DELAY_MS);
      router.replace("/app/chat?thread=welcome&welcome=1");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("createFailed"));
      setCreating(false);
    }
  }, [
    appData,
    assistantName,
    customAvatarFile,
    persistDraftForPreview,
    resolveSetupToken,
    router,
    selectedSkillIds,
    setupMode,
    t
  ]);

  const submitActionLabel =
    setupMode === "recover"
      ? t("recoverAssistant")
      : setupMode === "recreate"
        ? t("recreateAssistant")
        : t("createAssistant");
  const handleBackStep = useCallback(() => {
    setStep((current) => Math.max(firstAccessibleStep, current - 1));
  }, [firstAccessibleStep]);
  useHistoryBackToClose(
    step > firstAccessibleStep && completionScreen === null && !creating,
    handleBackStep
  );

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-bg">
      <AnimatePresence>
        {completionScreen && (
          <motion.div
            className="absolute inset-0 z-[80] flex items-center justify-center bg-bg/92 px-6 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <motion.div
              className="w-full max-w-md rounded-3xl border border-accent/30 bg-surface px-8 py-10 text-center shadow-[0_0_60px_var(--accent-glow)]"
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.98 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
            >
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/12 text-accent shadow-[0_0_32px_var(--accent-glow)]">
                <Sparkles className="h-8 w-8" />
              </div>
              <h2 className="mt-5 text-2xl font-semibold text-text sm:text-3xl">
                {completionScreen.title}
              </h2>
              <p className="mt-3 text-base leading-relaxed text-text-muted">
                {completionScreen.body}
              </p>
              <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/8 px-4 py-2 text-sm text-text">
                <Loader2 className="h-4 w-4 animate-spin text-accent" />
                {t("openingWelcomeChat")}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="flex shrink-0 items-center justify-between px-6 py-4">
        <span className="text-lg font-bold tracking-tight text-text">
          Pers<span className="text-accent">AI</span>
        </span>
        <div className="flex items-center gap-4">
          <LandingLocaleSwitcher />
          <div className="flex items-center gap-1.5">
            {Array.from({ length: visibleStepCount }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === visibleStepIndex
                    ? "w-6 bg-accent"
                    : i < visibleStepIndex
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
        <div className="flex min-h-full w-full max-w-5xl flex-col">
          <AnimatePresence mode="wait">
            {/* ===== Step 0: About you ===== */}
            {step === 0 && !shouldSkipProfileStep && (
              <StepContainer key="step-0">
                <h1 className="text-3xl font-bold text-text sm:text-4xl">{t("step0Title")}</h1>
                <p className="mt-3 text-base text-text-muted">{t("step0Subtitle")}</p>

                <div className="mt-8 w-full max-w-sm space-y-4">
                  {/* User name */}
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-text">
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
                      className={userFieldClassName()}
                    />
                  </div>

                  {/* Birthday */}
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-text">
                      <Calendar className="h-3.5 w-3.5" />
                      {t("birthday")}
                    </label>
                    <input
                      type="date"
                      value={birthday}
                      onChange={(e) => setBirthday(e.target.value)}
                      className={userFieldClassName("[color-scheme:dark]")}
                    />
                  </div>

                  {/* Gender */}
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-text">
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

                  {/* Country */}
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-text">
                      <Globe className="h-3.5 w-3.5" />
                      {t("country")}
                    </label>
                    <CountrySelect locale={locale} value={countryCode} onChange={setCountryCode} />
                  </div>

                  {/* Timezone */}
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-text">
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
                  onChange={(e) => {
                    setAssistantNameTouched(true);
                    setAssistantName(e.target.value);
                  }}
                  placeholder={t("assistantNamePlaceholder")}
                  maxLength={40}
                  autoFocus
                  className={userFieldClassName(
                    "mt-8 max-w-sm px-5 py-3.5 text-center text-lg font-medium"
                  )}
                />

                {/* Avatars */}
                <div className="mt-6 grid w-full max-w-2xl grid-cols-4 gap-3 sm:gap-3.5">
                  {ASSISTANT_AVATAR_PRESETS.map((av) => (
                    <button
                      key={av.id}
                      type="button"
                      onClick={() => handleSelectAvatarPreset(av.id)}
                      aria-label={av.label}
                      className={cn(
                        "group relative aspect-[0.83] cursor-pointer overflow-hidden rounded-[24px] border text-left transition-all duration-200",
                        selectedAvatarPresetId === av.id && customAvatarPreviewUrl === null
                          ? "border-accent/70 bg-[linear-gradient(180deg,rgba(191,148,84,0.18),rgba(191,148,84,0.08))] shadow-[0_0_0_1px_rgba(191,148,84,0.25),0_18px_40px_rgba(0,0,0,0.22)]"
                          : "border-border/70 bg-surface-raised/80 shadow-[0_10px_28px_rgba(0,0,0,0.16)] hover:border-border-strong hover:bg-surface-hover hover:shadow-[0_16px_36px_rgba(0,0,0,0.22)]"
                      )}
                    >
                      <img
                        src={av.imagePath}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,rgba(12,12,12,0)_0%,rgba(12,12,12,0.62)_52%,rgba(12,12,12,0.9)_100%)] px-3 py-3">
                        <span
                          className={cn(
                            "block rounded-[14px] border px-2.5 py-1.5 text-center text-[11px] font-semibold tracking-[0.01em] backdrop-blur-sm",
                            selectedAvatarPresetId === av.id && customAvatarPreviewUrl === null
                              ? "border-accent/35 bg-[rgba(191,148,84,0.18)] text-white"
                              : "border-white/10 bg-[rgba(18,18,18,0.42)] text-white/92"
                          )}
                        >
                          {av.label}
                        </span>
                      </div>
                    </button>
                  ))}

                  {/* Upload */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label={isUsingCustomAvatar ? t("yours") : t("upload")}
                    className={cn(
                      "group relative aspect-[0.83] cursor-pointer overflow-hidden rounded-[24px] border border-dashed text-left transition-all duration-200",
                      isUsingCustomAvatar
                        ? "border-accent/70 bg-[linear-gradient(180deg,rgba(191,148,84,0.18),rgba(191,148,84,0.08))] shadow-[0_0_0_1px_rgba(191,148,84,0.25),0_18px_40px_rgba(0,0,0,0.22)]"
                        : "border-border-strong bg-surface-raised/80 shadow-[0_10px_28px_rgba(0,0,0,0.16)] hover:border-accent/50 hover:bg-surface-hover hover:shadow-[0_16px_36px_rgba(0,0,0,0.22)]"
                    )}
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(255,255,255,0.08),rgba(255,255,255,0)_58%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div
                        className={cn(
                          "flex h-16 w-16 items-center justify-center rounded-[20px] border backdrop-blur-sm sm:h-[72px] sm:w-[72px]",
                          isUsingCustomAvatar
                            ? "border-accent/35 bg-[rgba(191,148,84,0.16)] text-white"
                            : "border-border/80 bg-surface/88 text-text-subtle"
                        )}
                      >
                        <Upload className="h-5 w-5" />
                      </div>
                    </div>
                  </button>
                </div>

                <div className="mt-6 w-full max-w-md space-y-2">
                  <label className="block text-xs font-semibold text-text">
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
                  <div className="rounded-[28px] border border-border/70 bg-background/88 p-5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_1px_2px_rgba(0,0,0,0.03)] sm:p-6">
                    <div className="flex items-start gap-4 sm:gap-5">
                      <div className="relative shrink-0">
                        <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-[22px] border border-border/80 bg-background text-4xl shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_1px_2px_rgba(0,0,0,0.03)] sm:h-[72px] sm:w-[72px] sm:text-5xl">
                          {currentAvatarPreviewUrl ? (
                            <img
                              src={currentAvatarPreviewUrl}
                              alt={assistantName}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <img
                              src={
                                selectedAvatarPreset?.imagePath ??
                                ASSISTANT_AVATAR_PRESETS[0]?.imagePath
                              }
                              alt={assistantName}
                              className="h-full w-full object-cover"
                            />
                          )}
                        </div>
                        <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-bg bg-accent sm:h-5 sm:w-5">
                          <span className="h-1.5 w-1.5 rounded-full bg-white sm:h-2 sm:w-2" />
                        </span>
                      </div>
                      <div className="min-w-0 flex-1 self-center">
                        {assistantName ? (
                          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-accent/90 sm:text-xs">
                            {assistantName}
                          </p>
                        ) : null}
                        <h1 className="mt-1 text-2xl font-semibold leading-tight text-text sm:text-3xl">
                          {t("step2Title")}
                        </h1>
                        <p className="mt-2 text-base leading-relaxed text-text-muted md:text-sm">
                          {t("step2Subtitle", { name: assistantName })}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(320px,1.05fr)] lg:items-start">
                    <div className="space-y-6">
                      <div className="rounded-2xl border border-border/70 bg-background/88 p-5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.03)]">
                        <div className="mb-4">
                          <p className="text-xs font-semibold text-text">
                            {t("presetSectionLabel")}
                          </p>
                          <p className="mt-1 text-[11px] leading-relaxed text-text-subtle">
                            {t("archetypeSectionHint")}
                          </p>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {currentArchetypes.map((archetype) => (
                            <button
                              key={archetype.key}
                              type="button"
                              onClick={() => applyArchetype(archetype)}
                              className={cn(
                                "rounded-2xl border px-4 py-3 text-left transition-all",
                                selectedArchetypeKey === archetype.key
                                  ? "border-accent/45 bg-accent/8 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.03)]"
                                  : "border-border/55 bg-background/94 hover:border-border/70 hover:bg-surface-hover/65"
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p
                                    className={cn(
                                      "text-sm font-semibold",
                                      selectedArchetypeKey === archetype.key
                                        ? "text-accent"
                                        : "text-text"
                                    )}
                                  >
                                    {resolveLocalizedString(archetype.label, locale)}
                                  </p>
                                  <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                                    {resolveLocalizedString(archetype.description, locale)}
                                  </p>
                                </div>
                                <div className="shrink-0 rounded-full border border-border/60 bg-surface-raised/55 px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-subtle">
                                  {archetype.voice.sentenceLength}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                        {selectedArchetype ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <div className="rounded-full border border-border/60 bg-surface-raised/55 px-2.5 py-1 text-[10px] text-text-subtle">
                              pace: {selectedArchetype.voice.pace}
                            </div>
                            <div className="rounded-full border border-border/60 bg-surface-raised/55 px-2.5 py-1 text-[10px] text-text-subtle">
                              irony: {selectedArchetype.voice.irony}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="rounded-2xl border border-border/70 bg-background/88 p-5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.03)]">
                        <p className="mb-4 text-xs font-semibold text-text">{t("fineTune")}</p>
                        <div className="space-y-4">
                          {TRAIT_SLIDERS.map((trait) => (
                            <div key={trait.key}>
                              <div className="mb-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs font-medium">
                                <span className="truncate text-text-muted">
                                  {tp(trait.labelLeftKey)}
                                </span>
                                <span className="rounded-full border border-border/60 bg-surface-raised/55 px-2 py-0.5 text-[10px] text-text-subtle">
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

                    <div className="flex h-full flex-col rounded-2xl border border-border/70 bg-background/88 p-5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.03)]">
                      <label className="block text-xs font-semibold text-text">
                        {t("describeCharacter")}
                      </label>
                      <textarea
                        value={assistantNotes}
                        onChange={(e) => setAssistantNotes(e.target.value)}
                        rows={10}
                        className={userTextareaClassName("mt-2 min-h-[320px] flex-1")}
                        placeholder={t("instructionPlaceholder")}
                      />
                      <p className="mt-2 text-[11px] leading-relaxed text-text-subtle">
                        {t("instructionHint")}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 rounded-[28px] border border-border/70 bg-background/88 p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_1px_2px_rgba(0,0,0,0.03)] sm:p-5">
                    <AssistantSkillsManager
                      state={skillsState}
                      selectedSkillIds={selectedSkillIds}
                      onChange={setSelectedSkillIds}
                      loading={skillsLoading}
                      error={skillsError}
                      mode="setup"
                      disabled={creating}
                      collapsible
                      initialVisibleCount={4}
                    />
                    {skillsError && !skillsLoading ? (
                      <button
                        type="button"
                        onClick={retryLoadSkills}
                        className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-surface-raised px-3 py-1.5 text-xs font-medium text-text transition-colors hover:bg-surface-hover"
                      >
                        <RefreshCcw className="h-3.5 w-3.5" />
                        {t("retrySkillsLoad")}
                      </button>
                    ) : null}
                  </div>
                </div>
              </StepContainer>
            )}

            {/* ===== Step 3: Preview ===== */}
            {step === 3 && (
              <StepContainer key="step-3" className="max-w-4xl">
                <h1 className="text-2xl font-semibold text-text sm:text-3xl">
                  {t("step3Title", { name: assistantName })}
                </h1>
                <p className="mt-2 text-base leading-relaxed text-text-muted md:text-sm">
                  {t("step3Subtitle")}
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
                        <img
                          src={
                            selectedAvatarPreset?.imagePath ??
                            ASSISTANT_AVATAR_PRESETS[0]?.imagePath
                          }
                          alt={assistantName}
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-text md:text-sm">
                        {assistantName}
                      </p>
                      <p className="text-[10px] text-text-subtle">
                        {t("introducingTo", { user: userName || "you" })}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-surface-raised px-5 py-4 sm:px-6 sm:py-5">
                    {previewLoading ? (
                      <div className="flex min-h-[120px] items-center gap-3 py-2">
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
                        <p className="text-base text-text-muted md:text-sm">
                          {t("previewLoading")}
                        </p>
                      </div>
                    ) : (
                      <div className="max-h-[360px] min-h-[140px] overflow-y-auto pr-1">
                        <PreviewMarkdown content={runtimePreview || t("previewNotReady")} />
                      </div>
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
                  <p className="mt-4 text-base text-destructive md:text-sm">
                    {previewError ?? error}
                  </p>
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
          {step > firstAccessibleStep && (
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(firstAccessibleStep, s - 1))}
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
/*  Preview markdown                                                   */
/* ------------------------------------------------------------------ */

function PreviewMarkdown({ content }: { content: string }) {
  return (
    <div className="space-y-3 text-base leading-relaxed text-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="text-text">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
          em: ({ children }) => <em className="italic text-text-muted">{children}</em>,
          code: ({ children, className }) => {
            if (className) {
              return <code className="text-sm text-text">{children}</code>;
            }
            return (
              <code className="rounded bg-bg px-1.5 py-0.5 text-[0.95em] text-accent">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="mb-3 overflow-x-auto rounded-xl border border-border bg-bg px-3 py-2 text-sm last:mb-0">
              {children}
            </pre>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline underline-offset-2"
            >
              {children}
            </a>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared step container                                              */
/* ------------------------------------------------------------------ */

function StepContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      className={cn("mx-auto flex w-full max-w-lg flex-col items-center text-center", className)}
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

function CountrySelect({
  locale,
  value,
  onChange
}: {
  locale: string;
  value: string;
  onChange: (countryCode: string) => void;
}) {
  const t = useTranslations("setup");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const options = useMemo(() => getCountryOptions(locale), [locale]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return options;
    }
    return options.filter(
      (option) =>
        option.code.toLowerCase().includes(query) || option.label.toLowerCase().includes(query)
    );
  }, [options, search]);

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

  const selected = options.find((option) => option.code === value) ?? null;
  const display = selected ? `${selected.label} (${selected.code})` : t("selectCountry");

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 rounded-xl border bg-surface-raised px-4 py-3 text-left transition-colors",
          open ? "border-accent" : "border-border hover:border-border-strong"
        )}
      >
        <span
          className={cn("flex-1 text-base md:text-sm", selected ? "text-text" : "text-text-subtle")}
        >
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
              placeholder={t("searchCountry")}
              className="w-full bg-transparent text-base text-text placeholder:text-text-subtle outline-none md:text-sm"
            />
          </div>
          <div className="custom-scrollbar max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-text-subtle">{t("noMatches")}</p>
            ) : (
              filtered.map((option) => (
                <button
                  key={option.code}
                  type="button"
                  onClick={() => {
                    onChange(option.code);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-left text-base transition-colors md:text-sm",
                    option.code === value
                      ? "bg-accent/10 text-accent"
                      : "text-text-muted hover:bg-surface-hover hover:text-text"
                  )}
                >
                  <span>{option.label}</span>
                  <span className="text-xs uppercase tracking-[0.16em] text-text-subtle">
                    {option.code}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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
        <span
          className={cn("flex-1 text-base md:text-sm", value ? "text-text" : "text-text-subtle")}
        >
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
              className="w-full bg-transparent text-base text-text placeholder:text-text-subtle outline-none md:text-sm"
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
                    "flex w-full cursor-pointer px-3 py-1.5 text-left text-base transition-colors md:text-sm",
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
