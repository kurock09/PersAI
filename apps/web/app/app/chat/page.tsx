"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { ChatArea } from "../_components/chat-area";
import { useChat } from "../_components/use-chat";
import { useAppDataContext } from "../_components/app-shell";

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const searchParams = useSearchParams();
  const threadFromUrl = searchParams.get("thread");

  const threadKey = useMemo(() => threadFromUrl ?? `web-${Date.now()}`, [threadFromUrl]);

  const chat = useChat(threadKey);
  const appData = useAppDataContext();

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

  return (
    <ChatArea
      chat={chat}
      title={existingChat?.chat.title ?? undefined}
      assistantName={appData.assistant?.draft.displayName ?? undefined}
      assistantCreatedAt={appData.assistant?.createdAt}
      assistantReady={appData.assistantStatus !== "none"}
      onTitleChanged={appData.reloadChats}
    />
  );
}
