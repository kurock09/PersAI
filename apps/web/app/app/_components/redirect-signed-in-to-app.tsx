"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { getSafeRedirectPathFromSearch, navigateAfterClerkAuth } from "@/app/lib/clerk-navigation";

/**
 * Full-page redirect for users who already have a Clerk session but opened /sign-in
 * or /sign-up manually. Uses the same navigation as post-auth (cookie-safe).
 */
export function RedirectSignedInUserToApp() {
  const t = useTranslations("auth");

  useEffect(() => {
    const target = getSafeRedirectPathFromSearch(window.location.search) ?? "/app";
    navigateAfterClerkAuth(target, "replace");
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-4">
      <Loader2 className="h-8 w-8 animate-spin text-accent" aria-hidden />
      <p className="text-sm text-text-muted">{t("redirectingSignedIn")}</p>
    </div>
  );
}
