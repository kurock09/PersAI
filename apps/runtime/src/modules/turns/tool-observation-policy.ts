/** ADR-161 A2 — hydrate-time micro-clear pressure policy for prior tool bodies. */

export type ToolObservationTier = "full" | "compact" | "masked";

/**
 * ADR-161 A2 — after a completed user turn, when fresh session pressure is at
 * or above 50% of `compactionTriggerThreshold`, model-facing prior tool
 * history keeps only the newest N results full. Older bodies become
 * placeholders. Never applied mid tool-loop to in-turn `toolHistory`.
 */
export const TOOL_OBSERVATION_MICRO_CLEAR_KEEP_FULL_COUNT = 5;
export const TOOL_OBSERVATION_MICRO_CLEAR_PRESSURE_RATIO = 0.5;

/**
 * True when hydrate-time micro-clear should apply to prior tool exchanges.
 * Requires fresh `currentTokens` (same freshness gate as 100% auto-compaction).
 */
export function shouldApplyToolObservationMicroClear(params: {
  currentTokens: number | null | undefined;
  totalTokensFresh: boolean | null | undefined;
  compactionTriggerThreshold: number;
}): boolean {
  if (params.totalTokensFresh !== true) {
    return false;
  }
  if (typeof params.currentTokens !== "number" || !Number.isFinite(params.currentTokens)) {
    return false;
  }
  const threshold = Math.max(1, params.compactionTriggerThreshold);
  return params.currentTokens >= threshold * TOOL_OBSERVATION_MICRO_CLEAR_PRESSURE_RATIO;
}

/**
 * Assign the micro-clear tier for one exchange index in a chronological list
 * (index 0 = oldest). Newest `TOOL_OBSERVATION_MICRO_CLEAR_KEEP_FULL_COUNT`
 * stay full; older bodies are placeholders. Errors never become a bare mask
 * (ADR-143 invariant retained for micro-clear placeholders).
 */
export function assignMicroClearObservationTier(params: {
  index: number;
  exchangeCount: number;
  isError: boolean;
}): ToolObservationTier {
  if (params.exchangeCount <= 0 || params.index < 0 || params.index >= params.exchangeCount) {
    return params.isError === true ? "compact" : "masked";
  }
  const ageFromNewest = params.exchangeCount - 1 - params.index;
  if (ageFromNewest < TOOL_OBSERVATION_MICRO_CLEAR_KEEP_FULL_COUNT) {
    return "full";
  }
  return params.isError === true ? "compact" : "masked";
}
