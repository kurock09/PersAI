/**
 * ADR-143 — locked model-facing observation tier windows.
 *
 * Newest exchange stays `full`; the next 4 older are `compact`; everything
 * older is `masked`. The same windows apply to in-turn `toolHistory` and to
 * each cross-turn replayed exchange list. Errors never drop to a bare mask.
 */

export type ToolObservationTier = "full" | "compact" | "masked";

/** Newest exchange is always full. */
export const TOOL_OBSERVATION_FULL_COUNT = 1;

/** Next older exchanges after the newest stay compact. */
export const TOOL_OBSERVATION_COMPACT_COUNT = 4;

export type ToolObservationMode = "in_turn" | "cross_turn";

/**
 * Assign the locked tier for one exchange index inside a turn's exchange list.
 * Index 0 is oldest; the last index is newest.
 */
export function assignToolObservationTier(params: {
  index: number;
  exchangeCount: number;
  isError: boolean;
}): ToolObservationTier {
  if (params.exchangeCount <= 0 || params.index < 0 || params.index >= params.exchangeCount) {
    return params.isError === true ? "compact" : "masked";
  }

  const ageFromNewest = params.exchangeCount - 1 - params.index;
  let tier: ToolObservationTier;
  if (ageFromNewest < TOOL_OBSERVATION_FULL_COUNT) {
    tier = "full";
  } else if (ageFromNewest < TOOL_OBSERVATION_FULL_COUNT + TOOL_OBSERVATION_COMPACT_COUNT) {
    tier = "compact";
  } else {
    tier = "masked";
  }

  // ADR-143 §7 — isError never becomes a bare mask that hides failure.
  if (tier === "masked" && params.isError === true) {
    return "compact";
  }
  return tier;
}

/**
 * Assign tiers for every exchange in a list (oldest → newest).
 * In-turn and cross-turn share the same window policy; mode is only accepted
 * on `projectToolExchangesForModel` for call-site clarity.
 */
export function assignToolObservationTiersForExchanges(
  exchanges: readonly { toolResult: { isError: boolean } }[]
): ToolObservationTier[] {
  const exchangeCount = exchanges.length;
  return exchanges.map((exchange, index) =>
    assignToolObservationTier({
      index,
      exchangeCount,
      isError: exchange.toolResult.isError === true
    })
  );
}
