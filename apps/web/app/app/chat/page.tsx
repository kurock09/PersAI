"use client";

import { Suspense, useMemo } from "react";
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

  const threadKey = useMemo(
    () => threadFromUrl ?? `web-${Date.now()}`,
    [threadFromUrl]
  );

  const chat = useChat(threadKey);
  const appData = useAppDataContext();

  const existingChat = threadFromUrl
    ? appData.chats.find((c) => c.chat.surfaceThreadKey === threadFromUrl)
    : undefined;

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
