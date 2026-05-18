"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { ChatArea } from "../_components/chat-area";
import { useChat } from "../_components/use-chat";
import { useAppDataContext, useShellActions } from "../_components/app-shell";
import { pushBackHandler } from "../_components/back-handler-stack";
import {
  getAssistantBillingPaymentIntent,
  getAssistantPlanVisibility,
  WELCOME_THREAD_KEY
} from "../assistant-api-client";

const DRAFT_THREAD_STORAGE_KEY = "persai.draft-chat-thread.v1";

function readDraftThreadKey(): string {
  if (typeof window === "undefined") return `web-${Date.now()}`;
  try {
    const existing = window.sessionStorage.getItem(DRAFT_THREAD_STORAGE_KEY);
    if (existing) return existing;
    const next = `web-${Date.now()}`;
    window.sessionStorage.setItem(DRAFT_THREAD_STORAGE_KEY, next);
    return next;
  } catch {
    return `web-${Date.now()}`;
  }
}

function clearDraftThreadKey(threadKey: string): void {
  if (typeof window === "undefined") return;
  try {
    if (window.sessionStorage.getItem(DRAFT_THREAD_STORAGE_KEY) === threadKey) {
      window.sessionStorage.removeItem(DRAFT_THREAD_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

type BillingReturnBannerState = {
  kind: "success" | "failed" | "pending" | undefined;
  planCode: string | undefined;
  paymentIntentId: string | undefined;
};

function readBillingReturnBannerState(
  searchParams: URLSearchParams | ReadonlyURLSearchParamsLike
): BillingReturnBannerState {
  const billingReturn =
    searchParams.get("billingReturn") === "success" ||
    searchParams.get("billingReturn") === "failed" ||
    searchParams.get("billingReturn") === "pending"
      ? (searchParams.get("billingReturn") as "success" | "failed" | "pending")
      : undefined;
  return {
    kind: billingReturn,
    planCode: searchParams.get("billingPlan") ?? undefined,
    paymentIntentId: searchParams.get("billingPaymentIntentId") ?? undefined
  };
}

type ReadonlyURLSearchParamsLike = {
  get(name: string): string | null;
  toString(): string;
};

function buildChatHrefWithoutBillingParams(
  searchParams: URLSearchParams | ReadonlyURLSearchParamsLike
): Route {
  const next = new URLSearchParams(searchParams.toString());
  next.delete("billingReturn");
  next.delete("billingPlan");
  next.delete("billingPaymentIntentId");
  next.delete("settings");
  const query = next.toString();
  return (query.length > 0 ? `/app/chat?${query}` : "/app/chat") as Route;
}

function buildAppRootHrefPreservingNonChatParams(
  searchParams: URLSearchParams | ReadonlyURLSearchParamsLike
): Route {
  const next = new URLSearchParams(searchParams.toString());
  next.delete("thread");
  next.delete("welcome");
  next.delete("billingReturn");
  next.delete("billingPlan");
  next.delete("billingPaymentIntentId");
  next.delete("settings");
  const query = next.toString();
  return (query.length > 0 ? `/app?${query}` : "/app") as Route;
}

function shouldWaitForImmediatePlanRefresh(purpose: string): boolean {
  return purpose === "plan_purchase" || purpose === "managed_recurring_upgrade";
}

export async function waitForPurchasedPlanTruth({
  token,
  targetPlanCode,
  reload,
  fetchPlanVisibility,
  isCancelled,
  sleep,
  now,
  deadlineMs = 12_000
}: {
  token: string;
  targetPlanCode: string;
  reload: () => Promise<void> | void;
  fetchPlanVisibility: typeof getAssistantPlanVisibility;
  isCancelled: () => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  deadlineMs?: number;
}): Promise<void> {
  const truthDeadline = now() + deadlineMs;
  while (!isCancelled()) {
    const visibility = await fetchPlanVisibility(token);
    await reload();
    if (visibility.effectivePlan.code === targetPlanCode) {
      return;
    }
    if (now() >= truthDeadline) {
      return;
    }
    await sleep(1_500);
  }
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const { userId, getToken } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { openSettings } = useShellActions();
  const threadFromUrl = searchParams.get("thread");
  const welcomeFromUrl = searchParams.get("welcome") === "1";
  const settingsFromUrl = searchParams.get("settings");
  const [billingBanner, setBillingBanner] = useState<BillingReturnBannerState>(() =>
    readBillingReturnBannerState(searchParams)
  );

  const threadKey = useMemo(() => threadFromUrl ?? readDraftThreadKey(), [threadFromUrl]);

  const appData = useAppDataContext();
  const canSeeShadowRoutingBadge =
    appData.isAdmin ||
    (typeof userId === "string" && userId.length > 0 && appData.assistant?.userId === userId);
  const chat = useChat(threadKey);
  const locale = useLocale();

  // Match by `threadKey` (not `threadFromUrl`) so that a chat row created by the
  // server during the first send becomes visible in the header immediately
  // after `reloadChats()` lands, even before the URL has been updated.
  const existingChat = appData.chats.find((c) => c.chat.surfaceThreadKey === threadKey);

  // ADR-076 mobile UX: hardware Back from a chat thread should jump straight
  // to the app home (`/app`) instead of walking back through every previously
  // viewed chat in the WebView history stack. We register at module-level so
  // open overlays (sidebar/modal) still consume Back first via the existing
  // LIFO stack; only when nothing is open does this handler fire.
  // Web/browser Back is intentionally unchanged — this only intercepts the
  // Capacitor Android backButton event delivered through BackButtonBridge.
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  useEffect(() => {
    const remove = pushBackHandler(() => {
      router.replace(buildAppRootHrefPreservingNonChatParams(searchParamsRef.current));
    });
    return remove;
  }, [router]);

  useEffect(() => {
    if (appData.isLoading) {
      return;
    }
    if (!threadFromUrl) {
      return;
    }
    if (welcomeFromUrl && threadFromUrl === WELCOME_THREAD_KEY) {
      return;
    }
    if (existingChat?.chat.id) {
      return;
    }
    if (chat.chatId || chat.isStreaming || chat.pendingSendStatus !== null || chat.historyLoading) {
      return;
    }
    router.replace(buildAppRootHrefPreservingNonChatParams(searchParams));
  }, [
    appData.isLoading,
    chat.chatId,
    chat.historyLoading,
    chat.isStreaming,
    chat.pendingSendStatus,
    existingChat?.chat.id,
    router,
    searchParams,
    threadFromUrl,
    welcomeFromUrl
  ]);

  useEffect(() => {
    if (!existingChat?.chat.id) {
      // No existing chat row matches this threadKey — this is a fresh
      // conversation with no history to fetch. Clear the optimistic
      // historyLoading flag set by useChat's threadKey-change reset, so the
      // EmptyState can render immediately instead of waiting for a fetch
      // that will never happen.
      chat.markHistoryEmpty();
      return;
    }
    void chat.loadHistory(existingChat.chat.id);
  }, [existingChat?.chat.id, chat.chatId]); // eslint-disable-line

  // When a new chat is created during streaming, refresh the sidebar list and
  // mirror the generated threadKey into the URL so a hard refresh keeps the
  // user on the same conversation (and `existingChat` lookup stays stable).
  const prevChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (chat.chatId && chat.chatId !== prevChatIdRef.current && !threadFromUrl) {
      prevChatIdRef.current = chat.chatId;
      appData.reloadChats();
      clearDraftThreadKey(threadKey);
      router.replace(`/app/chat?thread=${threadKey}` as Route);
    }
  }, [chat.chatId, threadFromUrl, threadKey, router]); // eslint-disable-line

  // Welcome chat: trigger only when setup/recreate explicitly requests it.
  const welcomeTriggeredRef = useRef(false);
  const billingTruthRefreshKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (welcomeTriggeredRef.current) return;
    if (appData.isLoading) return;
    if (appData.assistantStatus !== "live") return;
    if (!welcomeFromUrl) return;
    if (threadFromUrl !== WELCOME_THREAD_KEY) return;
    if (chat.isStreaming) return;

    const existingWelcome = appData.chats.find(
      (c) => c.chat.surfaceThreadKey === WELCOME_THREAD_KEY
    );
    if (existingWelcome) {
      welcomeTriggeredRef.current = true;
      router.replace(`/app/chat?thread=${WELCOME_THREAD_KEY}` as Route);
      return;
    }

    welcomeTriggeredRef.current = true;
    void chat.sendWelcome(locale).then(() => {
      void appData.reloadChats();
      router.replace(`/app/chat?thread=${WELCOME_THREAD_KEY}` as Route);
    });
  }, [
    appData.isLoading,
    appData.assistantStatus,
    appData.chats,
    chat,
    locale,
    router,
    threadFromUrl,
    welcomeFromUrl
  ]);

  useEffect(() => {
    const next = readBillingReturnBannerState(searchParams);
    if (next.kind === undefined) {
      return;
    }
    setBillingBanner(next);
    router.replace(buildChatHrefWithoutBillingParams(searchParams));
  }, [router, searchParams]);

  useEffect(() => {
    if (settingsFromUrl !== "limits") {
      return;
    }
    openSettings("limits");
    router.replace(buildChatHrefWithoutBillingParams(searchParams));
  }, [openSettings, router, searchParams, settingsFromUrl]);

  useEffect(() => {
    if (billingBanner.kind !== "success" && billingBanner.kind !== "pending") {
      billingTruthRefreshKeyRef.current = null;
      return;
    }

    const refreshKey = billingBanner.paymentIntentId ?? "no-payment-intent-id";
    if (billingTruthRefreshKeyRef.current === refreshKey) {
      return;
    }
    billingTruthRefreshKeyRef.current = refreshKey;

    let cancelled = false;
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    void (async () => {
      if (!billingBanner.paymentIntentId) {
        await appData.reload();
        return;
      }

      const token = await getToken();
      if (!token) {
        await appData.reload();
        return;
      }

      const deadline = Date.now() + 20_000;
      while (!cancelled) {
        try {
          const paymentIntent = await getAssistantBillingPaymentIntent(
            token,
            billingBanner.paymentIntentId
          );
          if (
            paymentIntent.status === "succeeded" ||
            paymentIntent.status === "failed" ||
            paymentIntent.status === "canceled" ||
            paymentIntent.status === "reversed" ||
            paymentIntent.status === "expired"
          ) {
            setBillingBanner((current) =>
              current.paymentIntentId === billingBanner.paymentIntentId
                ? {
                    ...current,
                    kind: paymentIntent.status === "succeeded" ? "success" : "failed"
                  }
                : current
            );
            if (
              paymentIntent.status === "succeeded" &&
              shouldWaitForImmediatePlanRefresh(paymentIntent.purpose)
            ) {
              await waitForPurchasedPlanTruth({
                token,
                targetPlanCode: paymentIntent.targetPlanCode,
                reload: appData.reload,
                fetchPlanVisibility: getAssistantPlanVisibility,
                isCancelled: () => cancelled,
                sleep,
                now: () => Date.now()
              });
              return;
            }
            await appData.reload();
            return;
          }
        } catch {
          await appData.reload();
          return;
        }

        if (Date.now() >= deadline) {
          await appData.reload();
          return;
        }
        await sleep(1_500);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appData.reload, billingBanner.kind, billingBanner.paymentIntentId, getToken]);

  return (
    <ChatArea
      chat={chat}
      title={existingChat?.chat.title ?? undefined}
      deepModeEnabled={existingChat?.chat.deepModeEnabled ?? false}
      assistantName={appData.assistant?.draft.displayName ?? undefined}
      assistantAvatarUrl={appData.assistant?.draft.avatarUrl ?? undefined}
      assistantAvatarEmoji={appData.assistant?.draft.avatarEmoji ?? undefined}
      assistantCreatedAt={appData.assistant?.createdAt}
      assistantReady={appData.assistantStatus !== "none"}
      showShadowRoutingBadge={canSeeShadowRoutingBadge}
      onTitleChanged={appData.reloadChats}
      onUserSend={() => appData.markChatListActivity(threadKey)}
      billingReturnKind={billingBanner.kind}
      billingPlanCode={billingBanner.planCode}
      billingPaymentIntentId={billingBanner.paymentIntentId}
    />
  );
}
