"use client";

import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import {
  compactChat,
  getChatMessages,
  getChatCompactionState,
  stageWebChatAttachment,
  streamAssistantWebChatTurn,
  toWebChatUxIssue,
  uploadAssistantKnowledgeSource,
  WELCOME_THREAD_KEY,
  WELCOME_TURN_SENTINEL,
  type ChatHistoryAttachment,
  type ChatCompactionResult,
  type ChatCompactionState,
  type WebChatUxIssue
} from "../assistant-api-client";
import { isKnowledgeEligibleFile } from "../chat-file-policy";
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

export interface RecentAutoCompactionNotice {
  detectedAt: string;
  tokensBefore: number | null;
  tokensAfter: number | null;
}

export type ChatEntry =
  | { kind: "message"; message: ChatMessage }
  | { kind: "activity"; event: ActivityEvent };

function createClientTurnId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export interface UseChatReturn {
  entries: ChatEntry[];
  messages: ChatMessage[];
  chatId: string | null;
  isStreaming: boolean;
  historyLoading: boolean;
  hasOlderMessages: boolean;
  olderMessagesLoading: boolean;
  issue: WebChatUxIssue | null;
  compaction: ChatCompactionState | null;
  recentAutoCompaction: RecentAutoCompactionNotice | null;
  compactionRunning: boolean;
  send: (text: string, files?: File[], options?: ChatSendOptions) => Promise<void>;
  sendWelcome: (locale: string) => Promise<void>;
  compactNow: (instructions?: string) => Promise<ChatCompactionResult | null>;
  stop: () => void;
  clearIssue: () => void;
  reportIssue: (error: unknown) => void;
  loadHistory: (chatId: string) => Promise<void>;
  loadOlderMessages: () => Promise<void>;
}

type RuntimeTransportMeta = {
  respondedAt?: string;
  degradedByQuotaFallback?: boolean;
  quotaFallbackReason?: "token_budget_limit_reached" | null;
  quotaFallbackModel?: string | null;
  turnRouting?: {
    mode: "shadow" | "active";
    executionMode: "normal" | "premium" | "reasoning";
    source: "precheck" | "llm" | "fallback";
  } | null;
};

export interface ChatSendOptions {
  addToKnowledgeBase?: boolean | undefined;
  deepModeEnabled?: boolean | undefined;
}

type LiveActivitySource = "tool" | "compaction" | "runtime";

type LiveActivityEvent = ActivityEvent & {
  source: LiveActivitySource;
};

const TOOL_ACTIVITY_COPY: Record<
  string,
  {
    start: string;
    end: string;
    failure: string;
  }
> = {
  web_search: {
    start: "Searching the web",
    end: "Web results ready",
    failure: "Web search failed"
  },
  web_fetch: {
    start: "Reading the page",
    end: "Page ready",
    failure: "Page read failed"
  },
  browser: {
    start: "Working in browser",
    end: "Browser step done",
    failure: "Browser step failed"
  },
  image_generate: {
    start: "Generating image",
    end: "Image ready",
    failure: "Image generation failed"
  },
  image_edit: {
    start: "Editing image",
    end: "Edited image ready",
    failure: "Image edit failed"
  },
  video_generate: {
    start: "Generating video",
    end: "Video ready",
    failure: "Video generation failed"
  },
  tts: {
    start: "Recording voice",
    end: "Voice ready",
    failure: "Voice generation failed"
  },
  scheduled_action: {
    start: "Scheduling task",
    end: "Task scheduled",
    failure: "Task scheduling failed"
  }
};

function buildToolLiveActivity(params: {
  assistantMessageId: string;
  toolName: string;
  phase: "start" | "end";
  isError: boolean;
}): LiveActivityEvent {
  const copy = TOOL_ACTIVITY_COPY[params.toolName];
  const label =
    copy === undefined
      ? params.phase === "start"
        ? `Using ${params.toolName}`
        : params.isError
          ? `${params.toolName} failed`
          : `${params.toolName} finished`
      : params.phase === "start"
        ? copy.start
        : params.isError
          ? copy.failure
          : copy.end;

  return {
    id: `activity-live-tool-${Date.now()}-${params.phase}-${params.toolName}`,
    type: "tool_use",
    label,
    afterMessageId: params.assistantMessageId,
    emphasis: "strong",
    source: "tool"
  };
}

function buildCompactionLiveActivity(params: {
  assistantMessageId: string;
  phase: "start" | "end";
  detail?: string | undefined;
  label: string;
}): LiveActivityEvent {
  return {
    id: `activity-live-compaction-${Date.now()}-${params.phase}`,
    type: "system",
    label: params.label,
    ...(params.detail ? { detail: params.detail } : {}),
    afterMessageId: params.assistantMessageId,
    emphasis: "strong",
    source: "compaction"
  };
}

function buildRuntimeLiveActivity(params: {
  assistantMessageId: string;
  respondedAt: string;
  detail?: string | undefined;
}): LiveActivityEvent {
  return {
    id: `activity-live-runtime-${Date.now()}`,
    type: "runtime_done",
    label: "Response generated",
    detail:
      params.detail ??
      new Date(params.respondedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      }),
    timestamp: params.respondedAt,
    afterMessageId: params.assistantMessageId,
    emphasis: "strong",
    source: "runtime"
  };
}

export function formatTurnRoutingBadgeLabel(
  turnRouting: NonNullable<RuntimeTransportMeta["turnRouting"]>
): string {
  return `${turnRouting.executionMode} (${turnRouting.source})`;
}

function appendQuotaFallbackActivity(params: {
  setActivities: React.Dispatch<React.SetStateAction<ActivityEvent[]>>;
  runtime: RuntimeTransportMeta | null | undefined;
  assistantMessageId: string | null;
}): void {
  const runtime = params.runtime;
  if (runtime?.degradedByQuotaFallback !== true) {
    return;
  }
  const detail = runtime.quotaFallbackModel
    ? `using ${runtime.quotaFallbackModel}`
    : "using the safe fallback model";
  params.setActivities((prev) => [
    ...prev,
    {
      id: `activity-quota-fallback-${Date.now()}`,
      type: "info",
      label: "Fallback mode active",
      detail,
      ...(runtime.respondedAt ? { timestamp: runtime.respondedAt } : {}),
      ...(params.assistantMessageId ? { afterMessageId: params.assistantMessageId } : {})
    }
  ]);
}

function buildKnowledgeUploadActivity(params: {
  afterMessageId?: string | undefined;
  readyCount: number;
  failedCount: number;
  t: (key: string, values?: Record<string, string | number | Date>) => string;
}): ActivityEvent {
  const label =
    params.failedCount === 0
      ? params.t("knowledgeUploadReady")
      : params.readyCount === 0
        ? params.t("knowledgeUploadFailed")
        : params.t("knowledgeUploadPartial");
  const detail =
    params.failedCount === 0
      ? params.t("knowledgeUploadReadyDetail", {
          count: params.readyCount
        })
      : params.readyCount === 0
        ? params.t("knowledgeUploadFailedDetail")
        : params.t("knowledgeUploadPartialDetail", {
            readyCount: params.readyCount,
            failedCount: params.failedCount
          });
  return {
    id: `activity-knowledge-upload-${Date.now()}`,
    type: params.failedCount === 0 ? "info" : "system",
    label,
    detail,
    ...(params.afterMessageId ? { afterMessageId: params.afterMessageId } : {})
  };
}

export function useChat(threadKey: string): UseChatReturn {
  const { getToken } = useAuth();
  const t = useTranslations("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [liveActivitiesByMessageId, setLiveActivitiesByMessageId] = useState<
    Record<string, LiveActivityEvent>
  >({});
  const [shadowRoutingLabelsByMessageId, setShadowRoutingLabelsByMessageId] = useState<
    Record<string, string>
  >({});
  const [chatId, setChatId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [olderMessagesLoading, setOlderMessagesLoading] = useState(false);
  const [issue, setIssue] = useState<WebChatUxIssue | null>(null);
  const [compaction, setCompaction] = useState<ChatCompactionState | null>(null);
  const [recentAutoCompaction, setRecentAutoCompaction] =
    useState<RecentAutoCompactionNotice | null>(null);
  const [compactionRunning, setCompactionRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const historyLoadedRef = useRef<Set<string>>(new Set());
  const olderCursorRef = useRef<string | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const prevThreadKeyRef = useRef(threadKey);

  if (prevThreadKeyRef.current !== threadKey) {
    prevThreadKeyRef.current = threadKey;
    setMessages([]);
    setActivities([]);
    setLiveActivitiesByMessageId({});
    setShadowRoutingLabelsByMessageId({});
    setChatId(null);
    setIssue(null);
    setCompaction(null);
    setRecentAutoCompaction(null);
    setCompactionRunning(false);
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

  const refreshCompactionState = useCallback(
    async (
      targetChatId: string,
      options?: { baselineCompaction?: ChatCompactionState | null | undefined }
    ) => {
      const token = await getToken();
      if (!token) return;
      try {
        const next = await getChatCompactionState(token, targetChatId);
        setCompaction(next);
        const baseline = options?.baselineCompaction ?? null;
        if (
          baseline !== null &&
          next.autoCompactionEnabled &&
          next.compactionCount > baseline.compactionCount
        ) {
          setRecentAutoCompaction({
            detectedAt: new Date().toISOString(),
            tokensBefore: baseline.currentTokens ?? null,
            tokensAfter: next.currentTokens ?? null
          });
        }
      } catch {
        /* non-critical */
      }
    },
    [getToken]
  );

  const compactNow = useCallback(
    async (instructions?: string): Promise<ChatCompactionResult | null> => {
      const targetChatId = activeChatIdRef.current ?? chatId;
      if (!targetChatId || compactionRunning || isStreaming) {
        return null;
      }
      setRecentAutoCompaction(null);
      const token = await getToken();
      if (!token) {
        setIssue(toWebChatUxIssue(t("sessionExpired")));
        return null;
      }
      setCompactionRunning(true);
      try {
        const response = await compactChat(token, targetChatId, instructions);
        setIssue(null);
        setCompaction(response.state);
        const compactDetail =
          response.result.tokensBefore !== null && response.result.tokensAfter !== null
            ? t("compactionDetailTokens", {
                before: response.result.tokensBefore,
                after: response.result.tokensAfter
              })
            : (response.result.reason ?? null);
        const anchorId = messages[messages.length - 1]?.id;
        setActivities((prev) => [
          ...prev,
          {
            id: `activity-compaction-manual-${Date.now()}`,
            type: "system",
            label: response.result.compacted
              ? t("compactionManualSuccess")
              : t("compactionManualSkipped"),
            ...(compactDetail ? { detail: compactDetail } : {}),
            ...(anchorId ? { afterMessageId: anchorId } : {})
          }
        ]);
        return response.result;
      } catch (error) {
        setIssue(toWebChatUxIssue(error));
        return null;
      } finally {
        setCompactionRunning(false);
      }
    },
    [chatId, compactionRunning, getToken, isStreaming, messages, t]
  );

  const send = useCallback(
    async (text: string, files?: File[], options?: ChatSendOptions) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || isStreaming) return;
      const compactionBeforeTurn = compaction;

      const token = await getToken();
      if (token === null) {
        setIssue(toWebChatUxIssue(t("sessionExpired")));
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
      const clientTurnId = createClientTurnId();
      const controller = new AbortController();
      abortRef.current = controller;
      const knowledgeEligibleFiles =
        options?.addToKnowledgeBase === true
          ? pendingFiles.filter((file) => isKnowledgeEligibleFile(file))
          : [];
      let knowledgeActivityAnchorId = userMsgId;

      setIsStreaming(true);
      setIssue(null);
      setRecentAutoCompaction(null);

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
        } catch (error) {
          setIssue(toWebChatUxIssue(error));
          setIsStreaming(false);
          abortRef.current = null;
          return;
        }
      }

      if (knowledgeEligibleFiles.length > 0) {
        void (async () => {
          const results = await Promise.allSettled(
            knowledgeEligibleFiles.map((file) => uploadAssistantKnowledgeSource(token, file))
          );
          const readyCount = results.filter((result) => result.status === "fulfilled").length;
          const failedResults = results.filter(
            (result): result is PromiseRejectedResult => result.status === "rejected"
          );
          if (readyCount === 0 && failedResults.length === 0) {
            return;
          }
          setActivities((prev) => [
            ...prev,
            buildKnowledgeUploadActivity({
              afterMessageId: knowledgeActivityAnchorId,
              readyCount,
              failedCount: failedResults.length,
              t
            })
          ]);
          if (failedResults.length > 0 && readyCount === 0) {
            const firstFailure = failedResults[0];
            if (!firstFailure) {
              return;
            }
            const firstIssue = toWebChatUxIssue(firstFailure.reason);
            setIssue(
              firstIssue.classId === "unknown"
                ? {
                    classId: "unknown",
                    message: t("knowledgeUploadFailed"),
                    guidance: t("knowledgeUploadFailedDetail")
                  }
                : firstIssue
            );
          }
        })();
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

      const cancelBufferedAssistantFlush = () => {
        if (pendingDelta.raf) {
          cancelAnimationFrame(pendingDelta.raf);
          pendingDelta.raf = 0;
        }
        if (pendingThought.raf) {
          cancelAnimationFrame(pendingThought.raf);
          pendingThought.raf = 0;
        }
      };

      const flushBufferedAssistantState = (forceBoundaryCommit = false) => {
        const hasPendingText = pendingDelta.text.length > 0;
        const hasPendingThought = pendingThought.text.length > 0;
        cancelBufferedAssistantFlush();
        if (!hasPendingText && !hasPendingThought) {
          return;
        }
        const commit = () => {
          flushDelta();
          flushThought();
        };
        if (forceBoundaryCommit) {
          flushSync(commit);
          return;
        }
        commit();
      };

      try {
        await streamAssistantWebChatTurn(
          token,
          {
            surfaceThreadKey: threadKey,
            message: trimmed,
            clientTurnId,
            ...(options?.deepModeEnabled === undefined
              ? {}
              : { deepModeEnabled: options.deepModeEnabled })
          },
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
            onTool: ({ phase, toolName, isError }) => {
              flushBufferedAssistantState(true);
              setLiveActivitiesByMessageId((prev) => ({
                ...prev,
                [assistantMsgId]: buildToolLiveActivity({
                  assistantMessageId: assistantMsgId,
                  toolName,
                  phase,
                  isError
                })
              }));
            },
            onCompaction: ({ phase, completed, willRetry }) => {
              flushBufferedAssistantState(true);
              setCompactionRunning(phase === "start" || willRetry);
              const activityDetail = willRetry ? t("compactionWillRetry") : null;
              setLiveActivitiesByMessageId((prev) => ({
                ...prev,
                [assistantMsgId]: buildCompactionLiveActivity({
                  assistantMessageId: assistantMsgId,
                  phase,
                  detail: activityDetail ?? undefined,
                  label:
                    phase === "start"
                      ? t("compactionPhaseStart")
                      : completed
                        ? t("compactionPhaseDone")
                        : t("compactionPhaseEnded")
                })
              }));
            },
            onRuntimeDone: ({ respondedAt }) => {
              flushBufferedAssistantState(true);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId && m.thought && !m.thoughtFinishedAt
                    ? { ...m, thoughtFinishedAt: respondedAt }
                    : m
                )
              );
              setLiveActivitiesByMessageId((prev) => {
                const current = prev[assistantMsgId];
                if (current?.source === "tool") {
                  return prev;
                }
                return {
                  ...prev,
                  [assistantMsgId]: buildRuntimeLiveActivity({
                    assistantMessageId: assistantMsgId,
                    respondedAt
                  })
                };
              });
            },
            onCompleted: ({ transport }) => {
              flushBufferedAssistantState(true);
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
                runtime?: RuntimeTransportMeta;
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
              if (realUserMsgId && realUserMsgId !== userMsgId) {
                knowledgeActivityAnchorId = realUserMsgId;
                setActivities((prev) =>
                  prev.map((a) =>
                    a.afterMessageId === userMsgId ? { ...a, afterMessageId: realUserMsgId } : a
                  )
                );
              }
              if (newAssistantId) {
                setActivities((prev) =>
                  prev.map((a) =>
                    a.afterMessageId === assistantMsgId
                      ? { ...a, afterMessageId: newAssistantId }
                      : a
                  )
                );
              }
              const resolvedAssistantMessageId = newAssistantId ?? assistantMsgId;
              if (newAssistantId) {
                setShadowRoutingLabelsByMessageId((prev) => {
                  const current = prev[assistantMsgId];
                  if (!current || newAssistantId === assistantMsgId) {
                    return prev;
                  }
                  const next = { ...prev };
                  delete next[assistantMsgId];
                  next[newAssistantId] = current;
                  return next;
                });
              }
              setLiveActivitiesByMessageId((prev) => {
                let next = prev;
                if (newAssistantId) {
                  const current = prev[assistantMsgId];
                  if (current && newAssistantId !== assistantMsgId) {
                    next = { ...prev };
                    delete next[assistantMsgId];
                    next[newAssistantId] = {
                      ...current,
                      afterMessageId: newAssistantId
                    };
                  }
                }
                return next;
              });
              if (t?.runtime?.turnRouting?.mode === "shadow") {
                const routingLabel = formatTurnRoutingBadgeLabel(t.runtime.turnRouting);
                setShadowRoutingLabelsByMessageId((prev) => ({
                  ...prev,
                  [assistantMsgId]: routingLabel,
                  [resolvedAssistantMessageId]: routingLabel
                }));
              }
              appendQuotaFallbackActivity({
                setActivities,
                runtime: t?.runtime,
                assistantMessageId: resolvedAssistantMessageId
              });
              const resolvedChatId =
                typeof t?.userMessage?.chatId === "string"
                  ? t.userMessage.chatId
                  : activeChatIdRef.current;
              if (resolvedChatId) {
                void refreshCompactionState(resolvedChatId, {
                  baselineCompaction: compactionBeforeTurn
                });
              }

              // Files are already staged before the stream — no post-stream upload needed
            },
            onInterrupted: () => {
              flushBufferedAssistantState();
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
              flushBufferedAssistantState();
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
        flushBufferedAssistantState();
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
    [compaction, getToken, isStreaming, refreshCompactionState, t, threadKey]
  );

  const sendWelcome = useCallback(
    async (locale: string) => {
      if (isStreaming) return;
      const token = await getToken();
      if (token === null) {
        setIssue(toWebChatUxIssue(t("sessionExpired")));
        return;
      }

      const assistantMsgId = `local-assistant-welcome-${Date.now()}`;
      const clientTurnId = createClientTurnId();
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

      const cancelBufferedAssistantFlush = () => {
        if (pendingDelta.raf) {
          cancelAnimationFrame(pendingDelta.raf);
          pendingDelta.raf = 0;
        }
      };

      const flushBufferedAssistantState = (forceBoundaryCommit = false) => {
        const hasPendingText = pendingDelta.text.length > 0;
        cancelBufferedAssistantFlush();
        if (!hasPendingText) {
          return;
        }
        if (forceBoundaryCommit) {
          flushSync(flushDelta);
          return;
        }
        flushDelta();
      };

      try {
        await streamAssistantWebChatTurn(
          token,
          {
            surfaceThreadKey: WELCOME_THREAD_KEY,
            message: "",
            clientTurnId,
            title: locale === "ru" ? "Добро пожаловать" : "Welcome",
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
              flushBufferedAssistantState(true);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId && m.thought && !m.thoughtFinishedAt
                    ? { ...m, thoughtFinishedAt: respondedAt }
                    : m
                )
              );
            },
            onCompleted: ({ transport }) => {
              flushBufferedAssistantState(true);
              const t = transport as {
                assistantMessage?: { id?: string; attachments?: ChatAttachment[] };
                runtime?: RuntimeTransportMeta;
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
              const resolvedAssistantMessageId = newAssistantId ?? assistantMsgId;
              if (t?.runtime?.turnRouting?.mode === "shadow") {
                const routingLabel = formatTurnRoutingBadgeLabel(t.runtime.turnRouting);
                setShadowRoutingLabelsByMessageId((prev) => ({
                  ...prev,
                  [assistantMsgId]: routingLabel,
                  [resolvedAssistantMessageId]: routingLabel
                }));
              }
              appendQuotaFallbackActivity({
                setActivities,
                runtime: t?.runtime,
                assistantMessageId: resolvedAssistantMessageId
              });
            },
            onInterrupted: () => {
              flushBufferedAssistantState();
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, status: m.content.trim().length > 0 ? "partial" : "streaming" }
                    : m
                )
              );
            },
            onFailed: (payload) => {
              flushBufferedAssistantState();
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
        flushBufferedAssistantState();
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
    [compaction, getToken, isStreaming, t]
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
        void refreshCompactionState(targetChatId);
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

  const latestAssistantMessageId =
    [...messages].reverse().find((message) => message.role === "assistant")?.id ?? null;
  const entries: ChatEntry[] = [];
  const activityByMsg = new Map<string, ActivityEvent[]>();
  const orphanActivities: ActivityEvent[] = [];
  for (const a of activities) {
    if (a.afterMessageId) {
      const list = activityByMsg.get(a.afterMessageId) ?? [];
      list.push(a);
      activityByMsg.set(a.afterMessageId, list);
    } else {
      orphanActivities.push(a);
    }
  }
  for (const m of messages) {
    entries.push({ kind: "message", message: m });
    const live = liveActivitiesByMessageId[m.id];
    if (live && m.id === latestAssistantMessageId) {
      const shadowRoutingLabel = shadowRoutingLabelsByMessageId[m.id];
      entries.push({
        kind: "activity",
        event: shadowRoutingLabel === undefined ? live : { ...live, shadowRoutingLabel }
      });
    }
    const linked = activityByMsg.get(m.id);
    if (linked) {
      for (const ev of linked) entries.push({ kind: "activity", event: ev });
    }
  }
  for (const ev of orphanActivities) {
    entries.push({ kind: "activity", event: ev });
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
    compaction,
    recentAutoCompaction,
    compactionRunning,
    send,
    sendWelcome,
    compactNow,
    stop,
    clearIssue,
    reportIssue,
    loadHistory,
    loadOlderMessages
  };
}
