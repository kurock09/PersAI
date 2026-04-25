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
  stopAssistantWebChatTurn,
  streamAssistantWebChatTurn,
  toWebChatUxIssue,
  uploadAssistantKnowledgeSource,
  WELCOME_THREAD_KEY,
  WELCOME_TURN_SENTINEL,
  XhrAbortError,
  XhrNetworkError,
  XhrStallError,
  XhrTimeoutError,
  type ChatHistoryAttachment,
  type ChatCompactionResult,
  type ChatCompactionState,
  type WebChatUxIssue
} from "../assistant-api-client";
import { isKnowledgeEligibleFile } from "../chat-file-policy";
import type { ActivityEvent } from "./activity-badge";
import { useStreamingThreadsRegistry } from "./streaming-threads";

/**
 * Pre-headers timeout (ms) for `streamAssistantWebChatTurn`. If the server
 * does not return 2xx headers within this window, the request is aborted
 * and the user bubble flips to "send_failed". 10s is well above normal
 * server response time but short enough to feel responsive on flaky
 * mobile networks. (ADR-075 § "Single-slot pending send".)
 */
const HEADERS_TIMEOUT_MS = 10_000;
/** Stall watchdog for attachment uploads — see uploadWithProgress. */
const STAGE_STALL_TIMEOUT_MS = 15_000;
/** Hard upper bound for a single attachment upload. */
const STAGE_HARD_TIMEOUT_MS = 5 * 60_000;

export type ChatMessageRole = "user" | "assistant";
/**
 * Lifecycle of a message bubble.
 *
 * "sending" / "send_failed" are the new pending-slot states from
 * ADR-075 § "Single-slot pending send". Only user bubbles can be in those
 * states; assistant bubbles still go committed → streaming → partial.
 *
 * - "sending"     : optimistic user message, request is in-flight (staging
 *                   attachments and/or waiting for the stream to return 2xx
 *                   headers). Composer is disabled, no second send allowed.
 * - "send_failed" : pre-headers failure (offline / stall / 10s timeout / etc).
 *                   Bubble shows a small red exclamation with Retry / Cancel
 *                   inline; composer stays disabled until user resolves it.
 */
export type ChatMessageStatus = "committed" | "streaming" | "partial" | "sending" | "send_failed";

export type PendingSendStatus = "sending" | "send_failed";

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
  /**
   * Current pending-send slot state, or null when no message is awaiting
   * delivery confirmation. See ADR-075 § "Single-slot pending send".
   */
  pendingSendStatus: PendingSendStatus | null;
  /** Retry the failed pending send. No-op if there is no failed bubble. */
  retryPendingSend: () => Promise<void>;
  /**
   * Cancel the failed pending send. Removes the failed bubble and returns
   * the original draft text so the composer can restore it. Returns null
   * if there was nothing to cancel.
   */
  cancelPendingSend: () => string | null;
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
  // Slice 1.1 — per-thread streaming flag.
  //
  // `isStreaming` used to be a single `useState(false)` local to this hook.
  // That meant Chat A's in-flight stream blocked the composer in Chat B as
  // soon as the user switched threads. We now lift "which threads are
  // streaming?" into a shared registry keyed by `surfaceThreadKey`, so each
  // thread has its own independent boolean and AbortController.
  // See `streaming-threads.tsx`.
  const { activeThreads, markStreaming } = useStreamingThreadsRegistry();
  const isStreaming = activeThreads.has(threadKey);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [olderMessagesLoading, setOlderMessagesLoading] = useState(false);
  const [issue, setIssue] = useState<WebChatUxIssue | null>(null);
  const [compaction, setCompaction] = useState<ChatCompactionState | null>(null);
  const [recentAutoCompaction, setRecentAutoCompaction] =
    useState<RecentAutoCompactionNotice | null>(null);
  const [compactionRunning, setCompactionRunning] = useState(false);
  const [pendingSendStatus, setPendingSendStatusState] = useState<PendingSendStatus | null>(null);
  // Slice 1.1 — abort controllers are per-thread now (was a single `useRef`).
  // The single ref clobbered itself when Chat A's stream cleaned up while
  // Chat B was already mid-flight, which made `stop()` either no-op or abort
  // the wrong stream. Keying by `threadKey` keeps each turn's controller
  // independent until *its* stream completes or the user explicitly stops it
  // from that thread's view.
  //
  // Slice 1.2 — each entry now also carries the `clientTurnId` of the
  // turn it owns. `stop()` needs the id to call the new
  // `stopAssistantWebChatTurn` API (see `assistant-api-client.ts`); see
  // the `stop` callback below for why this distinction matters
  // (soft-detach vs hard-stop).
  const abortControllersByThreadRef = useRef<
    Map<string, { controller: AbortController; clientTurnId: string }>
  >(new Map());
  const historyLoadedRef = useRef<Set<string>>(new Set());
  const olderCursorRef = useRef<string | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const prevThreadKeyRef = useRef(threadKey);
  // Single-slot pending send (ADR-075). Holds enough info to either retry the
  // exact same payload or cancel and restore the draft text.
  const pendingSendRef = useRef<{
    text: string;
    files: File[];
    options?: ChatSendOptions | undefined;
    userMsgId: string;
    assistantMsgId: string | null;
  } | null>(null);
  const pendingSendStatusRef = useRef<PendingSendStatus | null>(null);
  const setPendingSendStatus = useCallback((next: PendingSendStatus | null) => {
    pendingSendStatusRef.current = next;
    setPendingSendStatusState(next);
  }, []);

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
    // Failed pending sends are intentionally per-thread and in-memory only
    // (ADR-075): switching chats discards a failed bubble rather than carrying
    // it across threads. Voice/file blobs we held in pendingSendRef.files go
    // out of scope here too.
    pendingSendRef.current = null;
    pendingSendStatusRef.current = null;
    setPendingSendStatusState(null);
  }

  const stop = useCallback(() => {
    // Per-thread stop: abort only the stream attached to the thread the
    // user is currently looking at. Streams in other threads keep going so
    // switching away from a generating image doesn't kill it.
    //
    // Slice 1.2 — `stop()` is the *user-visible* hard-stop affordance
    // (the Stop button on the composer). The API can no longer infer
    // hard-stop from a dead SSE socket, because that signal also fires
    // for soft-detach cases like locking the screen mid-image-generate.
    // So before tearing down the local controller we send an explicit
    // `POST /assistant/chat/web/stop` with the in-flight `clientTurnId`,
    // which is the only path that flips the server-side abort signal.
    // The POST is best-effort and intentionally not awaited: a failure
    // here just means the runtime keeps generating in the background
    // (the same fate as a soft-detach), which is strictly safer than
    // the pre-Slice-1.2 "always kill on any disconnect" default.
    const entry = abortControllersByThreadRef.current.get(threadKey);
    if (entry === undefined) {
      return;
    }
    const { controller, clientTurnId } = entry;
    void (async () => {
      try {
        const token = await getToken();
        if (token === null || token === undefined) {
          return;
        }
        await stopAssistantWebChatTurn(token, clientTurnId);
      } catch {
        // Swallow; local abort below is the user-visible guarantee.
      }
    })();
    controller.abort();
    abortControllersByThreadRef.current.delete(threadKey);
  }, [threadKey, getToken]);

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
      // While a previous send is in send_failed state the composer must stay
      // single-slot — the user has to Retry or Cancel it before another send
      // can start. (ADR-075 § "Single-slot pending send".)
      if (pendingSendStatusRef.current === "send_failed") return;
      // Capture the thread key at send time so every subsequent
      // markStreaming / abort-map mutation in this turn targets the *originating*
      // thread, even if the user navigates away mid-stream.
      const sendThreadKey = threadKey;
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
      abortControllersByThreadRef.current.set(sendThreadKey, { controller, clientTurnId });
      // Helper used at every cleanup point to drop *this* turn's controller
      // without disturbing a newer controller that may have replaced it
      // (e.g. user retried fast, or another turn started in the same thread).
      const releaseAbortController = () => {
        const entry = abortControllersByThreadRef.current.get(sendThreadKey);
        if (entry !== undefined && entry.controller === controller) {
          abortControllersByThreadRef.current.delete(sendThreadKey);
        }
      };
      const knowledgeEligibleFiles =
        options?.addToKnowledgeBase === true
          ? pendingFiles.filter((file) => isKnowledgeEligibleFile(file))
          : [];
      let knowledgeActivityAnchorId = userMsgId;

      // Helper used by every pre-headers failure path (offline / staging
      // stall / 10s headers timeout / network error) to flip the optimistic
      // user bubble into "send_failed", drop the assistant placeholder if it
      // was rendered, and arm the single-slot retry/cancel UX.
      const sendFailedCleanup = (assistantWasMounted: boolean): void => {
        setMessages((prev) =>
          prev.flatMap((m) => {
            if (assistantWasMounted && m.id === assistantMsgId) return [];
            if (m.id === userMsgId) return [{ ...m, status: "send_failed" as const }];
            return [m];
          })
        );
        pendingSendRef.current = {
          text: trimmed,
          files: pendingFiles,
          options: options ?? undefined,
          userMsgId,
          assistantMsgId: null
        };
        setPendingSendStatus("send_failed");
      };

      const userMsgBase: Omit<ChatMessage, "status"> = {
        id: userMsgId,
        role: "user",
        content: trimmed,
        attachments: localAttachments.length > 0 ? localAttachments : undefined
      };

      // Cold offline pre-flight. We deliberately do NOT call markStreaming
      // here — there's no in-flight stream — so the chat-input renders the
      // pending-send helper line, not the "stop" button.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        const failedUserMsg: ChatMessage = { ...userMsgBase, status: "send_failed" };
        setMessages((prev) => [...prev, failedUserMsg]);
        pendingSendRef.current = {
          text: trimmed,
          files: pendingFiles,
          options: options ?? undefined,
          userMsgId,
          assistantMsgId: null
        };
        setPendingSendStatus("send_failed");
        releaseAbortController();
        return;
      }

      markStreaming(sendThreadKey, true);
      setIssue(null);
      setRecentAutoCompaction(null);

      const userMsg: ChatMessage = { ...userMsgBase, status: "sending" };
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
      pendingSendRef.current = {
        text: trimmed,
        files: pendingFiles,
        options: options ?? undefined,
        userMsgId,
        assistantMsgId
      };
      setPendingSendStatus("sending");

      if (pendingFiles.length > 0) {
        try {
          for (let i = 0; i < pendingFiles.length; i++) {
            const file = pendingFiles[i]!;
            // Stall watchdog: 15s without an upload-progress event aborts.
            // Hard upper bound: 5 minutes (covers very slow but progressing
            // uploads on weak mobile signal). Both come from ADR-075.
            const staged = await stageWebChatAttachment(token, threadKey, file, {
              signal: controller.signal,
              stallTimeoutMs: STAGE_STALL_TIMEOUT_MS,
              hardTimeoutMs: STAGE_HARD_TIMEOUT_MS
            });
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
          // Staging never reached server-confirmed state. Treat all of
          // stall/timeout/abort/network/HTTP as a pre-headers failure and
          // route through the pending-slot UI instead of an issue banner.
          // (Real server-side validation errors that DID return a structured
          // envelope still come back here; for those we keep the issue banner
          // so users get the proper guidance copy in addition to the bubble.)
          if (
            !(error instanceof XhrStallError) &&
            !(error instanceof XhrTimeoutError) &&
            !(error instanceof XhrAbortError) &&
            !(error instanceof XhrNetworkError)
          ) {
            setIssue(toWebChatUxIssue(error));
          }
          sendFailedCleanup(true);
          markStreaming(sendThreadKey, false);
          releaseAbortController();
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

      // Pre-headers watchdog: if the server never returns 2xx headers within
      // HEADERS_TIMEOUT_MS, abort the request so the bubble flips to
      // "send_failed" instead of hanging indefinitely. Tool turns can stay
      // silent for tens of seconds AFTER headers, which is fine — we only
      // measure up to the headers, not to the first SSE event.
      let headersOk = false;
      const headersTimer = setTimeout(() => {
        if (!headersOk) {
          try {
            controller.abort();
          } catch {
            /* ignore */
          }
        }
      }, HEADERS_TIMEOUT_MS);

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
            onHeadersOk: () => {
              headersOk = true;
              clearTimeout(headersTimer);
              // Server accepted the request — clear the pending-slot UI.
              setMessages((prev) =>
                prev.map((m) => (m.id === userMsgId ? { ...m, status: "committed" as const } : m))
              );
              pendingSendRef.current = null;
              setPendingSendStatus(null);
            },
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
            onStreamReset: () => {
              cancelBufferedAssistantFlush();
              pendingDelta.text = "";
              pendingThought.text = "";
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantMsgId ? { ...m, content: "" } : m))
              );
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
                  content?: string;
                  attachments?: ChatAttachment[];
                };
                runtime?: RuntimeTransportMeta;
              } | null;
              const realUserMsgId =
                typeof t?.userMessage?.id === "string" ? t.userMessage.id : null;
              const newAssistantId =
                typeof t?.assistantMessage?.id === "string" ? t.assistantMessage.id : null;
              const authoritativeAssistantContent =
                typeof t?.assistantMessage?.content === "string"
                  ? t.assistantMessage.content
                  : null;
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
                  if (m.id === assistantMsgId) {
                    return {
                      ...m,
                      ...(newAssistantId ? { id: newAssistantId } : {}),
                      ...(authoritativeAssistantContent !== null
                        ? { content: authoritativeAssistantContent }
                        : {}),
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
            onInterrupted: ({ transport }) => {
              flushBufferedAssistantState();
              const interruptedAt = new Date().toISOString();
              const t = transport as {
                assistantMessage?: {
                  id?: string;
                  content?: string;
                };
              } | null;
              const newAssistantId =
                typeof t?.assistantMessage?.id === "string" ? t.assistantMessage.id : null;
              const authoritativeAssistantContent =
                typeof t?.assistantMessage?.content === "string"
                  ? t.assistantMessage.content
                  : null;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? (() => {
                        const nextContent = authoritativeAssistantContent ?? m.content;
                        return {
                          ...m,
                          ...(newAssistantId ? { id: newAssistantId } : {}),
                          ...(authoritativeAssistantContent !== null
                            ? { content: authoritativeAssistantContent }
                            : {}),
                          status: nextContent.trim().length > 0 ? "partial" : "streaming",
                          thoughtFinishedAt:
                            m.thought && !m.thoughtFinishedAt
                              ? interruptedAt
                              : (m.thoughtFinishedAt ?? null)
                        };
                      })()
                    : m
                )
              );
            },
            onFailed: (payload) => {
              flushBufferedAssistantState();
              setIssue(toWebChatUxIssue(payload));
              const failedAt = new Date().toISOString();
              const t = payload.transport as {
                assistantMessage?: {
                  id?: string;
                  content?: string;
                };
              } | null;
              const newAssistantId =
                typeof t?.assistantMessage?.id === "string" ? t.assistantMessage.id : null;
              const authoritativeAssistantContent =
                typeof t?.assistantMessage?.content === "string"
                  ? t.assistantMessage.content
                  : null;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        ...(newAssistantId ? { id: newAssistantId } : {}),
                        ...(authoritativeAssistantContent !== null
                          ? { content: authoritativeAssistantContent }
                          : {}),
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
        clearTimeout(headersTimer);
        flushBufferedAssistantState();
        if (!headersOk) {
          // Pre-headers failure: the request was aborted or never reached the
          // server. The whole turn is "didn't fly" — flip the user bubble to
          // send_failed and drop the unused assistant placeholder. Skip the
          // existing issue banner: the bubble + composer helper carry the UX.
          sendFailedCleanup(true);
        } else {
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
        }
      } finally {
        clearTimeout(headersTimer);
        markStreaming(sendThreadKey, false);
        releaseAbortController();
      }
    },
    [
      compaction,
      getToken,
      isStreaming,
      markStreaming,
      refreshCompactionState,
      setPendingSendStatus,
      t,
      threadKey
    ]
  );

  const sendWelcome = useCallback(
    async (locale: string) => {
      if (isStreaming) return;
      const token = await getToken();
      if (token === null) {
        setIssue(toWebChatUxIssue(t("sessionExpired")));
        return;
      }

      const sendThreadKey = threadKey;
      const assistantMsgId = `local-assistant-welcome-${Date.now()}`;
      const clientTurnId = createClientTurnId();
      const controller = new AbortController();
      abortControllersByThreadRef.current.set(sendThreadKey, { controller, clientTurnId });
      const releaseAbortController = () => {
        const entry = abortControllersByThreadRef.current.get(sendThreadKey);
        if (entry !== undefined && entry.controller === controller) {
          abortControllersByThreadRef.current.delete(sendThreadKey);
        }
      };
      markStreaming(sendThreadKey, true);
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
            onStreamReset: () => {
              cancelBufferedAssistantFlush();
              pendingDelta.text = "";
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantMsgId ? { ...m, content: "" } : m))
              );
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
                assistantMessage?: {
                  id?: string;
                  content?: string;
                  attachments?: ChatAttachment[];
                };
                runtime?: RuntimeTransportMeta;
              } | null;
              const newAssistantId =
                typeof t?.assistantMessage?.id === "string" ? t.assistantMessage.id : null;
              const authoritativeAssistantContent =
                typeof t?.assistantMessage?.content === "string"
                  ? t.assistantMessage.content
                  : null;
              const assistantAttachments =
                Array.isArray(t?.assistantMessage?.attachments) &&
                t.assistantMessage.attachments.length > 0
                  ? (t.assistantMessage.attachments as ChatAttachment[])
                  : undefined;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        ...(newAssistantId ? { id: newAssistantId } : {}),
                        ...(authoritativeAssistantContent !== null
                          ? { content: authoritativeAssistantContent }
                          : {}),
                        status: "committed" as const,
                        attachments: assistantAttachments
                      }
                    : m
                )
              );
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
            onInterrupted: ({ transport }) => {
              flushBufferedAssistantState();
              const t = transport as {
                assistantMessage?: {
                  id?: string;
                  content?: string;
                };
              } | null;
              const newAssistantId =
                typeof t?.assistantMessage?.id === "string" ? t.assistantMessage.id : null;
              const authoritativeAssistantContent =
                typeof t?.assistantMessage?.content === "string"
                  ? t.assistantMessage.content
                  : null;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? (() => {
                        const nextContent = authoritativeAssistantContent ?? m.content;
                        return {
                          ...m,
                          ...(newAssistantId ? { id: newAssistantId } : {}),
                          ...(authoritativeAssistantContent !== null
                            ? { content: authoritativeAssistantContent }
                            : {}),
                          status: nextContent.trim().length > 0 ? "partial" : "streaming"
                        };
                      })()
                    : m
                )
              );
            },
            onFailed: (payload) => {
              flushBufferedAssistantState();
              setIssue(toWebChatUxIssue(payload));
              const t = payload.transport as {
                assistantMessage?: {
                  id?: string;
                  content?: string;
                };
              } | null;
              const newAssistantId =
                typeof t?.assistantMessage?.id === "string" ? t.assistantMessage.id : null;
              const authoritativeAssistantContent =
                typeof t?.assistantMessage?.content === "string"
                  ? t.assistantMessage.content
                  : null;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        ...(newAssistantId ? { id: newAssistantId } : {}),
                        ...(authoritativeAssistantContent !== null
                          ? { content: authoritativeAssistantContent }
                          : {}),
                        status: "partial" as const
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
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId && m.status === "streaming"
              ? { ...m, status: m.content.trim().length > 0 ? "partial" : "committed" }
              : m
          )
        );
      } finally {
        markStreaming(sendThreadKey, false);
        releaseAbortController();
      }
    },
    [compaction, getToken, isStreaming, markStreaming, t, threadKey]
  );

  // sendRef makes retryPendingSend independent of `send`'s identity so we
  // do not have to add `send` to the retry callback's dep list (which would
  // create a circular useCallback). The ref is updated on every render with
  // the latest `send`, so retry always dispatches the freshest closure.
  const sendRef = useRef(send);
  sendRef.current = send;

  const retryPendingSend = useCallback(async () => {
    const pending = pendingSendRef.current;
    if (pending === null) return;
    setMessages((prev) => {
      const idsToRemove = new Set<string>([pending.userMsgId]);
      if (pending.assistantMsgId !== null) idsToRemove.add(pending.assistantMsgId);
      for (const m of prev) {
        if (idsToRemove.has(m.id)) {
          for (const a of m.attachments ?? []) {
            if (a.localPreviewUrl !== undefined) URL.revokeObjectURL(a.localPreviewUrl);
          }
        }
      }
      return prev.filter((m) => !idsToRemove.has(m.id));
    });
    pendingSendRef.current = null;
    setPendingSendStatus(null);
    await sendRef.current(pending.text, pending.files, pending.options);
  }, [setPendingSendStatus]);

  const cancelPendingSend = useCallback((): string | null => {
    const pending = pendingSendRef.current;
    if (pending === null) return null;
    setMessages((prev) => {
      const idsToRemove = new Set<string>([pending.userMsgId]);
      if (pending.assistantMsgId !== null) idsToRemove.add(pending.assistantMsgId);
      for (const m of prev) {
        if (idsToRemove.has(m.id)) {
          for (const a of m.attachments ?? []) {
            if (a.localPreviewUrl !== undefined) URL.revokeObjectURL(a.localPreviewUrl);
          }
        }
      }
      return prev.filter((m) => !idsToRemove.has(m.id));
    });
    const restoredText = pending.text;
    pendingSendRef.current = null;
    setPendingSendStatus(null);
    return restoredText;
  }, [setPendingSendStatus]);

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
    loadOlderMessages,
    pendingSendStatus,
    retryPendingSend,
    cancelPendingSend
  };
}
