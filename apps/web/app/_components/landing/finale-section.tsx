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
                  className="h-[18px] w-[18px] shrink-0 dark:invert dark:brightness-150"
                />
              ) : null}
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        <div className="mt-7 flex w-full max-w-[18rem] flex-col items-stretch gap-2.5 sm:max-w-md sm:flex-row sm:justify-center sm:gap-3">
          <Link
            href={"/sign-up" as Route}
            className="flex min-h-12 cursor-pointer items-center justify-center rounded-[1.35rem] border border-[rgba(72,91,79,0.28)] bg-accent px-6 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_0_rgba(52,68,58,0.18),0_16px_28px_-20px_rgba(72,91,79,0.78)] transition-colors hover:bg-accent-hover sm:flex-1 dark:border-[#a8baa0]/35 dark:bg-[#8faa9a] dark:text-[#f6f0e8] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(0,0,0,0.22),0_18px_32px_-24px_rgba(143,170,154,0.56)] dark:hover:bg-[#9ab5a4]"
          >
            {t("ctaPrimary")}
          </Link>
          <Link
            href={"/pricing" as Route}
            className="flex min-h-12 cursor-pointer items-center justify-center rounded-[1.35rem] border border-[rgba(92,72,48,0.12)] bg-surface-raised/62 px-6 text-sm font-medium text-text-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.74),inset_0_-1px_0_rgba(92,72,48,0.08),0_14px_26px_-22px_rgba(92,72,48,0.46)] transition-colors hover:border-[rgba(92,72,48,0.18)] hover:bg-surface-raised/82 hover:text-text sm:flex-1 dark:border-white/16 dark:bg-surface-raised/48 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-1px_0_rgba(0,0,0,0.24),0_16px_30px_-24px_rgba(0,0,0,0.8)] dark:hover:border-white/22 dark:hover:bg-surface-hover/64"
          >
            {t("ctaSecondary")} →
          </Link>
        </div>

        <p className="mt-5 text-[11px] leading-relaxed text-text-subtle/85">{t("note")}</p>
      </div>
    </LandingSection>
  );
}
