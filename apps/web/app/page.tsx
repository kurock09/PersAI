import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LandingLocaleSwitcher } from "./_components/landing-locale-switcher";
import { LandingThemeToggle } from "./_components/landing-theme-toggle";

export default async function HomePage() {
  const { userId } = await auth();
  if (userId !== null) {
    redirect("/app" as Route);
  }

  const t = await getTranslations("landing");
  const headlineLine2 = t("headlineLine2").trim();
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
            {headlineLine2.length > 0 ? (
              <span className="block text-[clamp(2.1rem,5vw,4.2rem)] font-light text-text-muted">
                {headlineLine2}
              </span>
            ) : null}
          </h1>

          <p className="animate-fade-in-up-delay mx-auto mt-5 max-w-[22rem] text-sm leading-relaxed text-text-muted sm:max-w-[34rem] sm:text-lg">
            {t("subtitle")}
          </p>

          <div className="animate-fade-in-up-delay mt-5 flex w-full max-w-[34rem] flex-col items-center gap-3">
            <div className="grid w-full max-w-[30rem] grid-cols-1 gap-2.5 sm:grid-cols-3">
              <span className="rounded-2xl border border-white/6 bg-white/[0.028] px-4 py-3 text-center text-[11px] font-medium tracking-[0.02em] text-text-muted/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-md">
                {t("capabilityMemory")}
              </span>
              <span className="rounded-2xl border border-white/6 bg-white/[0.028] px-4 py-3 text-center text-[11px] font-medium tracking-[0.02em] text-text-muted/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-md">
                {t("capabilityChannels")}
              </span>
              <span className="rounded-2xl border border-white/6 bg-white/[0.028] px-4 py-3 text-center text-[11px] font-medium tracking-[0.02em] text-text-muted/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-md">
                {t("capabilityTasks")}
              </span>
            </div>
          </div>

          <div className="animate-fade-in-up-delay mt-6 flex w-full max-w-[15rem] flex-col items-stretch gap-2.5">
            <Link
              href={"/sign-up" as Route}
              className="group relative flex min-h-12 cursor-pointer items-center justify-center overflow-hidden rounded-2xl bg-accent px-6 text-sm font-semibold text-white shadow-[0_0_48px_var(--accent-glow)] transition-all duration-300 hover:bg-accent-hover hover:shadow-[0_0_72px_var(--accent-glow)]"
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
              className="flex min-h-12 cursor-pointer items-center justify-center rounded-2xl border border-border/60 bg-surface-raised/20 px-6 text-sm font-medium text-text-muted backdrop-blur-sm transition-colors hover:border-accent/25 hover:bg-surface-raised/35 hover:text-text"
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
