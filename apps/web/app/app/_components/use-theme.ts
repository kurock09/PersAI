"use client";

import { useCallback, useEffect, useState } from "react";
import { syncNativeSystemBars } from "./persai-native-bridge";

export type ThemeChoice = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

const STORAGE_KEY = "persai-theme";
const COOKIE_KEY = "persai-theme";
const COOKIE_MAX_AGE_SECONDS = 31_536_000;
const CYCLE: readonly ThemeChoice[] = ["system", "light", "dark"];
const THEME_COLOR_DARK = "#161513";
const THEME_COLOR_LIGHT = "#e0d8c8";

function readCookieChoice(): ThemeChoice | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )persai-theme=([^;]+)/);
  if (!match) return null;
  const value = decodeURIComponent(match[1] ?? "");
  if (value === "system" || value === "dark" || value === "light") return value;
  return null;
}

function writeCookieChoice(choice: ThemeChoice): void {
  if (typeof document === "undefined") return;
  const secure =
    typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE_KEY}=${encodeURIComponent(choice)}; Path=/; Max-Age=${String(
    COOKIE_MAX_AGE_SECONDS
  )}; SameSite=Lax${secure}`;
}

function readChoice(): ThemeChoice {
  // Cookie is the authoritative source per ADR-076 Slice 1; localStorage is
  // a same-origin mirror that survives if the cookie is ever cleared in a
  // session (e.g. third-party-cookie purges some browsers do on app load).
  const cookieChoice = readCookieChoice();
  if (cookieChoice) return cookieChoice;
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "system" || stored === "dark" || stored === "light") return stored;
  return "system";
}

function resolveChoice(choice: ThemeChoice): ResolvedTheme {
  if (choice !== "system") return choice;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyResolved(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("light", resolved === "light");
  // Native form controls, scrollbars, and autofill all read color-scheme
  // — keep it in sync so they don't show a dark scrollbar over a light
  // surface (or vice versa) on cold load.
  document.documentElement.style.colorScheme = resolved;
  // ADR-076 Slice 1 — keep <meta name="theme-color"> aligned with the active
  // palette so the browser chrome / Capacitor system bar match the app frame
  // for the rest of the session, regardless of OS preference.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta)
    meta.setAttribute("content", resolved === "light" ? THEME_COLOR_LIGHT : THEME_COLOR_DARK);
  // ADR-076 Slice 2a — additionally drive the Android status / navigation
  // bar colors and icon appearance from the same code path. No-op on
  // desktop / browser web.
  syncNativeSystemBars(resolved);
}

/**
 * Theme controller with three states: `system` (follow OS preference),
 * `dark`, and `light`.
 *
 * ADR-076 Slice 1 — the user's choice is persisted in the `persai-theme`
 * cookie (authoritative; read server-side in `apps/web/app/layout.tsx` to
 * SSR-bake the `<html class>` and `<meta name="theme-color">`). Every write
 * atomically updates **all four** synchronisation surfaces:
 *
 *   1. the cookie (next request will be server-resolved),
 *   2. the `localStorage` mirror (same-origin fallback),
 *   3. `<html class>` and `style.colorScheme` (in-page palette),
 *   4. `<meta name="theme-color">` (browser chrome / system bar).
 *
 * The OS-preference subscription only updates surfaces 3 & 4 — the user's
 * choice (cookie value) stays "system".
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeChoice>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("dark");

  useEffect(() => {
    const initial = readChoice();
    setThemeState(initial);
    const resolved = resolveChoice(initial);
    setResolvedTheme(resolved);
    applyResolved(resolved);
    // Mirror cookie → localStorage on first mount so the two surfaces never
    // drift after the SSR bake.
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, initial);
    }
  }, []);

  // While the user is on `system`, react to OS-level theme changes (night
  // shift, manual toggle in System Preferences) without requiring a reload.
  useEffect(() => {
    if (theme !== "system") return;
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const next: ResolvedTheme = mq.matches ? "dark" : "light";
      setResolvedTheme(next);
      applyResolved(next);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const persistChoice = useCallback((next: ThemeChoice) => {
    writeCookieChoice(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
    const resolved = resolveChoice(next);
    setResolvedTheme(resolved);
    applyResolved(resolved);
  }, []);

  const setTheme = useCallback(
    (next: ThemeChoice) => {
      setThemeState(next);
      persistChoice(next);
    },
    [persistChoice]
  );

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const idx = CYCLE.indexOf(prev);
      const next = CYCLE[(idx + 1) % CYCLE.length] ?? "system";
      persistChoice(next);
      return next;
    });
  }, [persistChoice]);

  return { theme, resolvedTheme, setTheme, toggleTheme };
}
