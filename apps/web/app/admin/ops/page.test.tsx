import { describe, expect, it } from "vitest";
import { resolveBillingSupportActions, type BillingSupportAction } from "./page";

function actionCodesForStatus(status: string | null): BillingSupportAction[] {
  return resolveBillingSupportActions({
    subscription: {
      id: "sub-1",
      planCode: "pro",
      status,
      trialStartedAt: null,
      trialEndsAt: null,
      graceStartedAt: null,
      graceEndsAt: null,
      currentPeriodStartedAt: null,
      currentPeriodEndsAt: null,
      cancelAtPeriodEnd: false,
      providerCustomerRef: null,
      providerSubscriptionRef: null
    },
    quotaPeriod: {
      startedAt: null,
      endsAt: null,
      source: null
    },
    latestLifecycleEvents: [],
    latestNotificationJobs: []
  }).map((action) => action.action);
}

describe("admin ops billing support actions", () => {
  it("shows trial support actions for trialing workspaces", () => {
    expect(actionCodesForStatus("trialing")).toEqual([
      "extend_trial",
      "send_billing_reminder",
      "apply_fallback_now"
    ]);
  });

  it("shows grace actions for grace-period workspaces", () => {
    expect(actionCodesForStatus("grace_period")).toEqual([
      "extend_grace",
      "send_billing_reminder",
      "apply_fallback_now"
    ]);
  });

  it("shows manual paid restore only after fallback", () => {
    expect(actionCodesForStatus("expired_fallback")).toEqual([
      "restore_paid_manually",
      "send_billing_reminder"
    ]);
  });
});
