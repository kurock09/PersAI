"use client";

import { useEffect, useState } from "react";

/**
 * Detect touch-only devices (phones, tablets) so the UI can offer
 * mobile-appropriate affordances — for example, inserting a newline on
 * Enter instead of submitting, or always showing controls that desktop
 * normally gates behind hover.
 *
 * Returns `false` on the server and during the first client render to keep
 * SSR markup stable, then settles to the real value after hydration.
 */
export function useTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // jsdom (used by vitest) doesn't implement matchMedia. Defaulting to
    // `false` in that environment matches the SSR contract above and keeps
    // touch-specific branches off in tests, which want desktop behaviour.
    if (typeof window.matchMedia !== "function") return;
    /*
     * 2026-04-25 robustness fix: Samsung's WebView on the Z Fold series in
     * unfolded (tablet-like) mode returns `(hover: hover)` even though the
     * primary input is still a finger. Combining `pointer: coarse` AND
     * `hover: none` therefore mis-classifies the device as desktop, and the
     * hold-to-record mic handler never gets attached. We now treat the
     * device as touch-capable when EITHER `pointer: coarse` matches OR
     * `navigator.maxTouchPoints > 0` is reported. That matches Telegram's
     * own touch detection and keeps the desktop branch intact for true
     * mouse-only browsers (where both signals are absent).
     */
    const coarseMq = window.matchMedia("(pointer: coarse)");
    const hasTouchPoints = typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0;
    const update = () => setIsTouch(coarseMq.matches || hasTouchPoints);
    update();
    coarseMq.addEventListener("change", update);
    return () => coarseMq.removeEventListener("change", update);
  }, []);

  return isTouch;
}
