"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Route } from "next";
import { LandingLocaleSwitcher } from "./landing-locale-switcher";
import { LandingThemeToggle } from "./landing-theme-toggle";

export function PublicAuthShell(props: { children: ReactNode }) {
  const { children } = props;

  return (
    <div className="relative min-h-screen min-h-[100svh] overflow-x-hidden bg-chrome">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-[12%] left-[7%] h-[380px] w-[380px] rounded-full bg-accent/[0.08] blur-[120px] animate-pulse-slow" />
        <div className="absolute right-[6%] bottom-[18%] h-[320px] w-[320px] rounded-full bg-accent/[0.05] blur-[110px] animate-pulse-slow [animation-delay:2s]" />
      </div>

      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")"
        }}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/25 to-transparent" />

      <div className="relative z-10 flex min-h-screen min-h-[100svh] flex-col px-4 pb-6 pt-5 sm:px-6 sm:pb-8 sm:pt-7">
        <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
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

        <main className="flex min-h-0 flex-1 items-center justify-center py-6 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
