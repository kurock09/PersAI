import Link from "next/link";
import type { Route } from "next";
import { LandingLocaleSwitcher } from "../landing-locale-switcher";
import { LandingThemeToggle } from "../landing-theme-toggle";

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border/30 bg-chrome/65 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-10 sm:py-5">
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
      </div>
    </header>
  );
}
