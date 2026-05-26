import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminOpsCockpitState } from "@persai/contracts";
import {
  resolveBillingSupportActions,
  resolveBillingNextDate,
  resolvePlanControlOptions,
  type BillingSupportAction
} from "./page";
import AdminOpsPage from "./page";

const clerkMocks = vi.hoisted(() => ({
  getToken: vi.fn()
}));

const apiMocks = vi.hoisted(() => ({
  getAdminOpsCockpit: vi.fn(),
  getAdminPlans: vi.fn(),
  deleteAdminOpsUserPlanOverride: vi.fn(),
  postAdminOpsUserBillingSupportAction: vi.fn(),
  postAdminOpsUserPlanOverride: vi.fn(),
  postAssistantReapply: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: clerkMocks.getToken
  })
}));

vi.mock("@/app/app/assistant-api-client", () => ({
  getAdminOpsCockpit: apiMocks.getAdminOpsCockpit,
  getAdminPlans: apiMocks.getAdminPlans,
  deleteAdminOpsUserPlanOverride: apiMocks.deleteAdminOpsUserPlanOverride,
  postAdminOpsUserBillingSupportAction: apiMocks.postAdminOpsUserBillingSupportAction,
  postAdminOpsUserPlanOverride: apiMocks.postAdminOpsUserPlanOverride,
  postAssistantReapply: apiMocks.postAssistantReapply
}));

function createOpsCockpitState(): AdminOpsCockpitState {
  return {
    quotaUsage: null,
    billingSupport: null,
    chatStats: null,
    modelCostLedger: {
      windowLabel: "current_quota_period",
      startedAt: "2026-05-01T00:00:00.000Z",
      endedAt: "2026-06-01T00:00:00.000Z",
      periodSource: "subscription_period",
      coverageScope: "adr099_block1_model_priced_paths",
      coverageNote: "Coverage note from shared ledger payload.",
      totalEvents: 2,
      trackedWorkspaces: 1,
      trackedUsers: 1,
      hasMultipleCurrencies: true,
      currencyTotals: [
        {
          currency: "USD",
          eventCount: 1,
          totalCostMicros: 1200000
        },
        {
          currency: "EUR",
          eventCount: 1,
          totalCostMicros: 1100000
        }
      ],
      byPurpose: [
        {
          key: "chat_main_reply",
          label: "Main reply",
          eventCount: 2,
          totalCostMicros: 2300000
        }
      ],
      bySurface: [
        {
          key: "web",
          label: "Web",
          eventCount: 2,
          totalCostMicros: 2300000
        }
      ],
      topBreakdown: [
        {
          provider: "openai",
          model: "gpt-4.1",
          purpose: "chat_main_reply",
          purposeLabel: "Main reply",
          surface: "web",
          surfaceLabel: "Web",
          currency: "USD",
          eventCount: 1,
          totalCostMicros: 1200000
        },
        {
          provider: "openai",
          model: "gpt-4.1",
          purpose: "chat_main_reply",
          purposeLabel: "Main reply",
          surface: "web",
          surfaceLabel: "Web",
          currency: "EUR",
          eventCount: 1,
          totalCostMicros: 1100000
        }
      ]
    },
    periodEconomics: {
      periodStartedAt: "2026-05-01T00:00:00.000Z",
      periodEndsAt: "2026-06-01T00:00:00.000Z",
      paidTotalMinor: 199000,
      paidCurrency: "RUB",
      modelCostUsdMicros: 5000000
    },
    channels: [],
    sandbox: null,
    assistant: {
      exists: true,
      assistantId: "assistant-1",
      workspaceId: "ws-1",
      assistants: [
        {
          id: "assistant-1",
          draftDisplayName: "Ops Helper",
          applyStatus: "succeeded",
          latestPublishedVersion: 7,
          lastPublishedAt: "2026-05-20T19:00:00.000Z",
          isActive: true
        }
      ],
      effectivePlan: {
        code: "pro",
        source: "workspace_subscription",
        assistantPlanOverrideCode: null,
        quotaPlanCode: "pro"
      },
      latestPublishedVersion: {
        id: "pub-1",
        version: 7,
        publishedAt: "2026-05-20T19:00:00.000Z"
      },
      runtimeApply: null
    },
    runtime: {
      adapterEnabled: true,
      runtimeTier: "pro",
      runtimeEndpointHost: "runtime.internal",
      preflight: {
        live: true,
        ready: true,
        checkedAt: "2026-05-20T20:00:00.000Z"
      }
    },
    controls: {
      reapplySupported: true,
      restartSupported: false,
      assistantPlanOverrideSupported: true,
      assistantPlanResetSupported: false
    },
    incidentSignals: [],
    updatedAt: "2026-05-20T20:00:00.000Z"
  };
}

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
  beforeEach(() => {
    vi.clearAllMocks();
    clerkMocks.getToken.mockResolvedValue("token-1");
    apiMocks.getAdminOpsCockpit.mockResolvedValue(createOpsCockpitState());
    apiMocks.getAdminPlans.mockResolvedValue([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ users: [], total: 0 })
      }))
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

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

  it("renders the shared ledger coverage note and mixed-currency top rows", async () => {
    render(<AdminOpsPage />);

    await waitFor(() => expect(apiMocks.getAdminOpsCockpit).toHaveBeenCalledWith("token-1", {}));

    expect(screen.getByText("Period economics")).toBeInTheDocument();
    expect(screen.getByText("Ledger-backed Model Cost")).toBeInTheDocument();
    expect(screen.getByText("Coverage note from shared ledger payload.")).toBeInTheDocument();
    expect(screen.getAllByText("openai / gpt-4.1")).toHaveLength(2);
  });

  it("renders one assistant selector for multi-assistant cockpit rows", async () => {
    apiMocks.getAdminOpsCockpit.mockResolvedValue({
      ...createOpsCockpitState(),
      assistant: {
        ...createOpsCockpitState().assistant,
        assistantId: "assistant-2",
        assistants: [
          {
            id: "assistant-1",
            draftDisplayName: "Ops Helper",
            applyStatus: "succeeded",
            latestPublishedVersion: 7,
            lastPublishedAt: "2026-05-20T19:00:00.000Z",
            isActive: false
          },
          {
            id: "assistant-2",
            draftDisplayName: "Sales Helper",
            applyStatus: "in_progress",
            latestPublishedVersion: 2,
            lastPublishedAt: "2026-05-21T19:00:00.000Z",
            isActive: true
          }
        ]
      }
    });

    render(<AdminOpsPage />);

    expect(await screen.findByDisplayValue("Sales Helper · v2")).toBeInTheDocument();
    expect(screen.getByText("Assistant: Sales Helper")).toBeInTheDocument();
    expect(screen.getByText("Plan Control: Sales Helper")).toBeInTheDocument();
  });
});
