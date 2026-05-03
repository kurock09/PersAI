import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantWebChatListItemState } from "@persai/contracts";
import { Sidebar } from "./sidebar";
import { OfflineGate } from "./offline-gate";
import type { AppData } from "./use-app-data";

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: vi.fn(async () => null) }),
  useUser: () => ({ user: null }),
  useClerk: () => ({ signOut: vi.fn() })
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigationMocks,
  useSearchParams: () => new URLSearchParams()
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key
}));

vi.mock("./use-theme", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() })
}));

vi.mock("./assistant-avatar", () => ({
  AssistantAvatar: () => <div data-testid="assistant-avatar" />
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigationMocks.push.mockClear();
  navigationMocks.replace.mockClear();
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
    const pushState = vi.spyOn(window.history, "pushState");
    const data = makeAppData({
      chats: [makeChat("thread-a")]
    });

    render(<Sidebar data={data} />);

    fireEvent.click(screen.getByText("Chat thread-a"));

    await waitFor(() => {
      expect(pushState).toHaveBeenCalledWith(null, "", "/app/chat?thread=thread-a");
    });
    expect(navigationMocks.push).not.toHaveBeenCalled();
  });

  it("blocks chat navigation and exposes the offline overlay when health recheck fails", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    const pushState = vi.spyOn(window.history, "pushState");
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
    expect(pushState).not.toHaveBeenCalled();
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
              paidFallbackPlanCode: null
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

    expect(screen.getByText("billingStatusTrial · 21%")).toBeInTheDocument();

    fireEvent.click(screen.getByText("billingStatusTrial · 21%").closest("button")!);

    await waitFor(() => {
      expect(screen.getByText("billingDateTrialEnds")).toBeInTheDocument();
    });
  });
});
