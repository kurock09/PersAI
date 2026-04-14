const NATIVE_RUNTIME_TURN_TIMEOUT_BUFFER_MS = 15_000;

export function resolveNativeRuntimeTurnTimeoutMs(
  runtimeBundle: unknown,
  fallbackTimeoutMs: number
): number {
  const workerTimeouts = readWorkerTimeouts(runtimeBundle);
  if (workerTimeouts.length === 0) {
    return fallbackTimeoutMs;
  }
  return Math.max(
    fallbackTimeoutMs,
    Math.max(...workerTimeouts) + NATIVE_RUNTIME_TURN_TIMEOUT_BUFFER_MS
  );
}

function readWorkerTimeouts(runtimeBundle: unknown): number[] {
  const bundle = asObject(runtimeBundle);
  const runtime = asObject(bundle?.runtime);
  const workerTools = asObject(runtime?.workerTools);
  const tools = Array.isArray(workerTools?.tools) ? workerTools.tools : [];
  return tools
    .map((tool) => asObject(tool)?.timeoutMs)
    .filter(
      (timeoutMs): timeoutMs is number => Number.isInteger(timeoutMs) && Number(timeoutMs) > 0
    );
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
