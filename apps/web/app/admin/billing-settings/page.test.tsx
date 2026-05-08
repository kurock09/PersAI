import { describe, expect, it } from "vitest";
import { toBillingLifecycleSettingsRequest } from "./page";

describe("toBillingLifecycleSettingsRequest", () => {
  it("maps valid draft to request", () => {
    expect(
      toBillingLifecycleSettingsRequest({
        gracePeriodDays: "5",
        globalFallbackPlanCode: "starter"
      })
    ).toEqual({
      gracePeriodDays: 5,
      globalFallbackPlanCode: "starter"
    });
  });

  it("maps empty fallback plan to null", () => {
    expect(
      toBillingLifecycleSettingsRequest({
        gracePeriodDays: "7",
        globalFallbackPlanCode: ""
      })
    ).toEqual({
      gracePeriodDays: 7,
      globalFallbackPlanCode: null
    });
  });

  it("rejects invalid grace periods before save", () => {
    expect(() =>
      toBillingLifecycleSettingsRequest({
        gracePeriodDays: "0",
        globalFallbackPlanCode: ""
      })
    ).toThrow(/Grace period/);
  });
});
