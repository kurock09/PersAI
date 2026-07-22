/** ADR-161 A2 — hydrate-time micro-clear pressure policy for prior tool bodies. */

export type ToolObservationTier = "full" | "compact" | "masked";

/**
 * ADR-161 A2 — after a completed user turn, when fresh session pressure is at
 * or above the current micro-clear arm ratio of `compactionTriggerThreshold`,
 * model-facing prior tool history keeps only the newest N results full.
 * Older bodies become placeholders. Never applied mid tool-loop.
 *
 * Once applied, projection stays cleared (no re-expand when the meter drops).
 * Arm schedule uses 5% hysteresis:
 * - arm at 50%; if after clear still >45%, next arm = 75%
 * - arm at 75%; if after clear still >70%, micro-clear exhausted → wait for S3
 * - if clear drops to ≤(arm−5%), next arm returns to 50% (growth can re-arm)
 * S3 session compaction resets all micro-clear session state.
 */
export const TOOL_OBSERVATION_MICRO_CLEAR_KEEP_FULL_COUNT = 5;
export const TOOL_OBSERVATION_MICRO_CLEAR_PRESSURE_RATIO = 0.5;
export const TOOL_OBSERVATION_MICRO_CLEAR_ESCALATED_RATIO = 0.75;
export const TOOL_OBSERVATION_MICRO_CLEAR_HYSTERESIS_RATIO = 0.05;

/** Next arm as percent of compaction threshold: 50, 75, or 0 (exhausted). */
export type ToolObservationMicroClearArmPercent = 50 | 75 | 0;

export function normalizeMicroClearArmPercent(
  value: number | null | undefined
): ToolObservationMicroClearArmPercent {
  if (value === 75) {
    return 75;
  }
  if (value === 0) {
    return 0;
  }
  return 50;
}

export function microClearArmRatio(armPercent: ToolObservationMicroClearArmPercent): number {
  if (armPercent === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return armPercent / 100;
}

/**
 * True when hydrate should project keep-N micro-clear for prior tool bodies.
 * Active sessions stay cleared; new arms require fresh tokens at/above next arm.
 */
export function shouldApplyToolObservationMicroClear(params: {
  priorToolMicroClearActive?: boolean | null | undefined;
  priorToolMicroClearNextArmPercent?: number | null | undefined;
  currentTokens: number | null | undefined;
  totalTokensFresh: boolean | null | undefined;
  compactionTriggerThreshold: number;
}): boolean {
  if (params.priorToolMicroClearActive === true) {
    return true;
  }
  return shouldCrossToolObservationMicroClearArm(params);
}

/**
 * True when pressure crosses the current next-arm threshold (50% / 75%).
 * Exhausted (0) never crosses — S3 handles further relief.
 */
export function shouldCrossToolObservationMicroClearArm(params: {
  priorToolMicroClearNextArmPercent?: number | null | undefined;
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
  const armPercent = normalizeMicroClearArmPercent(params.priorToolMicroClearNextArmPercent);
  if (armPercent === 0) {
    return false;
  }
  const threshold = Math.max(1, params.compactionTriggerThreshold);
  return params.currentTokens >= threshold * microClearArmRatio(armPercent);
}

/**
 * After a turn that crossed/applied an arm, decide the next arm from post-clear
 * pressure. Hysteresis band is `(arm − 5%)`.
 */
export function resolveMicroClearNextArmAfterClear(params: {
  lastArmPercent: number | null | undefined;
  currentTokens: number | null | undefined;
  totalTokensFresh: boolean | null | undefined;
  compactionTriggerThreshold: number;
}): ToolObservationMicroClearArmPercent {
  const lastArm = normalizeMicroClearArmPercent(params.lastArmPercent);
  if (lastArm === 0) {
    return 0;
  }
  if (params.totalTokensFresh !== true) {
    return lastArm;
  }
  if (typeof params.currentTokens !== "number" || !Number.isFinite(params.currentTokens)) {
    return lastArm;
  }
  const threshold = Math.max(1, params.compactionTriggerThreshold);
  const floorRatio = microClearArmRatio(lastArm) - TOOL_OBSERVATION_MICRO_CLEAR_HYSTERESIS_RATIO;
  const stillAboveHysteresis = params.currentTokens > threshold * floorRatio;
  if (!stillAboveHysteresis) {
    // Clear relieved enough (e.g. 50% → 20%). Next growth re-arms at 50%.
    return 50;
  }
  // Clear did not get under the hysteresis floor.
  if (lastArm === 50) {
    return 75;
  }
  // 75% clear still above 70% — micro-clear cannot help further; wait for S3.
  return 0;
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
