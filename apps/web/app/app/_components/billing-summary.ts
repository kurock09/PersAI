import type { UserPlanVisibilityState } from "@persai/contracts";

type EffectivePlanState = UserPlanVisibilityState["effectivePlan"];

export type BillingSummaryCopy = {
  statusKey: string;
  dateKey: string | null;
  dateLabel: string | null;
};

function formatBillingDate(value: string, locale: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short"
  }).format(date);
}

function isZeroPricePlan(plan: EffectivePlanState): boolean {
  return plan.price.amount === 0;
}

export function resolveBillingSummaryCopy(
  plan: EffectivePlanState | null | undefined,
  locale: string
): BillingSummaryCopy {
  if (plan === null || plan === undefined) {
    return {
      statusKey: "billingStatusFree",
      dateKey: null,
      dateLabel: null
    };
  }

  if (isZeroPricePlan(plan)) {
    return {
      statusKey: "billingStatusFree",
      dateKey: "billingDateIndefinite",
      dateLabel: null
    };
  }

  const resolveDate = (dateKey: string, value: string | null): BillingSummaryCopy => ({
    statusKey: resolveBillingStatusKey(plan),
    dateKey: value ? dateKey : null,
    dateLabel: value ? formatBillingDate(value, locale) : null
  });

  switch (plan.subscriptionStatus) {
    case "trialing":
      return resolveDate("billingDateTrialEnds", plan.trialEndsAt);
    case "grace_period":
    case "past_due":
      return resolveDate("billingDateGraceEnds", plan.graceEndsAt);
    case "active":
    case "paused":
      return resolveDate("billingDateNextBilling", plan.currentPeriodEndsAt);
    case "canceled":
      return resolveDate("billingDateAccessUntil", plan.currentPeriodEndsAt);
    case "expired":
    case "expired_fallback":
      return resolveDate("billingDateAccessUntil", plan.currentPeriodEndsAt);
    default:
      if (plan.trialEndsAt) {
        return resolveDate("billingDateTrialEnds", plan.trialEndsAt);
      }
      if (plan.currentPeriodEndsAt) {
        return resolveDate("billingDateNextBilling", plan.currentPeriodEndsAt);
      }
      return {
        statusKey: resolveBillingStatusKey(plan),
        dateKey: null,
        dateLabel: null
      };
  }
}

function resolveBillingStatusKey(plan: EffectivePlanState): string {
  if (plan.isTrialPlan || plan.subscriptionStatus === "trialing") {
    return "billingStatusTrial";
  }

  switch (plan.subscriptionStatus) {
    case "active":
      return "billingStatusActive";
    case "grace_period":
    case "past_due":
      return "billingStatusGrace";
    case "paused":
      return "billingStatusPaused";
    case "canceled":
      return "billingStatusCanceled";
    case "expired":
    case "expired_fallback":
      return "billingStatusExpired";
    default:
      return "billingStatusPlan";
  }
}
