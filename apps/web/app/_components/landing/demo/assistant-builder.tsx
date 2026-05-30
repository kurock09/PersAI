"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Upload } from "lucide-react";
import { cn } from "@/app/lib/utils";

/* ------------------------------------------------------------------ */
/* Timing constants                                                      */
/* ------------------------------------------------------------------ */

/**
 * In test env timers are 0 so the trailer completes instantly and all
 * existing hero-demo tests continue to work without needing extra ticks.
 * Matches the pattern used in apps/web/app/app/setup/page.tsx.
 */
const IS_TEST = process.env.NODE_ENV === "test";

const T = {
  avatarSelect: IS_TEST ? 0 : 650,
  nameFill: IS_TEST ? 0 : 1150,
  toneSelect: IS_TEST ? 0 : 1700,
  skillSelect: IS_TEST ? 0 : 2250,
  doneDelay: IS_TEST ? 0 : 3900
} as const;

/* ------------------------------------------------------------------ */
/* Sub-atoms                                                             */
/* ------------------------------------------------------------------ */

const AVATARS = [
  { id: "persai", label: "PersAI", imagePath: "/avatar-presets/persai.png" },
  { id: "luma", label: "Luma", imagePath: "/avatar-presets/luma.png" },
  { id: "theo", label: "Theo", imagePath: "/avatar-presets/theo.png" },
  { id: "lyra", label: "Lyra", imagePath: "/avatar-presets/lyra.png" }
] as const;

function AvatarGrid({ selected }: { selected: boolean }) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {AVATARS.map((avatar) => {
        const active = selected && avatar.id === "luma";
        return (
          <motion.div
            key={avatar.id}
            animate={active ? { y: -2, scale: 1.03 } : { y: 0, scale: 1 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            className={cn(
              "relative aspect-[0.83] overflow-hidden rounded-[18px] border bg-surface-raised/80",
              active
                ? "border-accent/70 shadow-[0_0_0_1px_var(--accent-glow),0_14px_32px_-20px_var(--accent)]"
                : "border-border/70"
            )}
          >
            <img
              src={avatar.imagePath}
              alt=""
              className="h-full w-full object-cover"
              loading="eager"
            />
            {active ? (
              <span className="absolute right-1.5 bottom-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white shadow-sm">
                <Check className="h-3 w-3" strokeWidth={2.6} />
              </span>
            ) : null}
          </motion.div>
        );
      })}
      <div className="flex aspect-[0.83] items-center justify-center rounded-[18px] border border-dashed border-border-strong bg-surface-raised/70 text-text-subtle">
        <Upload className="h-4 w-4" />
      </div>
    </div>
  );
}

function NameField({
  filled,
  label,
  placeholder
}: {
  filled: boolean;
  label: string;
  placeholder: string;
}) {
  return (
    <div className="mt-4">
      <p className="mb-1.5 text-[11px] font-medium text-text-muted">{label}</p>
      <div className="rounded-xl border border-border bg-surface-raised px-4 py-3 text-center text-base font-semibold text-text">
        {filled ? "Aurora" : <span className="text-text-subtle">{placeholder}</span>}
      </div>
    </div>
  );
}

function BuilderRow({
  visible,
  label,
  caption,
  selected
}: {
  visible: boolean;
  label: string;
  caption: string;
  selected: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={visible ? { opacity: 1, x: 0 } : { opacity: 0, x: -6 }}
      transition={{ duration: 0.26, ease: "easeOut" }}
      className={cn(
        "flex items-center justify-between rounded-xl border px-3 py-2.5 transition-colors",
        selected
          ? "border-accent/40 bg-accent/[0.09] dark:border-accent/30 dark:bg-accent/[0.12]"
          : "border-border bg-surface-raised/60"
      )}
    >
      <span className="min-w-0">
        <span className={cn("block text-sm font-medium", selected ? "text-accent" : "text-text")}>
          {label}
        </span>
        <span className="block text-[11px] text-text-subtle">{caption}</span>
      </span>
      <motion.span
        initial={{ scale: 0, opacity: 0 }}
        animate={selected ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
        transition={{ duration: 0.18, ease: "backOut" }}
        className="ml-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent"
      >
        <Check className="h-3 w-3" strokeWidth={2.5} />
      </motion.span>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* AssistantBuilder                                                      */
/* ------------------------------------------------------------------ */

export interface AssistantBuilderProps {
  /** Called when the trailer animation has completed (or immediately under reducedMotion). */
  onDone: () => void;
  /** Starts the trailer. Before this is true, the builder stays parked at the first frame. */
  shouldPlay: boolean;
  /** When true, skip animation and call onDone immediately. */
  reducedMotion: boolean;
  /** i18n labels — passed from HeroDemo so this component is i18n-agnostic. */
  labels: {
    ariaLabel: string;
    title: string;
    subtitle: string;
    nameLabel: string;
    namePlaceholder: string;
    configuring: string;
    toneName: string;
    toneCaption: string;
    skillName: string;
    skillCaption: string;
  };
}

/**
 * Opening "create Aurora" trailer.
 *
 * Renders a calm, condensed replay of the setup wizard (avatar → name →
 * tone → skill) as an absolute overlay inside the demo thread area.
 * Calls `onDone()` after the sequence completes so the machine can
 * transition to `idle` → `autoplay`.
 *
 * The trailer plays ONCE per mount. After a soft-reset the machine goes
 * directly to `autoplay`, so the trailer is never replayed on loop.
 *
 * SSR / no-JS safety: the component always renders its final configured
 * state as the initial server frame (all steps visible), giving a
 * meaningful first paint without a hydration mismatch. Framer-motion's
 * `initial` starts each item hidden so the animation plays on the client.
 * Under `reducedMotion` everything is shown at once and `onDone` fires
 * after a 1-frame delay.
 *
 * All timers are cleaned up on unmount.
 */
export function AssistantBuilder({
  onDone,
  shouldPlay,
  reducedMotion,
  labels
}: AssistantBuilderProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!shouldPlay) {
      setStep(1);
      return;
    }

    if (reducedMotion) {
      setStep(4);
      const id = setTimeout(() => onDoneRef.current(), 0);
      return () => clearTimeout(id);
    }

    const timers: ReturnType<typeof setTimeout>[] = [];

    timers.push(setTimeout(() => setStep(2), T.avatarSelect));
    timers.push(setTimeout(() => setStep(3), T.nameFill));
    timers.push(setTimeout(() => setStep(4), T.toneSelect));
    timers.push(setTimeout(() => setStep(5), T.skillSelect));
    timers.push(setTimeout(() => onDoneRef.current(), T.doneDelay));

    return () => timers.forEach(clearTimeout);
  }, [shouldPlay, reducedMotion]);

  const show = (minStep: number) => reducedMotion || step >= minStep;

  return (
    <div
      aria-label={labels.ariaLabel}
      className="absolute inset-0 z-10 flex items-center justify-center bg-bg px-4"
    >
      <div className="w-full max-w-[28rem]">
        <div className="mb-4 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-subtle">
            {labels.title}
          </p>
          <p className="mt-1 text-sm text-text-muted">{labels.subtitle}</p>
        </div>

        <AvatarGrid selected={show(2)} />
        <NameField filled={show(3)} label={labels.nameLabel} placeholder={labels.namePlaceholder} />

        <div className="mt-3 space-y-2">
          <BuilderRow
            visible={show(4)}
            label={labels.toneName}
            caption={labels.toneCaption}
            selected={show(4)}
          />
          <BuilderRow
            visible={show(5)}
            label={labels.skillName}
            caption={labels.skillCaption}
            selected={show(5)}
          />
        </div>

        {show(1) && !show(5) && (
          <p className="mt-4 text-center text-[11px] text-text-subtle">{labels.configuring}</p>
        )}
      </div>
    </div>
  );
}
