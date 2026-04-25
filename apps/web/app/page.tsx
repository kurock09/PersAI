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
  const footerLinks = [
    { label: t("plans"), href: "/sign-up" },
    { label: t("termsLink"), href: "#terms" },
    { label: t("privacyLink"), href: "#privacy" },
    { label: t("contactsLink"), href: "mailto:support@persai.app" },
    { label: t("requisitesLink"), href: "#requisites" }
  ];

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

      <div className="relative z-10 flex h-full flex-col px-5 sm:px-10">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between pt-5 sm:pt-7">
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
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center py-4 text-center sm:py-6">
          <p className="animate-fade-in text-[9px] font-semibold uppercase tracking-[0.26em] text-text-subtle sm:text-[10px]">
            {t("eyebrow")}
          </p>

          <h1 className="animate-fade-in-up mt-5 max-w-4xl leading-[1.05] tracking-[-0.04em] sm:mt-6">
            <span className="block text-[clamp(2.25rem,5.4vw,4.6rem)] font-semibold text-text">
              {t("headlineLine1")}
            </span>
            <span className="block text-[clamp(2.1rem,5vw,4.2rem)] font-light text-text-muted">
              {t("headlineLine2")}
            </span>
          </h1>

          <p className="animate-fade-in-up-delay mx-auto mt-4 max-w-[20rem] text-xs leading-relaxed text-text-muted sm:max-w-[30rem] sm:text-sm">
            {t("subtitle")}
          </p>

          <div className="animate-fade-in-up-delay mt-4 flex max-w-xl flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[10px] font-medium text-text-subtle/80 sm:gap-x-3 sm:text-[11px]">
            <span>{t("capabilityMemory")}</span>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-text-subtle/30" />
            <span>{t("capabilityChannels")}</span>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-text-subtle/30" />
            <span>{t("capabilityTasks")}</span>
          </div>

          {/* Platforms */}
          <div className="animate-fade-in-up-delay mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
            {/* Telegram — active */}
            <span className="flex items-center gap-1.5 rounded-full border border-[#2AABEE]/15 bg-[#2AABEE]/[0.045] px-3 py-1.5 text-[10px] font-medium text-[#2AABEE]/85">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2AABEE] opacity-35" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#2AABEE]" />
              </span>
              <TelegramIcon className="h-3 w-3" />
              Telegram
            </span>
            {/* Coming soon group — themed pill, stays on the same row when wrapping */}
            <span className="flex items-center gap-2 rounded-full border border-border/45 bg-surface-raised/20 px-3 py-1.5 backdrop-blur-sm">
              <span className="flex items-center gap-2 text-[10px] font-medium">
                <span className="text-[#0077FF]/55">VK</span>
                <span className="text-text-subtle/40">·</span>
                <span className="text-[#25D366]/55">WhatsApp</span>
                <span className="text-text-subtle/40">·</span>
                <span className="text-[#7B5CF6]/55">MAX</span>
              </span>
              <span className="ml-1 text-[9px] font-medium uppercase tracking-wider text-text-subtle/60">
                {t("soon")}
              </span>
            </span>
          </div>

          <div className="animate-fade-in-up-delay mt-6 flex flex-col items-center gap-3">
            <Link
              href={"/sign-up" as Route}
              className="group relative cursor-pointer overflow-hidden rounded-2xl bg-accent px-7 py-3.5 text-sm font-semibold text-white shadow-[0_0_48px_var(--accent-glow)] transition-all duration-300 hover:bg-accent-hover hover:shadow-[0_0_72px_var(--accent-glow)] sm:px-8"
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
              className="cursor-pointer rounded-2xl border border-border/60 bg-surface-raised/20 px-6 py-2.5 text-sm font-medium text-text-muted backdrop-blur-sm transition-colors hover:border-accent/25 hover:bg-surface-raised/35 hover:text-text"
            >
              {t("ctaSecondary")} →
            </Link>
          </div>
        </main>

        {/* Footer */}
        <footer className="shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))] text-center">
          <nav className="mx-auto flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[10px] font-medium text-text-subtle sm:gap-x-4 sm:text-[11px]">
            {footerLinks.map((link) =>
              link.href.startsWith("mailto:") || link.href.startsWith("#") ? (
                <a
                  key={link.label}
                  href={link.href}
                  className="transition-colors hover:text-text-muted"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.label}
                  href={link.href as Route}
                  className="transition-colors hover:text-text-muted"
                >
                  {link.label}
                </Link>
              )
            )}
          </nav>
          <p className="mt-2 text-[10px] text-text-subtle/60">{t("terms")}</p>
        </footer>
      </div>
    </div>
  );
}
