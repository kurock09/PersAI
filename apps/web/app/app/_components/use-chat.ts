"use client";

import { useCallback, useRef, useState } from "react";
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
  thought?: string;
  thoughtStartedAt?: string | null;
  thoughtFinishedAt?: string | null;
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
  hasOlderMessages: boolean;
  olderMessagesLoading: boolean;
  issue: WebChatUxIssue | null;
  send: (text: string) => Promise<void>;
  stop: () => void;
  clearIssue: () => void;
  loadHistory: (chatId: string) => Promise<void>;
  loadOlderMessages: () => Promise<void>;
}

export function useChat(threadKey: string): UseChatReturn {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [olderMessagesLoading, setOlderMessagesLoading] = useState(false);
  const [issue, setIssue] = useState<WebChatUxIssue | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const historyLoadedRef = useRef<Set<string>>(new Set());
  const olderCursorRef = useRef<string | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const prevThreadKeyRef = useRef(threadKey);

  if (prevThreadKeyRef.current !== threadKey) {
    prevThreadKeyRef.current = threadKey;
    setMessages([]);
    setActivities([]);
    setChatId(null);
    setIssue(null);
    setHasOlderMessages(false);
    historyLoadedRef.current = new Set();
    olderCursorRef.current = null;
    activeChatIdRef.current = null;
  }

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
        {
          id: assistantMsgId,
          role: "assistant",
          content: "",
          status: "streaming",
          thought: "",
          thoughtStartedAt: null,
          thoughtFinishedAt: null
        }
      ]);

      const pendingDelta = { text: "", raf: 0 };
      const pendingThought = { text: "", startedAt: null as string | null, raf: 0 };

      const flushDelta = () => {
        const chunk = pendingDelta.text;
        pendingDelta.text = "";
        pendingDelta.raf = 0;
        if (!chunk) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsgId ? { ...m, content: m.content + chunk } : m))
        );
      };

      const flushThought = () => {
        const thought = pendingThought.text;
        const startedAt = pendingThought.startedAt;
        pendingThought.raf = 0;
        if (!thought) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  thought,
                  thoughtStartedAt: m.thoughtStartedAt ?? startedAt
                }
              : m
          )
        );
      };

      try {
        await streamAssistantWebChatTurn(
          token,
          { surfaceThreadKey: threadKey, message: trimmed },
          {
            onStarted: ({ chat }) => {
              const c = chat as { id?: string } | null;
              if (typeof c?.id === "string") setChatId(c.id);
            },
            onThinking: ({ accumulated }) => {
              pendingThought.text = accumulated;
              if (!pendingThought.startedAt) {
                pendingThought.startedAt = new Date().toISOString();
              }
              if (!pendingThought.raf) {
                pendingThought.raf = requestAnimationFrame(flushThought);
              }
            },
            onDelta: ({ delta }) => {
              pendingDelta.text += delta;
              if (!pendingDelta.raf) {
                pendingDelta.raf = requestAnimationFrame(flushDelta);
              }
            },
            onRuntimeDone: ({ respondedAt }) => {
              if (pendingDelta.raf) cancelAnimationFrame(pendingDelta.raf);
              flushDelta();
              if (pendingThought.raf) cancelAnimationFrame(pendingThought.raf);
              flushThought();
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId && m.thought && !m.thoughtFinishedAt
                    ? { ...m, thoughtFinishedAt: respondedAt }
                    : m
                )
              );
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
              if (pendingDelta.raf) cancelAnimationFrame(pendingDelta.raf);
              flushDelta();
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
              const interruptedAt = new Date().toISOString();
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        status: m.content.trim().length > 0 ? "partial" : "streaming",
                        thoughtFinishedAt:
                          m.thought && !m.thoughtFinishedAt
                            ? interruptedAt
                            : (m.thoughtFinishedAt ?? null)
                      }
                    : m
                )
              );
            },
            onFailed: ({ message }) => {
              setIssue(toWebChatUxIssue(message));
              const failedAt = new Date().toISOString();
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        status: "partial" as const,
                        thoughtFinishedAt:
                          m.thought && !m.thoughtFinishedAt
                            ? failedAt
                            : (m.thoughtFinishedAt ?? null)
                      }
                    : m
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
        const abortedAt = new Date().toISOString();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId && m.status === "streaming"
              ? {
                  ...m,
                  status: m.content.trim().length > 0 ? "partial" : "committed",
                  thoughtFinishedAt:
                    m.thought && !m.thoughtFinishedAt ? abortedAt : (m.thoughtFinishedAt ?? null)
                }
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
        const page = await getChatMessages(token, targetChatId, undefined, 20);
        const loaded: ChatMessage[] = page.messages.map((m) => ({
          id: m.id,
          role: m.author === "system" ? "assistant" : m.author,
          content: m.content,
          status: "committed"
        }));

        if (loaded.length > 0) {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const newHistory = loaded.filter((m) => !existingIds.has(m.id));
            return [...newHistory, ...prev];
          });
        }

        olderCursorRef.current = page.nextCursor;
        activeChatIdRef.current = targetChatId;
        setHasOlderMessages(page.nextCursor !== null);
        setChatId(targetChatId);
        historyLoadedRef.current.add(targetChatId);
      } catch {
        /* non-critical */
      }
      setHistoryLoading(false);
    },
    [getToken]
  );

  const loadOlderMessages = useCallback(async () => {
    const cursor = olderCursorRef.current;
    const targetChatId = activeChatIdRef.current;
    if (!cursor || !targetChatId || olderMessagesLoading) return;

    const token = await getToken();
    if (!token) return;

    setOlderMessagesLoading(true);
    try {
      const page = await getChatMessages(token, targetChatId, cursor, 20);
      const loaded: ChatMessage[] = page.messages.map((m) => ({
        id: m.id,
        role: m.author === "system" ? "assistant" : m.author,
        content: m.content,
        status: "committed"
      }));

      if (loaded.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newHistory = loaded.filter((m) => !existingIds.has(m.id));
          return [...newHistory, ...prev];
        });
      }

      olderCursorRef.current = page.nextCursor;
      setHasOlderMessages(page.nextCursor !== null);
    } catch {
      /* non-critical */
    }
    setOlderMessagesLoading(false);
  }, [getToken, olderMessagesLoading]);

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
    hasOlderMessages,
    olderMessagesLoading,
    issue,
    send,
    stop,
    clearIssue,
    loadHistory,
    loadOlderMessages
  };
}
