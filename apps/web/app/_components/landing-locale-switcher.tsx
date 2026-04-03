"use client";

import { useLocale } from "next-intl";

export function LandingLocaleSwitcher() {
  const current = useLocale();

  const switchLocale = (code: string) => {
    document.cookie = `persai-locale=${code};path=/;max-age=${365 * 86400};samesite=lax`;
    window.location.reload();
  };

  return (
    <div className="flex items-center gap-2 text-sm font-medium tracking-wide">
      <button
        type="button"
        onClick={() => switchLocale("en")}
        className={`cursor-pointer transition-colors ${
          current === "en" ? "text-text" : "text-text-subtle hover:text-text-muted"
        }`}
      >
        EN
      </button>
      <span className="text-text-subtle/40">·</span>
      <button
        type="button"
        onClick={() => switchLocale("ru")}
        className={`cursor-pointer transition-colors ${
          current === "ru" ? "text-text" : "text-text-subtle hover:text-text-muted"
        }`}
      >
        RU
      </button>
    </div>
  );
}
