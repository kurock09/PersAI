import { describe, expect, it } from "vitest";
import {
  formatPlanModelSlotCreditHint,
  resolvePlanModelSlotCreditMultiplier
} from "./plan-model-credit-multipliers";

describe("plan-model-credit-multipliers", () => {
  const weightsByModel = {
    "gpt-5.4-mini": {
      inputTokenWeight: 1,
      cachedInputTokenWeight: 0.1,
      outputTokenWeight: 6
    },
    "gpt-5.4-pro": {
      inputTokenWeight: 1,
      cachedInputTokenWeight: 0.25,
      outputTokenWeight: 12
    }
  };

  const draft = {
    primaryModelKey: "gpt-5.4-mini",
    premiumModelKey: "gpt-5.4-pro",
    reasoningModelKey: ""
  };

  it("uses normal as the 1× baseline and compares premium against it", () => {
    expect(
      resolvePlanModelSlotCreditMultiplier("normal", draft, "gpt-5.4-mini", weightsByModel)
    ).toBe(1);

    const premiumMultiplier = resolvePlanModelSlotCreditMultiplier(
      "premium",
      draft,
      "gpt-5.4-mini",
      weightsByModel
    );
    expect(premiumMultiplier).not.toBeNull();
    expect(premiumMultiplier).toBeGreaterThan(1);

    expect(formatPlanModelSlotCreditHint("normal", draft, "gpt-5.4-mini", weightsByModel)).toBe(
      "1× baseline"
    );
    expect(formatPlanModelSlotCreditHint("premium", draft, "gpt-5.4-mini", weightsByModel)).toMatch(
      /× vs normal$/
    );
  });
});
