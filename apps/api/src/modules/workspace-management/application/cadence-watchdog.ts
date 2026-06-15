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
 * Tool-inflight suspension: while at least one native tool call is in flight (i.e.
 * the runtime emitted `tool_started` but not the matching `tool_finished` yet), the
 * silent timer is suspended. Long tools — `image_generate`, `video_generate`, slow
 * `web_fetch`, etc. — routinely take 15–60 s to complete and produce no intermediate
 * chunks; without suspension the silent timer would fire ~`silentMs` after the start
 * and falsely report the stream as stalled, which then aborts the runtime fetch and
 * loses the tool's side effects. After the last tool finishes, we keep the watchdog
 * quiet until the next model activity/delta; provider/runtime stream timeouts are the
 * correct guard for a slow post-tool final answer. Use `recordToolStarted()` /
 * `recordToolFinished()` for tool phase events instead of the generic
 * `recordActivity()`. The watchdog is meant to detect slow TEXT streaming, not slow
 * tool execution or post-tool thinking latency.
 *
 * Post-tool slow_avg suspension: once ANY native tool has started in this stream
 * span, the slow_avg signal is disabled for the remainder of the span. A short
 * post-tool final answer (e.g. the wrap-up note after `image_edit`/`image_generate`)
 * is routinely streamed slower than the per-token cadence threshold by some models,
 * and the previous behavior aborted the runtime fetch mid-final-answer — surfacing
 * as a silent stream cut with no error and, for media turns, a lost/duplicated job
 * because side-effect turns are not safe to retry. This mirrors the silent-timer
 * philosophy already documented for `recordToolFinished`: a slow post-tool answer is
 * the job of provider/runtime stream timeouts, not this mid-text cadence watchdog.
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
  silentEnabled?: boolean;
  slowAvgEnabled?: boolean;
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
   * Record any non-text activity from the runtime (`thinking`, `media`,
   * `runtime_done`, etc. — but NOT tool phase events). Resets the silent
   * timer (and starts it on the first call) but does NOT feed the slow_avg
   * window, so that long inter-text gaps caused by reasoning blocks do not
   * mask real slow-motion text streaming. For `tool_started` / `tool_finished`
   * use the dedicated `recordToolStarted` / `recordToolFinished` instead so
   * the silent timer is suspended for the tool's execution span.
   */
  recordActivity(): void;
  /**
   * Record that a native tool call has started executing. Increments the
   * inflight-tool counter and, if the count transitions from 0→1, suspends
   * the silent timer for the duration of the tool span. Also moves the
   * inter-delta anchor forward like `recordActivity` so a subsequent text
   * delta does not pollute the slow_avg rolling window with the tool's
   * setup gap.
   */
  recordToolStarted(): void;
  /**
   * Record that a native tool call finished. Decrements the inflight-tool
   * counter and moves `lastDeltaAtMs` forward so the next delta is measured
   * from the moment the tool returned (not from before it started). It does
   * not arm the silent timer; the model's first post-tool token may be slow
   * and should be governed by provider/runtime stream timeouts, not this
   * mid-text cadence watchdog.
   * Tolerates over-decrement (extra `recordToolFinished` calls are no-ops)
   * so callers do not need to track pairing perfectly across edge cases.
   */
  recordToolFinished(): void;
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
  const silentEnabled = options.silentEnabled !== false;
  const slowAvgEnabled = options.slowAvgEnabled !== false;

  let lastDeltaAtMs: number | null = null;
  let timerHandle: unknown = null;
  let fired = false;
  let disposed = false;
  let observedDeltaCount = 0;
  // Number of native tool calls currently in flight. While > 0, the silent
  // timer is suspended (long tools like image_generate routinely produce no
  // chunks for 15–60 s, which is healthy, not a stall).
  let inflightToolCount = 0;
  // Once any native tool has started in this span, the slow_avg signal is
  // disabled for the remainder of the span. See the file header comment: a
  // short post-tool final answer is routinely streamed below the per-token
  // cadence threshold and must not abort the runtime fetch.
  let slowAvgDisabledByTool = false;
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
    if (!silentEnabled) return;
    // Suspend the silent timer while any tool is in flight. The matching
    // `recordToolFinished` call will re-arm it once the last tool completes.
    if (inflightToolCount > 0) return;
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
        if (slowAvgEnabled && !slowAvgDisabledByTool && observedDeltaCount > warmupDeltas) {
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
    recordToolStarted() {
      if (disposed || fired) return;
      inflightToolCount += 1;
      // Disable slow_avg for the rest of this span. A post-tool wrap-up answer
      // (common on media turns) is legitimately slow and previously tripped
      // slow_avg, aborting the runtime fetch mid-answer with no error.
      slowAvgDisabledByTool = true;
      // Move the inter-delta anchor forward (same reason as recordActivity)
      // so that resumed text deltas after the tool finishes do not measure
      // the giant pre-tool gap.
      lastDeltaAtMs = now();
      // Suspend silent timer for the duration of the tool span. We do NOT
      // start a new timer here because `startSilentTimer` short-circuits when
      // `inflightToolCount > 0`; clearing here makes the suspension explicit
      // even if a previous timer was already armed.
      clearSilentTimer();
    },
    recordToolFinished() {
      if (disposed || fired) return;
      // Tolerate over-decrement: extra finished events (e.g. duplicated by
      // upstream demuxing) must not push the counter negative because that
      // would re-suspend the timer indefinitely once it next reached zero.
      if (inflightToolCount > 0) {
        inflightToolCount -= 1;
      }
      // Anchor the next text-delta gap measurement at "now" so a healthy
      // post-tool stream is not penalized by the tool's execution span.
      lastDeltaAtMs = now();
      // Do not re-arm the silent timer here. Slow post-tool finalization can
      // legitimately take longer than the text-cadence threshold; the next
      // delta/activity will re-arm the watchdog once streaming resumes.
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
