/**
 * ADR-149: API stream/sync turn ceilings use env wall-clock budgets only.
 * Worker tool timeouts remain per-tool execution limits inside runtime.
 */
export function resolveNativeRuntimeTurnTimeoutMs(
  _runtimeBundle: unknown,
  wallClockMs: number
): number {
  return wallClockMs;
}
