"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

const STORAGE_KEY = "persai-theme";
const CYCLE: readonly ThemeChoice[] = ["system", "light", "dark"];

function readChoice(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem(STORAGE_KEY);
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
}

/**
 * Theme controller with three states: `system` (follow OS preference),
 * `dark`, and `light`. The user's choice is persisted in localStorage; the
 * actual rendered theme is recomputed when the OS preference changes while
 * the user is on `system`.
 *
 * To avoid a dark/light flash on first paint, the root layout includes a
 * tiny inline script that applies the correct class before React hydrates;
 * this hook then takes over for runtime updates.
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

  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, next);
    const resolved = resolveChoice(next);
    setResolvedTheme(resolved);
    applyResolved(resolved);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const idx = CYCLE.indexOf(prev);
      const next = CYCLE[(idx + 1) % CYCLE.length] ?? "system";
      if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, next);
      const resolved = resolveChoice(next);
      setResolvedTheme(resolved);
      applyResolved(resolved);
      return next;
    });
  }, []);

  return { theme, resolvedTheme, setTheme, toggleTheme };
}
