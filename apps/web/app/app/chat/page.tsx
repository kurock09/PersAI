"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { ChatArea } from "../_components/chat-area";
import { useChat } from "../_components/use-chat";
import { useAppDataContext } from "../_components/app-shell";
import { WELCOME_THREAD_KEY } from "../assistant-api-client";

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const threadFromUrl = searchParams.get("thread");

  const threadKey = useMemo(() => threadFromUrl ?? `web-${Date.now()}`, [threadFromUrl]);

  const chat = useChat(threadKey);
  const appData = useAppDataContext();
  const locale = useLocale();

  const existingChat = threadFromUrl
    ? appData.chats.find((c) => c.chat.surfaceThreadKey === threadFromUrl)
    : undefined;

  useEffect(() => {
    if (existingChat?.chat.id) {
      void chat.loadHistory(existingChat.chat.id);
    }
  }, [existingChat?.chat.id]); // eslint-disable-line

  // When a new chat is created during streaming, refresh the sidebar list.
  const prevChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (chat.chatId && chat.chatId !== prevChatIdRef.current && !threadFromUrl) {
      prevChatIdRef.current = chat.chatId;
      appData.reloadChats();
    }
  }, [chat.chatId, threadFromUrl]); // eslint-disable-line

  // Welcome chat: trigger once on first visit when no chats exist.
  const welcomeTriggeredRef = useRef(false);
  useEffect(() => {
    if (welcomeTriggeredRef.current) return;
    if (appData.isLoading) return;
    if (appData.assistantStatus !== "live") return;
    if (threadFromUrl) return;
    if (chat.isStreaming) return;

    const existingWelcome = appData.chats.find(
      (c) => c.chat.surfaceThreadKey === WELCOME_THREAD_KEY
    );
    if (existingWelcome) return; // already done

    if (appData.chats.length === 0) {
      welcomeTriggeredRef.current = true;
      void chat.sendWelcome(locale).then(() => {
        void appData.reloadChats();
        router.replace(`/app/chat?thread=${WELCOME_THREAD_KEY}`);
      });
    }
  }, [appData.isLoading, appData.assistantStatus, appData.chats, threadFromUrl]); // eslint-disable-line

  return (
    <ChatArea
      chat={chat}
      title={existingChat?.chat.title ?? undefined}
      assistantName={appData.assistant?.draft.displayName ?? undefined}
      assistantAvatarUrl={appData.assistant?.draft.avatarUrl ?? undefined}
      assistantAvatarEmoji={appData.assistant?.draft.avatarEmoji ?? undefined}
      assistantCreatedAt={appData.assistant?.createdAt}
      assistantReady={appData.assistantStatus !== "none"}
      onTitleChanged={appData.reloadChats}
    />
  );
}
