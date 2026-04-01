"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { motion, AnimatePresence } from "framer-motion";
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
import {
  getAssistant,
  patchAssistantDraft,
  postAssistantCreate,
  postAssistantPublish,
  postAssistantSetupPreview,
  uploadAssistantAvatar
} from "../assistant-api-client";
import { getMe, postOnboarding } from "../me-api-client";
import {
  ASSISTANT_GENDER_OPTIONS,
  DEFAULT_TRAITS,
  TRAIT_SLIDERS,
  buildAssistantInstructions,
  traitPreviewLabel,
  type AssistantGender,
  type TraitKey
} from "../_components/assistant-persona";

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

function normalizeBirthdayForDateInput(value: string | null | undefined): string {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : value.slice(0, 10);
}

/* ------------------------------------------------------------------ */
/*  Wizard component                                                   */
/* ------------------------------------------------------------------ */

export default function SetupWizardPage() {
  const router = useRouter();
  const { getToken } = useAuth();

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
  const [assistantGender, setAssistantGender] = useState<AssistantGender>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2 — personality
  const [traits, setTraits] = useState<Record<TraitKey, number>>(DEFAULT_TRAITS);
  const [assistantNotes, setAssistantNotes] = useState("");
  const [instructionsEdited, setInstructionsEdited] = useState(false);

  // Step 3 — create
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runtimePreview, setRuntimePreview] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    setTimezone(detectTimezone());

    void (async () => {
      try {
        const token = await getToken();
        if (!token) return;

        const existing = await getAssistant(token);
        if (existing && existing.runtimeApply.status === "succeeded") {
          router.replace("/app");
          return;
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
  }, [getToken, router]);

  useEffect(() => {
    if (instructionsEdited) return;
    setAssistantNotes(
      buildAssistantInstructions({
        assistantName: assistantName.trim() || "your assistant",
        userName: userName.trim() || "your human",
        assistantGender,
        traits
      })
    );
  }, [assistantGender, assistantName, instructionsEdited, traits, userName]);

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
        (selectedAvatar !== null || customAvatarPreviewUrl !== null)
      );
    return true;
  }, [step, userName, gender, timezone, assistantName, selectedAvatar, customAvatarPreviewUrl]);

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
      setSelectedAvatar(null);
    },
    [customAvatarPreviewUrl]
  );

  const updateTrait = useCallback((key: TraitKey, value: number) => {
    setTraits((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resolveSetupToken = useCallback(
    async (fresh = false) => {
      const tokenResolver = getToken as (options?: {
        skipCache?: boolean;
      }) => Promise<string | null>;
      const token = await tokenResolver(fresh ? { skipCache: true } : undefined);
      if (!token) {
        throw new Error("Session expired. Sign in again and refresh the page.");
      }
      return token;
    },
    [getToken]
  );

  const persistDraftForPreview = useCallback(async () => {
    await postOnboarding(await resolveSetupToken(true), {
      displayName: userName.trim(),
      workspaceName: `${userName.trim()}'s workspace`,
      locale: navigator.language ?? "en",
      timezone: timezone || "UTC",
      birthday: birthday || null,
      gender: gender ?? null,
      acceptTermsOfService: true,
      acceptPrivacyPolicy: true
    });

    await postAssistantCreate(await resolveSetupToken(true));

    await patchAssistantDraft(await resolveSetupToken(true), {
      displayName: assistantName.trim(),
      instructions: assistantNotes.trim(),
      traits,
      avatarEmoji: customAvatarFile ? null : (avatarObj?.emoji ?? null),
      avatarUrl: null,
      assistantGender
    });
  }, [
    assistantGender,
    assistantName,
    assistantNotes,
    avatarObj,
    birthday,
    customAvatarFile,
    gender,
    resolveSetupToken,
    traits,
    timezone,
    userName
  ]);

  const loadRuntimePreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      await persistDraftForPreview();
      const preview = await postAssistantSetupPreview(await resolveSetupToken(true));
      setRuntimePreview(preview.message);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Preview failed. Please try again.");
    } finally {
      setPreviewLoading(false);
    }
  }, [persistDraftForPreview, resolveSetupToken]);

  useEffect(() => {
    if (step !== 3) return;
    void loadRuntimePreview();
  }, [loadRuntimePreview, step]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setError(null);

    try {
      const token = await resolveSetupToken(true);
      await postOnboarding(token, {
        displayName: userName.trim(),
        workspaceName: `${userName.trim()}'s workspace`,
        locale: navigator.language ?? "en",
        timezone: timezone || "UTC",
        birthday: birthday || null,
        gender: gender ?? null,
        acceptTermsOfService: true,
        acceptPrivacyPolicy: true
      });

      await postAssistantCreate(token);
      let avatarUrl: string | null = null;
      let avatarEmoji: string | null = avatarObj?.emoji ?? null;
      if (customAvatarFile) {
        const uploaded = await uploadAssistantAvatar(
          await resolveSetupToken(true),
          customAvatarFile
        );
        avatarUrl = uploaded.avatarUrl;
        avatarEmoji = null;
      }

      await patchAssistantDraft(await resolveSetupToken(true), {
        displayName: assistantName.trim(),
        instructions: assistantNotes.trim(),
        traits,
        avatarEmoji,
        avatarUrl,
        assistantGender
      });
      await postAssistantPublish(await resolveSetupToken(true));
      window.location.href = "/app/chat";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setCreating(false);
    }
  }, [
    assistantName,
    userName,
    timezone,
    birthday,
    gender,
    traits,
    assistantNotes,
    assistantGender,
    avatarObj,
    customAvatarFile,
    resolveSetupToken
  ]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-bg">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between px-6 py-4">
        <span className="text-lg font-bold tracking-tight text-text">
          Pers<span className="text-accent">AI</span>
        </span>
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
      </header>

      {/* Content — scrollable only inside */}
      <div className="flex flex-1 items-start justify-center overflow-y-auto px-6 py-8">
        <AnimatePresence mode="wait">
          {/* ===== Step 0: About you ===== */}
          {step === 0 && (
            <StepContainer key="step-0">
              <h1 className="text-3xl font-bold text-text sm:text-4xl">About you</h1>
              <p className="mt-3 text-base text-text-muted">
                Your assistant needs to know you to serve you better.
              </p>

              <div className="mt-8 w-full max-w-sm space-y-4">
                {/* User name */}
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-muted">
                    <User className="h-3.5 w-3.5" />
                    Your name
                  </label>
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="How should your assistant call you?"
                    maxLength={40}
                    autoFocus
                    className="w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm text-text placeholder:text-text-subtle outline-none transition-colors focus:border-accent"
                  />
                </div>

                {/* Birthday */}
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-muted">
                    <Calendar className="h-3.5 w-3.5" />
                    Date of birth
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
                  <label className="mb-1.5 block text-xs font-medium text-text-muted">Gender</label>
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
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Timezone */}
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-muted">
                    <Globe className="h-3.5 w-3.5" />
                    Timezone
                  </label>
                  <TimezoneSelect value={timezone} onChange={setTimezone} />
                </div>
              </div>
            </StepContainer>
          )}

          {/* ===== Step 1: Assistant identity ===== */}
          {step === 1 && (
            <StepContainer key="step-1">
              <h1 className="text-3xl font-bold text-text sm:text-4xl">Create your assistant</h1>
              <p className="mt-3 text-base text-text-muted">
                Give it a name and a face. This is who you'll be talking to every day.
              </p>

              {/* Assistant name */}
              <input
                type="text"
                value={assistantName}
                onChange={(e) => setAssistantName(e.target.value)}
                placeholder="Name — e.g. Atlas, Nova, Jarvis..."
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
                    customAvatarPreviewUrl
                      ? "border-accent bg-accent/10"
                      : "border-border-strong bg-surface-raised hover:bg-surface-hover hover:border-accent/50"
                  )}
                >
                  {customAvatarPreviewUrl ? (
                    <img
                      src={customAvatarPreviewUrl}
                      alt="Custom"
                      className="h-7 w-7 rounded-full object-cover"
                    />
                  ) : (
                    <Upload className="h-5 w-5 text-text-subtle" />
                  )}
                  <span className="text-[9px] font-medium text-text-muted">
                    {customAvatarPreviewUrl ? "Yours" : "Upload"}
                  </span>
                </button>
              </div>

              <div className="mt-6 w-full max-w-md space-y-2">
                <label className="block text-xs font-medium text-text-muted">
                  Assistant gender
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
                      {opt.label}
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
            <StepContainer key="step-2">
              <h1 className="text-3xl font-bold text-text sm:text-4xl">Shape the personality</h1>
              <p className="mt-3 text-base text-text-muted">
                How should <span className="font-medium text-text">{assistantName}</span> talk to
                you?
              </p>
              <div className="mt-8 w-full max-w-md space-y-6">
                {TRAIT_SLIDERS.map((trait) => (
                  <div key={trait.key}>
                    <div className="mb-2 flex items-center justify-between text-xs font-medium">
                      <span className="text-text-muted">{trait.labelLeft}</span>
                      <span className="text-text-muted">{trait.labelRight}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={traits[trait.key]}
                      onChange={(e) => updateTrait(trait.key, Number(e.target.value))}
                      className="w-full cursor-pointer accent-accent"
                    />
                  </div>
                ))}

                <div className="space-y-2 text-left">
                  <label className="block text-xs font-medium text-text-muted">
                    Describe the character in your own words
                  </label>
                  <textarea
                    value={assistantNotes}
                    onChange={(e) => {
                      setInstructionsEdited(true);
                      setAssistantNotes(e.target.value);
                    }}
                    rows={7}
                    className="w-full rounded-2xl border border-border bg-surface-raised px-4 py-3 text-sm text-text outline-none transition-colors focus:border-accent"
                    placeholder="Warm, observant, proactive, but not pushy..."
                  />
                  <p className="text-[11px] text-text-subtle">
                    Sliders shape the baseline, and this text lets you describe the personality more
                    precisely.
                  </p>
                </div>
              </div>
            </StepContainer>
          )}

          {/* ===== Step 3: Preview ===== */}
          {step === 3 && (
            <StepContainer key="step-3">
              <h1 className="text-3xl font-bold text-text sm:text-4xl">
                {assistantName} introduces itself
              </h1>
              <p className="mt-3 text-base text-text-muted">
                This is how your assistant will greet you for the first time.
              </p>

              {/* Simulated chat */}
              <div className="mt-8 w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-left">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xl overflow-hidden">
                    {customAvatarPreviewUrl ? (
                      <img
                        src={customAvatarPreviewUrl}
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
                      is introducing itself to {userName || "you"}
                    </p>
                  </div>
                </div>
                <div className="rounded-xl bg-surface-raised px-4 py-3">
                  <p className="text-sm leading-relaxed text-text">
                    {previewLoading
                      ? "Generating a real runtime preview..."
                      : runtimePreview || "Preview is not ready yet."}
                  </p>
                </div>
              </div>

              {/* Trait pills */}
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {TRAIT_SLIDERS.map((trait) => (
                  <span
                    key={trait.key}
                    className="rounded-full bg-surface-raised px-3 py-1 text-[10px] font-medium text-text-muted"
                  >
                    {traitPreviewLabel(trait.key, traits[trait.key])}
                  </span>
                ))}
              </div>

              {assistantGender && (
                <p className="mt-3 text-xs text-text-subtle">Identity: {assistantGender}</p>
              )}

              <button
                type="button"
                onClick={() => void loadRuntimePreview()}
                disabled={previewLoading || creating}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-hover disabled:opacity-50"
              >
                <RefreshCcw className={cn("h-4 w-4", previewLoading && "animate-spin")} />
                Refresh preview
              </button>

              {(previewError || error) && (
                <p className="mt-4 text-sm text-destructive">{previewError ?? error}</p>
              )}

              <p className="mt-6 text-[10px] text-text-subtle/60 max-w-xs">
                By creating your assistant you agree to the Terms&nbsp;of&nbsp;Service and
                Privacy&nbsp;Policy.
              </p>
            </StepContainer>
          )}
        </AnimatePresence>
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
              Back
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
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              className="flex cursor-pointer items-center gap-2 rounded-xl bg-accent px-8 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent-glow transition-all hover:bg-accent-hover disabled:opacity-70"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Create assistant
                  <ChevronRight className="h-4 w-4" />
                </>
              )}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared step container                                              */
/* ------------------------------------------------------------------ */

function StepContainer({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="flex w-full max-w-lg flex-col items-center text-center"
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

  const display = value ? value.replace(/_/g, " ") : "Select timezone";

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
              placeholder="Search timezone..."
              className="w-full bg-transparent text-sm text-text placeholder:text-text-subtle outline-none"
            />
          </div>
          <div className="custom-scrollbar max-h-44 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-text-subtle">No matches</p>
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
