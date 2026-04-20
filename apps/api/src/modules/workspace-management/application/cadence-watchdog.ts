/**
 * Cadence watchdog detects when a model stream is unusably slow and reports a stall.
 *
 * Two signals trigger a stall (whichever fires first):
 *  - "silent": no delta has arrived for `silentMs` (default 5000) since the last delta
 *    (or, before the first delta, since `arm()` was called).
 *  - "slow_avg": after at least `avgMinSamples` inter-delta gaps have been observed,
 *    the rolling average of the last `avgWindow` gaps exceeds `avgThresholdMs`.
 *
 * The watchdog fires `onStall` at most once and then becomes inert. Callers must
 * always invoke `dispose()` (typically in a `finally` block) so that the silent
 * timer is cleared even when the stream completes normally.
 *
 * The watchdog is deliberately stateless w.r.t. tracing — it always runs because
 * the rate of stalls is the very thing we are trying to measure, and the "is this
 * stream slow" decision must be made even when trace=OFF.
 */

export interface CadenceWatchdogOptions {
  silentMs: number;
  avgWindow: number;
  avgThresholdMs: number;
  avgMinSamples: number;
  /** Optional clock for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Optional timer factory for tests. Defaults to `setTimeout`. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface CadenceWatchdogStallReport {
  reason: "silent" | "slow_avg";
  silentMs?: number;
  rollingAvgMs?: number;
  rollingWindow?: number;
  observedGaps: number;
}

export interface CadenceWatchdog {
  /** Start the silent timer. Call once before the first expected delta. */
  arm(): void;
  /** Record the arrival of a delta and reset the silent timer. */
  recordDelta(): void;
  /** Stop all timers. Idempotent. */
  dispose(): void;
  /** Whether the stall callback already fired. */
  hasStalled(): boolean;
}

export function createCadenceWatchdog(
  options: CadenceWatchdogOptions,
  onStall: (report: CadenceWatchdogStallReport) => void
): CadenceWatchdog {
  const now = options.now ?? Date.now;
  const setTimer =
    options.setTimer ??
    ((fn: () => void, ms: number) => {
      const handle = setTimeout(fn, ms);
      // Avoid keeping the Node.js event loop alive solely for this timer.
      if (typeof (handle as { unref?: () => void }).unref === "function") {
        (handle as { unref: () => void }).unref();
      }
      return handle;
    });
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));

  const silentMs = options.silentMs;
  const avgWindow = options.avgWindow;
  const avgThresholdMs = options.avgThresholdMs;
  const avgMinSamples = options.avgMinSamples;

  let lastDeltaAtMs: number | null = null;
  let timerHandle: unknown = null;
  let fired = false;
  let disposed = false;
  const recentGapsMs: number[] = [];

  function clearSilentTimer(): void {
    if (timerHandle !== null) {
      clearTimer(timerHandle);
      timerHandle = null;
    }
  }

  function startSilentTimer(): void {
    clearSilentTimer();
    if (disposed || fired) return;
    timerHandle = setTimer(() => {
      timerHandle = null;
      trigger({
        reason: "silent",
        silentMs,
        observedGaps: recentGapsMs.length
      });
    }, silentMs);
  }

  function trigger(report: CadenceWatchdogStallReport): void {
    if (fired || disposed) return;
    fired = true;
    clearSilentTimer();
    try {
      onStall(report);
    } catch {
      // The watchdog must not propagate user-callback errors; the caller is
      // already in a streaming hot path and a thrown stall handler would mask
      // the real failure path. Errors in `onStall` are simply swallowed.
    }
  }

  return {
    arm() {
      if (disposed || fired) return;
      startSilentTimer();
    },
    recordDelta() {
      if (disposed || fired) return;
      const ts = now();
      if (lastDeltaAtMs !== null) {
        const gap = ts - lastDeltaAtMs;
        recentGapsMs.push(gap);
        if (recentGapsMs.length > avgWindow) {
          recentGapsMs.shift();
        }
        if (recentGapsMs.length >= avgMinSamples) {
          let sum = 0;
          for (const g of recentGapsMs) sum += g;
          const avg = sum / recentGapsMs.length;
          if (avg > avgThresholdMs) {
            trigger({
              reason: "slow_avg",
              rollingAvgMs: Math.round(avg),
              rollingWindow: recentGapsMs.length,
              observedGaps: recentGapsMs.length
            });
            return;
          }
        }
      }
      lastDeltaAtMs = ts;
      startSilentTimer();
    },
    dispose() {
      disposed = true;
      clearSilentTimer();
    },
    hasStalled() {
      return fired;
    }
  };
}

export interface CadenceThresholds {
  silentMs: number;
  avgWindow: number;
  avgThresholdMs: number;
  avgMinSamples: number;
}

/**
 * Default thresholds tuned for OpenAI gpt-5.x web chat streaming.
 * Normal cadence: 30-50ms inter-delta. Pathological: 200-300ms+.
 */
export const DEFAULT_CADENCE_THRESHOLDS: CadenceThresholds = {
  silentMs: 8000,
  avgWindow: 12,
  avgThresholdMs: 220,
  avgMinSamples: 8
};
