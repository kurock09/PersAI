"use client";

import { useAuth } from "@clerk/nextjs";
import { useLocale } from "next-intl";
import { isWebLocale, switchWebLocale } from "@/app/lib/locale-sync";

export function LandingLocaleSwitcher() {
  const current = useLocale();
  const { getToken, isSignedIn } = useAuth();

  const switchLocale = (code: string) => {
    if (!isWebLocale(code)) {
      return;
    }
    void (async () => {
      const token = isSignedIn ? await getToken() : null;
      await switchWebLocale(code, token);
    })();
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
