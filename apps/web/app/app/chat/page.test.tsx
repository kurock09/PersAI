import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeBackPress } from "../_components/back-handler-stack";
import ChatPage, { waitForPurchasedPlanTruth } from "./page";

const navigationMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
  router: {
    replace: vi.fn()
  }
}));

const chatHookMocks = vi.hoisted(() => ({
  sendWelcome: vi.fn(),
  loadHistory: vi.fn(),
  markHistoryEmpty: vi.fn(),
  isStreaming: false,
  historyLoading: false,
  chatId: null as string | null,
  pendingSendStatus: null as
    | null
    | "sending"
    | "reconciling"
    | "send_failed"
    | "send_failed_unconfirmed"
    | "send_failed_confirmed",
  threadKeys: [] as string[],
  assistantIds: [] as Array<string | null | undefined>
}));

const appDataMocks = vi.hoisted(() => ({
  isLoading: false,
  isReloading: false,
  isReloadingChats: false,
  assistantStatus: "live" as const,
  chats: [] as Array<{
    chat: { id: string; surfaceThreadKey: string; title: string | null; deepModeEnabled: boolean };
  }>,
  assistant: null,
  activeAssistantId: "assistant-1",
  reload: vi.fn(),
  reloadChats: vi.fn(),
  markChatListActivity: vi.fn(),
  createAssistant: vi.fn(),
  switchAssistant: vi.fn()
}));

const shellActionMocks = vi.hoisted(() => ({
  openSettings: vi.fn()
}));

const chatAreaMocks = vi.hoisted(() => ({
  lastProps: null as Record<string, unknown> | null
}));

const assistantApiClientMocks = vi.hoisted(() => ({
  getAssistantBillingPaymentIntent: vi.fn(),
  getAssistantPlanVisibility: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigationMocks.router,
  useSearchParams: () => navigationMocks.searchParams
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en"
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    userId: "user-1",
    getToken: vi.fn().mockResolvedValue("token-1")
  })
}));

vi.mock("../_components/use-chat", () => ({
  useChat: (threadKey: string, options?: { assistantId?: string | null }) => {
    chatHookMocks.threadKeys.push(threadKey);
    chatHookMocks.assistantIds.push(options?.assistantId);
    return chatHookMocks;
  }
}));

vi.mock("../_components/app-shell", () => ({
  useAppDataContext: () => appDataMocks,
  useShellActions: () => shellActionMocks
}));

vi.mock("../_components/chat-area", () => ({
  ChatArea: (props: Record<string, unknown>) => {
    chatAreaMocks.lastProps = props;
    return <div>chat-area</div>;
  }
}));

vi.mock("../assistant-api-client", () => ({
  WELCOME_THREAD_KEY: "welcome",
  getAssistantBillingPaymentIntent: assistantApiClientMocks.getAssistantBillingPaymentIntent,
  getAssistantPlanVisibility: assistantApiClientMocks.getAssistantPlanVisibility
}));

describe("ChatPage", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  beforeEach(() => {
    window.sessionStorage.clear();
    chatHookMocks.chatId = null;
    chatHookMocks.isStreaming = false;
    chatHookMocks.historyLoading = false;
    chatHookMocks.pendingSendStatus = null;
    chatHookMocks.threadKeys = [];
    chatHookMocks.assistantIds = [];
    chatAreaMocks.lastProps = null;
    assistantApiClientMocks.getAssistantBillingPaymentIntent.mockReset();
    assistantApiClientMocks.getAssistantPlanVisibility.mockReset();
    assistantApiClientMocks.getAssistantBillingPaymentIntent.mockResolvedValue({
      id: "intent-1",
      targetPlanCode: "pro_plus",
      action: "purchase",
      purpose: "plan_purchase",
      status: "succeeded",
      paymentMethodClass: "bank_card",
      amountMinor: 4900,
      currency: "RUB",
      billingPeriod: "month",
      returnUrl: "/app/chat",
      billingProvider: "cloudpayments",
      providerSessionRef: null,
      providerPaymentRef: null,
      recurring: { mode: "none" },
      checkout: { mode: "redirect", url: null, payload: null, expiresAt: null },
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: "2026-05-05T12:00:00.000Z",
      updatedAt: "2026-05-05T12:00:00.000Z"
    });
    assistantApiClientMocks.getAssistantPlanVisibility.mockResolvedValue({
      effectivePlan: {
        code: "pro_plus",
        displayName: "Pro Plus",
        price: { amount: 49, currency: "RUB", billingPeriod: "month" },
        subscriptionStatus: "active",
        isTrialPlan: false,
        currentPeriodEndsAt: "2026-06-05T12:00:00.000Z",
        trialEndsAt: null,
        graceEndsAt: null,
        source: "workspace_subscription"
      },
      entitlements: { tools: [], channels: [], features: [] },
      limits: {
        quotaBuckets: [],
        monthlyMediaQuotas: { tools: [] },
        toolDailyLimits: []
      },
      updatedAt: "2026-05-05T12:00:00.000Z"
    });
    appDataMocks.activeAssistantId = "assistant-1";
    appDataMocks.reload.mockReset();
    appDataMocks.markChatListActivity.mockReset();
    shellActionMocks.openSettings.mockReset();
    navigationMocks.replace.mockReset();
    navigationMocks.router.replace = navigationMocks.replace;
  });

  it("does not auto-create a welcome chat just because the chat list is empty", async () => {
    navigationMocks.searchParams = new URLSearchParams();
    chatHookMocks.sendWelcome.mockReset();
    chatHookMocks.markHistoryEmpty.mockReset();
    navigationMocks.replace.mockReset();
    appDataMocks.chats = [];
    appDataMocks.reloadChats.mockReset();

    render(<ChatPage />);

    await waitFor(() => {
      expect(chatHookMocks.sendWelcome).not.toHaveBeenCalled();
    });
    expect(navigationMocks.replace).not.toHaveBeenCalled();
  });

  it("creates the welcome chat only when explicitly requested by setup", async () => {
    navigationMocks.searchParams = new URLSearchParams("thread=welcome&welcome=1");
    chatHookMocks.sendWelcome.mockReset();
    chatHookMocks.sendWelcome.mockResolvedValue(undefined);
    chatHookMocks.markHistoryEmpty.mockReset();
    navigationMocks.replace.mockReset();
    appDataMocks.chats = [];
    appDataMocks.reloadChats.mockReset();

    render(<ChatPage />);

    await waitFor(() => {
      expect(chatHookMocks.sendWelcome).toHaveBeenCalledWith("en");
    });
    await waitFor(() => {
      expect(appDataMocks.reloadChats).toHaveBeenCalled();
    });
    expect(navigationMocks.replace).toHaveBeenCalledWith("/app/chat?thread=welcome");
  });

  it("validates an existing chat even when the hook already has the same chat id", async () => {
    navigationMocks.searchParams = new URLSearchParams("thread=thread-1");
    chatHookMocks.loadHistory.mockReset();
    chatHookMocks.markHistoryEmpty.mockReset();
    chatHookMocks.chatId = "chat-1";
    chatHookMocks.isStreaming = false;
    appDataMocks.chats = [
      {
        chat: {
          id: "chat-1",
          surfaceThreadKey: "thread-1",
          title: "Chat",
          deepModeEnabled: false
        }
      }
    ];

    render(<ChatPage />);

    await waitFor(() => {
      expect(chatHookMocks.loadHistory).toHaveBeenCalledWith("chat-1");
    });
    expect(chatHookMocks.markHistoryEmpty).not.toHaveBeenCalled();
  });

  it("redirects to /app when the URL points to a deleted chat thread with no recoverable local state", async () => {
    navigationMocks.searchParams = new URLSearchParams("thread=deleted-thread");
    navigationMocks.replace.mockReset();
    chatHookMocks.loadHistory.mockReset();
    chatHookMocks.markHistoryEmpty.mockReset();
    chatHookMocks.chatId = null;
    chatHookMocks.isStreaming = false;
    appDataMocks.isLoading = false;
    appDataMocks.chats = [];

    render(<ChatPage />);

    await waitFor(() => {
      expect(navigationMocks.replace).toHaveBeenCalledWith("/app");
    });
    expect(chatHookMocks.loadHistory).not.toHaveBeenCalled();
  });

  it("hardware Back from a chat thread jumps to /app instead of walking through chat history", async () => {
    navigationMocks.searchParams = new URLSearchParams("thread=thread-x");
    navigationMocks.replace.mockReset();
    chatHookMocks.chatId = "chat-x";
    appDataMocks.isLoading = false;
    appDataMocks.chats = [
      {
        chat: {
          id: "chat-x",
          surfaceThreadKey: "thread-x",
          title: "Chat X",
          deepModeEnabled: false
        }
      }
    ];

    const view = render(<ChatPage />);
    await waitFor(() => {
      expect(chatHookMocks.loadHistory).toHaveBeenCalled();
    });

    navigationMocks.replace.mockReset();
    act(() => {
      expect(consumeBackPress()).toBe(true);
    });
    expect(navigationMocks.replace).toHaveBeenCalledWith("/app");

    view.unmount();
    // Handler is removed on unmount so subsequent presses don't trigger
    // navigation from a stale chat page.
    expect(consumeBackPress()).toBe(false);
  });

  it("preserves non-chat search params when hardware Back lands on /app", async () => {
    navigationMocks.searchParams = new URLSearchParams("thread=thread-x&debug=1");
    navigationMocks.replace.mockReset();
    chatHookMocks.chatId = "chat-x";
    appDataMocks.isLoading = false;
    appDataMocks.chats = [
      {
        chat: {
          id: "chat-x",
          surfaceThreadKey: "thread-x",
          title: "Chat X",
          deepModeEnabled: false
        }
      }
    ];

    render(<ChatPage />);
    await waitFor(() => {
      expect(chatHookMocks.loadHistory).toHaveBeenCalled();
    });

    navigationMocks.replace.mockReset();
    act(() => {
      consumeBackPress();
    });
    expect(navigationMocks.replace).toHaveBeenCalledWith("/app?debug=1");
  });

  it("keeps the same draft thread key across bare chat remounts", async () => {
    navigationMocks.searchParams = new URLSearchParams();
    chatHookMocks.markHistoryEmpty.mockReset();
    appDataMocks.chats = [];

    const first = render(<ChatPage />);
    await waitFor(() => {
      expect(chatHookMocks.markHistoryEmpty).toHaveBeenCalled();
    });
    const firstThreadKey = chatHookMocks.threadKeys.at(-1);
    expect(firstThreadKey).toMatch(/^web-/);

    first.unmount();
    chatHookMocks.markHistoryEmpty.mockReset();
    render(<ChatPage />);

    await waitFor(() => {
      expect(chatHookMocks.markHistoryEmpty).toHaveBeenCalled();
    });
    expect(chatHookMocks.threadKeys.at(-1)).toBe(firstThreadKey);
  });

  it("clears the draft thread key after the server chat is created and mirrored into the URL", async () => {
    navigationMocks.searchParams = new URLSearchParams();
    navigationMocks.replace.mockReset();
    appDataMocks.reloadChats.mockReset();
    appDataMocks.chats = [];
    chatHookMocks.chatId = "chat-1";

    render(<ChatPage />);

    await waitFor(() => {
      expect(navigationMocks.replace).toHaveBeenCalled();
    });
    expect(window.sessionStorage.getItem("persai.draft-chat-thread.v1.assistant-1")).toBeNull();
  });

  it("namespaces the draft thread storage by active assistant", async () => {
    navigationMocks.searchParams = new URLSearchParams();
    appDataMocks.activeAssistantId = "assistant-42";
    appDataMocks.chats = [];

    render(<ChatPage />);

    await waitFor(() => {
      expect(chatHookMocks.threadKeys).toHaveLength(1);
    });

    expect(window.sessionStorage.getItem("persai.draft-chat-thread.v1.assistant-42")).toBe(
      chatHookMocks.threadKeys[0]
    );
    expect(chatHookMocks.assistantIds[0]).toBe("assistant-42");
  });

  it("passes billing return params through to the chat area banner props and strips one-shot billing params from the URL", async () => {
    navigationMocks.searchParams = new URLSearchParams(
      "billingReturn=success&billingPlan=pro_plus&billingPaymentIntentId=intent-1"
    );
    appDataMocks.chats = [];
    chatHookMocks.markHistoryEmpty.mockReset();

    render(<ChatPage />);

    await waitFor(() => {
      expect(chatAreaMocks.lastProps).not.toBeNull();
    });
    expect(chatAreaMocks.lastProps?.billingReturnKind).toBe("success");
    expect(chatAreaMocks.lastProps?.billingPlanCode).toBe("pro_plus");
    expect(chatAreaMocks.lastProps?.billingPaymentIntentId).toBe("intent-1");
    expect(navigationMocks.replace).toHaveBeenCalledWith("/app/chat");
  });

  it("keeps reloading until the purchased plan becomes visible", async () => {
    const reload = vi.fn();
    const sleepSpy = vi.fn();
    let nowMs = 0;
    const fetchPlanVisibility = vi
      .fn()
      .mockResolvedValueOnce({
        effectivePlan: { code: "basic" }
      })
      .mockResolvedValueOnce({
        effectivePlan: { code: "pro_plus" }
      });

    await waitForPurchasedPlanTruth({
      token: "token-1",
      targetPlanCode: "pro_plus",
      reload,
      fetchPlanVisibility:
        fetchPlanVisibility as typeof assistantApiClientMocks.getAssistantPlanVisibility,
      isCancelled: () => false,
      sleep: async (ms) => {
        nowMs += ms;
        sleepSpy(ms);
      },
      now: () => nowMs
    });

    expect(fetchPlanVisibility).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenCalledTimes(1);
  });

  it("wires chat-area sends into local chat-list activity bumping", async () => {
    navigationMocks.searchParams = new URLSearchParams("thread=thread-1");
    appDataMocks.chats = [
      {
        chat: {
          id: "chat-1",
          surfaceThreadKey: "thread-1",
          title: "Chat",
          deepModeEnabled: false
        }
      }
    ];

    render(<ChatPage />);

    await waitFor(() => {
      expect(chatAreaMocks.lastProps).not.toBeNull();
    });

    (chatAreaMocks.lastProps?.onUserSend as (() => void) | undefined)?.();

    expect(appDataMocks.markChatListActivity).toHaveBeenCalledWith("thread-1");
  });

  it("opens Limits & Plan from a settings deep link and strips the one-shot param", async () => {
    navigationMocks.searchParams = new URLSearchParams("settings=limits");
    appDataMocks.chats = [];
    chatHookMocks.markHistoryEmpty.mockReset();

    render(<ChatPage />);

    await waitFor(() => {
      expect(shellActionMocks.openSettings).toHaveBeenCalledWith("limits");
    });
    expect(navigationMocks.replace).toHaveBeenCalledWith("/app/chat");
  });
});
