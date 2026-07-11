"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Upload } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { useTypewriter } from "./use-typewriter";

const IS_TEST = process.env.NODE_ENV === "test";

const DELAYS = {
  avatar: IS_TEST ? 0 : 320,
  name: IS_TEST ? 0 : 760,
  instruction: IS_TEST ? 0 : 1160,
  create: IS_TEST ? 0 : 420,
  press: IS_TEST ? 0 : 360,
  done: IS_TEST ? 0 : 700
} as const;

type BuilderStep = 0 | 1 | 2 | 3 | 4 | 5;

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
          <div
            key={avatar.id}
            className={cn(
              "relative aspect-[0.83] overflow-hidden rounded-[18px] border bg-surface-raised/80 transition-[transform,box-shadow,border-color] duration-200",
              active
                ? "border-accent/70 shadow-[0_0_0_1px_var(--accent-glow),0_14px_32px_-20px_var(--accent)]"
                : "border-border/70"
            )}
            style={active ? { transform: "translateY(-2px) scale(1.03)" } : undefined}
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
          </div>
        );
      })}
      <div className="flex aspect-[0.83] items-center justify-center rounded-[18px] border border-dashed border-border-strong bg-surface-raised/70 text-text-subtle">
        <Upload className="h-4 w-4" />
      </div>
    </div>
  );
}

function NameField({ label }: { label: string }) {
  return (
    <div className="mt-4 animate-[fadeIn_180ms_ease-out]">
      <p className="mb-1.5 text-[11px] font-medium text-text-muted">{label}</p>
      <div className="rounded-xl border border-border bg-surface-raised px-4 py-3 text-center text-base font-semibold text-text">
        Aurora
      </div>
    </div>
  );
}

function InstructionField({
  instructionLabel,
  instructionValue,
  isDone
}: {
  instructionLabel: string;
  instructionValue: string;
  isDone: boolean;
}) {
  return (
    <div className="animate-[fadeIn_180ms_ease-out] rounded-xl border border-border bg-surface-raised/60 px-4 py-3">
      <span className="block min-w-0">
        <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-text-subtle">
          {instructionLabel}
        </span>
        <span className="block min-h-[4.25rem] text-base leading-relaxed text-text md:text-sm">
          {instructionValue}
          {!isDone ? (
            <span className="ml-0.5 inline-block h-4 w-1 rounded-sm bg-accent/65 align-middle" />
          ) : null}
        </span>
      </span>
    </div>
  );
}

function CreateButton({ pressed, label }: { pressed: boolean; label: string }) {
  return (
    <button
      type="button"
      className={cn(
        "mt-3 inline-flex w-full items-center justify-center rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-sm transition-[transform,background-color,box-shadow] duration-150",
        pressed && "bg-accent-hover shadow-[inset_0_2px_4px_rgba(0,0,0,0.14)]"
      )}
      style={pressed ? { transform: "scale(0.97)" } : undefined}
    >
      {label}
    </button>
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
  /** Parent thread viewport to scroll when CTA appears. */
  scrollViewportRef?: React.RefObject<HTMLDivElement | null> | undefined;
  /** i18n labels — passed from HeroDemo so this component is i18n-agnostic. */
  labels: {
    ariaLabel: string;
    title: string;
    subtitle: string;
    nameLabel: string;
    namePlaceholder: string;
    instructionLabel: string;
    instructionText: string;
    createLabel: string;
  };
}

export function AssistantBuilder({
  onDone,
  shouldPlay,
  reducedMotion,
  scrollViewportRef,
  labels
}: AssistantBuilderProps) {
  const [step, setStep] = useState<BuilderStep>(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const instant = IS_TEST || reducedMotion;

  const { visibleText: typedInstruction, isDone: instructionDone } = useTypewriter(
    step >= 3 ? labels.instructionText : "",
    instant
  );

  useEffect(() => {
    if (!shouldPlay) {
      setStep(0);
      return;
    }

    if (instant) {
      setStep(5);
      const id = setTimeout(() => onDoneRef.current(), 0);
      return () => clearTimeout(id);
    }

    const timers: ReturnType<typeof setTimeout>[] = [];
    setStep(0);
    timers.push(setTimeout(() => setStep(1), DELAYS.avatar));
    timers.push(setTimeout(() => setStep(2), DELAYS.name));
    timers.push(setTimeout(() => setStep(3), DELAYS.instruction));

    return () => timers.forEach(clearTimeout);
  }, [instant, shouldPlay]);

  useEffect(() => {
    if (!shouldPlay || instant || !instructionDone || step !== 3) return;
    const id = setTimeout(() => setStep(4), DELAYS.create);
    return () => clearTimeout(id);
  }, [instant, instructionDone, shouldPlay, step]);

  useEffect(() => {
    if (!shouldPlay || instant || step !== 4) return;
    const id = setTimeout(() => setStep(5), DELAYS.press);
    return () => clearTimeout(id);
  }, [instant, shouldPlay, step]);

  useEffect(() => {
    if (!shouldPlay || instant || step !== 5) return;
    const id = setTimeout(() => onDoneRef.current(), DELAYS.done);
    return () => clearTimeout(id);
  }, [instant, shouldPlay, step]);

  useEffect(() => {
    if (IS_TEST) return;
    if (step < 4) return;
    const viewport = scrollViewportRef?.current;
    if (!viewport) return;
    const frame = window.requestAnimationFrame(() => {
      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({
          top: viewport.scrollHeight,
          behavior: instant ? "auto" : "smooth"
        });
      } else {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
    const followUps = [140, 320].map((delay) =>
      window.setTimeout(() => {
        if (typeof viewport.scrollTo === "function") {
          viewport.scrollTo({
            top: viewport.scrollHeight,
            behavior: instant ? "auto" : "smooth"
          });
        } else {
          viewport.scrollTop = viewport.scrollHeight;
        }
      }, delay)
    );
    return () => {
      window.cancelAnimationFrame(frame);
      followUps.forEach((timer) => window.clearTimeout(timer));
    };
  }, [instant, scrollViewportRef, step]);

  const showName = step >= 2;
  const showInstruction = step >= 3;
  const showCreate = step >= 4;
  const pressed = step >= 5;

  return (
    <div
      aria-label={labels.ariaLabel}
      className="flex min-h-[22rem] items-center justify-center bg-bg px-4"
    >
      <div className="w-full max-w-[28rem]">
        <div className="mb-4 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-subtle">
            {labels.title}
          </p>
          <p className="mt-1 text-base text-text-muted md:text-sm">{labels.subtitle}</p>
        </div>

        <AvatarGrid selected={step >= 1} />
        {showName ? <NameField label={labels.nameLabel} /> : null}

        <div className="mt-3">
          {showInstruction ? (
            <InstructionField
              instructionLabel={labels.instructionLabel}
              instructionValue={typedInstruction}
              isDone={instructionDone}
            />
          ) : null}
          {showCreate ? <CreateButton pressed={pressed} label={labels.createLabel} /> : null}
        </div>
      </div>
    </div>
  );
}
