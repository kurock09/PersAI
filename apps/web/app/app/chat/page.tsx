"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { ChatArea } from "../_components/chat-area";
import { useChat } from "../_components/use-chat";
import { useAppDataContext } from "../_components/app-shell";
import { WELCOME_THREAD_KEY } from "../assistant-api-client";

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

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const { userId } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const threadFromUrl = searchParams.get("thread");
  const welcomeFromUrl = searchParams.get("welcome") === "1";
  const billingReturn =
    searchParams.get("billingReturn") === "success" ||
    searchParams.get("billingReturn") === "failed" ||
    searchParams.get("billingReturn") === "pending"
      ? (searchParams.get("billingReturn") as "success" | "failed" | "pending")
      : undefined;
  const billingPlanCode = searchParams.get("billingPlan") ?? undefined;

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
      billingReturnKind={billingReturn}
      billingPlanCode={billingPlanCode}
    />
  );
}
