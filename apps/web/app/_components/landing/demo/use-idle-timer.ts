"use client";

import { useEffect, useRef } from "react";

export interface UseIdleTimerOptions {
  /** When false the timer is cleared and does not restart until true again. */
  enabled: boolean;
  /** Milliseconds of inactivity before `onIdle` is called. */
  idleMs: number;
  /** Callback fired when the idle deadline is reached. */
  onIdle: () => void;
}

/**
 * Calls `onIdle` after `idleMs` of inactivity.
 * Call `reset()` on user interactions to restart the countdown.
 *
 * - When `enabled` becomes false the pending timer is cleared immediately.
 * - Cleans up on unmount.
 * - No `window` access at module scope — safe to import in SSR trees.
 */
export function useIdleTimer({ enabled, idleMs, onIdle }: UseIdleTimerOptions): {
  reset: () => void;
} {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable refs — always reflect the latest prop values so timer callbacks
  // don't capture stale closures.
  const onIdleRef = useRef(onIdle);
  const idleMsRef = useRef(idleMs);
  const enabledRef = useRef(enabled);

  // Keep refs up to date without triggering extra effect runs.
  useEffect(() => {
    onIdleRef.current = onIdle;
    idleMsRef.current = idleMs;
    enabledRef.current = enabled;
  });

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onIdleRef.current();
    }, idleMs);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, idleMs]);

  return {
    reset() {
      if (!enabledRef.current) return;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onIdleRef.current();
      }, idleMsRef.current);
    }
  };
}
