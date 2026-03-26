"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  getChatMessages,
  streamAssistantWebChatTurn,
  toWebChatUxIssue,
  type WebChatUxIssue
} from "../assistant-api-client";
import type { ActivityEvent } from "./activity-badge";

export type ChatMessageRole = "user" | "assistant";
export type ChatMessageStatus = "committed" | "streaming" | "partial";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
}

export type ChatEntry =
  | { kind: "message"; message: ChatMessage }
  | { kind: "activity"; event: ActivityEvent };

export interface UseChatReturn {
  entries: ChatEntry[];
  messages: ChatMessage[];
  chatId: string | null;
  isStreaming: boolean;
  historyLoading: boolean;
  issue: WebChatUxIssue | null;
  send: (text: string) => Promise<void>;
  stop: () => void;
  clearIssue: () => void;
  loadHistory: (chatId: string) => Promise<void>;
}

export function useChat(threadKey: string): UseChatReturn {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [issue, setIssue] = useState<WebChatUxIssue | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const historyLoadedRef = useRef<Set<string>>(new Set());

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const clearIssue = useCallback(() => setIssue(null), []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || isStreaming) return;

      const token = await getToken();
      if (token === null) {
        setIssue(toWebChatUxIssue("Your session has expired. Please sign in again."));
        return;
      }

      const userMsgId = `local-user-${Date.now()}`;
      const assistantMsgId = `local-assistant-${Date.now()}`;
      const controller = new AbortController();
      abortRef.current = controller;

      setIsStreaming(true);
      setIssue(null);
      setMessages((prev) => [
        ...prev,
        { id: userMsgId, role: "user", content: trimmed, status: "committed" },
        { id: assistantMsgId, role: "assistant", content: "", status: "streaming" }
      ]);

      try {
        await streamAssistantWebChatTurn(
          token,
          { surfaceThreadKey: threadKey, message: trimmed },
          {
            onStarted: ({ chat }) => {
              const c = chat as { id?: string } | null;
              if (typeof c?.id === "string") setChatId(c.id);
            },
            onDelta: ({ delta }) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, content: `${m.content}${delta}` } : m
                )
              );
            },
            onRuntimeDone: ({ respondedAt }) => {
              setActivities((prev) => [
                ...prev,
                {
                  id: `activity-runtime-${Date.now()}`,
                  type: "runtime_done",
                  label: "Response generated",
                  detail: new Date(respondedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit"
                  }),
                  timestamp: respondedAt,
                  afterMessageId: assistantMsgId
                }
              ]);
            },
            onCompleted: ({ transport }) => {
              const t = transport as {
                userMessage?: { id?: string };
                assistantMessage?: { id?: string };
              } | null;
              const newAssistantId =
                typeof t?.assistantMessage?.id === "string" ? t.assistantMessage.id : null;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id === assistantMsgId && newAssistantId) {
                    return { ...m, id: newAssistantId, status: "committed" as const };
                  }
                  if (m.id === userMsgId && typeof t?.userMessage?.id === "string") {
                    return { ...m, id: t.userMessage.id };
                  }
                  return m;
                })
              );
              if (newAssistantId) {
                setActivities((prev) =>
                  prev.map((a) =>
                    a.afterMessageId === assistantMsgId
                      ? { ...a, afterMessageId: newAssistantId }
                      : a
                  )
                );
              }
            },
            onInterrupted: () => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, status: m.content.trim().length > 0 ? "partial" : "streaming" }
                    : m
                )
              );
            },
            onFailed: ({ message }) => {
              setIssue(toWebChatUxIssue(message));
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, status: "partial" as const } : m
                )
              );
            }
          },
          controller.signal
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setIssue(toWebChatUxIssue(error));
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId && m.status === "streaming"
              ? { ...m, status: m.content.trim().length > 0 ? "partial" : "committed" }
              : m
          )
        );
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [getToken, isStreaming, threadKey]
  );

  const loadHistory = useCallback(
    async (targetChatId: string) => {
      if (historyLoadedRef.current.has(targetChatId)) return;
      const token = await getToken();
      if (!token) return;

      setHistoryLoading(true);
      try {
        const allMessages: ChatMessage[] = [];
        let cursor: string | undefined;
        let hasMore = true;

        while (hasMore) {
          const page = await getChatMessages(token, targetChatId, cursor, 100);
          for (const m of page.messages) {
            allMessages.push({
              id: m.id,
              role: m.author === "system" ? "assistant" : m.author,
              content: m.content,
              status: "committed"
            });
          }
          cursor = page.nextCursor ?? undefined;
          hasMore = !!page.nextCursor;
        }

        if (allMessages.length > 0) {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const newHistory = allMessages.filter((m) => !existingIds.has(m.id));
            return [...newHistory, ...prev];
          });
        }

        setChatId(targetChatId);
        historyLoadedRef.current.add(targetChatId);
      } catch {
        /* non-critical - chat still works */
      }
      setHistoryLoading(false);
    },
    [getToken]
  );

  const entries: ChatEntry[] = [];
  const activityByMsg = new Map<string, ActivityEvent[]>();
  for (const a of activities) {
    if (a.afterMessageId) {
      const list = activityByMsg.get(a.afterMessageId) ?? [];
      list.push(a);
      activityByMsg.set(a.afterMessageId, list);
    }
  }
  for (const m of messages) {
    entries.push({ kind: "message", message: m });
    const linked = activityByMsg.get(m.id);
    if (linked) {
      for (const ev of linked) entries.push({ kind: "activity", event: ev });
    }
  }

  return {
    entries,
    messages,
    chatId,
    isStreaming,
    historyLoading,
    issue,
    send,
    stop,
    clearIssue,
    loadHistory
  };
}
