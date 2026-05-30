"use client";

import { useEffect, useState } from "react";

/**
 * Deterministic per-character delay jitter in ms.
 * Cycles through these values using `count % JITTER.length` — no Math.random.
 */
const JITTER_MS = [0, 6, 3, 9, 1, 7, 4, 10, 1, 6, 2, 5, 2, 8, 3, 9];
const BASE_CHAR_DELAY_MS = 25;

/**
 * Progressively reveals `text` character by character at ~25–35 ms/char.
 *
 * - Returns `{ visibleText, isDone }`.
 * - Under `reducedMotion`, returns the full text immediately (`isDone: true`).
 * - Deterministic: uses a fixed jitter cycle; no `Math.random` / `Date.now`.
 * - All timers are cleaned up on unmount or when `text` / `reducedMotion` changes.
 */
export function useTypewriter(
  text: string,
  reducedMotion: boolean
): { visibleText: string; isDone: boolean } {
  const [visibleCount, setVisibleCount] = useState<number>(() => (reducedMotion ? text.length : 0));

  useEffect(() => {
    if (reducedMotion) {
      setVisibleCount(text.length);
      return;
    }

    setVisibleCount(0);

    if (text.length === 0) return;

    let count = 0;
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    function tick() {
      if (cancelled) return;
      count += 1;
      setVisibleCount(count);
      if (count < text.length) {
        const jitter = JITTER_MS[count % JITTER_MS.length] ?? 0;
        timerId = setTimeout(tick, BASE_CHAR_DELAY_MS + jitter);
      }
    }

    // Schedule the first character.
    const firstJitter = JITTER_MS[0] ?? 0;
    timerId = setTimeout(tick, BASE_CHAR_DELAY_MS + firstJitter);

    return () => {
      cancelled = true;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    };
  }, [text, reducedMotion]);

  return {
    visibleText: text.slice(0, visibleCount),
    isDone: visibleCount >= text.length
  };
}
