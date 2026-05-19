import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { LandingSection } from "./section";

/**
 * Typographic finale — rhymes with the Hero on purpose: same eyebrow rhythm,
 * same two-line headline split (semibold + light/muted), same CTA pair, but
 * compressed in scale and surrounded by air instead of a card. The page opens
 * with a question (Hero) and closes with the answer ("one step → your PersAI"),
 * so the reader feels the loop close without us needing a banner to say it.
 */
export async function LandingFinaleSection() {
  const t = await getTranslations("landing.finale");
  const titleLine2 = t("titleLine2").trim();
  const trustItems = [
    { key: "fastStart", label: t("trust.fastStart") },
    {
      key: "payment",
      label: t("trust.payment"),
      iconSrc: "/landing/sbp.svg",
      iconAlt: "SBP"
    },
    { key: "access", label: t("trust.access") }
  ];

  return (
    <LandingSection
      id="finale"
      // Keep the finale calm and prominent, but no longer as a full-screen
      // "second hero". Founder feedback: the vertical air was overpowering the
      // actual message and making the block feel detached from the System
      // section above.
      className="relative flex min-h-[30rem] flex-col items-center justify-center pt-4 pb-14 sm:min-h-[34rem] sm:pt-6 sm:pb-16"
    >
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        {/* Quiet sage hairline above the eyebrow — separates the finale from
            the System block without a hard divider, and keeps the eye moving
            into the type. */}
        <div
          aria-hidden
          className="h-px w-12 bg-gradient-to-r from-transparent via-accent/45 to-transparent sm:w-16"
        />

        <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.26em] text-text-subtle">
          {t("eyebrow")}
        </p>

        <h2 className="mt-4 leading-[1.05] tracking-[-0.04em] sm:mt-5">
          <span className="block text-[clamp(1.95rem,4.6vw,3.7rem)] font-semibold text-text">
            {t("titleLine1")}
          </span>
          {titleLine2.length > 0 ? (
            <span className="block text-[clamp(1.85rem,4.3vw,3.45rem)] font-light text-text-muted">
              {titleLine2}
            </span>
          ) : null}
        </h2>

        <p className="mt-5 max-w-[34rem] text-sm leading-relaxed text-text-muted sm:text-base">
          {t("body")}
        </p>

        <div className="mt-6 grid w-full max-w-2xl gap-2 sm:grid-cols-3">
          {trustItems.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-center gap-2 rounded-2xl border border-border/55 bg-surface-raised/18 px-4 py-3 text-center text-[12px] font-medium text-text-muted backdrop-blur-sm"
            >
              {item.iconSrc ? (
                <Image
                  src={item.iconSrc}
                  alt={item.iconAlt ?? ""}
                  width={18}
                  height={18}
                  className="h-[18px] w-[18px] shrink-0"
                />
              ) : null}
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        <div className="mt-7 flex w-full max-w-[18rem] flex-col items-stretch gap-2.5 sm:max-w-md sm:flex-row sm:justify-center sm:gap-3">
          <Link
            href={"/sign-up" as Route}
            className="group relative flex min-h-12 cursor-pointer items-center justify-center overflow-hidden rounded-2xl bg-accent px-6 text-sm font-semibold text-white shadow-[0_0_48px_var(--accent-glow)] transition-all duration-300 hover:bg-accent-hover hover:shadow-[0_0_72px_var(--accent-glow)] sm:flex-1"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 transition-all duration-700 ease-out group-hover:left-[120%] group-hover:opacity-100"
            />
            <span className="relative">{t("ctaPrimary")}</span>
          </Link>
          <Link
            href={"/pricing" as Route}
            className="flex min-h-12 cursor-pointer items-center justify-center rounded-2xl border border-border/60 bg-surface-raised/20 px-6 text-sm font-medium text-text-muted backdrop-blur-sm transition-colors hover:border-accent/25 hover:bg-surface-raised/35 hover:text-text sm:flex-1"
          >
            {t("ctaSecondary")} →
          </Link>
        </div>

        <p className="mt-5 text-[11px] leading-relaxed text-text-subtle/85">{t("note")}</p>
      </div>
    </LandingSection>
  );
}
