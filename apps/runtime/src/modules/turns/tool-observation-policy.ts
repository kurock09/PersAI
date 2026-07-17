/** ADR-156 — global mode-aware model-facing observation tier windows. */

export type ToolObservationTier = "full" | "compact" | "masked";
export type ToolObservationMode = "in_turn" | "cross_turn";

export const TOOL_OBSERVATION_IN_TURN_FULL_COUNT = 3;
export const TOOL_OBSERVATION_IN_TURN_COMPACT_COUNT = 3;
export const TOOL_OBSERVATION_CROSS_TURN_FULL_COUNT = 1;
export const TOOL_OBSERVATION_CROSS_TURN_COMPACT_COUNT = 4;

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
