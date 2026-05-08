import { describe, expect, it } from "vitest";
import {
  resolveBillingSupportActions,
  resolveBillingNextDate,
  resolvePlanControlOptions,
  type BillingSupportAction
} from "./page";

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
    latestPaidActivation: null,
    latestLifecycleEvents: []
  }).map((action) => action.action);
}

describe("admin ops billing support actions", () => {
  it("shows trial support actions for trialing workspaces", () => {
    expect(actionCodesForStatus("trialing")).toEqual([
      "activate_paid_manually",
      "extend_trial",
      "send_billing_reminder",
      "apply_fallback_now"
    ]);
  });

  it("shows grace actions for grace-period workspaces", () => {
    expect(actionCodesForStatus("grace_period")).toEqual([
      "activate_paid_manually",
      "extend_grace",
      "send_billing_reminder",
      "apply_fallback_now"
    ]);
  });

  it("shows manual paid activation after fallback", () => {
    expect(actionCodesForStatus("expired_fallback")).toEqual([
      "activate_paid_manually",
      "send_billing_reminder"
    ]);
  });

  it("shows lifecycle initialization for legacy fallback users", () => {
    expect(
      resolveBillingSupportActions(
        {
          subscription: {
            id: null,
            planCode: null,
            status: null,
            trialStartedAt: null,
            trialEndsAt: null,
            graceStartedAt: null,
            graceEndsAt: null,
            currentPeriodStartedAt: null,
            currentPeriodEndsAt: null,
            cancelAtPeriodEnd: null,
            providerCustomerRef: null,
            providerSubscriptionRef: null
          },
          quotaPeriod: {
            startedAt: null,
            endsAt: null,
            source: null
          },
          latestPaidActivation: null,
          latestLifecycleEvents: []
        },
        "assistant_plan_fallback"
      ).map((action) => action.action)
    ).toEqual(["initialize_lifecycle_now"]);
  });

  it("shows active plan options for tester override control", () => {
    expect(
      resolvePlanControlOptions(
        [
          { code: "starter", displayName: "Starter", status: "active" },
          { code: "legacy", displayName: "Legacy", status: "inactive" }
        ],
        null
      )
    ).toEqual([
      {
        code: "starter",
        displayName: "Starter",
        status: "active",
        selectedInactive: false
      }
    ]);
  });

  it("keeps the current inactive override visible for cleanup", () => {
    expect(
      resolvePlanControlOptions(
        [
          { code: "starter", displayName: "Starter", status: "active" },
          { code: "legacy", displayName: "Legacy", status: "inactive" }
        ],
        "legacy"
      )
    ).toEqual([
      {
        code: "starter",
        displayName: "Starter",
        status: "active",
        selectedInactive: false
      },
      {
        code: "legacy",
        displayName: "Legacy",
        status: "inactive",
        selectedInactive: true
      }
    ]);
  });

  it("prefers the paid current-period end over stale trial dates for active workspaces", () => {
    expect(
      resolveBillingNextDate({
        workspaceId: "ws-1",
        planCode: "pro",
        status: "active",
        trialEndsAt: "2026-05-08T00:00:00.000Z",
        graceEndsAt: null,
        currentPeriodEndsAt: "2026-06-05T00:00:00.000Z",
        usageRisk: "ok"
      })
    ).toBe("2026-06-05T00:00:00.000Z");
  });
});
