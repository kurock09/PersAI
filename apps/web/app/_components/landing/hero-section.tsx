import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { LandingSection } from "./section";

export async function LandingHeroSection() {
  const t = await getTranslations("landing");
  const headlineLine2 = t("headlineLine2").trim();

  return (
    <LandingSection
      id="hero"
      // Hero owns the entire first viewport (minus the sticky header). The
      // content is centered vertically so the eye lands on the headline +
      // CTA, and a quiet scroll-cue at the bottom hints at continuation
      // without competing with the type.
      className="relative flex min-h-[calc(100svh-4.5rem)] flex-col items-center justify-center pt-6 pb-24 sm:min-h-[calc(100svh-5rem)] sm:pt-10 sm:pb-28"
    >
      <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
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

        <div className="animate-fade-in-up-delay mt-10 flex w-full max-w-[18rem] flex-col items-stretch gap-2.5">
          <Link
            href={"/sign-up" as Route}
            className="group relative flex min-h-12 cursor-pointer items-center justify-center overflow-hidden rounded-2xl bg-accent px-6 text-sm font-semibold text-white shadow-[0_0_48px_var(--accent-glow)] transition-all duration-300 hover:bg-accent-hover hover:shadow-[0_0_72px_var(--accent-glow)]"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 transition-all duration-700 ease-out group-hover:left-[120%] group-hover:opacity-100"
            />
            <span className="relative">{t("cta")}</span>
          </Link>
          <Link
            href={"/sign-in" as Route}
            className="flex min-h-12 cursor-pointer items-center justify-center rounded-2xl border border-border/60 bg-surface-raised/20 px-6 text-sm font-medium text-text-muted backdrop-blur-sm transition-colors hover:border-accent/25 hover:bg-surface-raised/35 hover:text-text"
          >
            {t("ctaSecondary")} →
          </Link>
        </div>
      </div>

      {/* Premium scroll-cue: a thin sage hairline with a dot quietly drifting
          downward. Anchored to the next section so a click takes the user
          straight into the body of the page. */}
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
          <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-accent shadow-[0_0_10px_var(--accent-glow)] [animation:var(--animate-scroll-cue)]" />
        </span>
      </Link>
    </LandingSection>
  );
}
