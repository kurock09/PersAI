import { describe, expect, it } from "vitest";
import { toBillingLifecycleSettingsRequest } from "./page";

describe("AdminBillingSettingsPage helpers", () => {
  it("maps the draft into the persisted lifecycle settings request", () => {
    expect(
      toBillingLifecycleSettingsRequest({
        gracePeriodDays: "5",
        globalFallbackPlanCode: "starter",
        assistantPushEnabled: true,
        rules: [{ notificationCode: "grace_ending", enabled: true, offsetDays: 1 }]
      })
    ).toEqual({
      gracePeriodDays: 5,
      globalFallbackPlanCode: "starter",
      notificationPolicy: {
        emailEnabled: true,
        assistantPushEnabled: true,
        rules: [{ notificationCode: "grace_ending", enabled: true, offsetDays: 1 }]
      }
    });
  });

  it("rejects invalid grace periods before save", () => {
    expect(() =>
      toBillingLifecycleSettingsRequest({
        gracePeriodDays: "0",
        globalFallbackPlanCode: "",
        assistantPushEnabled: false,
        rules: []
      })
    ).toThrow(/Grace period/);
  });
});
