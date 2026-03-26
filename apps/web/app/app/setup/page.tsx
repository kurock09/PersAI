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
  postAssistantPublish
} from "../assistant-api-client";
import { getMe, postOnboarding } from "../me-api-client";

/* ------------------------------------------------------------------ */
/*  Types & constants                                                  */
/* ------------------------------------------------------------------ */

interface TraitSlider {
  key: string;
  labelLeft: string;
  labelRight: string;
  value: number;
}

const DEFAULT_TRAITS: TraitSlider[] = [
  { key: "formality", labelLeft: "Formal", labelRight: "Casual", value: 50 },
  { key: "verbosity", labelLeft: "Concise", labelRight: "Detailed", value: 50 },
  { key: "playfulness", labelLeft: "Serious", labelRight: "Playful", value: 50 },
  { key: "initiative", labelLeft: "Reactive", labelRight: "Proactive", value: 50 },
  { key: "warmth", labelLeft: "Neutral", labelRight: "Warm", value: 50 }
];

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

/* ------------------------------------------------------------------ */
/*  Trait → instructions builder                                       */
/* ------------------------------------------------------------------ */

function traitsToInstructions(
  assistantName: string,
  userName: string,
  traits: TraitSlider[]
): string {
  const lines: string[] = [
    `You are ${assistantName}, a personal AI assistant.`,
    `Your user's name is ${userName}. Address them by name naturally.`
  ];

  for (const t of traits) {
    const v = t.value;
    if (t.key === "formality") {
      if (v < 30) lines.push("Communicate in a formal, professional tone.");
      else if (v > 70) lines.push("Be casual, friendly, and conversational.");
    }
    if (t.key === "verbosity") {
      if (v < 30) lines.push("Keep responses brief and to the point.");
      else if (v > 70) lines.push("Provide detailed, thorough explanations.");
    }
    if (t.key === "playfulness") {
      if (v < 30) lines.push("Maintain a serious, focused demeanor.");
      else if (v > 70) lines.push("Be playful, use humor when appropriate.");
    }
    if (t.key === "initiative") {
      if (v < 30) lines.push("Wait for the user to ask before offering suggestions.");
      else if (v > 70) lines.push("Be proactive — suggest ideas and anticipate needs.");
    }
    if (t.key === "warmth") {
      if (v < 30) lines.push("Stay neutral and objective in your responses.");
      else if (v > 70) lines.push("Be warm, empathetic, and show genuine care.");
    }
  }

  lines.push("Remember conversations and learn user preferences over time.");
  return lines.join("\n");
}

function generatePreview(assistantName: string, userName: string, traits: TraitSlider[]): string {
  const tone = traits.find((t) => t.key === "playfulness")?.value ?? 50;
  const warmth = traits.find((t) => t.key === "warmth")?.value ?? 50;
  const verbosity = traits.find((t) => t.key === "verbosity")?.value ?? 50;
  const formality = traits.find((t) => t.key === "formality")?.value ?? 50;
  const initiative = traits.find((t) => t.key === "initiative")?.value ?? 50;

  const n = assistantName || "your assistant";
  const u = userName || "friend";

  if (warmth > 70 && tone > 70) {
    return verbosity > 60
      ? `Hey ${u}! 😊 I'm ${n}! I'm so happy to finally meet you! I'll be your personal companion — I'll remember everything we talk about, learn what you like, and always be here when you need me. So, what should we start with?`
      : `Hey ${u}! 😊 I'm ${n}, your personal assistant. Super excited to meet you! What's on your mind?`;
  }
  if (formality < 30 && warmth < 40) {
    return verbosity > 60
      ? `Good day, ${u}. My name is ${n}. I am your dedicated personal assistant, designed to provide precise and thorough support across a wide range of tasks. How may I be of service?`
      : `Good day, ${u}. I'm ${n}, your personal assistant. How may I help you?`;
  }
  if (tone > 70) {
    return initiative > 60
      ? `Yo ${u}! I'm ${n} 🚀 Your brand new personal AI! I'm already thinking about how we can make your day better. Ready to get started?`
      : `Hey ${u}! I'm ${n} 🚀 Your personal assistant, at your service. Throw anything at me!`;
  }
  if (warmth > 60) {
    return verbosity > 60
      ? `Hi ${u}! I'm ${n}, your personal AI assistant. I'm here to help you with anything you need — from everyday questions to big projects. I'll remember our conversations and get better at understanding you over time. What would you like to talk about?`
      : `Hi ${u}! I'm ${n} — your personal assistant. I'm here for you. What can I help with?`;
  }
  return verbosity > 60
    ? `Hello, ${u}! I'm ${n}, your personal AI assistant. I can help with a wide range of tasks — answering questions, organizing your thoughts, or just having a conversation. What would you like to work on?`
    : `Hello, ${u}! I'm ${n}, your personal assistant. How can I help you today?`;
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
  const [customAvatarUrl, setCustomAvatarUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2 — personality
  const [traits, setTraits] = useState<TraitSlider[]>(DEFAULT_TRAITS);

  // Step 3 — create
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        if (me.me.onboarding.status !== "pending") {
          const u = me.me.appUser;
          if (u.displayName) setUserName(u.displayName);
          if (u.birthday) setBirthday(u.birthday);
          if (u.gender) setGender(u.gender as Gender);
          if (me.me.workspace?.timezone) setTimezone(me.me.workspace.timezone);
        }
      } catch {
        // Pre-fill is best-effort; ignore errors.
      }
    })();
  }, [getToken, router]);

  const canProceed = useMemo(() => {
    if (step === 0) return userName.trim().length >= 2 && gender !== null && timezone.length > 0;
    if (step === 1)
      return (
        assistantName.trim().length >= 2 && (selectedAvatar !== null || customAvatarUrl !== null)
      );
    return true;
  }, [step, userName, gender, timezone, assistantName, selectedAvatar, customAvatarUrl]);

  const preview = useMemo(
    () => generatePreview(assistantName, userName, traits),
    [assistantName, userName, traits]
  );

  const avatarObj = useMemo(() => AVATARS.find((a) => a.id === selectedAvatar), [selectedAvatar]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    setCustomAvatarUrl(URL.createObjectURL(file));
    setSelectedAvatar(null);
  }, []);

  const updateTrait = useCallback((key: string, value: number) => {
    setTraits((prev) => prev.map((t) => (t.key === key ? { ...t, value } : t)));
  }, []);

  const handleCreate = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    setCreating(true);
    setError(null);

    try {
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

      const instructions = traitsToInstructions(assistantName, userName, traits);
      const structuredTraits: Record<string, number> = {};
      for (const t of traits) {
        structuredTraits[t.key] = t.value;
      }
      const avatarEmoji = avatarObj?.emoji ?? null;

      await patchAssistantDraft(token, {
        displayName: assistantName.trim(),
        instructions,
        traits: structuredTraits,
        avatarEmoji,
        avatarUrl: customAvatarUrl
      });
      await postAssistantPublish(token);
      window.location.href = "/app/chat";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setCreating(false);
    }
  }, [
    getToken,
    assistantName,
    userName,
    timezone,
    birthday,
    gender,
    traits,
    avatarObj,
    customAvatarUrl
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
                      setCustomAvatarUrl(null);
                    }}
                    className={cn(
                      "flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 p-2.5 transition-all",
                      selectedAvatar === av.id && customAvatarUrl === null
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
                    customAvatarUrl
                      ? "border-accent bg-accent/10"
                      : "border-border-strong bg-surface-raised hover:bg-surface-hover hover:border-accent/50"
                  )}
                >
                  {customAvatarUrl ? (
                    <img
                      src={customAvatarUrl}
                      alt="Custom"
                      className="h-7 w-7 rounded-full object-cover"
                    />
                  ) : (
                    <Upload className="h-5 w-5 text-text-subtle" />
                  )}
                  <span className="text-[9px] font-medium text-text-muted">
                    {customAvatarUrl ? "Yours" : "Upload"}
                  </span>
                </button>
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
                {traits.map((trait) => (
                  <div key={trait.key}>
                    <div className="mb-2 flex items-center justify-between text-xs font-medium">
                      <span className="text-text-muted">{trait.labelLeft}</span>
                      <span className="text-text-muted">{trait.labelRight}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={trait.value}
                      onChange={(e) => updateTrait(trait.key, Number(e.target.value))}
                      className="w-full cursor-pointer accent-accent"
                    />
                  </div>
                ))}
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
                    {customAvatarUrl ? (
                      <img
                        src={customAvatarUrl}
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
                  <p className="text-sm leading-relaxed text-text">{preview}</p>
                </div>
              </div>

              {/* Trait pills */}
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {traits.map((t) => {
                  const label =
                    t.value < 40 ? t.labelLeft : t.value > 60 ? t.labelRight : "Balanced";
                  return (
                    <span
                      key={t.key}
                      className="rounded-full bg-surface-raised px-3 py-1 text-[10px] font-medium text-text-muted"
                    >
                      {label}
                    </span>
                  );
                })}
              </div>

              {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

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
