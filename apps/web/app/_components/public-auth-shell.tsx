"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Route } from "next";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import { LandingLocaleSwitcher } from "./landing-locale-switcher";
import { LandingThemeToggle } from "./landing-theme-toggle";
import { LandingAndroidAppDownload } from "./landing-android-app-download";

export function PublicAuthShell(props: {
  children: ReactNode;
  showFooter?: boolean;
  showDownloadCta?: boolean;
  mainClassName?: string;
}) {
  const { children, showFooter = false, showDownloadCta = false, mainClassName } = props;
  const t = useTranslations("landing");
  const footerLinks = [
    { label: t("plans"), href: "/pricing" as Route },
    { label: t("termsLink"), href: "/terms" as Route },
    { label: t("privacyLink"), href: "/privacy" as Route },
    { label: t("contactsLink"), href: "/contacts" as Route },
    { label: t("requisitesLink"), href: "/requisites" as Route }
  ];

  return (
    <div className="relative min-h-screen min-h-[100svh] overflow-x-hidden bg-chrome">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-[12%] left-[7%] h-[380px] w-[380px] rounded-full bg-accent/[0.07] blur-[120px]" />
        <div className="absolute right-[6%] bottom-[18%] h-[320px] w-[320px] rounded-full bg-accent/[0.04] blur-[110px]" />
      </div>

      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")"
        }}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/25 to-transparent" />

      <div className="relative z-10 flex min-h-screen min-h-[100svh] flex-col px-5 pb-6 pt-5 sm:px-10 sm:pb-8 sm:pt-7">
        <header className="flex w-full items-center justify-between gap-4">
          <Link
            href={"/" as Route}
            className="select-none text-xs font-semibold uppercase tracking-[0.22em] text-text-muted transition-colors hover:text-text"
          >
            Pers<span className="text-text">AI</span>
          </Link>
          <div className="flex items-center gap-3">
            <LandingThemeToggle />
            <span className="hidden h-4 w-px bg-border sm:inline-block" />
            <LandingLocaleSwitcher />
          </div>
        </header>

        <main
          className={cn(
            "flex min-h-0 flex-1 items-center justify-center py-6 sm:py-8",
            mainClassName
          )}
        >
          {children}
        </main>

        {showFooter ? (
          <footer className="mx-auto mt-8 w-full max-w-3xl shrink-0 border-t border-border/70 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))] text-center sm:mt-10 sm:pt-10">
            {showDownloadCta ? (
              <div className="mb-6">
                <LandingAndroidAppDownload cta={t("androidAppCta")} />
              </div>
            ) : null}
            <nav className="mx-auto flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[10px] font-medium text-text-subtle sm:gap-x-4 sm:text-[11px]">
              {footerLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="transition-colors hover:text-text-muted"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <p className="mt-2 text-[10px] text-text-subtle/60">{t("terms")}</p>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
