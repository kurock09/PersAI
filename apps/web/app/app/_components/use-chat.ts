"use client";

import { useCallback, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  getChatMessages,
  stageWebChatAttachment,
  streamAssistantWebChatTurn,
  toWebChatUxIssue,
  WELCOME_THREAD_KEY,
  WELCOME_TURN_SENTINEL,
  type ChatHistoryAttachment,
  type WebChatUxIssue
} from "../assistant-api-client";
import type { ActivityEvent } from "./activity-badge";

export type ChatMessageRole = "user" | "assistant";
export type ChatMessageStatus = "committed" | "streaming" | "partial";

export type ChatAttachment = ChatHistoryAttachment & {
  localPreviewUrl?: string | undefined;
};

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  attachments?: ChatAttachment[] | undefined;
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
  send: (text: string, files?: File[]) => Promise<void>;
  sendWelcome: (locale: string) => Promise<void>;
  stop: () => void;
  clearIssue: () => void;
  reportIssue: (error: unknown) => void;
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
  const reportIssue = useCallback((error: unknown) => {
    setIssue(toWebChatUxIssue(error));
  }, []);

  const send = useCallback(
    async (text: string, files?: File[]) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || isStreaming) return;

      const token = await getToken();
      if (token === null) {
        setIssue(toWebChatUxIssue("Your session has expired. Please sign in again."));
        return;
      }

      const pendingFiles = files ?? [];
      const localAttachments: ChatAttachment[] = pendingFiles.map((f, i) => ({
        id: `local-att-${Date.now()}-${String(i)}`,
        attachmentType: f.type.startsWith("image/")
          ? "image"
          : f.type.startsWith("audio/")
            ? "audio"
            : f.type.startsWith("video/")
              ? "video"
              : "document",
        originalFilename: f.name,
        mimeType: f.type || "application/octet-stream",
        sizeBytes: f.size,
        processingStatus: "pending",
        createdAt: new Date().toISOString(),
        localPreviewUrl:
          f.type.startsWith("image/") || f.type.startsWith("audio/") || f.type.startsWith("video/")
            ? URL.createObjectURL(f)
            : undefined
      }));

      const userMsgId = `local-user-${Date.now()}`;
      const assistantMsgId = `local-assistant-${Date.now()}`;
      const controller = new AbortController();
      abortRef.current = controller;

      setIsStreaming(true);
      setIssue(null);

      const userMsg: ChatMessage = {
        id: userMsgId,
        role: "user",
        content: trimmed,
        status: "committed",
        attachments: localAttachments.length > 0 ? localAttachments : undefined
      };
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        status: "streaming",
        thought: "",
        thoughtStartedAt: null,
        thoughtFinishedAt: null
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      if (pendingFiles.length > 0) {
        try {
          for (let i = 0; i < pendingFiles.length; i++) {
            const file = pendingFiles[i]!;
            const staged = await stageWebChatAttachment(token, threadKey, file);
            const u = staged.attachment;
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== userMsgId) return m;
                const next = [...(m.attachments ?? [])];
                const prevEntry = next[i];
                if (prevEntry?.localPreviewUrl) {
                  URL.revokeObjectURL(prevEntry.localPreviewUrl);
                }
                next[i] = {
                  id: u.id,
                  attachmentType: u.attachmentType,
                  originalFilename: u.originalFilename ?? file.name,
                  mimeType: u.mimeType,
                  sizeBytes: u.sizeBytes,
                  processingStatus: u.processingStatus as ChatAttachment["processingStatus"],
                  createdAt: u.createdAt,
                  localPreviewUrl: undefined
                };
                return { ...m, attachments: next };
              })
            );
          }
        } catch {
          setIssue(toWebChatUxIssue("Failed to upload attachments. Please try again."));
          setIsStreaming(false);
          abortRef.current = null;
          return;
        }
      }

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
                userMessage?: {
                  id?: string;
                  chatId?: string;
                  attachments?: ChatAttachment[];
                };
                assistantMessage?: {
                  id?: string;
                  attachments?: ChatAttachment[];
                };
              } | null;
              const realUserMsgId =
                typeof t?.userMessage?.id === "string" ? t.userMessage.id : null;
              const newAssistantId =
                typeof t?.assistantMessage?.id === "string" ? t.assistantMessage.id : null;
              const assistantAttachments =
                Array.isArray(t?.assistantMessage?.attachments) &&
                t.assistantMessage.attachments.length > 0
                  ? (t.assistantMessage.attachments as ChatAttachment[])
                  : undefined;
              const userServerAttachments = Array.isArray(t?.userMessage?.attachments)
                ? t.userMessage.attachments
                : undefined;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id === assistantMsgId && newAssistantId) {
                    return {
                      ...m,
                      id: newAssistantId,
                      status: "committed" as const,
                      attachments: assistantAttachments
                    };
                  }
                  if (m.id === userMsgId && realUserMsgId) {
                    for (const a of m.attachments ?? []) {
                      if (a.localPreviewUrl) URL.revokeObjectURL(a.localPreviewUrl);
                    }
                    const nextUserAtts =
                      userServerAttachments !== undefined && userServerAttachments.length > 0
                        ? userServerAttachments.map((a) => ({
                            id: a.id,
                            attachmentType: a.attachmentType,
                            originalFilename: a.originalFilename,
                            mimeType: a.mimeType,
                            sizeBytes: a.sizeBytes,
                            processingStatus: a.processingStatus,
                            createdAt: a.createdAt
                          }))
                        : (m.attachments ?? []).map((a) => {
                            const next = { ...a };
                            delete next.localPreviewUrl;
                            return next;
                          });
                    return { ...m, id: realUserMsgId, attachments: nextUserAtts };
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

              // Files are already staged before the stream — no post-stream upload needed
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
            onFailed: (payload) => {
              setIssue(toWebChatUxIssue(payload));
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

  const sendWelcome = useCallback(
    async (locale: string) => {
      if (isStreaming) return;
      const token = await getToken();
      if (token === null) {
        setIssue(toWebChatUxIssue("Your session has expired. Please sign in again."));
        return;
      }

      const assistantMsgId = `local-assistant-welcome-${Date.now()}`;
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      setIssue(null);

      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        status: "streaming",
        thought: "",
        thoughtStartedAt: null,
        thoughtFinishedAt: null
      };
      setMessages([assistantMsg]);

      const pendingDelta = { text: "", raf: 0 };
      const flushDelta = () => {
        const chunk = pendingDelta.text;
        pendingDelta.text = "";
        pendingDelta.raf = 0;
        if (!chunk) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsgId ? { ...m, content: m.content + chunk } : m))
        );
      };

      try {
        await streamAssistantWebChatTurn(
          token,
          {
            surfaceThreadKey: WELCOME_THREAD_KEY,
            message: "",
            welcomeTurn: true,
            welcomeLocale: locale
          },
          {
            onStarted: ({ chat }) => {
              const c = chat as { id?: string } | null;
              if (typeof c?.id === "string") setChatId(c.id);
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
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId && m.thought && !m.thoughtFinishedAt
                    ? { ...m, thoughtFinishedAt: respondedAt }
                    : m
                )
              );
            },
            onCompleted: ({ transport }) => {
              if (pendingDelta.raf) cancelAnimationFrame(pendingDelta.raf);
              flushDelta();
              const t = transport as {
                assistantMessage?: { id?: string; attachments?: ChatAttachment[] };
              } | null;
              const newAssistantId =
                typeof t?.assistantMessage?.id === "string" ? t.assistantMessage.id : null;
              const assistantAttachments =
                Array.isArray(t?.assistantMessage?.attachments) &&
                t.assistantMessage.attachments.length > 0
                  ? (t.assistantMessage.attachments as ChatAttachment[])
                  : undefined;
              if (newAssistantId) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          id: newAssistantId,
                          status: "committed" as const,
                          attachments: assistantAttachments
                        }
                      : m
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
            onFailed: (payload) => {
              setIssue(toWebChatUxIssue(payload));
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
    [getToken, isStreaming]
  );

  const loadHistory = useCallback(
    async (targetChatId: string) => {
      if (historyLoadedRef.current.has(targetChatId)) return;
      const token = await getToken();
      if (!token) return;

      setHistoryLoading(true);
      try {
        const page = await getChatMessages(token, targetChatId, undefined, 20);
        const loaded: ChatMessage[] = page.messages
          .filter((m) => m.content !== WELCOME_TURN_SENTINEL)
          .map((m) => ({
            id: m.id,
            role: m.author === "system" ? "assistant" : m.author,
            content: m.content,
            status: "committed" as const,
            attachments: m.attachments.length > 0 ? (m.attachments as ChatAttachment[]) : undefined
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
        status: "committed" as const,
        attachments: m.attachments.length > 0 ? (m.attachments as ChatAttachment[]) : undefined
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
    sendWelcome,
    stop,
    clearIssue,
    reportIssue,
    loadHistory,
    loadOlderMessages
  };
}
