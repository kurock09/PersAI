// Mirrors apps/api/src/modules/workspace-management/interface/http/
// stream-writer-instrumentation.ts. Three local copies are intentional to
// avoid creating a new shared package for ~50 lines of code; the active
// stream path lives in three different apps and each writer must be able
// to record the same observational counters.

const STREAM_FLUSH_COALESCE_INTERVAL_MS = 40;

export interface StreamWriterStats {
  writes: number;
  backpressureWrites: number;
  backpressureMaxDrainMs: number;
  backpressureTotalDrainMs: number;
}

export interface DrainEventTarget {
  once(eventName: "drain", listener: () => void): unknown;
}

export interface FlushTarget {
  flush?: () => void;
  writableEnded?: boolean;
}

export interface StreamWriterInstrumentation {
  recordWrite(writeReturnedTrue: boolean, drainEventTarget: DrainEventTarget): void;
  formatStats(): string;
  snapshot(): StreamWriterStats;
}

export interface CoalescedStreamFlusher {
  flushAfterWrite(options?: { immediate?: boolean }): void;
  flushNow(): void;
  dispose(): void;
}

export function createStreamWriterInstrumentation(): StreamWriterInstrumentation {
  const stats: StreamWriterStats = {
    writes: 0,
    backpressureWrites: 0,
    backpressureMaxDrainMs: 0,
    backpressureTotalDrainMs: 0
  };
  let pendingDrainStartedAtMs: number | null = null;

  return {
    recordWrite(writeReturnedTrue, drainEventTarget) {
      stats.writes += 1;
      if (writeReturnedTrue) {
        return;
      }
      stats.backpressureWrites += 1;
      if (pendingDrainStartedAtMs !== null) {
        return;
      }
      const startedAtMs = Date.now();
      pendingDrainStartedAtMs = startedAtMs;
      drainEventTarget.once("drain", () => {
        if (pendingDrainStartedAtMs !== startedAtMs) {
          return;
        }
        const elapsedMs = Date.now() - startedAtMs;
        if (elapsedMs > stats.backpressureMaxDrainMs) {
          stats.backpressureMaxDrainMs = elapsedMs;
        }
        stats.backpressureTotalDrainMs += elapsedMs;
        pendingDrainStartedAtMs = null;
      });
    },
    snapshot() {
      return { ...stats };
    },
    formatStats() {
      return `writes=${String(stats.writes)} backpressureWrites=${String(stats.backpressureWrites)} backpressureMaxDrainMs=${String(stats.backpressureMaxDrainMs)} backpressureTotalDrainMs=${String(stats.backpressureTotalDrainMs)}`;
    }
  };
}

export function createCoalescedStreamFlusher(
  target: FlushTarget,
  intervalMs = STREAM_FLUSH_COALESCE_INTERVAL_MS
): CoalescedStreamFlusher {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushPending = false;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flushNow = (): void => {
    clearTimer();
    if (!flushPending || target.writableEnded === true) {
      flushPending = false;
      return;
    }
    flushPending = false;
    target.flush?.();
  };

  return {
    flushAfterWrite(options) {
      if (target.flush === undefined || target.writableEnded === true) {
        flushPending = false;
        clearTimer();
        return;
      }
      flushPending = true;
      if (options?.immediate === true) {
        flushNow();
        return;
      }
      if (timer === null) {
        timer = setTimeout(flushNow, intervalMs);
      }
    },
    flushNow,
    dispose() {
      flushNow();
      clearTimer();
    }
  };
}
