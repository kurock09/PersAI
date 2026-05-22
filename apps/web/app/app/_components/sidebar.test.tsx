import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantWebChatListItemState } from "@persai/contracts";
import { Sidebar, formatChatRowTimestamp } from "./sidebar";
import { OfflineGate } from "./offline-gate";
import type { AppData } from "./use-app-data";

const ORIGINAL_USER_AGENT = window.navigator.userAgent;

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  navigateAfterClerkAuth: vi.fn()
}));

const clerkMocks = vi.hoisted(() => ({
  signOut: vi.fn()
}));

const liveThreadMocks = vi.hoisted(() => ({
  streamingThreads: new Set<string>(),
  mediaThreads: new Set<string>(),
  documentThreads: new Set<string>()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: vi.fn(async () => null) }),
  useUser: () => ({ user: null }),
  useClerk: () => ({ signOut: clerkMocks.signOut })
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigationMocks,
  useSearchParams: () => new URLSearchParams()
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    typeof values?.count === "number" ? `${key}:${values.count}` : key
}));

vi.mock("./use-theme", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() })
}));

vi.mock("./assistant-avatar", () => ({
  AssistantAvatar: () => <div data-testid="assistant-avatar" />
}));

vi.mock("./streaming-threads", () => ({
  useIsThreadStreaming: (threadKey: string) => liveThreadMocks.streamingThreads.has(threadKey),
  useHasThreadActiveMediaJobs: (threadKey: string) => liveThreadMocks.mediaThreads.has(threadKey),
  useHasThreadActiveDocumentJobs: (threadKey: string) =>
    liveThreadMocks.documentThreads.has(threadKey)
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("ok", { status: 200 }))
  );
});

vi.mock("../assistant-api-client", () => ({
  patchAssistantWebChat: vi.fn(async () => undefined),
  postAssistantWebChatArchive: vi.fn(async () => undefined),
  deleteAssistantWebChat: vi.fn(async () => undefined)
}));

vi.mock("@/app/lib/clerk-navigation", () => ({
  navigateAfterClerkAuth: navigationMocks.navigateAfterClerkAuth
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigationMocks.push.mockClear();
  navigationMocks.replace.mockClear();
  navigationMocks.navigateAfterClerkAuth.mockClear();
  clerkMocks.signOut.mockReset();
  clerkMocks.signOut.mockResolvedValue(undefined);
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: ORIGINAL_USER_AGENT
  });
  liveThreadMocks.streamingThreads.clear();
  liveThreadMocks.mediaThreads.clear();
  liveThreadMocks.documentThreads.clear();
});

function makeAppData(overrides: Partial<AppData>): AppData {
  return {
    assistant: null,
    assistantStatus: "live",
    assistantResolved: true,
    chats: [],
    telegram: null,
    notificationPreference: null,
    plan: null,
    isAdmin: false,
    isLoading: false,
    isReloading: false,
    isReloadingChats: false,
    error: null,
    reload: vi.fn(),
    reloadChats: vi.fn(),
    markChatListActivity: vi.fn(),
    ...overrides
  };
}

function makeChat(id: string): AssistantWebChatListItemState {
  return {
    chat: {
      id,
      surfaceThreadKey: id,
      title: `Chat ${id}`,
      lastMessageAt: "2026-04-25T12:00:00.000Z",
      createdAt: "2026-04-25T11:00:00.000Z",
      archivedAt: null,
      deepModeEnabled: false
    },
    lastMessagePreview: null
  } as unknown as AssistantWebChatListItemState;
}

describe("Sidebar — ADR-076 Slice 5 chat list skeleton", () => {
  it("renders the chat list skeleton during cold-start (isLoading=true)", () => {
    render(<Sidebar data={makeAppData({ isLoading: true })} />);
    expect(screen.queryByTestId("chat-list-skeleton")).not.toBeNull();
  });

  it("renders the chat list skeleton when reloadChats is in flight and the list is empty", () => {
    render(<Sidebar data={makeAppData({ isReloadingChats: true, chats: [] })} />);
    expect(screen.queryByTestId("chat-list-skeleton")).not.toBeNull();
  });

  it("keeps existing chats visible (no skeleton) when reloadChats runs over a non-empty list", () => {
    const data = makeAppData({
      isReloadingChats: true,
      chats: [makeChat("c-1"), makeChat("c-2")]
    });
    render(<Sidebar data={data} />);
    expect(screen.queryByTestId("chat-list-skeleton")).toBeNull();
    expect(screen.queryByText(/Chat c-1/)).not.toBeNull();
    expect(screen.queryByText(/Chat c-2/)).not.toBeNull();
  });

  it("renders the empty-state message (no skeleton) when fully idle and no chats", () => {
    render(<Sidebar data={makeAppData({})} />);
    expect(screen.queryByTestId("chat-list-skeleton")).toBeNull();
  });

  it("does not flash a skeleton when reload() runs but reloadChats() does not", () => {
    const data = makeAppData({
      isReloading: true,
      isReloadingChats: false,
      chats: [makeChat("c-1")]
    });
    render(<Sidebar data={data} />);
    expect(screen.queryByTestId("chat-list-skeleton")).toBeNull();
    expect(screen.queryByText(/Chat c-1/)).not.toBeNull();
  });

  it("switches chats with local history so uploads do not wait for app-router navigation", async () => {
    const data = makeAppData({
      chats: [makeChat("thread-a")]
    });

    render(<Sidebar data={data} />);

    fireEvent.click(screen.getByText("Chat thread-a"));

    await waitFor(() => {
      expect(navigationMocks.push).toHaveBeenCalledWith("/app/chat?thread=thread-a");
    });
  });

  it("shows a time badge for yesterday chats on the right edge", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-26T18:00:00.000Z"));
      const yesterdayIso = "2026-04-25T12:34:00.000Z";
      const expected = new Intl.DateTimeFormat("en", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(new Date(yesterdayIso));
      expect(formatChatRowTimestamp(yesterdayIso, "en")).toBe(expected);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the pulsing live indicator for chats with active background media jobs", () => {
    liveThreadMocks.mediaThreads.add("thread-a");
    const data = makeAppData({
      chats: [makeChat("thread-a")]
    });

    render(<Sidebar data={data} />);

    const indicator = screen.getByLabelText("streamingIndicator");
    expect(indicator).toHaveClass("animate-pulse");
  });

  it("shows the pulsing live indicator for chats with active background document jobs", () => {
    const data = makeAppData({
      chats: [
        {
          ...makeChat("thread-a"),
          activeDocumentJobs: [
            {
              id: "doc-job-1",
              documentType: "presentation",
              descriptorMode: "export_or_redeliver",
              status: "queued",
              createdAt: "2026-05-19T22:00:00.000Z",
              startedAt: null,
              updatedAt: "2026-05-19T22:00:00.000Z"
            }
          ]
        } as AssistantWebChatListItemState
      ]
    });

    render(<Sidebar data={data} />);

    const indicator = screen.getByLabelText("streamingIndicator");
    expect(indicator).toHaveClass("animate-pulse");
  });

  it("replaces the assistant live status with a compact support reply status when unread support exists", () => {
    render(<Sidebar data={makeAppData({})} supportUnreadCount={2} />);

    expect(screen.getByText("supportUnreadStatus:2")).toBeInTheDocument();
    expect(screen.queryByText("live")).toBeNull();
  });

  it("blocks chat navigation and exposes the offline overlay when health recheck fails", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    const data = makeAppData({
      chats: [makeChat("thread-a")]
    });

    render(
      <>
        <Sidebar data={data} />
        <OfflineGate />
      </>
    );

    fireEvent.click(screen.getByText("Chat thread-a"));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/health",
        expect.objectContaining({ cache: "no-store", method: "GET" })
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(navigationMocks.push).not.toHaveBeenCalled();
  });

  it("renders compact billing summary in the account footer", async () => {
    render(
      <Sidebar
        data={makeAppData({
          plan: {
            effectivePlan: {
              code: "starter_trial",
              displayName: "Starter Trial",
              status: "active",
              source: "plan",
              subscriptionStatus: "trialing",
              trialEndsAt: "2026-05-12T00:00:00.000Z",
              graceStartedAt: null,
              graceEndsAt: null,
              currentPeriodEndsAt: null,
              isTrialPlan: true,
              trialFallbackPlanCode: null,
              paidFallbackPlanCode: null,
              price: { amount: 980, currency: "RUB", billingPeriod: "month" }
            },
            entitlements: {
              channelsAndSurfaces: {
                webChat: true,
                telegram: true,
                whatsapp: false,
                max: false
              }
            },
            limits: {
              quotaBuckets: [
                {
                  bucketCode: "token_budget",
                  displayName: "Token budget",
                  unit: "tokens",
                  used: 2100,
                  limit: 10000,
                  percent: 21,
                  usageAvailable: true,
                  status: "ok"
                }
              ],
              monthlyMediaQuotas: {
                planCode: "starter_trial",
                periodStartedAt: "2026-05-01T00:00:00.000Z",
                periodEndsAt: "2026-06-01T00:00:00.000Z",
                periodSource: "subscription_period",
                tools: []
              },
              toolDailyLimits: []
            },
            updatedAt: "2026-05-01T10:00:00.000Z"
          } as unknown as AppData["plan"]
        })}
      />
    );

    expect(screen.getByText("Starter Trial · 21%")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Starter Trial · 21%").closest("button")!);

    await waitFor(() => {
      expect(screen.getByText("billingDateTrialEnds")).toBeInTheDocument();
    });
  });

  it("shows a quiet light-mode marker when paid token light mode is active", () => {
    render(
      <Sidebar
        data={makeAppData({
          plan: {
            effectivePlan: {
              code: "starter_pro",
              displayName: "Starter Pro",
              status: "active",
              source: "plan",
              subscriptionStatus: "active",
              trialEndsAt: null,
              graceStartedAt: null,
              graceEndsAt: null,
              currentPeriodEndsAt: "2026-06-01T00:00:00.000Z",
              isTrialPlan: false,
              trialFallbackPlanCode: null,
              paidFallbackPlanCode: null,
              price: { amount: 1990, currency: "RUB", billingPeriod: "month" }
            },
            advisories: {
              warningThresholdPercent: 90,
              isFreePlan: false,
              higherPaidPlanAvailable: true,
              highestVisiblePaidPlanCode: "pro_max",
              tokenBudget: {
                periodStartedAt: "2026-05-01T00:00:00.000Z",
                periodEndsAt: "2026-06-01T00:00:00.000Z",
                periodSource: "subscription_period",
                paidLightModeEligible: true,
                paidLightModeActive: true,
                paidLightModeReason: "token_budget_limit_reached"
              }
            },
            entitlements: {
              channelsAndSurfaces: {
                webChat: true,
                telegram: true,
                whatsapp: false,
                max: false
              }
            },
            limits: {
              quotaBuckets: [
                {
                  bucketCode: "token_budget",
                  displayName: "Token budget",
                  unit: "tokens",
                  used: 10000,
                  limit: 10000,
                  percent: 100,
                  usageAvailable: true,
                  status: "limit_reached"
                }
              ],
              monthlyMediaQuotas: {
                planCode: "starter_pro",
                periodStartedAt: "2026-05-01T00:00:00.000Z",
                periodEndsAt: "2026-06-01T00:00:00.000Z",
                periodSource: "subscription_period",
                tools: []
              },
              toolDailyLimits: []
            },
            updatedAt: "2026-05-08T10:00:00.000Z"
          } as unknown as AppData["plan"]
        })}
      />
    );

    expect(screen.getByText("Starter Pro · 100% · lightModeBadge")).toBeInTheDocument();
  });

  it("shows the Android APK button above the account card in the mobile sidebar", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36"
    });

    render(<Sidebar data={makeAppData({})} onClose={vi.fn()} />);

    const apkLink = await screen.findByRole("link", { name: "androidAppCta" });
    expect(apkLink).toHaveAttribute("href", "/mobile/persai-android-release.apk");
  });

  it("does not show the Android APK button for non-Android mobile sidebar sessions", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"
    });

    render(<Sidebar data={makeAppData({})} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "androidAppCta" })).toBeNull();
    });
  });

  it("uses mobile-safe logout navigation after signOut resolves", async () => {
    render(<Sidebar data={makeAppData({})} />);

    fireEvent.click(screen.getByText("freePlan · 0%").closest("button")!);
    fireEvent.click(screen.getByText("signOut"));

    await waitFor(() => {
      expect(clerkMocks.signOut).toHaveBeenCalled();
      expect(navigationMocks.navigateAfterClerkAuth).toHaveBeenCalledWith("/", "replace");
    });
  });

  it("prevents repeated logout clicks while signOut is pending", async () => {
    let resolveSignOut: (() => void) | undefined;
    clerkMocks.signOut.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveSignOut = resolve;
      })
    );

    render(<Sidebar data={makeAppData({})} />);

    fireEvent.click(screen.getByText("freePlan · 0%").closest("button")!);
    const logoutButton = screen.getByRole("button", { name: "signOut" });
    fireEvent.click(logoutButton);

    await waitFor(() => {
      expect(clerkMocks.signOut).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "signOut" }));
    expect(clerkMocks.signOut).toHaveBeenCalledTimes(1);

    if (resolveSignOut) {
      resolveSignOut();
    }

    await waitFor(() => {
      expect(navigationMocks.navigateAfterClerkAuth).toHaveBeenCalledWith("/", "replace");
    });
  });
});
