/**
 * Cadence watchdog detects when a model stream is unusably slow and reports a stall.
 *
 * Two signals trigger a stall (whichever fires first):
 *  - "silent": no activity has arrived for `silentMs` since the last activity. The
 *    silent timer is intentionally NOT started by `arm()` — it is started lazily on
 *    the first `recordDelta()` or `recordActivity()` call. This avoids killing the
 *    stream during the cold-start / pre-first-token phase (long reasoning, queueing,
 *    provider warm-up). Once the runtime has shown any sign of life, the silent
 *    timer guards against mid-stream hangs.
 *  - "slow_avg": after at least `avgMinSamples` inter-delta gaps have been observed,
 *    the rolling average of the last `avgWindow` gaps exceeds `avgThresholdMs`.
 *    Only `recordDelta()` (text deltas) feeds this rolling window — non-text events
 *    like `thinking`/`tool`/`media` would inflate the average and mask real slow-mo,
 *    so they are recorded via `recordActivity()` which only resets the silent timer.
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
  warmupDeltas?: number;
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
  /**
   * Mark the watchdog as ready to track activity. Does NOT start the silent
   * timer — the timer is started by the first `recordDelta()` or
   * `recordActivity()` call so that the cold-start phase before the first
   * runtime event is never reported as a stall.
   */
  arm(): void;
  /**
   * Record the arrival of a text delta. Resets the silent timer (and starts it
   * on the first call) and feeds the slow_avg rolling window.
   * Use ONLY for text deltas — non-text events must use `recordActivity()`.
   */
  recordDelta(): void;
  /**
   * Record any non-text activity from the runtime (`thinking`, `tool` start/
   * end, `media`, `runtime_done`, etc.). Resets the silent timer (and starts
   * it on the first call) but does NOT feed the slow_avg window, so that long
   * inter-text gaps caused by tool calls or reasoning blocks do not mask real
   * slow-motion text streaming.
   */
  recordActivity(): void;
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
  const warmupDeltas = Math.max(0, options.warmupDeltas ?? 0);

  let lastDeltaAtMs: number | null = null;
  let timerHandle: unknown = null;
  let fired = false;
  let disposed = false;
  let observedDeltaCount = 0;
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
      // Intentionally a no-op for the silent timer — see the file header comment.
      // We keep the method on the API so callers can express intent ("the stream
      // is about to start") and so future signals (e.g. tracing) can hook here
      // without changing call sites.
      if (disposed || fired) return;
    },
    recordDelta() {
      if (disposed || fired) return;
      const ts = now();
      if (lastDeltaAtMs !== null) {
        const gap = ts - lastDeltaAtMs;
        observedDeltaCount += 1;
        if (observedDeltaCount > warmupDeltas) {
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
      }
      lastDeltaAtMs = ts;
      startSilentTimer();
    },
    recordActivity() {
      if (disposed || fired) return;
      // Move the inter-delta anchor forward so that the NEXT recordDelta()
      // measures the gap from "now" instead of from the last text delta. Without
      // this, a long activity span (e.g. a 4s tool call) would inject a single
      // huge gap into the slow_avg rolling window once text streaming resumes,
      // falsely flagging healthy post-tool text as slow_avg. We only want
      // slow_avg to reflect real text-delta-to-text-delta cadence.
      lastDeltaAtMs = now();
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
  warmupDeltas: number;
}

/**
 * Default thresholds for web chat slow-motion recovery.
 *
 * The cold-start / first-token wait is handled by the normal stream timeout.
 * Once text streaming has actually started, we ignore the first 20 text gaps,
 * then evaluate only text-delta cadence. If at least 20 measured gaps average
 * above 200ms, the caller may retry the same request as a slow-mo recovery.
 */
export const DEFAULT_CADENCE_THRESHOLDS: CadenceThresholds = {
  silentMs: 8000,
  avgWindow: 20,
  avgThresholdMs: 200,
  avgMinSamples: 20,
  warmupDeltas: 20
};
