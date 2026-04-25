import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LandingLocaleSwitcher } from "./_components/landing-locale-switcher";
import { LandingThemeToggle } from "./_components/landing-theme-toggle";

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.926l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.978.633z" />
    </svg>
  );
}

export default async function HomePage() {
  const { userId } = await auth();
  if (userId !== null) {
    redirect("/app" as Route);
  }

  const t = await getTranslations("landing");

  return (
    <div className="relative h-screen overflow-hidden bg-chrome">
      {/* Aurora — three sage halos, soft blur, slow pulse */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[5%] top-[10%] h-[600px] w-[600px] rounded-full bg-accent/[0.13] blur-[160px] animate-pulse-slow" />
        <div className="absolute right-[5%] top-[30%] h-[400px] w-[400px] rounded-full bg-accent/[0.07] blur-[130px] animate-pulse-slow [animation-delay:2s]" />
        <div className="absolute bottom-[5%] left-[35%] h-[350px] w-[350px] rounded-full bg-accent/[0.09] blur-[120px] animate-pulse-slow [animation-delay:4s]" />
      </div>

      {/* Tactile grain — subtle SVG noise overlay, ~3% opacity. Adds the
          "premium tactile" feel without committing to a background image
          asset. The data: URI keeps it self-contained and themable. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")"
        }}
      />

      {/* Top hairline — sage gradient */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/25 to-transparent" />

      <div className="relative z-10 flex h-full flex-col px-6 sm:px-10">
        {/* Header */}
        <header className="flex items-center justify-between pt-6 sm:pt-8">
          <span className="select-none text-xs font-semibold uppercase tracking-[0.22em] text-text-muted">
            Pers<span className="text-text">AI</span>
          </span>
          <div className="flex items-center gap-3">
            <LandingThemeToggle />
            <span className="hidden h-4 w-px bg-border sm:inline-block" />
            <LandingLocaleSwitcher />
          </div>
        </header>

        {/* Hero */}
        <main className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="animate-fade-in text-[10px] font-semibold uppercase tracking-[0.25em] text-text-subtle sm:text-[11px]">
            {t("eyebrow")}
          </p>

          <h1 className="animate-fade-in-up mt-6 leading-[1.08] tracking-[-0.035em]">
            <span className="block text-[clamp(2rem,5.5vw,4rem)] font-semibold text-text">
              {t("headlineLine1")}
            </span>
            <span className="block text-[clamp(2rem,5.5vw,4rem)] font-light text-text-muted">
              {t("headlineLine2")}
            </span>
          </h1>

          <p className="animate-fade-in-up-delay mx-auto mt-6 max-w-xs text-sm leading-relaxed text-text-muted sm:max-w-md sm:text-base">
            {t("subtitle")}
          </p>

          {/* Platforms */}
          <div className="animate-fade-in-up-delay mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
            {/* Telegram — active */}
            <span className="flex items-center gap-2 rounded-full border border-[#2AABEE]/30 bg-[#2AABEE]/[0.08] px-4 py-1.5 text-[12px] font-medium text-[#2AABEE]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2AABEE] opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#2AABEE]" />
              </span>
              <TelegramIcon className="h-3.5 w-3.5" />
              Telegram
            </span>
            {/* Coming soon group — themed pill, stays on the same row when wrapping */}
            <span className="flex items-center gap-2 rounded-full border border-border bg-surface-raised/40 px-3.5 py-1.5 backdrop-blur-sm">
              <span className="flex items-center gap-2 text-[12px] font-medium">
                <span className="text-[#0077FF]/55">VK</span>
                <span className="text-text-subtle/40">·</span>
                <span className="text-[#25D366]/55">WhatsApp</span>
                <span className="text-text-subtle/40">·</span>
                <span className="text-[#7B5CF6]/55">MAX</span>
              </span>
              <span className="ml-1 text-[10px] font-medium uppercase tracking-wider text-text-subtle/60">
                {t("soon")}
              </span>
            </span>
          </div>

          <div className="animate-fade-in-up-delay mt-7 flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href={"/sign-up" as Route}
              className="group relative cursor-pointer overflow-hidden rounded-2xl bg-accent px-8 py-3.5 text-sm font-semibold text-white shadow-[0_0_48px_var(--accent-glow)] transition-all duration-300 hover:bg-accent-hover hover:shadow-[0_0_72px_var(--accent-glow)]"
            >
              {/* Soft sheen on hover — reads as a glassy ridge crossing the
                  CTA, kept short so it stays calm rather than gimmicky. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 transition-all duration-700 ease-out group-hover:left-[120%] group-hover:opacity-100"
              />
              <span className="relative">{t("cta")}</span>
            </Link>
            <Link
              href={"/sign-in" as Route}
              className="cursor-pointer text-sm font-medium text-text-muted transition-colors hover:text-text"
            >
              {t("ctaSecondary")} →
            </Link>
          </div>
        </main>

        {/* Footer */}
        <footer className="pb-6 pt-4 text-center">
          <p className="text-[11px] text-text-subtle">{t("terms")}</p>
        </footer>
      </div>
    </div>
  );
}
