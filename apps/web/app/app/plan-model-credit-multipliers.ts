import {
  computeTokenMeteredModeCreditMultiplier,
  formatTokenMeteredCreditMultiplier,
  type TokenMeteredWeights
} from "@persai/types";

export type PlanModelSlot = "normal" | "premium" | "reasoning";

export type PlanModelSlotDraft = {
  primaryModelKey: string;
  premiumModelKey: string;
  reasoningModelKey: string;
};

export function resolvePlanModelSlotKey(
  slot: PlanModelSlot,
  draft: PlanModelSlotDraft,
  runtimePrimaryModelKey: string | null
): string | null {
  const primary = draft.primaryModelKey.trim() || runtimePrimaryModelKey?.trim() || null;
  const premium = draft.premiumModelKey.trim() || primary;
  const reasoning = draft.reasoningModelKey.trim() || premium;
  switch (slot) {
    case "normal":
      return primary;
    case "premium":
      return premium;
    case "reasoning":
      return reasoning;
  }
}

export function resolvePlanModelSlotCreditMultiplier(
  slot: PlanModelSlot,
  draft: PlanModelSlotDraft,
  runtimePrimaryModelKey: string | null,
  weightsByModel: Record<string, TokenMeteredWeights>
): number | null {
  const normalModelKey = resolvePlanModelSlotKey("normal", draft, runtimePrimaryModelKey);
  if (normalModelKey === null) {
    return null;
  }
  const normalWeights = weightsByModel[normalModelKey];
  if (normalWeights === undefined) {
    return null;
  }
  if (slot === "normal") {
    return 1;
  }
  const slotModelKey = resolvePlanModelSlotKey(slot, draft, runtimePrimaryModelKey);
  if (slotModelKey === null) {
    return null;
  }
  const slotWeights = weightsByModel[slotModelKey];
  if (slotWeights === undefined) {
    return null;
  }
  return computeTokenMeteredModeCreditMultiplier(slotWeights, normalWeights);
}

export function formatPlanModelSlotCreditHint(
  slot: PlanModelSlot,
  draft: PlanModelSlotDraft,
  runtimePrimaryModelKey: string | null,
  weightsByModel: Record<string, TokenMeteredWeights>
): string | null {
  const multiplier = resolvePlanModelSlotCreditMultiplier(
    slot,
    draft,
    runtimePrimaryModelKey,
    weightsByModel
  );
  if (multiplier === null) {
    return null;
  }
  if (slot === "normal") {
    return "1× baseline";
  }
  return `${formatTokenMeteredCreditMultiplier(multiplier)} vs normal`;
}
