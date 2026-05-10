import { describe, expect, it } from "vitest";
import { resolveBillingSummaryCopy } from "./billing-summary";

describe("resolveBillingSummaryCopy", () => {
  it("keeps expired fallback semantics for zero-price fallback states", () => {
    const summary = resolveBillingSummaryCopy(
      {
        code: "free",
        displayName: "Free",
        status: "active",
        source: "subscription_paid_fallback",
        subscriptionStatus: "expired_fallback",
        trialEndsAt: null,
        graceStartedAt: null,
        graceEndsAt: null,
        currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
        isTrialPlan: false,
        trialFallbackPlanCode: null,
        paidFallbackPlanCode: null,
        price: { amount: 0, currency: "RUB", billingPeriod: "month" }
      },
      "en"
    );

    expect(summary.statusKey).toBe("billingStatusExpired");
    expect(summary.dateKey).toBe("billingDateAccessUntil");
    expect(summary.dateLabel).toBeTruthy();
  });

  it("keeps active zero-price plans quiet and indefinite", () => {
    const summary = resolveBillingSummaryCopy(
      {
        code: "free",
        displayName: "Free",
        status: "active",
        source: "workspace_subscription",
        subscriptionStatus: "active",
        trialEndsAt: null,
        graceStartedAt: null,
        graceEndsAt: null,
        currentPeriodEndsAt: null,
        isTrialPlan: false,
        trialFallbackPlanCode: null,
        paidFallbackPlanCode: null,
        price: { amount: 0, currency: "RUB", billingPeriod: "month" }
      },
      "en"
    );

    expect(summary.statusKey).toBe("billingStatusFree");
    expect(summary.dateKey).toBe("billingDateIndefinite");
    expect(summary.dateLabel).toBeNull();
  });

  it("does not collapse subscription fallback sources into ordinary free copy", () => {
    const summary = resolveBillingSummaryCopy(
      {
        code: "free",
        displayName: "Free",
        status: "active",
        source: "subscription_paid_fallback",
        subscriptionStatus: "active",
        trialEndsAt: null,
        graceStartedAt: null,
        graceEndsAt: null,
        currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
        isTrialPlan: false,
        trialFallbackPlanCode: null,
        paidFallbackPlanCode: null,
        price: { amount: 0, currency: "RUB", billingPeriod: "month" }
      },
      "en"
    );

    expect(summary.statusKey).toBe("billingStatusActive");
    expect(summary.dateKey).toBe("billingDateNextBilling");
    expect(summary.dateLabel).toBeTruthy();
  });
});
