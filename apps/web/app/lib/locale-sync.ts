"use client";

import { patchMePreferences } from "@/app/app/me-api-client";

const LOCALE_COOKIE_NAME = "persai-locale";
const LOCALE_COOKIE_MAX_AGE_SECONDS = 365 * 86400;

export type WebLocale = "en" | "ru";

export function isWebLocale(value: string): value is WebLocale {
  return value === "en" || value === "ru";
}

export function getLocaleCookie(): WebLocale | null {
  if (typeof document === "undefined") {
    return null;
  }

  const cookieValue = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${LOCALE_COOKIE_NAME}=`))
    ?.split("=")[1];

  return cookieValue && isWebLocale(cookieValue) ? cookieValue : null;
}

export function setLocaleCookie(locale: WebLocale): void {
  document.cookie = `${LOCALE_COOKIE_NAME}=${locale};path=/;max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS};samesite=lax`;
}

/**
 * Switch UI locale cookie and persist backend truth when the user is signed in.
 */
export async function switchWebLocale(locale: WebLocale, authToken?: string | null): Promise<void> {
  setLocaleCookie(locale);

  if (authToken) {
    try {
      await patchMePreferences(authToken, { preferredLocale: locale });
    } catch {
      // Cookie still drives UI rendering; backend sync can retry on next switch.
    }
  }

  window.location.reload();
}
