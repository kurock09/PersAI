import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminBusinessPlatformState } from "@persai/contracts";
import AdminBusinessPage from "./page";

const clerkMocks = vi.hoisted(() => ({
  getToken: vi.fn()
}));

const apiMocks = vi.hoisted(() => ({
  getAdminBusinessPlatform: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: clerkMocks.getToken
  })
}));

vi.mock("@/app/app/assistant-api-client", () => ({
  getAdminBusinessPlatform: apiMocks.getAdminBusinessPlatform
}));

function createBusinessPlatformState(): AdminBusinessPlatformState {
  return {
    totalUsers: 4,
    totalAssistants: 3,
    activeAssistants: 2,
    totalConversations: 12,
    totalMessages: 48,
    activeWebChats: 5,
    planDistribution: [
      {
        planCode: "pro",
        planDisplayName: "Pro",
        userCount: 4,
        percent: 100
      }
    ],
    quotaPressureDistribution: {
      low: 3,
      elevated: 1,
      high: 0
    },
    channelAdoption: {
      webChat: 5,
      telegram: 2,
      whatsapp: 0,
      max: 0,
      total: 7
    },
    publishApplyHealth: {
      window: "last_7_days",
      applySucceeded: 4,
      applyDegraded: 1,
      applyFailed: 0,
      applySuccessPercent: 80
    },
    planCatalog: {
      totalPlans: 3,
      activePlans: 2,
      inactivePlans: 1,
      defaultRegistrationPlanCode: "starter"
    },
    platformPaymentRevenueAllTime: {
      rubTotalMinor: 56100,
      rubSucceededPayments: 3,
      usdTotalMinor: 0,
      usdSucceededPayments: 0
    },
    ledgerBackedModelCost: {
      windowLabel: "all_time",
      startedAt: "1970-01-01T00:00:00.000Z",
      endedAt: null,
      periodSource: "all_time",
      coverageScope: "adr099_block1_model_priced_paths",
      coverageNote: "Coverage note from shared ledger payload.",
      totalEvents: 3,
      trackedWorkspaces: 2,
      trackedUsers: 2,
      hasMultipleCurrencies: false,
      currencyTotals: [
        {
          currency: "USD",
          eventCount: 3,
          totalCostMicros: 4500000
        }
      ],
      byPurpose: [
        {
          key: "chat_main_reply",
          label: "Main reply",
          eventCount: 2,
          totalCostMicros: 3600000
        },
        {
          key: "router",
          label: "Router / classifier",
          eventCount: 1,
          totalCostMicros: 900000
        }
      ],
      bySurface: [
        {
          key: "web",
          label: "Web",
          eventCount: 2,
          totalCostMicros: 3000000
        },
        {
          key: "telegram",
          label: "Telegram",
          eventCount: 1,
          totalCostMicros: 1500000
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
          eventCount: 2,
          totalCostMicros: 3600000
        }
      ],
      textCacheAccountingV2: [
        {
          currency: "USD",
          v2CallCount: 2,
          v2TurnCount: 1,
          totalInputTokens: 100,
          uncachedInputTokens: 40,
          cacheWriteInputTokens: 10,
          cacheReadInputTokens: 50,
          outputTokens: 20,
          totalTokens: 120,
          hitCallCount: 1,
          actualCachedInputCostMicros: 1000,
          noCacheInputCostMicros: 2000,
          netCacheSavingsMicros: 1000,
          cacheReadSharePercent: 50,
          cacheWriteSharePercent: 10,
          hitCallSharePercent: 50,
          netCacheSavingsPercent: 50
        }
      ],
      textCacheAccountingV2ByProvider: []
    },
    runtimeTurnAverages: {
      window: "last_7_days",
      completedTurns: 10,
      turnsWithV2TextUsageAccounting: 8,
      v2TextUsageCallCount: 12,
      v2CacheReadHitTurns: 4,
      avgTotalInputTokens: 1200,
      avgUncachedInputTokens: 600,
      avgCacheWriteInputTokens: 100,
      avgCacheReadInputTokens: 500,
      avgOutputTokens: 300,
      avgTotalTokens: 1500,
      avgUsageStepsPerTurn: 2,
      cacheReadSharePercent: 41.7,
      cacheWriteSharePercent: 8.3,
      cacheReadHitTurnSharePercent: 50
    },
    updatedAt: "2026-05-20T20:00:00.000Z"
  };
}

describe("AdminBusinessPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerkMocks.getToken.mockResolvedValue("token-1");
    apiMocks.getAdminBusinessPlatform.mockResolvedValue(createBusinessPlatformState());
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the shared ledger coverage note from the typed business payload", async () => {
    render(<AdminBusinessPage />);

    await waitFor(() => expect(apiMocks.getAdminBusinessPlatform).toHaveBeenCalledWith("token-1"));

    expect(screen.getByText("Ledger-backed Model Cost · Global · all time")).toBeInTheDocument();
    expect(screen.getByText("Coverage note from shared ledger payload.")).toBeInTheDocument();
    expect(screen.getByText("Payments · RUB")).toBeInTheDocument();
    expect(screen.getByText("561 ₽")).toBeInTheDocument();
  });
});
