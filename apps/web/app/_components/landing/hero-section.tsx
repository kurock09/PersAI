import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { LandingSection } from "./section";
import { HeroDemo } from "./demo/hero-demo";

export async function LandingHeroSection() {
  const t = await getTranslations("landing");
  const headlineLine2 = t("headlineLine2").trim();

  return (
    <LandingSection id="hero" className="relative overflow-hidden pt-10 pb-28 sm:pt-14 sm:pb-32">
      {/* Stacked: copy → CTAs → demo full-width */}

      {/* 1. Copy block — always centered */}
      <div className="flex flex-col items-center text-center">
        <p className="animate-fade-in text-[10px] font-semibold uppercase tracking-[0.26em] text-text-subtle">
          {t("eyebrow")}
        </p>

        <h1 className="animate-fade-in-up mt-6 leading-[1.05] tracking-[-0.04em]">
          <span className="block text-[clamp(2.25rem,5.4vw,4.6rem)] font-semibold text-text">
            {t("headlineLine1")}
          </span>
          {headlineLine2.length > 0 ? (
            <span className="block text-[clamp(2.1rem,5vw,4.2rem)] font-light text-text-muted">
              {headlineLine2}
            </span>
          ) : null}
        </h1>

        <p className="animate-fade-in-up-delay mt-6 max-w-[34rem] text-sm leading-relaxed text-text-muted sm:text-lg">
          {t("subtitle")}
        </p>
      </div>

      {/* 2. CTA buttons — centered, constrained */}
      <div className="animate-fade-in-up-delay mx-auto mt-8 flex w-full max-w-[18rem] flex-col items-stretch gap-2.5">
        <Link
          href={"/sign-up" as Route}
          className="flex min-h-12 cursor-pointer items-center justify-center rounded-[1.35rem] border border-[rgba(72,91,79,0.28)] bg-accent px-6 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_0_rgba(52,68,58,0.18),0_16px_28px_-20px_rgba(72,91,79,0.78)] transition-colors hover:bg-accent-hover dark:border-[#a8baa0]/35 dark:bg-[#8faa9a] dark:text-[#f6f0e8] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(0,0,0,0.22),0_18px_32px_-24px_rgba(143,170,154,0.56)] dark:hover:bg-[#9ab5a4]"
        >
          {t("cta")}
        </Link>
        <Link
          href={"/sign-in" as Route}
          className="flex min-h-12 cursor-pointer items-center justify-center rounded-[1.35rem] border border-[rgba(92,72,48,0.12)] bg-surface-raised/62 px-6 text-sm font-medium text-text-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.74),inset_0_-1px_0_rgba(92,72,48,0.08),0_14px_26px_-22px_rgba(92,72,48,0.46)] transition-colors hover:border-[rgba(92,72,48,0.18)] hover:bg-surface-raised/82 hover:text-text dark:border-white/16 dark:bg-surface-raised/48 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-1px_0_rgba(0,0,0,0.24),0_16px_30px_-24px_rgba(0,0,0,0.8)] dark:hover:border-white/22 dark:hover:bg-surface-hover/64"
        >
          {t("ctaSecondary")} →
        </Link>
      </div>

      {/* 3. Demo — full-width below copy, max-w-6xl so it has real breathing room */}
      <div className="mx-auto mt-12 w-full max-w-6xl">
        <HeroDemo />
      </div>

      {/* Premium scroll-cue: anchored to the next section. */}
      <Link
        href={"/#workflow" as Route}
        scroll
        aria-label={t("scrollHint")}
        className="group absolute inset-x-0 bottom-6 mx-auto inline-flex w-fit flex-col items-center gap-2 sm:bottom-10"
      >
        <span className="text-[9px] font-medium uppercase tracking-[0.32em] text-text-subtle/65 transition-colors group-hover:text-text-subtle">
          {t("scrollHint")}
        </span>
        <span
          aria-hidden
          className="relative block h-9 w-px bg-gradient-to-b from-accent/45 via-accent/20 to-transparent"
        >
          <span className="scroll-cue-dot absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-accent shadow-[0_0_10px_var(--accent-glow)] [animation:var(--animate-scroll-cue)]" />
        </span>
      </Link>
    </LandingSection>
  );
}
