export type RuntimeTurnDeadlineAbortReason = "wall_clock" | "idle_stall" | "external";

export interface RuntimeStreamTurnDeadline {
  signal: AbortSignal;
  recordProgress: () => void;
  dispose: () => void;
  getAbortReason: () => RuntimeTurnDeadlineAbortReason | null;
}

export interface RuntimeTurnStreamDeadlineConfig {
  wallClockMs: number;
  idleStallMs: number;
}

export function resolveRuntimeTurnStreamDeadlineConfig(config: {
  PERSAI_RUNTIME_TURN_WALL_CLOCK_MS: number;
  PERSAI_RUNTIME_TURN_IDLE_STALL_MS: number;
}): RuntimeTurnStreamDeadlineConfig {
  return {
    wallClockMs: config.PERSAI_RUNTIME_TURN_WALL_CLOCK_MS,
    idleStallMs: config.PERSAI_RUNTIME_TURN_IDLE_STALL_MS
  };
}

export function createRuntimeStreamTurnDeadline(input: {
  wallClockMs: number;
  idleStallMs: number;
  externalSignal?: AbortSignal;
}): RuntimeStreamTurnDeadline {
  const controller = new AbortController();
  let abortReason: RuntimeTurnDeadlineAbortReason | null = null;
  let idleTimer: NodeJS.Timeout | null = null;
  let disposed = false;

  const abort = (reason: RuntimeTurnDeadlineAbortReason): void => {
    if (disposed || controller.signal.aborted) {
      return;
    }
    abortReason = reason;
    controller.abort();
  };

  const clearIdleTimer = (): void => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const scheduleIdleTimer = (): void => {
    clearIdleTimer();
    if (disposed || controller.signal.aborted) {
      return;
    }
    idleTimer = setTimeout(() => abort("idle_stall"), input.idleStallMs);
  };

  const recordProgress = (): void => {
    if (disposed || controller.signal.aborted) {
      return;
    }
    scheduleIdleTimer();
  };

  const wallClockTimer = setTimeout(() => abort("wall_clock"), input.wallClockMs);

  if (input.externalSignal) {
    if (input.externalSignal.aborted) {
      abort("external");
    } else {
      input.externalSignal.addEventListener("abort", () => abort("external"), { once: true });
    }
  }

  recordProgress();

  return {
    signal: controller.signal,
    recordProgress,
    dispose: () => {
      disposed = true;
      clearTimeout(wallClockTimer);
      clearIdleTimer();
    },
    getAbortReason: () => abortReason
  };
}

export function createRuntimeTurnWallClockDeadline(input: {
  wallClockMs: number;
  externalSignal?: AbortSignal;
}): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const wallClockTimer = setTimeout(() => controller.abort(), input.wallClockMs);

  if (input.externalSignal) {
    if (input.externalSignal.aborted) {
      controller.abort();
    } else {
      input.externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  return {
    signal: controller.signal,
    dispose: () => clearTimeout(wallClockTimer)
  };
}
