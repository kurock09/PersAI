/** ADR-156 — global mode-aware model-facing observation tier windows. */

export type ToolObservationTier = "full" | "compact" | "masked";
export type ToolObservationMode = "in_turn" | "cross_turn";

export const TOOL_OBSERVATION_IN_TURN_FULL_COUNT = 3;
export const TOOL_OBSERVATION_IN_TURN_COMPACT_COUNT = 3;
export const TOOL_OBSERVATION_CROSS_TURN_FULL_COUNT = 1;
export const TOOL_OBSERVATION_CROSS_TURN_COMPACT_COUNT = 4;

/**
 * ADR-161 A2 — after a completed user turn, when fresh session pressure is at
 * or above 50% of `compactionTriggerThreshold`, model-facing prior tool
 * history keeps only the newest N results full. Older bodies become
 * placeholders. Distinct from ADR-156 in-turn full window (3).
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
 * (ADR-143 / ADR-156 invariant).
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

/**
 * Assign the mode-aware tier for one exchange index inside an exchange list.
 * Index 0 is oldest; the last index is newest.
 */
export function assignToolObservationTier(params: {
  index: number;
  exchangeCount: number;
  isError: boolean;
  mode: ToolObservationMode;
}): ToolObservationTier {
  if (params.exchangeCount <= 0 || params.index < 0 || params.index >= params.exchangeCount) {
    return params.isError === true ? "compact" : "masked";
  }

  const fullCount =
    params.mode === "in_turn"
      ? TOOL_OBSERVATION_IN_TURN_FULL_COUNT
      : TOOL_OBSERVATION_CROSS_TURN_FULL_COUNT;
  const compactCount =
    params.mode === "in_turn"
      ? TOOL_OBSERVATION_IN_TURN_COMPACT_COUNT
      : TOOL_OBSERVATION_CROSS_TURN_COMPACT_COUNT;
  const ageFromNewest = params.exchangeCount - 1 - params.index;
  let tier: ToolObservationTier;
  if (ageFromNewest < fullCount) {
    tier = "full";
  } else if (ageFromNewest < fullCount + compactCount) {
    tier = "compact";
  } else {
    tier = "masked";
  }

  // ADR-143 invariant retained by ADR-156: errors never become a bare mask.
  if (tier === "masked" && params.isError === true) {
    return "compact";
  }
  return tier;
}

/**
 * Assign tiers for every exchange in a list (oldest → newest).
 */
export function assignToolObservationTiersForExchanges(
  exchanges: readonly { toolResult: { isError: boolean } }[],
  mode: ToolObservationMode
): ToolObservationTier[] {
  const exchangeCount = exchanges.length;
  return exchanges.map((exchange, index) =>
    assignToolObservationTier({
      index,
      exchangeCount,
      isError: exchange.toolResult.isError === true,
      mode
    })
  );
}
