"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useAuth } from "@clerk/nextjs";
import { ContractsApiError } from "@persai/contracts";
import { useTranslations } from "next-intl";
import {
  compactChat,
  getAssistantWebChatTurnStatus,
  getChatMessages,
  getChatCompactionState,
  reattachAssistantWebChatTurnStream,
  stageWebChatAttachment,
  stopAssistantWebChatTurn,
  streamAssistantWebChatTurn,
  toWebChatUxIssue,
  uploadAssistantKnowledgeSource,
  getAssistantWebChatPlan,
  clearAssistantWebChatPlan,
  WELCOME_THREAD_KEY,
  WELCOME_TURN_SENTINEL,
  XhrAbortError,
  XhrNetworkError,
  XhrStallError,
  XhrTimeoutError,
  type ChatHistoryAttachment,
  type ChatHistoryMessage,
  type AssistantChatMode,
  type ChatCompactionResult,
  type ChatCompactionState,
  type WebChatActiveMediaJobState,
  type WebChatActiveDocumentJobState,
  type WebChatActiveTurnState,
  type WebChatTurnStatusState,
  type WebChatUxIssue,
  parsePendingBrowserLoginState,
  type PendingBrowserLoginState,
  deleteAssistantBrowserProfile
} from "../assistant-api-client";
import type { RuntimeTodoItem, RuntimeTurnToolInvocation } from "@persai/runtime-contract";
import { isKnowledgeEligibleFile } from "../chat-file-policy";
import {
  getCachedCurrentLocalBrowserBridgeStatus,
  getCurrentLocalBrowserBridgeStatus,
  isNativeBrowserBridgeShell
} from "../browser-bridge-client";
import type { ActivityEvent } from "./activity-badge";
import { dispatchProjectFilesChanged } from "./project-files-events";
import { scopeThreadKey, useStreamingThreadsRegistry } from "./streaming-threads";
/** * Pre-headers timeout (ms) for `streamAssistantWebChatTurn`. If the server * does not return 2xx headers within this window, the request is aborted * and the user bubble flips to "send_failed". 10s is well above normal * server response time but short enough to feel responsive on flaky * mobile networks. (ADR-075 T� "Single-slot pending send".) */ const HEADERS_TIMEOUT_MS = 10_000;
/** Avoid duplicate focus/visibility refresh bursts from the same browser resume. */ const RESUME_REFRESH_DEBOUNCE_MS = 1_500;
const SOFT_DETACH_RECONCILE_INTERVAL_MS = 2_000;
const SOFT_DETACH_RECONCILE_MAX_ATTEMPTS = 60;
const SOFT_DETACH_RECONCILE_LONG_INTERVAL_MS = 10_000;
const HARD_STOP_SERVER_ACK_TIMEOUT_MS = 750;
const ACTIVE_TURN_RESTORE_INTERVAL_MS = 1_000;
const ACTIVE_TURN_RESTORE_MAX_ATTEMPTS = 30;
const PENDING_RECONCILE_INTERVAL_MS = 1_000;
const PENDING_RECONCILE_MAX_ATTEMPTS = 30;
const ACTIVE_WEB_TURN_STORAGE_PREFIX = "persai.active-web-turn.v1.";
const STREAM_DELTA_FRAME_CHAR_BUDGET = 48;

function isStreamAuthRetryable(error: unknown): error is ContractsApiError {
  return error instanceof ContractsApiError && error.status === 401;
}

export type ChatMessageRole = "user" | "assistant";
/** * Lifecycle of a message bubble. * * "sending" / "send_failed" are the new pending-slot states from * ADR-075 T� "Single-slot pending send". Only user bubbles can be in those * states; assistant bubbles still go committed ��� streaming ��� partial. * * - "sending"     : optimistic user message, request is in-flight (staging *                   attachments and/or waiting for the stream to return 2xx *                   headers). Composer is disabled, no second send allowed. * - "send_failed" : pre-headers failure (offline / stall / 10s timeout / etc). *                   Bubble shows a small red exclamation with Retry / Cancel *                   inline; composer stays disabled until user resolves it. */ export type ChatMessageStatus =

    | "committed"
    | "streaming"
    | "partial"
    | "sending"
    | "reconciling"
    | "send_failed"
    | "send_failed_unconfirmed"
    | "send_failed_confirmed";
export type PendingSendStatus =
  | "sending"
  | "reconciling"
  | "send_failed"
  | "send_failed_unconfirmed"
  | "send_failed_confirmed";
export type ChatAttachment = ChatHistoryAttachment & {
  localPreviewUrl?: string | undefined;
  uploadProgressPercent?: number | undefined;
};
export type ChatPlatformNotice = {
  kind: "safety_inbound_warn" | "safety_inbound_restricted";
  reasonCode: string;
};

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  attachments?: ChatAttachment[] | undefined;
  platformNotice?: ChatPlatformNotice | undefined;
  thought?: string;
  thoughtStartedAt?: string | null;
  thoughtFinishedAt?: string | null;
  /** The texts the model wrote before each tool call across the tool loop. Absent/empty when no tools ran. */
  workingNotes?: string[];
  /** Sanitized tool calls emitted by the runtime, used to interleave process badges with working notes. */
  toolInvocations?: RuntimeTurnToolInvocation[];
  /** Local-only streaming hint: true while text deltas are actively being appended. */
  streamingTextActive?: boolean;
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
  activeMediaJobs: WebChatActiveMediaJobState[];
  activeDocumentJobs: WebChatActiveDocumentJobState[];
  isStreaming: boolean;
  historyLoading: boolean;
  hasOlderMessages: boolean;
  olderMessagesLoading: boolean;
  issue: WebChatUxIssue | null;
  compaction: ChatCompactionState | null;
  recentAutoCompaction: RecentAutoCompactionNotice | null;
  compactionRunning: boolean;
  chatPlan: RuntimeTodoItem[];
  chatPlanTotalCount: number;
  chatPlanWindowed: boolean;
  refreshChatPlan: () => Promise<void>;
  clearChatPlan: () => Promise<void>;
  /**
   * ADR-125 follow-up — chat-level "active skill / scenario" projection so
   * the header subtitle has a stable source of truth that survives history
   * reloads. Mirrors `chat.skillDecisionState` derivation on the API.
   */
  currentEngagement: { skillDisplayName: string; scenarioDisplayName: string | null } | null;
  pendingBrowserLogin: PendingBrowserLoginState | null;
  browserLoginModalOpen: boolean;
  dismissBrowserLogin: () => void;
  reopenBrowserLogin: () => void;
  abortBrowserLogin: () => Promise<void>;
  clearPendingBrowserLogin: () => void;
  send: (text: string, files?: File[], options?: ChatSendOptions) => Promise<void>;
  sendWelcome: (locale: string) => Promise<void>;
  compactNow: (instructions?: string) => Promise<ChatCompactionResult | null>;
  stop: () => void;
  clearIssue: () => void;
  reportIssue: (error: unknown) => void;
  noteDocumentJobStarted: () => void;
  loadHistory: (chatId: string) => Promise<void>;
  /**   * Mark the active thread as "no history will be loaded" so the empty-state   * UI can render. Used by `chat/page.tsx` when the active threadKey does not   * correspond to any existing chat row (i.e. it's a brand-new conversation).   * See the `historyLoading` optimistic-true reset in the threadKey-change   * branch below for the rationale.   */ markHistoryEmpty: () => void;
  loadOlderMessages: () => Promise<void>;
  /**   * Current pending-send slot state, or null when no message is awaiting   * delivery confirmation. See ADR-075 T� "Single-slot pending send".   */ pendingSendStatus: PendingSendStatus | null;
  /** Retry the failed pending send. No-op if there is no failed bubble. */ retryPendingSend: () => Promise<void>;
  /**   * Cancel the failed pending send. Removes the failed bubble and returns   * the original draft text so the composer can restore it. Returns null   * if there was nothing to cancel.   */ cancelPendingSend: () =>
    | string
    | null;
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
    retrievalPlan?: {
      useSkills: boolean;
      selectedSkillIds: string[];
      useUserKnowledge: boolean;
      useProductKnowledge: boolean;
      useWeb: boolean;
      ordinarySourcePriorityMode:
        | "personal_first"
        | "product_first"
        | "web_first"
        | "mixed_ambiguous"
        | "not_applicable";
      confidence: "low" | "medium" | "high";
      reasonCode: string;
    } | null;
    skillState?: {
      status: "inactive" | "active";
      activeSkillId: string | null;
      activeSkillName: string | null;
      activeScenarioKey: string | null;
      activeScenarioDisplayName: string | null;
      topicSummary: string | null;
    } | null;
  } | null;
};
export interface ChatSendOptions {
  addToKnowledgeBase?: boolean | undefined;
  chatMode?: AssistantChatMode | undefined;
  deepModeEnabled?: boolean | undefined;
  clientTurnId?: string | undefined;
  clientAttachmentIds?: string[] | undefined;
}
interface UseChatOptions {
  assistantId?: string | null;
}
type LiveActivitySource = "tool" | "compaction" | "retrieval" | "project";
type LiveActivityEvent = ActivityEvent & {
  source: LiveActivitySource;
  skillDetail?: string | undefined;
};
type ActiveTurnSnapshot = {
  clientTurnId: string;
  messages: ChatMessage[];
  /**
   * Identity of the user/assistant messages that BELONG to this live turn.
   * `messages` above is the visible thread state (which can be merged with
   * older committed history during loadHistory or thread restore), so it is
   * not a safe source of truth for "is this turn's result already in the
   * committed history?" — older committed assistant ids would falsely
   * answer "yes" and tear down a still-live stream. These two fields stay
   * scoped to the live turn:
   *
   * - `liveUserMessageId`  — starts as `local-user-...`, replaced with the
   *   server id by `onStarted` / status reattach / authoritative projection.
   *   `null` for sendWelcome (no user message).
   * - `liveAssistantMessageId` — starts as `local-assistant-...` or
   *   `active-assistant-...`, replaced with the server id by `onCompleted` /
   *   `onInterrupted` / `onFailed` / status reattach.
   */
  liveUserMessageId: string | null;
  liveAssistantMessageId: string;
  liveActivitiesByMessageId: Record<string, LiveActivityEvent>;
  shadowRoutingLabelsByMessageId: Record<string, string>;
  chatId: string | null;
  compactionRunning: boolean;
};
type CachedThreadHistorySnapshot = ActiveTurnSnapshot & {
  olderCursor: string | null;
  hasOlderMessages: boolean;
  activeMediaJobs: WebChatActiveMediaJobState[];
  activeDocumentJobs: WebChatActiveDocumentJobState[];
};
type SnapshotDebugEvent = {
  type: "active-snapshot-non-live-user";
  at: string;
  callsite: string;
  threadKey: string;
  clientTurnId: string;
  chatId: string | null;
  liveUserMessageId: string | null;
  liveAssistantMessageId: string;
  nonLiveUsers: Array<{
    id: string;
    status: ChatMessageStatus;
    contentPreview: string;
    index: number;
  }>;
  messagesTail: Array<{
    id: string;
    role: ChatMessageRole;
    status: ChatMessageStatus;
    contentPreview: string;
    index: number;
  }>;
};
function isSnapshotDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get("debugChatSnapshots") === "1" ||
      window.localStorage.getItem("persai.debug.chatSnapshots") === "1"
    );
  } catch {
    return false;
  }
}
function shouldSurfacePreHeaderIssueAsBanner(issue: WebChatUxIssue): boolean {
  return (
    issue.classId === "chat_message_limit" ||
    issue.classId === "active_chat_cap" ||
    issue.classId === "quota_limit_reached" ||
    issue.classId === "media_storage_full" ||
    issue.classId === "knowledge_storage_full" ||
    issue.classId === "workspace_storage_full" ||
    issue.classId === "assistant_not_live" ||
    issue.classId === "assistant_activating" ||
    issue.classId === "assistant_activation_failed" ||
    issue.classId === "feature_unavailable" ||
    issue.classId === "auth_session"
  );
}
function recordSnapshotDebugEvent(event: SnapshotDebugEvent): void {
  if (typeof window === "undefined") return;
  const debugWindow = window as typeof window & {
    __persaiChatSnapshotDebug?: SnapshotDebugEvent[];
  };
  const events = debugWindow.__persaiChatSnapshotDebug ?? [];
  events.push(event);
  debugWindow.__persaiChatSnapshotDebug = events.slice(-100);
  console.warn("[persai-chat-snapshot-debug]", event);
}
function auditActiveTurnSnapshotMessages(
  callsite: string,
  threadKey: string,
  snapshot: ActiveTurnSnapshot
): void {
  if (!isSnapshotDebugEnabled()) return;
  const nonLiveUsers = snapshot.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role === "user" && message.id !== snapshot.liveUserMessageId)
    .map(({ message, index }) => ({
      id: message.id,
      status: message.status,
      contentPreview: message.content.replace(/\s+/g, " ").slice(0, 160),
      index
    }));
  if (nonLiveUsers.length === 0) return;
  recordSnapshotDebugEvent({
    type: "active-snapshot-non-live-user",
    at: new Date().toISOString(),
    callsite,
    threadKey,
    clientTurnId: snapshot.clientTurnId,
    chatId: snapshot.chatId,
    liveUserMessageId: snapshot.liveUserMessageId,
    liveAssistantMessageId: snapshot.liveAssistantMessageId,
    nonLiveUsers,
    messagesTail: snapshot.messages.slice(-8).map((message, offset) => ({
      id: message.id,
      role: message.role,
      status: message.status,
      contentPreview: message.content.replace(/\s+/g, " ").slice(0, 160),
      index: snapshot.messages.length - Math.min(snapshot.messages.length, 8) + offset
    }))
  });
}
type PendingSendSlot = {
  text: string;
  files: File[];
  options?: ChatSendOptions | undefined;
  userMsgId: string;
  assistantMsgId: string | null;
  clientTurnId: string;
  clientAttachmentIds: string[];
  status: PendingSendStatus;
};
const TOOL_ACTIVITY_COPY: Record<string, { start: string; end: string; failure: string }> = {
  web_search: {
    start: "Searching the web",
    end: "Web results ready",
    failure: "Web search failed"
  },
  web_fetch: { start: "Reading the page", end: "Page ready", failure: "Page read failed" },
  image_generate: {
    start: "Generating image",
    end: "Image ready",
    failure: "Image generation failed"
  },
  image_edit: { start: "Editing image", end: "Edited image ready", failure: "Image edit failed" },
  video_generate: {
    start: "Generating video",
    end: "Video ready",
    failure: "Video generation failed"
  },
  tts: { start: "Recording voice", end: "Voice ready", failure: "Voice generation failed" },
  scheduled_action: {
    start: "Scheduling task",
    end: "Task scheduled",
    failure: "Task scheduling failed"
  },
  browser: { start: "browser_started", end: "browser_finished", failure: "browser_failed" },
  knowledge_search: {
    start: "knowledge_search_started",
    end: "knowledge_search_finished",
    failure: "knowledge_search_failed"
  },
  knowledge_fetch: {
    start: "knowledge_fetch_started",
    end: "knowledge_fetch_finished",
    failure: "knowledge_fetch_failed"
  },
  files: { start: "files_started", end: "files_finished", failure: "files_failed" },
  document: { start: "document_started", end: "document_finished", failure: "document_failed" },
  grep: { start: "grep_started", end: "grep_finished", failure: "grep_failed" },
  glob: { start: "glob_started", end: "glob_finished", failure: "glob_failed" },
  shell: { start: "shell_started", end: "shell_finished", failure: "shell_failed" },
  exec: { start: "exec_started", end: "exec_finished", failure: "exec_failed" },
  quota_status: {
    start: "quota_status_started",
    end: "quota_status_finished",
    failure: "quota_status_failed"
  },
  memory_write: {
    start: "memory_write_started",
    end: "memory_write_finished",
    failure: "memory_write_failed"
  },
  skill: { start: "skill_started", end: "skill_finished", failure: "skill_failed" },
  background_task: {
    start: "background_task_started",
    end: "background_task_finished",
    failure: "background_task_failed"
  }
};
const HIDDEN_MEDIA_ACTIVITY_LABEL = "__hidden_media_activity__";
function shouldSuppressLegacyMediaActivity(toolName: string): boolean {
  return (
    toolName === "image_generate" || toolName === "image_edit" || toolName === "video_generate"
  );
}
function isHiddenMediaActivity(event: ActivityEvent): boolean {
  return event.label === HIDDEN_MEDIA_ACTIVITY_LABEL;
}
function buildToolLiveActivity(params: {
  assistantMessageId: string;
  toolName: string;
  phase: "start" | "end";
  isError: boolean;
}): LiveActivityEvent {
  if (shouldSuppressLegacyMediaActivity(params.toolName)) {
    return {
      id: `activity-live-tool-hidden-${Date.now()}-${params.phase}-${params.toolName}`,
      type: "tool_use",
      label: HIDDEN_MEDIA_ACTIVITY_LABEL,
      afterMessageId: params.assistantMessageId,
      emphasis: "default",
      source: "tool"
    };
  }
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
function buildProjectLiveActivity(params: {
  assistantMessageId: string;
  label: string;
  detail?: string | undefined;
}): LiveActivityEvent {
  return {
    id: `activity-project-live-${Date.now()}-${params.label}`,
    type: "info",
    label: params.label,
    ...(params.detail ? { detail: params.detail } : {}),
    afterMessageId: params.assistantMessageId,
    emphasis: "strong",
    source: "project"
  };
}
function buildRetrievalLiveActivity(
  params: {
    assistantMessageId: string;
    source: "skill" | "user" | "product" | "web";
    resultCount: number;
    skillName?: string | null;
    skillIconEmoji?: string | null;
  },
  skillBadgePrefix: string
): LiveActivityEvent {
  const labelBySource = {
    skill: "retrieval_skill_started",
    user: "retrieval_user_started",
    product: "retrieval_product_started",
    web: "retrieval_web_started"
  } satisfies Record<"skill" | "user" | "product" | "web", string>;
  const skillIconEmoji =
    params.source === "skill" && params.skillIconEmoji ? params.skillIconEmoji.trim() : "";
  const detail =
    params.source === "skill" && (params.skillName || skillIconEmoji.length > 0)
      ? `${skillBadgePrefix}${skillIconEmoji.length > 0 ? ` - ${skillIconEmoji}` : ""}`
      : null;
  return {
    id: `activity-live-retrieval-${Date.now()}-${params.source}`,
    type: "info",
    label: labelBySource[params.source],
    ...(detail === null ? {} : { detail, skillDetail: detail }),
    afterMessageId: params.assistantMessageId,
    emphasis: detail !== null || params.resultCount > 0 ? "strong" : "default",
    source: "retrieval"
  };
}
function applyPriorSkillDetail(
  nextActivity: LiveActivityEvent,
  priorActivity: LiveActivityEvent | undefined
): LiveActivityEvent {
  const priorSkillDetail = priorActivity?.skillDetail?.trim();
  if (!priorSkillDetail || nextActivity.skillDetail?.trim()) {
    return nextActivity;
  }
  const nextDetail = nextActivity.detail?.trim();
  return {
    ...nextActivity,
    skillDetail: priorSkillDetail,
    detail:
      nextDetail && !nextDetail.includes(priorSkillDetail)
        ? `${nextDetail} · ${priorSkillDetail}`
        : (nextDetail ?? priorSkillDetail),
    emphasis: "strong"
  };
}
const LIVE_ACTIVITY_PRIORITY: Record<LiveActivitySource, number> = {
  compaction: 5,
  tool: 4,
  retrieval: 3,
  project: 2
};
function shouldReplaceLiveActivity(
  currentActivity: LiveActivityEvent | undefined,
  nextActivity: LiveActivityEvent
): boolean {
  if (currentActivity === undefined) {
    return true;
  }
  if (currentActivity.source === nextActivity.source) {
    return true;
  }
  return (
    LIVE_ACTIVITY_PRIORITY[nextActivity.source] >= LIVE_ACTIVITY_PRIORITY[currentActivity.source]
  );
}
function mergeLiveActivity(
  currentActivity: LiveActivityEvent | undefined,
  nextActivity: LiveActivityEvent
): LiveActivityEvent {
  if (!shouldReplaceLiveActivity(currentActivity, nextActivity)) {
    return currentActivity ?? nextActivity;
  }
  return applyPriorSkillDetail(nextActivity, currentActivity);
}
export function formatTurnRoutingBadgeLabel(
  turnRouting: NonNullable<RuntimeTransportMeta["turnRouting"]>
): string {
  return `${turnRouting.executionMode} (${turnRouting.source})`;
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
      ? params.t("knowledgeUploadReadyDetail", { count: params.readyCount })
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
function toCommittedChatMessage(message: ChatHistoryMessage): ChatMessage | null {
  if (message.content === WELCOME_TURN_SENTINEL) {
    return null;
  }
  return {
    id: message.id,
    role: message.author === "system" ? "assistant" : message.author,
    content: message.content,
    status: "committed",
    ...(message.platformNotice ? { platformNotice: message.platformNotice } : {}),
    ...(Array.isArray(message.workingNotes) && message.workingNotes.length > 0
      ? { workingNotes: message.workingNotes }
      : {}),
    ...(Array.isArray(message.toolInvocations) && message.toolInvocations.length > 0
      ? { toolInvocations: message.toolInvocations }
      : {}),
    attachments:
      message.attachments.length > 0 ? (message.attachments as ChatAttachment[]) : undefined
  };
}

function reconcileAuthoritativeAssistantContent(
  _currentContent: string,
  authoritativeContent: string | null
): string | null {
  // Content is now always a clean final answer; no :::working markers.
  // The authoritative server content is always the correct one to use.
  return authoritativeContent;
}

function reconcileServerAssistantMessageWithLocal(
  serverMessage: ChatMessage,
  localMessages: ChatMessage[]
): ChatMessage {
  if (serverMessage.role !== "assistant") {
    return serverMessage;
  }
  const localMessage = localMessages.find(
    (message) => message.id === serverMessage.id && message.role === "assistant"
  );
  if (!localMessage?.content.includes(":::working")) {
    return serverMessage;
  }
  const nextContent = reconcileAuthoritativeAssistantContent(
    localMessage.content,
    serverMessage.content
  );
  return nextContent === null || nextContent === serverMessage.content
    ? serverMessage
    : { ...serverMessage, content: nextContent };
}

function reconcileServerAssistantMessagesWithLocal(
  serverMessages: ChatMessage[],
  localMessages: ChatMessage[]
): ChatMessage[] {
  return serverMessages.map((message) =>
    reconcileServerAssistantMessageWithLocal(message, localMessages)
  );
}

function toChatAttachment(
  attachment: ChatHistoryAttachment,
  options?: { localPreviewUrl?: string | undefined; uploadProgressPercent?: number | undefined }
): ChatAttachment {
  return {
    ...attachment,
    ...(options?.localPreviewUrl !== undefined ? { localPreviewUrl: options.localPreviewUrl } : {}),
    ...(options?.uploadProgressPercent !== undefined
      ? { uploadProgressPercent: options.uploadProgressPercent }
      : {})
  };
}
function toActiveTurnOverlayMessages(activeTurn: WebChatActiveTurnState | null | undefined): {
  messages: ChatMessage[];
  liveActivitiesByMessageId: Record<string, LiveActivityEvent>;
  liveUserMessageId: string | null;
  liveAssistantMessageId: string | null;
} {
  if (!activeTurn) {
    return {
      messages: [],
      liveActivitiesByMessageId: {},
      liveUserMessageId: null,
      liveAssistantMessageId: null
    };
  }
  const userMessage = activeTurn.userMessage
    ? toCommittedChatMessage(activeTurn.userMessage)
    : null;
  const assistantMessage = activeTurn.assistantMessage
    ? toCommittedChatMessage(activeTurn.assistantMessage)
    : null;
  if (!userMessage) {
    return {
      messages: [],
      liveActivitiesByMessageId: {},
      liveUserMessageId: null,
      liveAssistantMessageId: null
    };
  }
  const assistantOverlay: ChatMessage =
    assistantMessage ??
    ({
      id: `active-assistant-${activeTurn.clientTurnId}`,
      role: "assistant",
      content: "",
      status: "streaming"
    } satisfies ChatMessage);
  const liveActivitiesByMessageId =
    activeTurn.currentActivity && activeTurn.currentActivity.phase === "start"
      ? {
          [assistantOverlay.id]: buildToolLiveActivity({
            assistantMessageId: assistantOverlay.id,
            toolName: activeTurn.currentActivity.toolName,
            phase: activeTurn.currentActivity.phase,
            isError: activeTurn.currentActivity.isError
          })
        }
      : {};
  return {
    messages: [
      { ...userMessage, status: "committed" },
      { ...assistantOverlay, status: "streaming" }
    ],
    liveActivitiesByMessageId,
    liveUserMessageId: userMessage.id,
    liveAssistantMessageId: assistantOverlay.id
  };
}
function isOptimisticLocalMessage(message: ChatMessage): boolean {
  return message.id.startsWith("local-user-") || message.id.startsWith("local-assistant-");
}
function isTransientActiveAssistantMessage(message: ChatMessage): boolean {
  return (
    message.role === "assistant" &&
    message.status === "streaming" &&
    (message.id.startsWith("local-assistant-") || message.id.startsWith("active-assistant-"))
  );
}
function isPassiveStreamDisconnect(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.message === "Stream closed before terminal event." ||
      error.name === "AbortError" ||
      error.name === "TypeError" ||
      error.name === "NetworkError"
    );
  }
  return false;
}
function mergeChatMessagesById(...groups: ChatMessage[][]): ChatMessage[] {
  const messagesById = new Map<string, ChatMessage>();
  for (const group of groups) {
    for (const message of group) {
      messagesById.set(message.id, message);
    }
  }
  return Array.from(messagesById.values());
}
function committedHistoryHasActiveTurnResult(
  loaded: ChatMessage[],
  activeTurn: WebChatActiveTurnState
): boolean {
  if (
    activeTurn.assistantMessageId &&
    loaded.some((message) => message.id === activeTurn.assistantMessageId)
  ) {
    return true;
  }
  const activeUserId = activeTurn.userMessage?.id ?? activeTurn.pendingUserMessageId;
  if (!activeUserId) {
    return false;
  }
  const activeUserIndex = loaded.findIndex((message) => message.id === activeUserId);
  return (
    activeUserIndex >= 0 &&
    loaded.slice(activeUserIndex + 1).some((message) => message.role === "assistant")
  );
}
function isLocalScopedAssistantId(id: string): boolean {
  return id.startsWith("local-assistant-") || id.startsWith("active-assistant-");
}

/**
 * Returns true when committed history already contains the result of the
 * active turn — i.e. the live turn's authoritative server messages are
 * present. Uses the snapshot's scoped `liveUserMessageId` /
 * `liveAssistantMessageId` rather than scanning `snapshot.messages`,
 * because the latter is the visible (and possibly merged) thread state and
 * can legitimately contain older committed user/assistant ids that have
 * nothing to do with the live turn.
 */
function committedHistoryHasActiveSnapshotResult(
  loaded: ChatMessage[],
  activeSnapshot: ActiveTurnSnapshot | undefined
): boolean {
  if (activeSnapshot === undefined) {
    return false;
  }
  const liveAssistantId = activeSnapshot.liveAssistantMessageId;
  if (
    !isLocalScopedAssistantId(liveAssistantId) &&
    loaded.some((message) => message.id === liveAssistantId)
  ) {
    return true;
  }
  const liveUserId = activeSnapshot.liveUserMessageId;
  if (liveUserId === null || liveUserId.startsWith("local-user-")) {
    return false;
  }
  const userIndex = loaded.findIndex((message) => message.id === liveUserId);
  if (userIndex < 0) {
    return false;
  }
  return loaded
    .slice(userIndex + 1)
    .some(
      (message) =>
        message.role === "assistant" &&
        !isLocalScopedAssistantId(message.id) &&
        message.id !== liveAssistantId
    );
}
function dropSupersededLiveAssistantPlaceholder(
  messages: ChatMessage[],
  activeSnapshot: ActiveTurnSnapshot | undefined
): ChatMessage[] {
  if (activeSnapshot === undefined) {
    return messages;
  }
  const liveUserId = activeSnapshot.liveUserMessageId;
  const liveAssistantId = activeSnapshot.liveAssistantMessageId;
  if (liveUserId === null || liveUserId.startsWith("local-user-")) {
    return messages;
  }
  const liveUserIndex = messages.findIndex((message) => message.id === liveUserId);
  if (liveUserIndex < 0) {
    return messages;
  }
  const hasCommittedAssistantAfterLiveUser = messages
    .slice(liveUserIndex + 1)
    .some(
      (message) =>
        message.role === "assistant" &&
        !isLocalScopedAssistantId(message.id) &&
        message.id !== liveAssistantId
    );
  if (!hasCommittedAssistantAfterLiveUser || !isLocalScopedAssistantId(liveAssistantId)) {
    return messages;
  }
  return messages.filter((message) => message.id !== liveAssistantId);
}
function getSnapshotTerminalAssistantReplacementId(
  snapshot: ActiveTurnSnapshot,
  liveTurnIds: Set<string>
): string | null {
  const liveUserId = snapshot.liveUserMessageId;
  const liveAssistantId = snapshot.liveAssistantMessageId;
  if (
    liveUserId === null ||
    liveUserId.startsWith("local-user-") ||
    !isLocalScopedAssistantId(liveAssistantId) ||
    snapshot.messages.some((message) => message.id === liveAssistantId)
  ) {
    return null;
  }
  const liveUserIndex = snapshot.messages.findIndex((message) => message.id === liveUserId);
  if (liveUserIndex < 0) {
    return null;
  }
  return (
    snapshot.messages
      .slice(liveUserIndex + 1)
      .find(
        (message) =>
          message.role === "assistant" &&
          !liveTurnIds.has(message.id) &&
          !isLocalScopedAssistantId(message.id)
      )?.id ?? null
  );
}
function mergeCommittedHistoryWithActiveTurn(input: {
  loaded: ChatMessage[];
  activeSnapshot: ActiveTurnSnapshot | undefined;
  baseMessages?: ChatMessage[] | undefined;
}): { messages: ChatMessage[]; replacedActiveTurn: boolean } {
  const { loaded, activeSnapshot, baseMessages } = input;
  if (activeSnapshot === undefined) {
    return {
      messages:
        baseMessages === undefined
          ? loaded
          : mergeChatMessagesById(
              loaded,
              baseMessages.filter(
                (message) =>
                  !isOptimisticLocalMessage(message) && !isTransientActiveAssistantMessage(message)
              )
            ),
      replacedActiveTurn: false
    };
  }
  // Track only the LIVE TURN's message identity here, not every id in
  // `snapshot.messages`. `snapshot.messages` is the visible thread state
  // (which can legitimately include older committed history after a thread
  // restore / loadHistory merge), so using it as "the live turn's id set"
  // would falsely classify older committed messages as part of this turn.
  const liveUserId = activeSnapshot.liveUserMessageId;
  const liveAssistantId = activeSnapshot.liveAssistantMessageId;
  const liveTurnIds = new Set<string>([
    ...(liveUserId !== null ? [liveUserId] : []),
    liveAssistantId
  ]);
  const baseMessageIds = new Set((baseMessages ?? []).map((message) => message.id));
  const liveUserIsOptimistic = liveUserId !== null && liveUserId.startsWith("local-user-");
  const liveAssistantIsOptimistic = isLocalScopedAssistantId(liveAssistantId);
  const newLoadedUserMessages =
    baseMessages === undefined
      ? []
      : loaded.filter((message) => message.role === "user" && !baseMessageIds.has(message.id));
  const newLoadedAssistantMessages =
    baseMessages === undefined
      ? []
      : loaded.filter((message) => message.role === "assistant" && !baseMessageIds.has(message.id));
  const liveUserIndexInLoaded =
    liveUserId !== null && !liveUserIsOptimistic
      ? loaded.findIndex((message) => message.id === liveUserId)
      : -1;
  const loadedHasAssistantAfterActiveUser =
    liveUserIndexInLoaded >= 0 &&
    loaded
      .slice(liveUserIndexInLoaded + 1)
      .some(
        (message) =>
          message.role === "assistant" &&
          !isLocalScopedAssistantId(message.id) &&
          message.id !== liveAssistantId
      );
  const loadedHasLiveAssistantId =
    !liveAssistantIsOptimistic && loaded.some((message) => message.id === liveAssistantId);
  const loadedIntroducedCommittedTurnTail =
    baseMessages !== undefined &&
    liveUserIsOptimistic &&
    liveAssistantIsOptimistic &&
    loaded.length > 0 &&
    loaded[loaded.length - 1]?.role === "assistant" &&
    newLoadedUserMessages.length === 1 &&
    newLoadedAssistantMessages.length === 1;
  const shouldReplaceActiveTurn =
    loadedHasAssistantAfterActiveUser ||
    loadedHasLiveAssistantId ||
    loadedIntroducedCommittedTurnTail;
  if (!shouldReplaceActiveTurn) {
    // Filter optimistic / transient ids out of `loaded` here too. The
    // snapshot's `liveUserMessageId` / `liveAssistantMessageId` are
    // the canonical truth for the live turn; if `loaded` (e.g. a cached
    // history snapshot written between `send()` and `onStarted`) still
    // carries the original `local-user-*` id, leaving it in the merge
    // produces a duplicate user bubble next to the canonical
    // `server-user-*` one. The snapshot's entries are appended after,
    // so removing the optimistic stub from `loaded` is safe.
    const sanitizedLoaded = loaded.filter(
      (message) => !isOptimisticLocalMessage(message) && !isTransientActiveAssistantMessage(message)
    );
    const terminalReplacementAssistantId = getSnapshotTerminalAssistantReplacementId(
      activeSnapshot,
      liveTurnIds
    );
    const liveSnapshotMessages = activeSnapshot.messages.filter(
      (message) => liveTurnIds.has(message.id) || message.id === terminalReplacementAssistantId
    );
    return {
      messages: dropSupersededLiveAssistantPlaceholder(
        mergeChatMessagesById(sanitizedLoaded, liveSnapshotMessages),
        activeSnapshot
      ),
      replacedActiveTurn: false
    };
  }
  const baseWithoutActive = (baseMessages ?? activeSnapshot.messages).filter(
    (message) =>
      !liveTurnIds.has(message.id) &&
      !isOptimisticLocalMessage(message) &&
      !isTransientActiveAssistantMessage(message)
  );
  const sanitizedLoadedForReplace = loaded.filter(
    (message) => !isOptimisticLocalMessage(message) && !isTransientActiveAssistantMessage(message)
  );
  return {
    messages: mergeChatMessagesById(baseWithoutActive, sanitizedLoadedForReplace),
    replacedActiveTurn: true
  };
}
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function activeTurnStorageKey(targetThreadKey: string): string {
  return `${ACTIVE_WEB_TURN_STORAGE_PREFIX}${targetThreadKey}`;
}
function readStoredActiveTurnClientTurnId(targetThreadKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(activeTurnStorageKey(targetThreadKey));
    return value && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}
function writeStoredActiveTurnClientTurnId(targetThreadKey: string, clientTurnId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(activeTurnStorageKey(targetThreadKey), clientTurnId);
  } catch {
    /* non-critical */
  }
}
function clearStoredActiveTurnClientTurnId(targetThreadKey: string, clientTurnId?: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = activeTurnStorageKey(targetThreadKey);
    if (clientTurnId !== undefined && window.sessionStorage.getItem(key) !== clientTurnId) {
      return;
    }
    window.sessionStorage.removeItem(key);
  } catch {
    /* non-critical */
  }
}
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
export function useChat(threadKey: string, options?: UseChatOptions): UseChatReturn {
  const { getToken } = useAuth();
  const t = useTranslations("chat");
  const currentAssistantId = options?.assistantId ?? null;
  const assistantScopedThreadKey = scopeThreadKey(threadKey, options?.assistantId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [liveActivitiesByMessageId, setLiveActivitiesByMessageId] = useState<
    Record<string, LiveActivityEvent>
  >({});
  const [shadowRoutingLabelsByMessageId, setShadowRoutingLabelsByMessageId] = useState<
    Record<string, string>
  >({});
  const [chatId, setChatId] = useState<string | null>(null);
  const [activeMediaJobs, setActiveMediaJobs] = useState<WebChatActiveMediaJobState[]>([]);
  const [activeDocumentJobs, setActiveDocumentJobs] = useState<WebChatActiveDocumentJobState[]>([]);
  /* Slice 1.1 ��� per-thread streaming flag. */ /*  */ /* `isStreaming` used to be a single `useState(false)` local to this hook. */ /* That meant Chat A's in-flight stream blocked the composer in Chat B as */ /* soon as the user switched threads. We now lift "which threads are */ /* streaming?" into a shared registry keyed by `surfaceThreadKey`, so each */ /* thread has its own independent boolean and AbortController. */ /* See `streaming-threads.tsx`. */ const {
    activeThreads,
    markDocumentActive,
    markMediaActive,
    markStreaming
  } = useStreamingThreadsRegistry();
  const isStreaming = activeThreads.has(assistantScopedThreadKey);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [olderMessagesLoading, setOlderMessagesLoading] = useState(false);
  const [issue, setIssue] = useState<WebChatUxIssue | null>(null);
  const [compaction, setCompaction] = useState<ChatCompactionState | null>(null);
  const [recentAutoCompaction, setRecentAutoCompaction] =
    useState<RecentAutoCompactionNotice | null>(null);
  const [compactionRunning, setCompactionRunning] = useState(false);
  const [chatPlan, setChatPlan] = useState<RuntimeTodoItem[]>([]);
  const [chatPlanTotalCount, setChatPlanTotalCount] = useState(0);
  const [chatPlanWindowed, setChatPlanWindowed] = useState(false);
  // ADR-125 follow-up — chat-level active engagement state. Derived on the
  // API from `chat.skillDecisionState` and delivered via the history endpoint
  // (initial load) and the SSE turn-completion payload (live updates). The
  // header subtitle reads this directly so it survives history reloads.
  const [currentEngagement, setCurrentEngagement] = useState<{
    skillDisplayName: string;
    scenarioDisplayName: string | null;
  } | null>(null);
  const pendingBrowserLoginByThreadRef = useRef<Map<string, PendingBrowserLoginState>>(new Map());
  const browserLoginDismissedByThreadRef = useRef<Map<string, boolean>>(new Map());
  const [pendingBrowserLogin, setPendingBrowserLoginState] =
    useState<PendingBrowserLoginState | null>(null);
  const [browserLoginDismissed, setBrowserLoginDismissedState] = useState(false);
  const [pendingSendStatus, setPendingSendStatusState] = useState<PendingSendStatus | null>(null);
  /* Slice 1.1 ��� abort controllers are per-thread now (was a single `useRef`). */ /* The single ref clobbered itself when Chat A's stream cleaned up while */ /* Chat B was already mid-flight, which made `stop()` either no-op or abort */ /* the wrong stream. Keying by `threadKey` keeps each turn's controller */ /* independent until *its* stream completes or the user explicitly stops it */ /* from that thread's view. */ /*  */ /* Slice 1.2 ��� each entry now also carries the `clientTurnId` of the */ /* turn it owns. `stop()` needs the id to call the new */ /* `stopAssistantWebChatTurn` API (see `assistant-api-client.ts`); see */ /* the `stop` callback below for why this distinction matters */ /* (soft-detach vs hard-stop). */ const abortControllersByThreadRef =
    useRef<Map<string, { controller: AbortController; clientTurnId: string }>>(new Map());
  const hardStoppedClientTurnIdsRef = useRef<Set<string>>(new Set());
  const softDetachedClientTurnIdsRef = useRef<Set<string>>(new Set());
  const activeTurnSnapshotsRef = useRef<Map<string, ActiveTurnSnapshot>>(new Map());
  const cachedThreadHistorySnapshotsRef = useRef<Map<string, CachedThreadHistorySnapshot>>(
    new Map()
  );
  const cachedThreadKeyByChatIdRef = useRef<Map<string, string>>(new Map());
  const activeTurnRestoreTimersByKeyRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const softDetachReconcileTimersByThreadRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const historyRefreshInFlightByKeyRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const turnReattachInFlightByKeyRef = useRef<
    Map<string, Promise<"running" | "terminal" | "terminal_status" | "unknown">>
  >(new Map());
  const resumeRefreshInFlightRef = useRef(false);
  const historyLoadedRef = useRef<Set<string>>(new Set());
  const olderCursorRef = useRef<string | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const activeMediaJobsRef = useRef<WebChatActiveMediaJobState[]>([]);
  const activeDocumentJobsRef = useRef<WebChatActiveDocumentJobState[]>([]);
  const prevThreadKeyRef = useRef(assistantScopedThreadKey);
  const currentThreadKeyRef = useRef(assistantScopedThreadKey);
  const lastResumeRefreshAtRef = useRef(0);
  /* Single-slot pending send (ADR-075). Holds enough info to either retry the */ /* exact same payload or cancel and restore the draft text. */ const pendingSendRef =
    useRef<PendingSendSlot | null>(null);
  const pendingSendsByThreadRef = useRef<Map<string, PendingSendSlot>>(new Map());
  const pendingSendStatusRef = useRef<PendingSendStatus | null>(null);
  /**
   * Per-thread synchronous re-entrancy guard for `send()` / `sendWelcome()`.
   *
   * The `isStreaming` / `pendingSendStatusRef` guards inside `send()` are checked
   * before the optimistic slot is claimed. A second synchronous `send()`
   * invocation — e.g. the user pressing Enter twice between two key events, or
   * the composer's `Stop` flipping back to `Send` plus an immediate Enter —
   * can otherwise pass both guards while React state has not flipped yet and
   * the pending-slot ref is still null.
   *
   * Both turns then race: each calls `setMessages([...prev, userMsg, asst])`
   * appending its own optimistic pair, each calls
   * `activeTurnSnapshotsRef.set(threadKey, ...)` clobbering the other's
   * snapshot, both stream in parallel, and the loser's `finally` block ends
   * up running `cacheThreadHistorySnapshot()` against the winner's snapshot
   * (since snapshot is per-thread, single-slot). The visible state ends with
   * a phantom user bubble (the second send's optimistic that survived
   * cleanup) AND/OR a missing user bubble (the first send's optimistic that
   * was overwritten in cache); the cached state is corrupt for the next swap.
   *
   * This ref is set synchronously at the top of `send()` / `sendWelcome()`
   * BEFORE any `await`, so the second invocation hits the guard and returns
   * before it can claim a slot. It is cleared once the function reaches the
   * synchronous slot-claim block (`markStreaming(true)` +
   * `setThreadPendingSend(..., "sending")`), or earlier on every pre-flight
   * abort path (offline, missing token).
   */
  const sendInPreflightByThreadRef = useRef<Set<string>>(new Set());
  const setPendingSendStatus = useCallback((next: PendingSendStatus | null) => {
    pendingSendStatusRef.current = next;
    setPendingSendStatusState(next);
  }, []);
  const syncPendingBrowserLoginForThread = useCallback((targetThreadKey: string) => {
    const nextPending = pendingBrowserLoginByThreadRef.current.get(targetThreadKey) ?? null;
    const dismissed = browserLoginDismissedByThreadRef.current.get(targetThreadKey) === true;
    setPendingBrowserLoginState(nextPending);
    setBrowserLoginDismissedState(dismissed);
  }, []);
  const applyPendingBrowserLoginForThread = useCallback(
    (targetThreadKey: string, next: PendingBrowserLoginState | null) => {
      if (next === null) {
        pendingBrowserLoginByThreadRef.current.delete(targetThreadKey);
        browserLoginDismissedByThreadRef.current.delete(targetThreadKey);
      } else {
        pendingBrowserLoginByThreadRef.current.set(targetThreadKey, next);
        browserLoginDismissedByThreadRef.current.delete(targetThreadKey);
      }
      if (currentThreadKeyRef.current === targetThreadKey) {
        syncPendingBrowserLoginForThread(targetThreadKey);
      }
    },
    [syncPendingBrowserLoginForThread]
  );
  const dismissBrowserLogin = useCallback(() => {
    browserLoginDismissedByThreadRef.current.set(assistantScopedThreadKey, true);
    setBrowserLoginDismissedState(true);
  }, [assistantScopedThreadKey]);
  const reopenBrowserLogin = useCallback(() => {
    browserLoginDismissedByThreadRef.current.delete(assistantScopedThreadKey);
    setBrowserLoginDismissedState(false);
  }, [assistantScopedThreadKey]);
  const clearPendingBrowserLogin = useCallback(() => {
    applyPendingBrowserLoginForThread(assistantScopedThreadKey, null);
  }, [applyPendingBrowserLoginForThread, assistantScopedThreadKey]);
  const abortBrowserLogin = useCallback(async () => {
    const pending = pendingBrowserLoginByThreadRef.current.get(assistantScopedThreadKey) ?? null;
    if (pending?.completionMode === "assist") {
      browserLoginDismissedByThreadRef.current.set(assistantScopedThreadKey, true);
      setBrowserLoginDismissedState(true);
      return;
    }
    browserLoginDismissedByThreadRef.current.delete(assistantScopedThreadKey);
    setBrowserLoginDismissedState(false);
    applyPendingBrowserLoginForThread(assistantScopedThreadKey, null);
    const assistantId = options?.assistantId;
    if (pending !== null && typeof assistantId === "string" && assistantId.length > 0) {
      try {
        const token = await getToken();
        if (token) {
          const bridgeStatus =
            getCachedCurrentLocalBrowserBridgeStatus() ??
            (await getCurrentLocalBrowserBridgeStatus(250).catch(() => null));
          const bridgeDeviceId =
            bridgeStatus?.connected === true &&
            bridgeStatus.assistantId === assistantId &&
            bridgeStatus.workspaceId === pending.workspaceId
              ? bridgeStatus.bridgeDeviceId
              : null;
          await deleteAssistantBrowserProfile(
            token,
            assistantId,
            pending.profileId,
            bridgeDeviceId
          );
        }
      } catch {
        // Best-effort provider cleanup; still clear local pending-login state.
      }
    }
  }, [applyPendingBrowserLoginForThread, assistantScopedThreadKey, getToken, options?.assistantId]);
  currentThreadKeyRef.current = assistantScopedThreadKey;
  const setThreadPendingSend = useCallback(
    (targetThreadKey: string, next: PendingSendSlot | null) => {
      if (next === null) {
        pendingSendsByThreadRef.current.delete(targetThreadKey);
      } else {
        pendingSendsByThreadRef.current.set(targetThreadKey, next);
      }
      if (currentThreadKeyRef.current === targetThreadKey) {
        pendingSendRef.current = next;
        setPendingSendStatus(next?.status ?? null);
      }
    },
    [setPendingSendStatus]
  );
  const applyThreadMessages = useCallback(
    (targetThreadKey: string, updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      const snapshot = activeTurnSnapshotsRef.current.get(targetThreadKey);
      if (snapshot !== undefined) {
        const nextSnapshot = {
          ...snapshot,
          messages: updater(snapshot.messages)
        };
        activeTurnSnapshotsRef.current.set(targetThreadKey, nextSnapshot);
        auditActiveTurnSnapshotMessages("applyThreadMessages", targetThreadKey, nextSnapshot);
      }
      if (currentThreadKeyRef.current === targetThreadKey) {
        setMessages(updater);
      }
    },
    []
  );
  const applyThreadLiveActivities = useCallback(
    (
      targetThreadKey: string,
      updater: (prev: Record<string, LiveActivityEvent>) => Record<string, LiveActivityEvent>
    ) => {
      const snapshot = activeTurnSnapshotsRef.current.get(targetThreadKey);
      if (snapshot !== undefined) {
        activeTurnSnapshotsRef.current.set(targetThreadKey, {
          ...snapshot,
          liveActivitiesByMessageId: updater(snapshot.liveActivitiesByMessageId)
        });
      }
      if (currentThreadKeyRef.current === targetThreadKey) {
        setLiveActivitiesByMessageId(updater);
      }
    },
    []
  );
  const clearThreadLiveActivity = useCallback(
    (targetThreadKey: string, assistantMessageIdToClear: string) => {
      applyThreadLiveActivities(targetThreadKey, (prev) => {
        if (!(assistantMessageIdToClear in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[assistantMessageIdToClear];
        return next;
      });
    },
    [applyThreadLiveActivities]
  );
  const setThreadChatId = useCallback((targetThreadKey: string, nextChatId: string) => {
    const snapshot = activeTurnSnapshotsRef.current.get(targetThreadKey);
    if (snapshot !== undefined) {
      activeTurnSnapshotsRef.current.set(targetThreadKey, { ...snapshot, chatId: nextChatId });
    }
    if (currentThreadKeyRef.current === targetThreadKey) {
      setChatId(nextChatId);
      activeChatIdRef.current = nextChatId;
    }
  }, []);
  const resolveKnownChatIdForThread = useCallback((targetThreadKey: string): string | null => {
    const activeSnapshot = activeTurnSnapshotsRef.current.get(targetThreadKey);
    if (activeSnapshot?.chatId) {
      return activeSnapshot.chatId;
    }
    const cachedSnapshot = cachedThreadHistorySnapshotsRef.current.get(targetThreadKey);
    if (cachedSnapshot?.chatId) {
      return cachedSnapshot.chatId;
    }
    if (currentThreadKeyRef.current === targetThreadKey) {
      return activeChatIdRef.current;
    }
    return null;
  }, []);
  const cacheThreadHistorySnapshot = useCallback(
    (targetThreadKey: string, snapshot: ActiveTurnSnapshot) => {
      const existing = cachedThreadHistorySnapshotsRef.current.get(targetThreadKey);
      // Strip OPTIMISTIC `local-user-*` / `local-assistant-*` and
      // server-projected `active-assistant-*` ids from the existing
      // cached base before merging with the snapshot. Without this
      // filter, a cache write that happened DURING the optimistic
      // window of `send()` (e.g. a `loadHistory` that ran between
      // send() and `onStarted`) leaves the local-* user/assistant in
      // the cached set even after `onStarted` has remapped the
      // snapshot to canonical server ids — and the next swap-back
      // restore then merges the cached `local-user-*` AND the
      // snapshot's `server-user-*` side by side, rendering the
      // founder's reported "two of my bubbles, one is a phantom".
      const filteredExisting = (existing?.messages ?? []).filter(
        (message) =>
          !isOptimisticLocalMessage(message) && !isTransientActiveAssistantMessage(message)
      );
      const messages = dropSupersededLiveAssistantPlaceholder(
        mergeChatMessagesById(filteredExisting, snapshot.messages),
        snapshot
      );
      cachedThreadHistorySnapshotsRef.current.set(targetThreadKey, {
        ...snapshot,
        messages,
        olderCursor: existing?.olderCursor ?? null,
        hasOlderMessages: existing?.hasOlderMessages ?? false,
        activeMediaJobs:
          existing?.activeMediaJobs ??
          (currentThreadKeyRef.current === targetThreadKey ? activeMediaJobsRef.current : []),
        activeDocumentJobs:
          existing?.activeDocumentJobs ??
          (currentThreadKeyRef.current === targetThreadKey ? activeDocumentJobsRef.current : [])
      });
      if (snapshot.chatId !== null) {
        cachedThreadKeyByChatIdRef.current.set(snapshot.chatId, targetThreadKey);
      }
    },
    []
  );
  const replaceActiveMediaJobs = useCallback(
    (next: WebChatActiveMediaJobState[]) => {
      activeMediaJobsRef.current = next;
      setActiveMediaJobs(next);
      markMediaActive(currentThreadKeyRef.current, next.length > 0);
    },
    [markMediaActive]
  );
  const replaceActiveDocumentJobs = useCallback(
    (next: WebChatActiveDocumentJobState[]) => {
      activeDocumentJobsRef.current = next;
      setActiveDocumentJobs(next);
      markDocumentActive(currentThreadKeyRef.current, next.length > 0);
    },
    [markDocumentActive]
  );
  const clearSoftDetachReconcileTimer = useCallback((targetThreadKey: string) => {
    const timer = softDetachReconcileTimersByThreadRef.current.get(targetThreadKey);
    if (timer !== undefined) {
      clearTimeout(timer);
      softDetachReconcileTimersByThreadRef.current.delete(targetThreadKey);
    }
  }, []);
  const clearActiveTurnRestoreTimer = useCallback((restoreKey: string) => {
    const timer = activeTurnRestoreTimersByKeyRef.current.get(restoreKey);
    if (timer !== undefined) {
      clearTimeout(timer);
      activeTurnRestoreTimersByKeyRef.current.delete(restoreKey);
    }
  }, []);
  const finalizeReconciledDetachedTurn = useCallback(
    (targetThreadKey: string) => {
      clearSoftDetachReconcileTimer(targetThreadKey);
      markStreaming(targetThreadKey, false);
      const snapshot = activeTurnSnapshotsRef.current.get(targetThreadKey);
      if (snapshot !== undefined) {
        cacheThreadHistorySnapshot(targetThreadKey, snapshot);
        clearStoredActiveTurnClientTurnId(targetThreadKey, snapshot.clientTurnId);
      }
      activeTurnSnapshotsRef.current.delete(targetThreadKey);
      const controllerEntry = abortControllersByThreadRef.current.get(targetThreadKey);
      if (snapshot !== undefined) {
        softDetachedClientTurnIdsRef.current.delete(snapshot.clientTurnId);
      }
      controllerEntry?.controller.abort();
      abortControllersByThreadRef.current.delete(targetThreadKey);
    },
    [cacheThreadHistorySnapshot, clearSoftDetachReconcileTimer, markStreaming]
  );
  if (prevThreadKeyRef.current !== assistantScopedThreadKey) {
    const outgoingThreadKey = prevThreadKeyRef.current;
    prevThreadKeyRef.current = assistantScopedThreadKey;
    // Sync the OUTGOING thread's full visible state into the CACHE
    // (NOT into `activeTurnSnapshotsRef`). The snapshot is initialised
    // by `send()` with only `[liveUser, liveAssistant]` and is the
    // source of truth for the live turn ids; promoting full visible
    // history into snapshot.messages causes a regression where, on
    // swap-back, the swap-back merge below treats every off-screen id
    // promoted into snapshot.messages as a "live turn carry-over" and
    // re-appends it AT THE END of the merged window when the
    // paginated cache no longer contains it. Founder repro:
    // `send("Напиши длинный спич... ещё раз")`, before the
    // post-render `loadHistory` rehydrates snapshot.A, swap A→B→A;
    // an old user message from the off-screen top of chat A
    // ("когда openai научиться...") suddenly re-appears RIGHT BEFORE
    // the live assistant. F5 fixes it because hard reload rebuilds
    // cache from authoritative paginated server history. Writing into
    // cache (which is the proper place for "what the user was
    // looking at last") preserves the swap-out window for the
    // swap-back restore below WITHOUT polluting the live snapshot.
    if (outgoingThreadKey !== assistantScopedThreadKey) {
      const outgoingSnapshot = activeTurnSnapshotsRef.current.get(outgoingThreadKey);
      if (outgoingSnapshot !== undefined && messages.length > 0) {
        const sanitizedVisible = messages.filter(
          (message) =>
            !isOptimisticLocalMessage(message) && !isTransientActiveAssistantMessage(message)
        );
        if (sanitizedVisible.length > 0) {
          const existingCache = cachedThreadHistorySnapshotsRef.current.get(outgoingThreadKey);
          const filteredCache = (existingCache?.messages ?? []).filter(
            (message) =>
              !isOptimisticLocalMessage(message) && !isTransientActiveAssistantMessage(message)
          );
          // Cache first preserves the canonical paginated order;
          // `sanitizedVisible` only contributes ids the cache has not
          // seen yet (e.g. older messages the user scrolled up to load
          // via `loadOlderMessages`, or the live turn pair that has
          // not yet been written to cache). `mergeChatMessagesById` is
          // last-write-wins on value, so any fresher status from the
          // visible array still overrides cached entries.
          const merged = mergeChatMessagesById(filteredCache, sanitizedVisible);
          const nextCache = {
            clientTurnId: existingCache?.clientTurnId ?? outgoingSnapshot.clientTurnId,
            messages: merged,
            liveUserMessageId:
              existingCache?.liveUserMessageId ?? outgoingSnapshot.liveUserMessageId,
            liveAssistantMessageId:
              existingCache?.liveAssistantMessageId ?? outgoingSnapshot.liveAssistantMessageId,
            liveActivitiesByMessageId:
              existingCache?.liveActivitiesByMessageId ??
              outgoingSnapshot.liveActivitiesByMessageId,
            shadowRoutingLabelsByMessageId:
              existingCache?.shadowRoutingLabelsByMessageId ??
              outgoingSnapshot.shadowRoutingLabelsByMessageId,
            chatId: existingCache?.chatId ?? outgoingSnapshot.chatId,
            compactionRunning:
              existingCache?.compactionRunning ?? outgoingSnapshot.compactionRunning,
            olderCursor: existingCache?.olderCursor ?? null,
            hasOlderMessages: existingCache?.hasOlderMessages ?? false,
            activeMediaJobs: existingCache?.activeMediaJobs ?? activeMediaJobs,
            activeDocumentJobs: existingCache?.activeDocumentJobs ?? activeDocumentJobs
          };
          cachedThreadHistorySnapshotsRef.current.set(outgoingThreadKey, nextCache);
          auditActiveTurnSnapshotMessages("swap-out-cache-sync", outgoingThreadKey, nextCache);
          if (outgoingSnapshot.chatId !== null) {
            cachedThreadKeyByChatIdRef.current.set(outgoingSnapshot.chatId, outgoingThreadKey);
          }
        }
      }
    }
    const pendingForThread = pendingSendsByThreadRef.current.get(assistantScopedThreadKey) ?? null;
    const cachedHistorySnapshot =
      cachedThreadHistorySnapshotsRef.current.get(assistantScopedThreadKey);
    const liveSnapshot =
      activeThreads.has(assistantScopedThreadKey) || pendingForThread !== null
        ? activeTurnSnapshotsRef.current.get(assistantScopedThreadKey)
        : undefined;
    const restoredSnapshot = liveSnapshot ?? cachedHistorySnapshot;
    // RESTORE the FULL visible state by merging the cached window
    // (older history + previously-committed turns) with ONLY the live
    // turn slice of the snapshot. We MUST restrict the snapshot
    // contribution to messages whose id is in `liveTurnIds`: other
    // code paths (`applyThreadMessages`, `loadHistory`'s post-merge
    // write at line ~2987 / ~3065) intentionally write the full
    // visible window into `snapshot.messages` for other purposes,
    // and a permissive filter here re-introduces those non-live
    // committed entries at the END of the merge whenever the
    // paginated cache does not include them — which is exactly the
    // founder-reported "phantom user message from the off-screen
    // top of the chat shows up right before the live assistant".
    const restoredMessages = (() => {
      if (liveSnapshot === undefined) {
        // Even on the no-live-snapshot path, never resurrect a stale
        // optimistic / transient placeholder that may have leaked
        // into cache from an earlier in-flight write.
        return (restoredSnapshot?.messages ?? []).filter(
          (message) =>
            !isOptimisticLocalMessage(message) && !isTransientActiveAssistantMessage(message)
        );
      }
      const liveUserId = liveSnapshot.liveUserMessageId;
      const liveAssistantId = liveSnapshot.liveAssistantMessageId;
      // STRIP optimistic / transient ids from the cached base. They are
      // by definition transient (the snapshot's canonical
      // liveUserMessageId / liveAssistantMessageId is the truth) and
      // leaving them in produces the duplicate-bubble symptom: cached
      // has `local-user-XXX` from a write that happened before
      // `onStarted` remapped it, the snapshot now carries the canonical
      // `server-user-NEW`, and the merge appends both side by side.
      const cachedBase = (cachedHistorySnapshot?.messages ?? []).filter(
        (message) =>
          !isOptimisticLocalMessage(message) && !isTransientActiveAssistantMessage(message)
      );
      const liveTurnIds = new Set<string>(
        [liveUserId, liveAssistantId].filter((value): value is string => typeof value === "string")
      );
      const terminalReplacementAssistantId = getSnapshotTerminalAssistantReplacementId(
        liveSnapshot,
        liveTurnIds
      );
      // Snapshot restore is allowed to contribute only the canonical live
      // pair. Committed history belongs to cache/server history; accepting
      // arbitrary assistant messages from snapshot lets another thread's
      // assistant tail reappear during A->B->A swaps.
      const liveTurnMessages = liveSnapshot.messages.filter(
        (message) => liveTurnIds.has(message.id) || message.id === terminalReplacementAssistantId
      );
      return mergeChatMessagesById(cachedBase, liveTurnMessages);
    })();
    setMessages(restoredMessages);
    if (liveSnapshot !== undefined && restoredMessages !== liveSnapshot.messages) {
      const nextSnapshot = {
        ...liveSnapshot,
        messages: restoredMessages
      };
      activeTurnSnapshotsRef.current.set(threadKey, nextSnapshot);
      auditActiveTurnSnapshotMessages("swap-back-restore", threadKey, nextSnapshot);
    }
    setActivities([]);
    setLiveActivitiesByMessageId(liveSnapshot?.liveActivitiesByMessageId ?? {});
    setShadowRoutingLabelsByMessageId(liveSnapshot?.shadowRoutingLabelsByMessageId ?? {});
    setChatId(restoredSnapshot?.chatId ?? null);
    setIssue(null);
    setCompaction(null);
    setRecentAutoCompaction(null);
    setCompactionRunning(restoredSnapshot?.compactionRunning ?? false);
    // Plan and skill engagement are chat-owned. Never let the previous
    // thread's chrome survive while the next thread (or a fresh draft)
    // resolves its own history.
    setChatPlan([]);
    setChatPlanTotalCount(0);
    setChatPlanWindowed(false);
    setCurrentEngagement(null);
    setHasOlderMessages(cachedHistorySnapshot?.hasOlderMessages ?? false);
    replaceActiveMediaJobs(cachedHistorySnapshot?.activeMediaJobs ?? []);
    replaceActiveDocumentJobs(cachedHistorySnapshot?.activeDocumentJobs ?? []);
    /*     * Optimistically flip historyLoading to true the moment the user     * navigates to a different thread. Without this, there is one render     * frame between the synchronous reset above and the post-render effect     * in `chat/page.tsx` that triggers `loadHistory()` ��� and during that     * frame `messages.length === 0 && historyLoading === false`, which     * renders the EmptyState. On a slow fetch the EmptyState then flickers     * for the entire 0.5���1s the history takes to arrive (founder report     * 2026-04-25). The `markHistoryEmpty()` callback below clears this back     * to false when the active thread is brand-new and has no history to     * load.     */ setHistoryLoading(
      restoredSnapshot === undefined
    );
    historyLoadedRef.current = new Set();
    olderCursorRef.current = cachedHistorySnapshot?.olderCursor ?? null;
    activeChatIdRef.current = restoredSnapshot?.chatId ?? null;
    pendingSendRef.current = pendingForThread;
    pendingSendStatusRef.current = pendingForThread?.status ?? null;
    setPendingSendStatusState(pendingForThread?.status ?? null);
    syncPendingBrowserLoginForThread(assistantScopedThreadKey);
  }
  const clearIssue = useCallback(() => setIssue(null), []);
  const reportIssue = useCallback((error: unknown) => {
    setIssue(toWebChatUxIssue(error));
  }, []);
  const stop = useCallback(() => {
    /* Per-thread stop: abort only the stream attached to the thread the */ /* user is currently looking at. Streams in other threads keep going so */ /* switching away from a generating image doesn't kill it. */ /*  */ /* Slice 1.2 ��� `stop()` is the *user-visible* hard-stop affordance */ /* (the Stop button on the composer). The API can no longer infer */ /* hard-stop from a dead SSE socket, because that signal also fires */ /* for soft-detach cases like locking the screen mid-image-generate. */ /* So before tearing down the local controller we send an explicit */ /* `POST /assistant/chat/web/stop` with the in-flight `clientTurnId`, */ /* which is the only path that flips the server-side abort signal. */ /* The POST is best-effort and intentionally not awaited: a failure */ /* here just means the runtime keeps generating in the background */ /* (the same fate as a soft-detach), which is strictly safer than */ /* the pre-Slice-1.2 "always kill on any disconnect" default. */ const entry =
      abortControllersByThreadRef.current.get(assistantScopedThreadKey);
    const snapshotClientTurnId =
      activeTurnSnapshotsRef.current.get(assistantScopedThreadKey)?.clientTurnId;
    const clientTurnId = entry?.clientTurnId ?? snapshotClientTurnId;
    if (clientTurnId === undefined) {
      return;
    }
    hardStoppedClientTurnIdsRef.current.add(clientTurnId);
    void (async () => {
      try {
        const token = await getToken();
        if (token === null || token === undefined) {
          return;
        }
        await Promise.race([
          stopAssistantWebChatTurn(token, clientTurnId),
          delay(HARD_STOP_SERVER_ACK_TIMEOUT_MS)
        ]);
      } catch (error) {
        reportIssue(error);
      } finally {
        entry?.controller.abort();
        abortControllersByThreadRef.current.delete(threadKey);
      }
    })();
  }, [assistantScopedThreadKey, getToken, reportIssue, threadKey]);
  const refreshCompactionState = useCallback(
    async (
      targetChatId: string,
      options?: { baselineCompaction?: ChatCompactionState | null | undefined }
    ) => {
      const token = await getToken({ skipCache: true });
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
  const refreshChatPlan = useCallback(
    async (requestedChatId?: string | null, requestedThreadKey?: string): Promise<void> => {
      const targetChatId = requestedChatId ?? activeChatIdRef.current ?? chatId;
      const targetThreadKey = requestedThreadKey ?? currentThreadKeyRef.current;
      if (!targetChatId) return;
      const token = await getToken({ skipCache: true });
      if (!token) return;
      try {
        const result = await getAssistantWebChatPlan(token, targetChatId);
        // A late response from the previous chat must not repopulate the
        // newly-opened draft/thread after its synchronous reset.
        if (
          currentThreadKeyRef.current !== targetThreadKey ||
          activeChatIdRef.current !== targetChatId
        ) {
          return;
        }
        setChatPlan(result.todos);
        setChatPlanTotalCount(result.totalCount);
        setChatPlanWindowed(result.windowed);
      } catch {
        /* non-critical */
      }
    },
    [chatId, getToken]
  );
  const clearChatPlan = useCallback(async () => {
    const targetChatId = activeChatIdRef.current ?? chatId;
    const targetThreadKey = currentThreadKeyRef.current;
    if (!targetChatId) return;
    const token = await getToken({ skipCache: true });
    if (!token) return;
    try {
      await clearAssistantWebChatPlan(token, targetChatId);
      await refreshChatPlan(targetChatId, targetThreadKey);
    } catch {
      /* non-critical */
    }
  }, [chatId, getToken, refreshChatPlan]);
  const refreshLatestHistory = useCallback(
    async (
      targetChatId: string,
      options?: { clearIssueOnReconcile?: boolean; targetThreadKey?: string | undefined }
    ): Promise<boolean> => {
      const targetThreadKey = options?.targetThreadKey ?? currentThreadKeyRef.current;
      const refreshKey = `${targetThreadKey}:${targetChatId}:${
        options?.clearIssueOnReconcile === true ? "clear" : "keep"
      }`;
      const existingRefresh = historyRefreshInFlightByKeyRef.current.get(refreshKey);
      if (existingRefresh !== undefined) {
        return existingRefresh;
      }
      const refreshPromise = (async (): Promise<boolean> => {
        const token = await getToken({ skipCache: true });
        if (!token) return false;
        let reconciledOptimisticTurn = false;
        try {
          const page = await getChatMessages(token, targetChatId, undefined, 20);
          const nextActiveMediaJobs = page.activeMediaJobs ?? [];
          const nextActiveDocumentJobs = page.activeDocumentJobs ?? [];
          const rawLoaded = page.messages
            .map(toCommittedChatMessage)
            .filter((message): message is ChatMessage => message !== null);
          const localAssistantMessages = [
            ...(activeTurnSnapshotsRef.current.get(targetThreadKey)?.messages ?? []),
            ...(cachedThreadHistorySnapshotsRef.current.get(targetThreadKey)?.messages ?? []),
            ...(currentThreadKeyRef.current === targetThreadKey ? messages : [])
          ];
          const loaded = reconcileServerAssistantMessagesWithLocal(
            rawLoaded,
            localAssistantMessages
          );
          if (loaded.length === 0) {
            return false;
          }
          const activeSnapshot = activeTurnSnapshotsRef.current.get(targetThreadKey);
          const cachedSnapshot = cachedThreadHistorySnapshotsRef.current.get(targetThreadKey);
          // SCOPE all live-turn id checks here to the snapshot's `liveUserMessageId` /
          // `liveAssistantMessageId` rather than to every id present in
          // `activeSnapshot.messages`. After a thread switch / loadHistory the
          // snapshot.messages set may legitimately contain older committed user
          // and assistant ids that are NOT part of the current live turn; using
          // the full id set caused stale committed history to look like "the
          // active turn already landed", which then tore down the live stream.
          const liveUserId = activeSnapshot?.liveUserMessageId ?? null;
          const liveAssistantId = activeSnapshot?.liveAssistantMessageId ?? null;
          const liveTurnIds = new Set<string>(
            [liveUserId, liveAssistantId].filter(
              (value): value is string => typeof value === "string"
            )
          );
          const liveUserIsOptimistic = liveUserId !== null && liveUserId.startsWith("local-user-");
          const liveAssistantIsOptimistic =
            liveAssistantId !== null && isLocalScopedAssistantId(liveAssistantId);
          const currentBaseMessages = cachedSnapshot?.messages ?? activeSnapshot?.messages ?? [];
          const currentBaseMessageIds = new Set(currentBaseMessages.map((message) => message.id));
          let loadedHasActiveUserMessage = false;
          let loadedHasAssistantMessageAfterActiveUser = false;
          let loadedIntroducedCommittedTurnTail = false;
          if (activeSnapshot !== undefined) {
            loadedHasActiveUserMessage =
              liveUserId !== null &&
              !liveUserIsOptimistic &&
              loaded.some((message) => message.id === liveUserId);
            const activeUserIndexInLoaded =
              liveUserId === null || liveUserIsOptimistic
                ? -1
                : loaded.findIndex((message) => message.id === liveUserId);
            loadedHasAssistantMessageAfterActiveUser =
              activeUserIndexInLoaded >= 0 &&
              loaded
                .slice(activeUserIndexInLoaded + 1)
                .some(
                  (message) =>
                    message.role === "assistant" &&
                    !isLocalScopedAssistantId(message.id) &&
                    message.id !== liveAssistantId
                );
            const newLoadedUserMessages = loaded.filter(
              (message) => message.role === "user" && !currentBaseMessageIds.has(message.id)
            );
            const newLoadedAssistantMessages = loaded.filter(
              (message) => message.role === "assistant" && !currentBaseMessageIds.has(message.id)
            );
            loadedIntroducedCommittedTurnTail =
              liveUserIsOptimistic &&
              liveAssistantIsOptimistic &&
              loaded.length > 0 &&
              loaded[loaded.length - 1]?.role === "assistant" &&
              newLoadedUserMessages.length === 1 &&
              newLoadedAssistantMessages.length === 1;
            if (loadedHasActiveUserMessage && loadedHasAssistantMessageAfterActiveUser) {
              reconciledOptimisticTurn = true;
            }
            if (loadedIntroducedCommittedTurnTail) {
              reconciledOptimisticTurn = true;
            }
          }
          applyThreadMessages(targetThreadKey, (prev) => {
            const loadedById = new Map(loaded.map((message) => [message.id, message]));
            const prevIds = new Set(prev.map((message) => message.id));
            const newServerAssistantMessages = loaded.filter(
              (message) => message.role === "assistant" && !prevIds.has(message.id)
            );
            const newServerUserMessages = loaded.filter(
              (message) => message.role === "user" && !prevIds.has(message.id)
            );
            const loadedIntroducedCommittedTurnTailFromPrev =
              liveUserIsOptimistic &&
              liveAssistantIsOptimistic &&
              loaded.length > 0 &&
              loaded[loaded.length - 1]?.role === "assistant" &&
              newServerUserMessages.length === 1 &&
              newServerAssistantMessages.length === 1;
            const shouldReplaceActiveTurn =
              (loadedHasActiveUserMessage && loadedHasAssistantMessageAfterActiveUser) ||
              loadedIntroducedCommittedTurnTail ||
              loadedIntroducedCommittedTurnTailFromPrev;
            if (shouldReplaceActiveTurn) {
              reconciledOptimisticTurn = true;
            }
            const next = prev.flatMap((message) => {
              const replacement = loadedById.get(message.id);
              if (replacement !== undefined) {
                return [replacement];
              }
              if (
                shouldReplaceActiveTurn &&
                (liveTurnIds.has(message.id) ||
                  isOptimisticLocalMessage(message) ||
                  isTransientActiveAssistantMessage(message))
              ) {
                for (const attachment of message.attachments ?? []) {
                  if (attachment.localPreviewUrl !== undefined) {
                    URL.revokeObjectURL(attachment.localPreviewUrl);
                  }
                }
                return [];
              }
              return [message];
            });
            const nextIds = new Set(next.map((message) => message.id));
            const missing =
              activeSnapshot !== undefined && !shouldReplaceActiveTurn
                ? []
                : loaded.filter((message) => !nextIds.has(message.id));
            const merged = [...next, ...missing];
            if (activeSnapshot !== undefined) {
              const liveTurnIds = new Set<string>(
                [activeSnapshot.liveUserMessageId, activeSnapshot.liveAssistantMessageId].filter(
                  (value): value is string => typeof value === "string"
                )
              );
              const loadedIds = new Set(loaded.map((message) => message.id));
              return merged.filter(
                (message) =>
                  liveTurnIds.has(message.id) ||
                  !currentBaseMessageIds.has(message.id) ||
                  loadedIds.has(message.id)
              );
            }
            return merged;
          });
          olderCursorRef.current = page.nextCursor;
          if (currentThreadKeyRef.current === targetThreadKey) {
            activeChatIdRef.current = targetChatId;
            setHasOlderMessages(page.nextCursor !== null);
            replaceActiveMediaJobs(nextActiveMediaJobs);
            replaceActiveDocumentJobs(nextActiveDocumentJobs);
            setChatId(targetChatId);
          }
          const cachedThreadKey =
            cachedThreadKeyByChatIdRef.current.get(targetChatId) ?? targetThreadKey;
          const cachedHistorySnapshotForMediaJobs =
            cachedThreadHistorySnapshotsRef.current.get(cachedThreadKey);
          if (cachedHistorySnapshotForMediaJobs !== undefined) {
            cachedThreadHistorySnapshotsRef.current.set(cachedThreadKey, {
              ...cachedHistorySnapshotForMediaJobs,
              activeMediaJobs: nextActiveMediaJobs,
              activeDocumentJobs: nextActiveDocumentJobs
            });
          }
          markMediaActive(cachedThreadKey, nextActiveMediaJobs.length > 0);
          markDocumentActive(cachedThreadKey, nextActiveDocumentJobs.length > 0);
          historyLoadedRef.current.add(targetChatId);
          void refreshCompactionState(targetChatId);
          if (
            options?.clearIssueOnReconcile === true &&
            currentThreadKeyRef.current === targetThreadKey
          ) {
            setIssue(null);
            setThreadPendingSend(targetThreadKey, null);
          }
          return reconciledOptimisticTurn;
        } catch {
          /* non-critical resume refresh */ return false;
        }
      })();
      historyRefreshInFlightByKeyRef.current.set(refreshKey, refreshPromise);
      try {
        return await refreshPromise;
      } finally {
        if (historyRefreshInFlightByKeyRef.current.get(refreshKey) === refreshPromise) {
          historyRefreshInFlightByKeyRef.current.delete(refreshKey);
        }
      }
    },
    [applyThreadMessages, getToken, refreshCompactionState, setThreadPendingSend]
  );
  const noteDocumentJobStarted = useCallback(() => {
    const nowIso = new Date().toISOString();
    if (activeDocumentJobsRef.current.length === 0) {
      replaceActiveDocumentJobs([
        {
          id: `optimistic-document-job-${nowIso}`,
          documentType: "presentation",
          descriptorMode: "export_or_redeliver",
          status: "queued",
          createdAt: nowIso,
          startedAt: null,
          updatedAt: nowIso
        }
      ]);
    } else {
      replaceActiveDocumentJobs(activeDocumentJobsRef.current);
    }
    const knownChatId = resolveKnownChatIdForThread(currentThreadKeyRef.current);
    if (knownChatId !== null) {
      void refreshLatestHistory(knownChatId, { targetThreadKey: currentThreadKeyRef.current });
    }
  }, [refreshLatestHistory, replaceActiveDocumentJobs, resolveKnownChatIdForThread]);
  const applyTurnStatusState = useCallback(
    (
      targetThreadKey: string,
      clientTurnId: string,
      status: WebChatTurnStatusState
    ): "running" | "terminal" | "terminal_status" | "unknown" => {
      const userMessage = status.userMessage ? toCommittedChatMessage(status.userMessage) : null;
      const rawAssistantMessage = status.assistantMessage
        ? toCommittedChatMessage(status.assistantMessage)
        : null;
      const existingSnapshot = activeTurnSnapshotsRef.current.get(targetThreadKey);
      const cachedSnapshot = cachedThreadHistorySnapshotsRef.current.get(targetThreadKey);
      const localMessages =
        existingSnapshot?.messages ??
        cachedSnapshot?.messages ??
        (currentThreadKeyRef.current === targetThreadKey ? messages : []);
      const assistantMessage =
        rawAssistantMessage !== null
          ? reconcileServerAssistantMessageWithLocal(rawAssistantMessage, localMessages)
          : null;
      const followUpAssistantMessage = status.followUpAssistantMessage
        ? toCommittedChatMessage(status.followUpAssistantMessage)
        : null;
      if (status.status === "accepted" || status.status === "running") {
        if (userMessage === null && targetThreadKey !== WELCOME_THREAD_KEY) {
          return "unknown";
        }
        // Resolve the LIVE assistant by `liveAssistantMessageId`, not by
        // "first assistant role found in snapshot.messages". After a
        // loadHistory merge, snapshot.messages may contain OLDER committed
        // assistants; `.find(role==="assistant")` would return the wrong
        // bubble and the running-status reattach would copy its id /
        // content into the live placeholder.
        const liveAssistantIdFromSnapshot = existingSnapshot?.liveAssistantMessageId ?? null;
        const existingAssistant =
          (liveAssistantIdFromSnapshot !== null
            ? existingSnapshot?.messages.find(
                (message) =>
                  message.role === "assistant" && message.id === liveAssistantIdFromSnapshot
              )
            : undefined) ??
          (currentThreadKeyRef.current === targetThreadKey
            ? messages.find(
                (message) => message.role === "assistant" && message.status === "streaming"
              )
            : undefined);
        const statusAssistantMessage = assistantMessage ?? null;
        // A focus/visibility resume can ask for turn-status while the original
        // POST /stream is still alive. In that case the captured primary stream
        // handlers still write to `assistantMsgId`, so a running status must not
        // swap the live assistant id to the server-projected id before the
        // primary `onCompleted` maps it to the committed message id.
        const primaryStreamStillOwnsTurn =
          abortControllersByThreadRef.current.get(targetThreadKey)?.clientTurnId === clientTurnId &&
          !softDetachedClientTurnIdsRef.current.has(clientTurnId);
        const fallbackAssistantMessage = existingAssistant ?? {
          id: `local-assistant-${clientTurnId}`,
          role: "assistant" as const,
          content: "",
          status: "streaming" as const,
          thought: "",
          thoughtStartedAt: null,
          thoughtFinishedAt: null
        };
        const liveAssistantMessage: ChatMessage = {
          ...fallbackAssistantMessage,
          ...(statusAssistantMessage === null
            ? {}
            : {
                id: primaryStreamStillOwnsTurn
                  ? fallbackAssistantMessage.id
                  : statusAssistantMessage.id,
                thought: statusAssistantMessage.thought,
                thoughtStartedAt: statusAssistantMessage.thoughtStartedAt,
                thoughtFinishedAt: statusAssistantMessage.thoughtFinishedAt
              }),
          content:
            statusAssistantMessage !== null &&
            statusAssistantMessage.content.length > fallbackAssistantMessage.content.length
              ? statusAssistantMessage.content
              : fallbackAssistantMessage.content,
          status: "streaming",
          // Running/accepted turn-status is only live-progress truth.
          // Never hydrate attachment blocks from it, or an older committed
          // assistant message returned by reattach/status can visually stick
          // its media onto the new pending bubble.
          attachments: undefined
        };
        const currentActivity = status.currentActivity;
        const nextLiveActivities =
          currentActivity === null
            ? (existingSnapshot?.liveActivitiesByMessageId ?? {})
            : {
                [liveAssistantMessage.id]: buildToolLiveActivity({
                  assistantMessageId: liveAssistantMessage.id,
                  toolName: currentActivity.toolName,
                  phase: currentActivity.phase,
                  isError: currentActivity.isError
                })
              };
        // PRESERVE EXISTING THREAD HISTORY when applying a running-status
        // refresh. The previous implementation replaced
        // `snapshot.messages` and the visible state with just
        // `[userMessage, liveAssistantMessage]`, which discarded all the
        // older committed history above the live turn. That manifested as
        // "the user bubble disappears after a chat swap" / "everything
        // above the live answer is gone after focus/visibility resume",
        // because the focus / soft-detach / reattach paths all funnel
        // through here.
        //
        // The correct behavior: keep the existing visible/snapshot
        // messages, replace the live-turn user/assistant slots in place
        // (matched by their ids), and only append fresh slots if they
        // are not yet present.
        const previousLiveUserId = existingSnapshot?.liveUserMessageId ?? null;
        const previousLiveAssistantId = existingSnapshot?.liveAssistantMessageId ?? null;
        const reconcileWithLiveTurn = (prev: ChatMessage[]): ChatMessage[] => {
          const userIdsToReplace = new Set<string>(
            [previousLiveUserId, userMessage?.id ?? null].filter(
              (value): value is string => typeof value === "string"
            )
          );
          const assistantIdsToReplace = new Set<string>(
            [previousLiveAssistantId, liveAssistantMessage.id].filter(
              (value): value is string => typeof value === "string"
            )
          );
          let userInjected = userMessage === null;
          let assistantInjected = false;
          const next: ChatMessage[] = [];
          for (const message of prev) {
            if (userMessage !== null && userIdsToReplace.has(message.id)) {
              if (!userInjected) {
                next.push(userMessage);
                userInjected = true;
              }
              continue;
            }
            if (assistantIdsToReplace.has(message.id)) {
              if (!assistantInjected) {
                next.push(liveAssistantMessage);
                assistantInjected = true;
              }
              continue;
            }
            next.push(message);
          }
          if (userMessage !== null && !userInjected) {
            next.push(userMessage);
          }
          if (!assistantInjected) {
            next.push(liveAssistantMessage);
          }
          return next;
        };
        // Pick the LONGEST known base — `existingSnapshot?.messages`
        // is just the live pair right after `send()` (the snapshot is
        // initialised with only `[liveUser, liveAssistant]` and only
        // grows to include older history after a `loadHistory` cached
        // merge has updated it), while the visible `messages` already
        // contains the full older-history + live-pair window. Merging
        // both by id ensures we never collapse the visible window down
        // to 2 messages on a focus / reattach refresh.
        const visibleBase = currentThreadKeyRef.current === targetThreadKey ? messages : [];
        const snapshotBase = existingSnapshot?.messages ?? [];
        const baseMessages =
          visibleBase.length === 0
            ? snapshotBase
            : snapshotBase.length === 0
              ? visibleBase
              : mergeChatMessagesById(visibleBase, snapshotBase);
        const nextMessages = reconcileWithLiveTurn(baseMessages);
        const nextSnapshot = {
          clientTurnId,
          messages: nextMessages,
          liveUserMessageId: userMessage?.id ?? existingSnapshot?.liveUserMessageId ?? null,
          liveAssistantMessageId: liveAssistantMessage.id,
          liveActivitiesByMessageId: nextLiveActivities,
          shadowRoutingLabelsByMessageId: existingSnapshot?.shadowRoutingLabelsByMessageId ?? {},
          chatId: status.chat?.id ?? existingSnapshot?.chatId ?? null,
          compactionRunning: existingSnapshot?.compactionRunning ?? false
        };
        activeTurnSnapshotsRef.current.set(targetThreadKey, nextSnapshot);
        auditActiveTurnSnapshotMessages(
          "applyTurnStatusState:running",
          targetThreadKey,
          nextSnapshot
        );
        markStreaming(targetThreadKey, true);
        if (currentThreadKeyRef.current === targetThreadKey) {
          setMessages(reconcileWithLiveTurn);
          setLiveActivitiesByMessageId(nextLiveActivities);
          setShadowRoutingLabelsByMessageId(existingSnapshot?.shadowRoutingLabelsByMessageId ?? {});
          if (status.chat?.id) {
            setChatId(status.chat.id);
            activeChatIdRef.current = status.chat.id;
          }
        }
        writeStoredActiveTurnClientTurnId(targetThreadKey, clientTurnId);
        return "running";
      }
      if (
        status.status === "completed" ||
        status.status === "failed" ||
        status.status === "interrupted"
      ) {
        clearStoredActiveTurnClientTurnId(targetThreadKey, clientTurnId);
        setLiveActivitiesByMessageId((prev) =>
          currentThreadKeyRef.current === targetThreadKey ? {} : prev
        );
        const controllerEntry = abortControllersByThreadRef.current.get(targetThreadKey);
        controllerEntry?.controller.abort();
        abortControllersByThreadRef.current.delete(targetThreadKey);
        activeTurnSnapshotsRef.current.delete(targetThreadKey);
        markStreaming(targetThreadKey, false);
        if (status.status === "failed" && status.error?.message) {
          setIssue(
            toWebChatUxIssue({
              code: status.error.code ?? undefined,
              message: status.error.message
            })
          );
        }
        if (status.status === "completed" && userMessage !== null && assistantMessage !== null) {
          const committed = [
            userMessage,
            assistantMessage,
            ...(followUpAssistantMessage ? [followUpAssistantMessage] : [])
          ];
          const baseMessages =
            existingSnapshot?.messages ??
            cachedSnapshot?.messages ??
            (currentThreadKeyRef.current === targetThreadKey ? messages : []);
          const committedIds = new Set(committed.map((message) => message.id));
          // Only the LIVE turn's stale ids should be removed here. Using the
          // entire `existingSnapshot.messages` id set would also strip older
          // committed messages that were merged into the snapshot's visible
          // state during a prior loadHistory.
          const liveTurnIds = new Set<string>(
            [
              existingSnapshot?.liveUserMessageId ?? null,
              existingSnapshot?.liveAssistantMessageId ?? null
            ].filter((value): value is string => typeof value === "string")
          );
          const committedMessages = [
            ...baseMessages.filter(
              (message) =>
                !isOptimisticLocalMessage(message) &&
                !isTransientActiveAssistantMessage(message) &&
                !liveTurnIds.has(message.id) &&
                !committedIds.has(message.id)
            ),
            ...committed
          ];
          cacheThreadHistorySnapshot(targetThreadKey, {
            clientTurnId,
            messages: committedMessages,
            liveUserMessageId: userMessage?.id ?? existingSnapshot?.liveUserMessageId ?? null,
            liveAssistantMessageId:
              assistantMessage?.id ??
              existingSnapshot?.liveAssistantMessageId ??
              `local-assistant-${clientTurnId}`,
            liveActivitiesByMessageId: {},
            shadowRoutingLabelsByMessageId: existingSnapshot?.shadowRoutingLabelsByMessageId ?? {},
            chatId: status.chat?.id ?? existingSnapshot?.chatId ?? cachedSnapshot?.chatId ?? null,
            compactionRunning: false
          });
          applyThreadMessages(targetThreadKey, (prev) => {
            const withoutActiveTurn = prev.filter(
              (message) =>
                !isOptimisticLocalMessage(message) &&
                !isTransientActiveAssistantMessage(message) &&
                !liveTurnIds.has(message.id) &&
                !committedIds.has(message.id)
            );
            return [...withoutActiveTurn, ...committed];
          });
        }
        return "terminal_status";
      }
      return "unknown";
    },
    [applyThreadMessages, cacheThreadHistorySnapshot, markStreaming, messages]
  );
  const refreshTurnStatus = useCallback(
    async (
      targetThreadKey: string,
      clientTurnId: string
    ): Promise<"running" | "terminal" | "terminal_status" | "unknown"> => {
      const token = await getToken({ skipCache: true });
      if (!token) return "unknown";
      try {
        const status = await getAssistantWebChatTurnStatus(token, clientTurnId);
        return applyTurnStatusState(targetThreadKey, clientTurnId, status);
      } catch {
        return "unknown";
      }
    },
    [applyTurnStatusState, getToken]
  );
  const startTurnReattach = useCallback(
    async (
      targetThreadKey: string,
      clientTurnId: string
    ): Promise<"running" | "terminal" | "terminal_status" | "unknown"> => {
      const reattachKey = `${targetThreadKey}:${clientTurnId}`;
      const existingReattach = turnReattachInFlightByKeyRef.current.get(reattachKey);
      if (existingReattach !== undefined) {
        return existingReattach;
      }
      const reattachPromise = (async (): Promise<
        "running" | "terminal" | "terminal_status" | "unknown"
      > => {
        const token = await getToken({ skipCache: true });
        if (!token) return "unknown";
        const controller = new AbortController();
        let latestResult: "running" | "terminal" | "terminal_status" | "unknown" = "unknown";
        try {
          await reattachAssistantWebChatTurnStream(
            token,
            clientTurnId,
            {
              onHeadersOk: () => {
                markStreaming(targetThreadKey, true);
              },
              onTurnStatus: ({ turn }) => {
                latestResult = applyTurnStatusState(targetThreadKey, clientTurnId, turn);
              },
              onReattached: ({ turn }) => {
                latestResult = applyTurnStatusState(targetThreadKey, clientTurnId, turn);
              },
              onDelta: ({ delta }) => {
                applyThreadMessages(targetThreadKey, (prev) =>
                  prev.map((message) =>
                    message.role === "assistant" && message.status === "streaming"
                      ? {
                          ...message,
                          content: `${message.content}${delta}`,
                          streamingTextActive: true
                        }
                      : message
                  )
                );
              },
              onThinking: ({ accumulated }) => {
                const now = new Date().toISOString();
                applyThreadMessages(targetThreadKey, (prev) =>
                  prev.map((message) =>
                    message.role === "assistant" && message.status === "streaming"
                      ? {
                          ...message,
                          thought: accumulated,
                          thoughtStartedAt: message.thoughtStartedAt ?? now
                        }
                      : message
                  )
                );
              },
              onTool: ({ phase, toolName, isError }) => {
                const snapshot = activeTurnSnapshotsRef.current.get(targetThreadKey);
                const assistantMessageId = snapshot?.liveAssistantMessageId ?? null;
                if (assistantMessageId === null) {
                  return;
                }
                applyThreadLiveActivities(targetThreadKey, (prev) => ({
                  ...prev,
                  [assistantMessageId]: mergeLiveActivity(
                    prev[assistantMessageId],
                    buildToolLiveActivity({
                      assistantMessageId,
                      toolName,
                      phase,
                      isError
                    })
                  )
                }));
                applyThreadMessages(targetThreadKey, (prev) =>
                  prev.map((message) =>
                    message.id === assistantMessageId
                      ? { ...message, streamingTextActive: false }
                      : message
                  )
                );
                if (toolName === "todo_write") {
                  void refreshChatPlan();
                }
              },
              onProjectActivity: ({ summary, detail }) => {
                const snapshot = activeTurnSnapshotsRef.current.get(targetThreadKey);
                const assistantMessageId = snapshot?.liveAssistantMessageId ?? null;
                if (assistantMessageId === null) {
                  return;
                }
                applyThreadLiveActivities(targetThreadKey, (prev) => ({
                  ...prev,
                  [assistantMessageId]: mergeLiveActivity(
                    prev[assistantMessageId],
                    buildProjectLiveActivity({
                      assistantMessageId,
                      label: summary,
                      ...(detail ? { detail } : {})
                    })
                  )
                }));
                applyThreadMessages(targetThreadKey, (prev) =>
                  prev.map((message) =>
                    message.id === assistantMessageId
                      ? { ...message, streamingTextActive: false }
                      : message
                  )
                );
              },
              onProjectReasoningSummary: ({ summary, detail }) => {
                const snapshot = activeTurnSnapshotsRef.current.get(targetThreadKey);
                const assistantMessageId = snapshot?.liveAssistantMessageId ?? null;
                if (assistantMessageId === null) {
                  return;
                }
                applyThreadLiveActivities(targetThreadKey, (prev) => ({
                  ...prev,
                  [assistantMessageId]: mergeLiveActivity(
                    prev[assistantMessageId],
                    buildProjectLiveActivity({
                      assistantMessageId,
                      label: summary,
                      ...(detail ? { detail } : {})
                    })
                  )
                }));
                applyThreadMessages(targetThreadKey, (prev) =>
                  prev.map((message) =>
                    message.id === assistantMessageId
                      ? { ...message, streamingTextActive: false }
                      : message
                  )
                );
              },
              onActivity: ({ source, resultCount, skillName, skillIconEmoji }) => {
                const snapshot = activeTurnSnapshotsRef.current.get(targetThreadKey);
                const assistantMessageId = snapshot?.liveAssistantMessageId ?? null;
                if (assistantMessageId === null) {
                  return;
                }
                applyThreadLiveActivities(targetThreadKey, (prev) => {
                  const nextActivity = buildRetrievalLiveActivity(
                    {
                      assistantMessageId,
                      source,
                      resultCount,
                      ...(skillName === undefined ? {} : { skillName }),
                      ...(skillIconEmoji === undefined ? {} : { skillIconEmoji })
                    },
                    t("skillBadgePrefix")
                  );
                  return {
                    ...prev,
                    [assistantMessageId]: mergeLiveActivity(prev[assistantMessageId], nextActivity)
                  };
                });
                applyThreadMessages(targetThreadKey, (prev) =>
                  prev.map((message) =>
                    message.id === assistantMessageId
                      ? { ...message, streamingTextActive: false }
                      : message
                  )
                );
              },
              onPendingBrowserLogin: ({
                pendingBrowserLogin
              }: {
                pendingBrowserLogin: unknown;
              }) => {
                const pendingLogin = parsePendingBrowserLoginState(pendingBrowserLogin);
                if (pendingLogin !== null) {
                  applyPendingBrowserLoginForThread(targetThreadKey, pendingLogin);
                }
              },
              onCompleted: async () => {
                const targetChatId = resolveKnownChatIdForThread(targetThreadKey);
                const reconciled = targetChatId
                  ? await refreshLatestHistory(targetChatId, { targetThreadKey })
                  : false;
                void refreshChatPlan();
                latestResult = reconciled ? "terminal" : "terminal";
              },
              onInterrupted: async () => {
                const targetChatId = resolveKnownChatIdForThread(targetThreadKey);
                const reconciled = targetChatId
                  ? await refreshLatestHistory(targetChatId, { targetThreadKey })
                  : false;
                void refreshChatPlan();
                latestResult = reconciled ? "terminal" : latestResult;
              },
              onFailed: async (payload) => {
                setIssue(toWebChatUxIssue(payload));
                const targetChatId = resolveKnownChatIdForThread(targetThreadKey);
                const reconciled = targetChatId
                  ? await refreshLatestHistory(targetChatId, { targetThreadKey })
                  : false;
                void refreshChatPlan();
                latestResult = reconciled ? "terminal" : "running";
              }
            },
            controller.signal
          );
          return latestResult;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return latestResult;
          }
          return latestResult;
        }
      })();
      turnReattachInFlightByKeyRef.current.set(reattachKey, reattachPromise);
      try {
        return await reattachPromise;
      } finally {
        if (turnReattachInFlightByKeyRef.current.get(reattachKey) === reattachPromise) {
          turnReattachInFlightByKeyRef.current.delete(reattachKey);
        }
      }
    },
    [
      applyThreadLiveActivities,
      applyThreadMessages,
      applyTurnStatusState,
      getToken,
      markStreaming,
      refreshChatPlan,
      refreshLatestHistory,
      resolveKnownChatIdForThread
    ]
  );
  const startSoftDetachReconcile = useCallback(
    (targetThreadKey: string, targetChatId: string) => {
      clearSoftDetachReconcileTimer(targetThreadKey);
      let attempts = 0;
      const tick = async () => {
        attempts += 1;
        const reconciled = await refreshLatestHistory(targetChatId, {
          clearIssueOnReconcile: true,
          targetThreadKey
        });
        if (reconciled) {
          finalizeReconciledDetachedTurn(targetThreadKey);
          return;
        }
        const snapshot = activeTurnSnapshotsRef.current.get(targetThreadKey);
        if (snapshot !== undefined) {
          const shouldReattach =
            softDetachedClientTurnIdsRef.current.has(snapshot.clientTurnId) ||
            !activeThreads.has(targetThreadKey);
          if (!shouldReattach) {
            const timer = setTimeout(tick, SOFT_DETACH_RECONCILE_INTERVAL_MS);
            softDetachReconcileTimersByThreadRef.current.set(targetThreadKey, timer);
            return;
          }
          const statusResult = await startTurnReattach(targetThreadKey, snapshot.clientTurnId);
          if (statusResult === "running") {
            const interval =
              attempts >= SOFT_DETACH_RECONCILE_MAX_ATTEMPTS
                ? SOFT_DETACH_RECONCILE_LONG_INTERVAL_MS
                : SOFT_DETACH_RECONCILE_INTERVAL_MS;
            const timer = setTimeout(tick, interval);
            softDetachReconcileTimersByThreadRef.current.set(targetThreadKey, timer);
            return;
          }
          if (statusResult === "terminal") {
            await refreshLatestHistory(targetChatId, {
              clearIssueOnReconcile: true,
              targetThreadKey
            });
            abortControllersByThreadRef.current.delete(targetThreadKey);
            return;
          }
          if (statusResult === "terminal_status") {
            abortControllersByThreadRef.current.delete(targetThreadKey);
            return;
          }
        }
        const stillHasLocalActiveTurn =
          activeTurnSnapshotsRef.current.has(targetThreadKey) ||
          activeThreads.has(targetThreadKey) ||
          abortControllersByThreadRef.current.has(targetThreadKey);
        if (attempts >= SOFT_DETACH_RECONCILE_MAX_ATTEMPTS && !stillHasLocalActiveTurn) {
          clearSoftDetachReconcileTimer(targetThreadKey);
          return;
        }
        const interval =
          attempts >= SOFT_DETACH_RECONCILE_MAX_ATTEMPTS
            ? SOFT_DETACH_RECONCILE_LONG_INTERVAL_MS
            : SOFT_DETACH_RECONCILE_INTERVAL_MS;
        const timer = setTimeout(tick, interval);
        softDetachReconcileTimersByThreadRef.current.set(targetThreadKey, timer);
      };
      void tick();
    },
    [
      clearSoftDetachReconcileTimer,
      finalizeReconciledDetachedTurn,
      markStreaming,
      refreshLatestHistory,
      startTurnReattach,
      activeThreads
    ]
  );
  const startStoredActiveTurnRestore = useCallback(
    (targetThreadKey: string, clientTurnId: string) => {
      const restoreKey = `${targetThreadKey}:${clientTurnId}`;
      if (activeTurnRestoreTimersByKeyRef.current.has(restoreKey)) {
        return;
      }
      let attempts = 0;
      let hasSeenRunning = false;
      const tick = async () => {
        const activeSnapshot = activeTurnSnapshotsRef.current.get(targetThreadKey);
        const shouldContinue =
          hasSeenRunning || activeSnapshot !== undefined
            ? activeSnapshot?.clientTurnId === clientTurnId
            : readStoredActiveTurnClientTurnId(targetThreadKey) === clientTurnId;
        if (!shouldContinue) {
          clearActiveTurnRestoreTimer(restoreKey);
          return;
        }
        attempts += 1;
        let statusResult =
          activeSnapshot === undefined && !hasSeenRunning
            ? await refreshTurnStatus(targetThreadKey, clientTurnId)
            : await startTurnReattach(targetThreadKey, clientTurnId);
        if (statusResult === "running" && !hasSeenRunning) {
          hasSeenRunning = true;
          statusResult = await startTurnReattach(targetThreadKey, clientTurnId);
        }
        if (statusResult === "terminal") {
          clearActiveTurnRestoreTimer(restoreKey);
          return;
        }
        if (statusResult === "running") {
          hasSeenRunning = true;
        }
        const maxAttempts = hasSeenRunning
          ? SOFT_DETACH_RECONCILE_MAX_ATTEMPTS
          : ACTIVE_TURN_RESTORE_MAX_ATTEMPTS;
        if (attempts >= maxAttempts) {
          if (!hasSeenRunning) {
            clearActiveTurnRestoreTimer(restoreKey);
            return;
          }
          const timer = setTimeout(tick, SOFT_DETACH_RECONCILE_LONG_INTERVAL_MS);
          activeTurnRestoreTimersByKeyRef.current.set(restoreKey, timer);
          return;
        }
        const interval = hasSeenRunning
          ? SOFT_DETACH_RECONCILE_INTERVAL_MS
          : ACTIVE_TURN_RESTORE_INTERVAL_MS;
        const timer = setTimeout(tick, interval);
        activeTurnRestoreTimersByKeyRef.current.set(restoreKey, timer);
      };
      const timer = setTimeout(tick, 0);
      activeTurnRestoreTimersByKeyRef.current.set(restoreKey, timer);
    },
    [clearActiveTurnRestoreTimer, refreshTurnStatus, startTurnReattach]
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
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const refreshOnResume = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      const targetChatId = activeChatIdRef.current ?? chatId;
      if (!targetChatId) {
        return;
      }
      const now = Date.now();
      if (now - lastResumeRefreshAtRef.current < RESUME_REFRESH_DEBOUNCE_MS) {
        return;
      }
      if (resumeRefreshInFlightRef.current) {
        return;
      }
      lastResumeRefreshAtRef.current = now;
      resumeRefreshInFlightRef.current = true;
      const targetThreadKey = currentThreadKeyRef.current;
      void (async () => {
        try {
          const activeSnapshot = activeTurnSnapshotsRef.current.get(targetThreadKey);
          const clientTurnId =
            activeSnapshot?.clientTurnId ?? readStoredActiveTurnClientTurnId(targetThreadKey);
          if (clientTurnId !== null) {
            const statusResult = await refreshTurnStatus(targetThreadKey, clientTurnId);
            if (statusResult === "running") {
              startSoftDetachReconcile(targetThreadKey, targetChatId);
              return;
            }
            if (statusResult === "terminal") {
              const stillActiveAfterTerminal =
                activeTurnSnapshotsRef.current.has(targetThreadKey) ||
                abortControllersByThreadRef.current.has(targetThreadKey);
              if (stillActiveAfterTerminal) {
                await refreshLatestHistory(targetChatId, {
                  clearIssueOnReconcile: true,
                  targetThreadKey
                });
              }
              void refreshCompactionState(targetChatId);
              void refreshChatPlan();
              return;
            }
          }
          const reconciled = await refreshLatestHistory(targetChatId, {
            clearIssueOnReconcile: true,
            targetThreadKey
          });
          void refreshChatPlan();
          if (reconciled) {
            finalizeReconciledDetachedTurn(targetThreadKey);
            return;
          }
          if (
            activeThreads.has(targetThreadKey) ||
            activeTurnSnapshotsRef.current.has(targetThreadKey) ||
            abortControllersByThreadRef.current.has(targetThreadKey)
          ) {
            startSoftDetachReconcile(targetThreadKey, targetChatId);
          }
        } finally {
          resumeRefreshInFlightRef.current = false;
        }
      })();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshOnResume();
      }
    };
    window.addEventListener("focus", refreshOnResume);
    window.addEventListener("pageshow", refreshOnResume);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", refreshOnResume);
      window.removeEventListener("pageshow", refreshOnResume);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    activeThreads,
    chatId,
    finalizeReconciledDetachedTurn,
    refreshChatPlan,
    refreshCompactionState,
    refreshLatestHistory,
    refreshTurnStatus,
    startSoftDetachReconcile
  ]);
  useEffect(() => {
    return () => {
      for (const timer of softDetachReconcileTimersByThreadRef.current.values()) {
        clearTimeout(timer);
      }
      softDetachReconcileTimersByThreadRef.current.clear();
      for (const timer of activeTurnRestoreTimersByKeyRef.current.values()) {
        clearTimeout(timer);
      }
      activeTurnRestoreTimersByKeyRef.current.clear();
    };
  }, []);
  useEffect(() => {
    const clientTurnId = readStoredActiveTurnClientTurnId(assistantScopedThreadKey);
    if (clientTurnId === null || activeTurnSnapshotsRef.current.has(assistantScopedThreadKey)) {
      return;
    }
    startStoredActiveTurnRestore(assistantScopedThreadKey, clientTurnId);
  }, [assistantScopedThreadKey, startStoredActiveTurnRestore]);
  const send = useCallback(
    async (text: string, files?: File[], options?: ChatSendOptions) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || isStreaming) return;
      /* While a previous send is in send_failed state the composer must stay */ /* single-slot ��� the user has to Retry or Cancel it before another send */ /* can start. (ADR-075 T� "Single-slot pending send".) */ if (
        pendingSendStatusRef.current !== null
      )
        return;
      /* Capture the assistant-scoped thread key at send time so every
       * subsequent local registry / cache mutation stays bound to the
       * originating assistant+thread view, even if another assistant later
       * reuses the same surface thread key. */
      const sendThreadKey = assistantScopedThreadKey;
      /* Synchronous re-entrancy guard. It stays set until the optimistic      */
      /* `[user, assistant]` pair and pending slot are claimed, so another     */
      /* same-thread send cannot race through before React renders the new     */
      /* `isStreaming` / pending state. See `sendInPreflightByThreadRef`.      */
      if (sendInPreflightByThreadRef.current.has(sendThreadKey)) return;
      sendInPreflightByThreadRef.current.add(sendThreadKey);
      const releasePreflight = () => {
        sendInPreflightByThreadRef.current.delete(sendThreadKey);
      };
      const compactionBeforeTurn = compaction;
      const pendingFiles = files ?? [];
      const clientTurnId = options?.clientTurnId ?? createClientTurnId();
      const clientAttachmentIds =
        options?.clientAttachmentIds?.length === pendingFiles.length
          ? options.clientAttachmentIds
          : pendingFiles.map(() => createClientTurnId());
      const localAttachments: ChatAttachment[] = pendingFiles.map((f, i) => ({
        id: clientAttachmentIds[i] ?? `local-att-${Date.now()}-${String(i)}`,
        path: null,
        thumbnailStoragePath: null,
        posterStoragePath: null,
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
        uploadProgressPercent: 0,
        localPreviewUrl:
          f.type.startsWith("image/") || f.type.startsWith("audio/") || f.type.startsWith("video/")
            ? URL.createObjectURL(f)
            : undefined
      }));
      const userMsgId = `local-user-${Date.now()}`;
      const assistantMsgId = `local-assistant-${Date.now()}`;
      const controller = new AbortController();
      abortControllersByThreadRef.current.set(sendThreadKey, { controller, clientTurnId });
      /* Helper used at every cleanup point to drop *this* turn's controller */ /* without disturbing a newer controller that may have replaced it */ /* (e.g. user retried fast, or another turn started in the same thread). */ const releaseAbortController =
        () => {
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
      /* Helper used by every pre-headers failure path (offline / staging */ /* stall / 10s headers timeout / network error) to flip the optimistic */ /* user bubble into "send_failed", drop the assistant placeholder if it */ /* was rendered, and arm the single-slot retry/cancel UX. */ const sendFailedCleanup =
        (assistantWasMounted: boolean): void => {
          clearStoredActiveTurnClientTurnId(sendThreadKey, clientTurnId);
          applyThreadMessages(sendThreadKey, (prev) =>
            prev.flatMap((m) => {
              if (assistantWasMounted && m.id === assistantMsgId) return [];
              if (m.id === userMsgId) return [{ ...m, status: "send_failed_unconfirmed" as const }];
              return [m];
            })
          );
          setThreadPendingSend(sendThreadKey, {
            text: trimmed,
            files: pendingFiles,
            options: options ?? undefined,
            userMsgId,
            assistantMsgId: null,
            clientTurnId,
            clientAttachmentIds,
            status: "send_failed_unconfirmed"
          });
        };
      const dismissPreHeaderTurnWithIssue = (issue: WebChatUxIssue): void => {
        clearStoredActiveTurnClientTurnId(sendThreadKey, clientTurnId);
        clearThreadLiveActivity(sendThreadKey, assistantMsgId);
        setIssue(issue);
        applyThreadMessages(sendThreadKey, (prev) => {
          const idsToRemove = new Set<string>([userMsgId, assistantMsgId]);
          for (const message of prev) {
            if (!idsToRemove.has(message.id)) {
              continue;
            }
            for (const attachment of message.attachments ?? []) {
              if (attachment.localPreviewUrl !== undefined) {
                URL.revokeObjectURL(attachment.localPreviewUrl);
              }
            }
          }
          return prev.filter((message) => !idsToRemove.has(message.id));
        });
        activeTurnSnapshotsRef.current.delete(sendThreadKey);
        setThreadPendingSend(sendThreadKey, null);
      };
      const userMsgBase: Omit<ChatMessage, "status"> = {
        id: userMsgId,
        role: "user",
        content: trimmed,
        attachments: localAttachments.length > 0 ? localAttachments : undefined
      };
      /* Cold offline pre-flight. We deliberately do NOT call markStreaming */ /* here ��� there's no in-flight stream ��� so the chat-input renders the */ /* pending-send helper line, not the "stop" button. */ if (
        typeof navigator !== "undefined" &&
        navigator.onLine === false
      ) {
        const failedUserMsg: ChatMessage = { ...userMsgBase, status: "send_failed_confirmed" };
        setMessages((prev) => [...prev, failedUserMsg]);
        setThreadPendingSend(sendThreadKey, {
          text: trimmed,
          files: pendingFiles,
          options: options ?? undefined,
          userMsgId,
          assistantMsgId: null,
          clientTurnId,
          clientAttachmentIds,
          status: "send_failed_confirmed"
        });
        releaseAbortController();
        releasePreflight();
        return;
      }
      markStreaming(sendThreadKey, true);
      writeStoredActiveTurnClientTurnId(sendThreadKey, clientTurnId);
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
      const initialSnapshot = {
        clientTurnId,
        messages: [userMsg, assistantMsg],
        liveUserMessageId: userMsgId,
        liveAssistantMessageId: assistantMsgId,
        liveActivitiesByMessageId: {},
        shadowRoutingLabelsByMessageId: {},
        chatId: null,
        compactionRunning: false
      };
      activeTurnSnapshotsRef.current.set(sendThreadKey, initialSnapshot);
      auditActiveTurnSnapshotMessages("send:initial-snapshot", sendThreadKey, initialSnapshot);
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setThreadPendingSend(sendThreadKey, {
        text: trimmed,
        files: pendingFiles,
        options: options ?? undefined,
        userMsgId,
        assistantMsgId,
        clientTurnId,
        clientAttachmentIds,
        status: "sending"
      });
      /* Pending-slot is now claimed synchronously via `pendingSendStatusRef`  */
      /* (set by `setThreadPendingSend` above). Any later `send()` for this   */
      /* thread will be blocked by `pendingSendStatusRef.current !== null` in */
      /* its top-of-function guards, so we can release the preflight gate.   */
      releasePreflight();
      let token: string;
      try {
        const cachedToken = await getToken();
        if (cachedToken === null) {
          setIssue(toWebChatUxIssue(t("sessionExpired")));
          sendFailedCleanup(true);
          markStreaming(sendThreadKey, false);
          releaseAbortController();
          return;
        }
        token = cachedToken;
      } catch (error) {
        setIssue(toWebChatUxIssue(error));
        sendFailedCleanup(true);
        markStreaming(sendThreadKey, false);
        releaseAbortController();
        return;
      }
      if (pendingFiles.length > 0) {
        try {
          let stagedChatId: string | null = null;
          for (let i = 0; i < pendingFiles.length; i++) {
            const file = pendingFiles[i]!;
            /* Do not use an absolute hard timeout here: on weak mobile signal a */ /* large PDF can keep making progress for minutes, and killing that */ /* upload would be worse than letting the pending bubble continue. */ const staged =
              await stageWebChatAttachment(
                token,
                threadKey,
                clientTurnId,
                clientAttachmentIds[i] ?? createClientTurnId(),
                file,
                {
                  signal: controller.signal,
                  onProgress: (progress) => {
                    applyThreadMessages(sendThreadKey, (prev) =>
                      prev.map((m) => {
                        if (m.id !== userMsgId) return m;
                        const next = [...(m.attachments ?? [])];
                        const current = next[i];
                        if (current === undefined) return m;
                        next[i] = { ...current, uploadProgressPercent: progress.percent };
                        return { ...m, attachments: next };
                      })
                    );
                  }
                }
              );
            const u = staged.attachment;
            applyThreadMessages(sendThreadKey, (prev) =>
              prev.map((m) => {
                if (m.id !== userMsgId) return m;
                const next = [...(m.attachments ?? [])];
                const prevEntry = next[i];
                if (prevEntry?.localPreviewUrl) {
                  URL.revokeObjectURL(prevEntry.localPreviewUrl);
                }
                next[i] = {
                  ...toChatAttachment({
                    ...u,
                    originalFilename: u.originalFilename ?? file.name,
                    processingStatus: u.processingStatus as ChatAttachment["processingStatus"]
                  }),
                  uploadProgressPercent: undefined,
                  localPreviewUrl: undefined
                };
                return { ...m, attachments: next };
              })
            );
            stagedChatId = staged.chatId;
          }
          if (stagedChatId !== null) {
            dispatchProjectFilesChanged(stagedChatId);
          }
        } catch (error) {
          /* Staging never reached server-confirmed state. Treat all of */ /* stall/timeout/abort/network/HTTP as a pre-headers failure and */ /* route through the pending-slot UI instead of an issue banner. */ /* (Real server-side validation errors that DID return a structured */ /* envelope still come back here; for those we keep the issue banner */ /* so users get the proper guidance copy in addition to the bubble.) */ if (
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
      const flushDelta = (force = false) => {
        const chunk = force
          ? pendingDelta.text
          : pendingDelta.text.slice(0, STREAM_DELTA_FRAME_CHAR_BUDGET);
        pendingDelta.text = force ? "" : pendingDelta.text.slice(STREAM_DELTA_FRAME_CHAR_BUDGET);
        pendingDelta.raf = 0;
        if (!chunk) return;
        applyThreadMessages(sendThreadKey, (prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: m.content + chunk, streamingTextActive: true }
              : m
          )
        );
        if (pendingDelta.text.length > 0 && !pendingDelta.raf) {
          pendingDelta.raf = requestAnimationFrame(() => flushDelta());
        }
      };
      const flushThought = () => {
        const thought = pendingThought.text;
        const startedAt = pendingThought.startedAt;
        pendingThought.raf = 0;
        if (!thought) return;
        applyThreadMessages(sendThreadKey, (prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, thought, thoughtStartedAt: m.thoughtStartedAt ?? startedAt }
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
          flushDelta(true);
          flushThought();
        };
        if (forceBoundaryCommit) {
          flushSync(commit);
          return;
        }
        commit();
      };
      const markAssistantActivityBoundary = () => {
        applyThreadMessages(sendThreadKey, (prev) =>
          prev.map((m) => (m.id === assistantMsgId ? { ...m, streamingTextActive: false } : m))
        );
      };
      /* Pre-headers watchdog: if the server never returns 2xx headers within */ /* HEADERS_TIMEOUT_MS, abort the request so the bubble flips to */ /* "send_failed" instead of hanging indefinitely. Tool turns can stay */ /* silent for tens of seconds AFTER headers, which is fine ��� we only */ /* measure up to the headers, not to the first SSE event. */ let headersOk = false;
      let softDetached = false;
      let completedSuccessfully = false;
      let streamAccepted = false;
      const acceptStartedStream = () => {
        if (streamAccepted) {
          return;
        }
        streamAccepted = true;
        applyThreadMessages(sendThreadKey, (prev) =>
          prev.map((m) => (m.id === userMsgId ? { ...m, status: "committed" as const } : m))
        );
        setThreadPendingSend(sendThreadKey, null);
      };
      const headersTimer = setTimeout(() => {
        if (!headersOk) {
          try {
            controller.abort();
          } catch {
            /* ignore */
          }
        }
      }, HEADERS_TIMEOUT_MS);
      const nativeBridgeShell = isNativeBrowserBridgeShell();
      const cachedBridgeStatus = getCachedCurrentLocalBrowserBridgeStatus();
      // Registration returns before the extension WebSocket necessarily
      // reaches OPEN, so a freshly cached `connected:false` is not terminal.
      // Probe the live bridge instead of sending a turn without its device id;
      // that mismatch made assistant-triggered open_live fail while the same
      // profile still opened from Settings moments later.
      let currentBridgeStatus =
        cachedBridgeStatus?.connected === true
          ? cachedBridgeStatus
          : await getCurrentLocalBrowserBridgeStatus(1_200).catch(() => null);
      if (!nativeBridgeShell && currentBridgeStatus !== null && !currentBridgeStatus.connected) {
        for (const retryDelayMs of [100, 200, 300]) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, retryDelayMs));
          currentBridgeStatus = await getCurrentLocalBrowserBridgeStatus(500).catch(
            () => currentBridgeStatus
          );
          if (currentBridgeStatus?.connected === true) {
            break;
          }
        }
      }
      const currentBridgeDeviceId =
        currentBridgeStatus?.connected === true &&
        currentBridgeStatus.assistantId === currentAssistantId &&
        typeof currentBridgeStatus.bridgeDeviceId === "string"
          ? currentBridgeStatus.bridgeDeviceId
          : null;
      const streamPayload = {
        surfaceThreadKey: threadKey,
        message: trimmed,
        clientTurnId,
        bridgeDeviceKind: nativeBridgeShell ? ("capacitor" as const) : ("extension" as const),
        ...(currentBridgeDeviceId === null ? {} : { bridgeDeviceId: currentBridgeDeviceId }),
        ...(options?.chatMode === undefined ? {} : { chatMode: options.chatMode }),
        ...(options?.deepModeEnabled === undefined
          ? {}
          : { deepModeEnabled: options.deepModeEnabled })
      };
      const streamHandlers = {
        onHeadersOk: () => {
          headersOk = true;
          clearTimeout(headersTimer);
        },
        onStarted: ({ chat, userMessage }: { chat: unknown; userMessage: unknown }) => {
          acceptStartedStream();
          const c = chat as { id?: string } | null;
          if (typeof c?.id === "string") {
            setThreadChatId(sendThreadKey, c.id);
          }
          const u = userMessage as { id?: string } | null;
          if (typeof u?.id === "string") {
            applyThreadMessages(sendThreadKey, (prev) =>
              prev.map((message) =>
                message.id === userMsgId ? { ...message, id: u.id!, status: "committed" } : message
              )
            );
            const startedSnapshot = activeTurnSnapshotsRef.current.get(sendThreadKey);
            if (startedSnapshot !== undefined) {
              const nextSnapshot = {
                ...startedSnapshot,
                liveUserMessageId: u.id
              };
              activeTurnSnapshotsRef.current.set(sendThreadKey, nextSnapshot);
              auditActiveTurnSnapshotMessages("send:onStarted", sendThreadKey, nextSnapshot);
            }
          }
        },
        onThinking: ({ accumulated }: { accumulated: string }) => {
          pendingThought.text = accumulated;
          if (!pendingThought.startedAt) {
            pendingThought.startedAt = new Date().toISOString();
          }
          if (!pendingThought.raf) {
            pendingThought.raf = requestAnimationFrame(flushThought);
          }
        },
        onDelta: ({ delta }: { delta: string }) => {
          pendingDelta.text += delta;
          if (!pendingDelta.raf) {
            pendingDelta.raf = requestAnimationFrame(() => flushDelta());
          }
        },
        onStreamReset: () => {
          cancelBufferedAssistantFlush();
          pendingDelta.text = "";
          pendingThought.text = "";
          applyThreadMessages(sendThreadKey, (prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, content: "", streamingTextActive: false } : m
            )
          );
        },
        onTool: ({
          phase,
          toolName,
          isError
        }: {
          phase: "start" | "end";
          toolName: string;
          isError: boolean;
        }) => {
          flushBufferedAssistantState(true);
          markAssistantActivityBoundary();
          applyThreadLiveActivities(sendThreadKey, (prev) => ({
            ...prev,
            [assistantMsgId]: mergeLiveActivity(
              prev[assistantMsgId],
              buildToolLiveActivity({
                assistantMessageId: assistantMsgId,
                toolName,
                phase,
                isError
              })
            )
          }));
          if (toolName === "todo_write") {
            void refreshChatPlan();
          }
        },
        onProjectActivity: ({
          summary,
          detail
        }: {
          stage: "plan" | "gather" | "analyze" | "replan" | "synthesize";
          status: "started" | "completed";
          summary: string;
          detail?: string | null;
        }) => {
          flushBufferedAssistantState(true);
          markAssistantActivityBoundary();
          applyThreadLiveActivities(sendThreadKey, (prev) => ({
            ...prev,
            [assistantMsgId]: mergeLiveActivity(
              prev[assistantMsgId],
              buildProjectLiveActivity({
                assistantMessageId: assistantMsgId,
                label: summary,
                ...(detail ? { detail } : {})
              })
            )
          }));
        },
        onProjectReasoningSummary: ({
          summary,
          detail
        }: {
          kind: "plan" | "check" | "gap" | "conflict" | "interim" | "replan" | "synthesis";
          summary: string;
          detail?: string | null;
        }) => {
          flushBufferedAssistantState(true);
          markAssistantActivityBoundary();
          applyThreadLiveActivities(sendThreadKey, (prev) => ({
            ...prev,
            [assistantMsgId]: mergeLiveActivity(
              prev[assistantMsgId],
              buildProjectLiveActivity({
                assistantMessageId: assistantMsgId,
                label: summary,
                ...(detail ? { detail } : {})
              })
            )
          }));
        },
        onActivity: ({
          source,
          resultCount,
          skillName,
          skillIconEmoji
        }: {
          source: "skill" | "user" | "product" | "web";
          resultCount: number;
          skillName?: string | null;
          skillIconEmoji?: string | null;
        }) => {
          flushBufferedAssistantState(true);
          markAssistantActivityBoundary();
          applyThreadLiveActivities(sendThreadKey, (prev) => {
            const nextActivity = buildRetrievalLiveActivity(
              {
                assistantMessageId: assistantMsgId,
                source,
                resultCount,
                ...(skillName === undefined ? {} : { skillName }),
                ...(skillIconEmoji === undefined ? {} : { skillIconEmoji })
              },
              t("skillBadgePrefix")
            );
            return {
              ...prev,
              [assistantMsgId]: mergeLiveActivity(prev[assistantMsgId], nextActivity)
            };
          });
        },
        onCompaction: ({
          phase,
          completed,
          willRetry
        }: {
          phase: "start" | "end";
          completed: boolean;
          willRetry: boolean;
        }) => {
          flushBufferedAssistantState(true);
          markAssistantActivityBoundary();
          const nextCompactionRunning = phase === "start" || willRetry;
          const snapshot = activeTurnSnapshotsRef.current.get(sendThreadKey);
          if (snapshot !== undefined) {
            activeTurnSnapshotsRef.current.set(sendThreadKey, {
              ...snapshot,
              compactionRunning: nextCompactionRunning
            });
          }
          if (currentThreadKeyRef.current === sendThreadKey) {
            setCompactionRunning(nextCompactionRunning);
          }
          const activityDetail = willRetry ? t("compactionWillRetry") : null;
          applyThreadLiveActivities(sendThreadKey, (prev) => ({
            ...prev,
            [assistantMsgId]: mergeLiveActivity(
              prev[assistantMsgId],
              buildCompactionLiveActivity({
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
            )
          }));
        },
        onRuntimeDone: ({ respondedAt }: { respondedAt: string }) => {
          flushBufferedAssistantState(true);
          applyThreadMessages(sendThreadKey, (prev) =>
            prev.map((m) =>
              m.id === assistantMsgId && m.thought && !m.thoughtFinishedAt
                ? { ...m, thoughtFinishedAt: respondedAt }
                : m
            )
          );
        },
        onPendingBrowserLogin: ({ pendingBrowserLogin }: { pendingBrowserLogin: unknown }) => {
          const pendingLogin = parsePendingBrowserLoginState(pendingBrowserLogin);
          if (pendingLogin !== null) {
            applyPendingBrowserLoginForThread(sendThreadKey, pendingLogin);
          }
        },
        onCompleted: ({ transport }: { transport: unknown }) => {
          acceptStartedStream();
          flushBufferedAssistantState(true);
          const t = transport as {
            userMessage?: { id?: string; chatId?: string; attachments?: ChatAttachment[] };
            assistantMessage?: {
              id?: string;
              content?: string;
              workingNotes?: string[];
              toolInvocations?: RuntimeTurnToolInvocation[];
              attachments?: ChatAttachment[];
            };
            followUpAssistantMessage?: {
              id?: string;
              content?: string;
              attachments?: ChatAttachment[];
            };
            activeMediaJobs?: WebChatActiveMediaJobState[];
            activeDocumentJobs?: WebChatActiveDocumentJobState[];
            engagementSummary?: {
              skillDisplayName?: unknown;
              scenarioDisplayName?: unknown;
            } | null;
            runtime?: RuntimeTransportMeta;
            pendingBrowserLogin?: unknown;
          } | null;
          // ADR-125 follow-up — drive the chat-level subtitle from the SSE
          // payload. When the engagement summary is `null` the server is
          // telling us the chat is now in "no active skill" — apply that
          // verbatim instead of leaving stale state. Only mutate visible
          // chrome when this completion belongs to the currently viewed
          // thread (prevents cross-thread / B2B bleed). Omitted field = no-op.
          if (currentThreadKeyRef.current === sendThreadKey) {
            const raw = t?.engagementSummary;
            if (raw === null) {
              setCurrentEngagement(null);
            } else if (raw && typeof raw === "object" && typeof raw.skillDisplayName === "string") {
              setCurrentEngagement({
                skillDisplayName: raw.skillDisplayName,
                scenarioDisplayName:
                  typeof raw.scenarioDisplayName === "string" ? raw.scenarioDisplayName : null
              });
            }
          }
          const pendingLogin = parsePendingBrowserLoginState(t?.pendingBrowserLogin);
          if (pendingLogin !== null) {
            applyPendingBrowserLoginForThread(sendThreadKey, pendingLogin);
          } else if (t?.pendingBrowserLogin === null) {
            applyPendingBrowserLoginForThread(sendThreadKey, null);
          }
          const realUserMsgId = typeof t?.userMessage?.id === "string" ? t.userMessage.id : null;
          const newAssistantId =
            typeof t?.assistantMessage?.id === "string" ? t.assistantMessage.id : null;
          const assistantAttachments =
            Array.isArray(t?.assistantMessage?.attachments) &&
            t.assistantMessage.attachments.length > 0
              ? t.assistantMessage.attachments.map((attachment) => toChatAttachment(attachment))
              : undefined;
          const followUpAssistantMessage =
            typeof t?.followUpAssistantMessage?.id === "string" &&
            typeof t?.followUpAssistantMessage?.content === "string"
              ? ({
                  id: t.followUpAssistantMessage.id,
                  role: "assistant" as const,
                  content: t.followUpAssistantMessage.content,
                  status: "committed" as const,
                  attachments:
                    Array.isArray(t.followUpAssistantMessage.attachments) &&
                    t.followUpAssistantMessage.attachments.length > 0
                      ? t.followUpAssistantMessage.attachments.map((attachment) =>
                          toChatAttachment(attachment)
                        )
                      : undefined
                } satisfies ChatMessage)
              : null;
          const userServerAttachments = Array.isArray(t?.userMessage?.attachments)
            ? t.userMessage.attachments
            : undefined;
          const nextActiveMediaJobs = Array.isArray(t?.activeMediaJobs)
            ? t.activeMediaJobs
            : undefined;
          applyThreadMessages(sendThreadKey, (prev) => {
            const mapped = prev.map((m) => {
              if (m.id === assistantMsgId) {
                const authoritativeAssistantContent =
                  typeof t?.assistantMessage?.content === "string"
                    ? reconcileAuthoritativeAssistantContent(m.content, t.assistantMessage.content)
                    : null;
                const authoritativeWorkingNotes =
                  Array.isArray(t?.assistantMessage?.workingNotes) &&
                  t.assistantMessage.workingNotes.length > 0
                    ? t.assistantMessage.workingNotes
                    : null;
                const authoritativeToolInvocations =
                  Array.isArray(t?.assistantMessage?.toolInvocations) &&
                  t.assistantMessage.toolInvocations.length > 0
                    ? t.assistantMessage.toolInvocations
                    : null;
                return {
                  ...m,
                  ...(newAssistantId ? { id: newAssistantId } : {}),
                  ...(authoritativeAssistantContent !== null
                    ? { content: authoritativeAssistantContent }
                    : {}),
                  ...(authoritativeWorkingNotes !== null
                    ? { workingNotes: authoritativeWorkingNotes }
                    : {}),
                  ...(authoritativeToolInvocations !== null
                    ? { toolInvocations: authoritativeToolInvocations }
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
                    ? userServerAttachments.map((a) => toChatAttachment(a))
                    : (m.attachments ?? []).map((a) => {
                        const next = { ...a };
                        delete next.localPreviewUrl;
                        return next;
                      });
                return {
                  ...m,
                  id: realUserMsgId,
                  status: "committed" as const,
                  attachments: nextUserAtts
                };
              }
              return m;
            });
            if (followUpAssistantMessage === null) {
              return mapped;
            }
            return mapped.some((message) => message.id === followUpAssistantMessage.id)
              ? mapped
              : [...mapped, followUpAssistantMessage];
          });
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
                a.afterMessageId === assistantMsgId ? { ...a, afterMessageId: newAssistantId } : a
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
          applyThreadLiveActivities(sendThreadKey, (prev) => {
            let next = prev;
            if (newAssistantId) {
              const current = prev[assistantMsgId];
              if (current && newAssistantId !== assistantMsgId) {
                next = { ...prev };
                delete next[assistantMsgId];
                next[newAssistantId] = { ...current, afterMessageId: newAssistantId };
              }
            }
            return next;
          });
          if (t?.runtime?.turnRouting?.mode === "shadow") {
            const routingLabel = formatTurnRoutingBadgeLabel(t.runtime.turnRouting);
            const snapshot = activeTurnSnapshotsRef.current.get(sendThreadKey);
            if (snapshot !== undefined) {
              activeTurnSnapshotsRef.current.set(sendThreadKey, {
                ...snapshot,
                shadowRoutingLabelsByMessageId: {
                  ...snapshot.shadowRoutingLabelsByMessageId,
                  [assistantMsgId]: routingLabel,
                  [resolvedAssistantMessageId]: routingLabel
                }
              });
            }
            if (currentThreadKeyRef.current === sendThreadKey) {
              setShadowRoutingLabelsByMessageId((prev) => ({
                ...prev,
                [assistantMsgId]: routingLabel,
                [resolvedAssistantMessageId]: routingLabel
              }));
            }
          }
          const completedSnapshot = activeTurnSnapshotsRef.current.get(sendThreadKey);
          if (completedSnapshot !== undefined) {
            const nextSnapshot = {
              ...completedSnapshot,
              liveUserMessageId: realUserMsgId ?? completedSnapshot.liveUserMessageId,
              liveAssistantMessageId: newAssistantId ?? completedSnapshot.liveAssistantMessageId
            };
            activeTurnSnapshotsRef.current.set(sendThreadKey, nextSnapshot);
            auditActiveTurnSnapshotMessages("send:onCompleted", sendThreadKey, nextSnapshot);
          }
          const resolvedChatId =
            typeof t?.userMessage?.chatId === "string"
              ? t.userMessage.chatId
              : resolveKnownChatIdForThread(sendThreadKey);
          const nextActiveDocumentJobs = Array.isArray(t?.activeDocumentJobs)
            ? t.activeDocumentJobs
            : undefined;
          if (currentThreadKeyRef.current === sendThreadKey && nextActiveMediaJobs !== undefined) {
            replaceActiveMediaJobs(nextActiveMediaJobs);
          }
          if (
            currentThreadKeyRef.current === sendThreadKey &&
            nextActiveDocumentJobs !== undefined
          ) {
            replaceActiveDocumentJobs(nextActiveDocumentJobs);
          }
          if (resolvedChatId && nextActiveMediaJobs !== undefined) {
            const cachedThreadKey =
              cachedThreadKeyByChatIdRef.current.get(resolvedChatId) ?? sendThreadKey;
            const cachedSnapshot = cachedThreadHistorySnapshotsRef.current.get(cachedThreadKey);
            if (cachedSnapshot !== undefined) {
              cachedThreadHistorySnapshotsRef.current.set(cachedThreadKey, {
                ...cachedSnapshot,
                activeMediaJobs: nextActiveMediaJobs,
                activeDocumentJobs:
                  nextActiveDocumentJobs ?? cachedSnapshot.activeDocumentJobs ?? []
              });
            }
            markMediaActive(cachedThreadKey, nextActiveMediaJobs.length > 0);
            markDocumentActive(
              cachedThreadKey,
              (nextActiveDocumentJobs ?? cachedSnapshot?.activeDocumentJobs ?? []).length > 0
            );
          }
          if (resolvedChatId) {
            void refreshCompactionState(resolvedChatId, {
              baselineCompaction: compactionBeforeTurn
            });
          }
          void refreshChatPlan();
          completedSuccessfully = true;
          setThreadPendingSend(
            sendThreadKey,
            null
          ); /* Files are already staged before the stream ��� no post-stream upload needed */
        },
        onInterrupted: ({ transport }: { transport: unknown }) => {
          acceptStartedStream();
          flushBufferedAssistantState();
          clearThreadLiveActivity(sendThreadKey, assistantMsgId);
          const interruptedAt = new Date().toISOString();
          const t = transport as {
            assistantMessage?: { id?: string; content?: string };
          } | null;
          const newAssistantId =
            typeof t?.assistantMessage?.id === "string" ? t.assistantMessage.id : null;
          applyThreadMessages(sendThreadKey, (prev) =>
            prev.flatMap((m) => {
              if (
                m.id !== assistantMsgId &&
                m.role === "assistant" &&
                m.status === "streaming" &&
                m.content.trim().length === 0 &&
                isOptimisticLocalMessage(m)
              ) {
                return [];
              }
              if (m.id !== assistantMsgId) {
                return [m];
              }
              const authoritativeAssistantContent =
                typeof t?.assistantMessage?.content === "string"
                  ? reconcileAuthoritativeAssistantContent(m.content, t.assistantMessage.content)
                  : null;
              const nextContent = authoritativeAssistantContent ?? m.content;
              return [
                {
                  ...m,
                  ...(newAssistantId ? { id: newAssistantId } : {}),
                  ...(authoritativeAssistantContent !== null
                    ? { content: authoritativeAssistantContent }
                    : {}),
                  status: nextContent.trim().length > 0 ? "partial" : "committed",
                  thoughtFinishedAt:
                    m.thought && !m.thoughtFinishedAt
                      ? interruptedAt
                      : (m.thoughtFinishedAt ?? null)
                }
              ];
            })
          );
          if (newAssistantId) {
            clearThreadLiveActivity(sendThreadKey, newAssistantId);
            const interruptedSnapshot = activeTurnSnapshotsRef.current.get(sendThreadKey);
            if (interruptedSnapshot !== undefined) {
              activeTurnSnapshotsRef.current.set(sendThreadKey, {
                ...interruptedSnapshot,
                liveAssistantMessageId: newAssistantId
              });
            }
          }
        },
        onFailed: (payload: { code?: string; message: string; transport: unknown }) => {
          const nextIssue = toWebChatUxIssue(payload);
          if (!streamAccepted) {
            dismissPreHeaderTurnWithIssue(nextIssue);
            return;
          }
          flushBufferedAssistantState();
          clearThreadLiveActivity(sendThreadKey, assistantMsgId);
          setIssue(nextIssue);
          const failedAt = new Date().toISOString();
          const t = payload.transport as {
            assistantMessage?: { id?: string; content?: string };
          } | null;
          const newAssistantId =
            typeof t?.assistantMessage?.id === "string" ? t.assistantMessage.id : null;
          applyThreadMessages(sendThreadKey, (prev) =>
            prev.flatMap((m) => {
              if (
                m.id !== assistantMsgId &&
                m.role === "assistant" &&
                m.status === "streaming" &&
                m.content.trim().length === 0 &&
                isOptimisticLocalMessage(m)
              ) {
                return [];
              }
              if (m.id !== assistantMsgId) {
                return [m];
              }
              const authoritativeAssistantContent =
                typeof t?.assistantMessage?.content === "string"
                  ? reconcileAuthoritativeAssistantContent(m.content, t.assistantMessage.content)
                  : null;
              return [
                {
                  ...m,
                  ...(newAssistantId ? { id: newAssistantId } : {}),
                  ...(authoritativeAssistantContent !== null
                    ? { content: authoritativeAssistantContent }
                    : {}),
                  status: "partial" as const,
                  thoughtFinishedAt:
                    m.thought && !m.thoughtFinishedAt ? failedAt : (m.thoughtFinishedAt ?? null)
                }
              ];
            })
          );
          if (newAssistantId) {
            clearThreadLiveActivity(sendThreadKey, newAssistantId);
            const failedSnapshot = activeTurnSnapshotsRef.current.get(sendThreadKey);
            if (failedSnapshot !== undefined) {
              activeTurnSnapshotsRef.current.set(sendThreadKey, {
                ...failedSnapshot,
                liveAssistantMessageId: newAssistantId
              });
            }
          }
        }
      };
      const runStreamWithToken = async (streamToken: string) => {
        await streamAssistantWebChatTurn(
          streamToken,
          streamPayload,
          streamHandlers,
          controller.signal
        );
      };
      try {
        try {
          await runStreamWithToken(token);
        } catch (error) {
          if (!headersOk && isStreamAuthRetryable(error)) {
            const freshToken = await getToken({ skipCache: true });
            if (freshToken === null) {
              setIssue(toWebChatUxIssue(t("sessionExpired")));
              sendFailedCleanup(true);
              markStreaming(sendThreadKey, false);
              releaseAbortController();
              return;
            }
            await runStreamWithToken(freshToken);
          } else {
            throw error;
          }
        }
      } catch (error) {
        clearTimeout(headersTimer);
        flushBufferedAssistantState();
        if (!headersOk) {
          const preHeaderIssue =
            error instanceof DOMException && error.name === "AbortError"
              ? null
              : toWebChatUxIssue(error);
          if (preHeaderIssue !== null && shouldSurfacePreHeaderIssueAsBanner(preHeaderIssue)) {
            dismissPreHeaderTurnWithIssue(preHeaderIssue);
          } else {
            /* Pre-headers failure: the request was aborted or never reached the */ /* server. The whole turn is "didn't fly" ��� flip the user bubble to */ /* send_failed and drop the unused assistant placeholder. Skip the */ /* existing issue banner: the bubble + composer helper carry the UX. */ sendFailedCleanup(
              true
            );
          }
        } else if (
          isPassiveStreamDisconnect(error) &&
          !hardStoppedClientTurnIdsRef.current.has(clientTurnId)
        ) {
          const targetChatId = resolveKnownChatIdForThread(sendThreadKey);
          const hasActiveSnapshot = activeTurnSnapshotsRef.current.has(sendThreadKey);
          if (hasActiveSnapshot) {
            softDetached = true;
            softDetachedClientTurnIdsRef.current.add(clientTurnId);
            if (targetChatId) {
              startSoftDetachReconcile(sendThreadKey, targetChatId);
            } else {
              startStoredActiveTurnRestore(sendThreadKey, clientTurnId);
            }
          }
        } else {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setIssue(toWebChatUxIssue(error));
          }
          const abortedAt = new Date().toISOString();
          clearThreadLiveActivity(sendThreadKey, assistantMsgId);
          applyThreadMessages(sendThreadKey, (prev) =>
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
        hardStoppedClientTurnIdsRef.current.delete(clientTurnId);
        if (!softDetached) {
          softDetachedClientTurnIdsRef.current.delete(clientTurnId);
          clearSoftDetachReconcileTimer(sendThreadKey);
          markStreaming(sendThreadKey, false);
          const hasFailedPending =
            pendingSendsByThreadRef.current
              .get(sendThreadKey)
              ?.status?.startsWith("send_failed") === true;
          if (!hasFailedPending) {
            const snapshot = activeTurnSnapshotsRef.current.get(sendThreadKey);
            if (completedSuccessfully && snapshot !== undefined) {
              cacheThreadHistorySnapshot(sendThreadKey, snapshot);
            }
            clearStoredActiveTurnClientTurnId(sendThreadKey, clientTurnId);
            activeTurnSnapshotsRef.current.delete(sendThreadKey);
          }
          releaseAbortController();
        }
      }
    },
    [
      compaction,
      getToken,
      isStreaming,
      applyThreadLiveActivities,
      applyThreadMessages,
      cacheThreadHistorySnapshot,
      clearThreadLiveActivity,
      clearSoftDetachReconcileTimer,
      currentAssistantId,
      markStreaming,
      refreshChatPlan,
      refreshCompactionState,
      resolveKnownChatIdForThread,
      setThreadPendingSend,
      setThreadChatId,
      startSoftDetachReconcile,
      startStoredActiveTurnRestore,
      t,
      threadKey
    ]
  );
  const sendWelcome = useCallback(
    async (locale: string) => {
      if (isStreaming) return;
      const sendThreadKey = assistantScopedThreadKey;
      /* See `sendInPreflightByThreadRef` doc above. The same microtask race  */
      /* exists here between the `isStreaming` check and the synchronous     */
      /* `markStreaming(true)` below. Without this guard, two near-                 */
      /* simultaneous welcome triggers (e.g. a fast remount on first paint)  */
      /* would both reach the snapshot/setMessages claim and clobber each   */
      /* other.                                                              */
      if (sendInPreflightByThreadRef.current.has(sendThreadKey)) return;
      sendInPreflightByThreadRef.current.add(sendThreadKey);
      const releasePreflight = () => {
        sendInPreflightByThreadRef.current.delete(sendThreadKey);
      };
      const token = await getToken({ skipCache: true });
      if (token === null) {
        setIssue(toWebChatUxIssue(t("sessionExpired")));
        releasePreflight();
        return;
      }
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
      /* `markStreaming(true)` schedules a React state flip but the closure   */
      /* of any in-flight concurrent `sendWelcome` still sees the old        */
      /* `isStreaming = false`. We rely on the preflight ref above to gate   */
      /* re-entrancy until *this* welcome turn has appended its assistant    */
      /* placeholder + claimed the snapshot (a few lines below). Releasing   */
      /* immediately after `setMessages([assistantMsg])` is correct because   */
      /* by then both the snapshot map and the visible `messages` array      */
      /* contain the welcome assistant id, so a follow-up `send()` would     */
      /* still skip via its own `pendingSendStatusRef` check (welcome does   */
      /* not set the pending slot, so we keep the preflight ref live until   */
      /* after the assistant placeholder is mounted).                         */
      writeStoredActiveTurnClientTurnId(sendThreadKey, clientTurnId);
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
      const initialSnapshot = {
        clientTurnId,
        messages: [assistantMsg],
        liveUserMessageId: null,
        liveAssistantMessageId: assistantMsgId,
        liveActivitiesByMessageId: {},
        shadowRoutingLabelsByMessageId: {},
        chatId: null,
        compactionRunning: false
      };
      activeTurnSnapshotsRef.current.set(sendThreadKey, initialSnapshot);
      auditActiveTurnSnapshotMessages(
        "sendWelcome:initial-snapshot",
        sendThreadKey,
        initialSnapshot
      );
      setMessages([assistantMsg]);
      /* Snapshot is now claimed; concurrent `sendWelcome` would be blocked   */
      /* by the snapshot existing on this thread (and the next render's      */
      /* `isStreaming = true`). Release the synchronous preflight gate.      */
      releasePreflight();
      const pendingDelta = { text: "", raf: 0 };
      const flushDelta = (force = false) => {
        const chunk = force
          ? pendingDelta.text
          : pendingDelta.text.slice(0, STREAM_DELTA_FRAME_CHAR_BUDGET);
        pendingDelta.text = force ? "" : pendingDelta.text.slice(STREAM_DELTA_FRAME_CHAR_BUDGET);
        pendingDelta.raf = 0;
        if (!chunk) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: m.content + chunk, streamingTextActive: true }
              : m
          )
        );
        if (pendingDelta.text.length > 0 && !pendingDelta.raf) {
          pendingDelta.raf = requestAnimationFrame(() => flushDelta());
        }
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
          flushSync(() => flushDelta(true));
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
              if (typeof c?.id === "string") {
                setChatId(c.id);
                activeChatIdRef.current = c.id;
                setThreadChatId(sendThreadKey, c.id);
              }
            },
            onDelta: ({ delta }) => {
              pendingDelta.text += delta;
              if (!pendingDelta.raf) {
                pendingDelta.raf = requestAnimationFrame(() => flushDelta());
              }
            },
            onStreamReset: () => {
              cancelBufferedAssistantFlush();
              pendingDelta.text = "";
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, content: "", streamingTextActive: false } : m
                )
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
                  workingNotes?: string[];
                  toolInvocations?: RuntimeTurnToolInvocation[];
                  attachments?: ChatAttachment[];
                };
                runtime?: RuntimeTransportMeta;
              } | null;
              const newAssistantId =
                typeof t?.assistantMessage?.id === "string" ? t.assistantMessage.id : null;
              const assistantAttachments =
                Array.isArray(t?.assistantMessage?.attachments) &&
                t.assistantMessage.attachments.length > 0
                  ? t.assistantMessage.attachments.map((attachment) => toChatAttachment(attachment))
                  : undefined;
              const authoritativeWorkingNotes =
                Array.isArray(t?.assistantMessage?.workingNotes) &&
                t.assistantMessage.workingNotes.length > 0
                  ? t.assistantMessage.workingNotes
                  : null;
              const authoritativeToolInvocations =
                Array.isArray(t?.assistantMessage?.toolInvocations) &&
                t.assistantMessage.toolInvocations.length > 0
                  ? t.assistantMessage.toolInvocations
                  : null;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantMsgId) {
                    return m;
                  }
                  const authoritativeAssistantContent =
                    typeof t?.assistantMessage?.content === "string"
                      ? reconcileAuthoritativeAssistantContent(
                          m.content,
                          t.assistantMessage.content
                        )
                      : null;
                  return {
                    ...m,
                    ...(newAssistantId ? { id: newAssistantId } : {}),
                    ...(authoritativeAssistantContent !== null
                      ? { content: authoritativeAssistantContent }
                      : {}),
                    ...(authoritativeWorkingNotes !== null
                      ? { workingNotes: authoritativeWorkingNotes }
                      : {}),
                    ...(authoritativeToolInvocations !== null
                      ? { toolInvocations: authoritativeToolInvocations }
                      : {}),
                    status: "committed" as const,
                    attachments: assistantAttachments
                  };
                })
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
              const snapshot = activeTurnSnapshotsRef.current.get(sendThreadKey);
              if (snapshot !== undefined) {
                cacheThreadHistorySnapshot(sendThreadKey, {
                  ...snapshot,
                  liveAssistantMessageId: resolvedAssistantMessageId,
                  messages: snapshot.messages.map((message) =>
                    message.id === assistantMsgId
                      ? (() => {
                          const authoritativeAssistantContent =
                            typeof t?.assistantMessage?.content === "string"
                              ? reconcileAuthoritativeAssistantContent(
                                  message.content,
                                  t.assistantMessage.content
                                )
                              : null;
                          return {
                            ...message,
                            id: resolvedAssistantMessageId,
                            ...(authoritativeAssistantContent !== null
                              ? { content: authoritativeAssistantContent }
                              : {}),
                            status: "committed" as const,
                            attachments: assistantAttachments
                          };
                        })()
                      : message
                  )
                });
                activeTurnSnapshotsRef.current.set(sendThreadKey, {
                  ...snapshot,
                  liveAssistantMessageId: resolvedAssistantMessageId
                });
              }
            },
            onInterrupted: ({ transport }) => {
              flushBufferedAssistantState();
              const t = transport as {
                assistantMessage?: { id?: string; content?: string };
              } | null;
              const newAssistantId =
                typeof t?.assistantMessage?.id === "string" ? t.assistantMessage.id : null;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantMsgId) {
                    return m;
                  }
                  const authoritativeAssistantContent =
                    typeof t?.assistantMessage?.content === "string"
                      ? reconcileAuthoritativeAssistantContent(
                          m.content,
                          t.assistantMessage.content
                        )
                      : null;
                  const nextContent = authoritativeAssistantContent ?? m.content;
                  return {
                    ...m,
                    ...(newAssistantId ? { id: newAssistantId } : {}),
                    ...(authoritativeAssistantContent !== null
                      ? { content: authoritativeAssistantContent }
                      : {}),
                    status: nextContent.trim().length > 0 ? "partial" : "streaming"
                  };
                })
              );
            },
            onFailed: (payload) => {
              flushBufferedAssistantState();
              setIssue(toWebChatUxIssue(payload));
              const t = payload.transport as {
                assistantMessage?: { id?: string; content?: string };
              } | null;
              const newAssistantId =
                typeof t?.assistantMessage?.id === "string" ? t.assistantMessage.id : null;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantMsgId) {
                    return m;
                  }
                  const authoritativeAssistantContent =
                    typeof t?.assistantMessage?.content === "string"
                      ? reconcileAuthoritativeAssistantContent(
                          m.content,
                          t.assistantMessage.content
                        )
                      : null;
                  return {
                    ...m,
                    ...(newAssistantId ? { id: newAssistantId } : {}),
                    ...(authoritativeAssistantContent !== null
                      ? { content: authoritativeAssistantContent }
                      : {}),
                    status: "partial" as const
                  };
                })
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
        clearStoredActiveTurnClientTurnId(sendThreadKey, clientTurnId);
        activeTurnSnapshotsRef.current.delete(sendThreadKey);
        markStreaming(sendThreadKey, false);
        releaseAbortController();
      }
    },
    [
      cacheThreadHistorySnapshot,
      getToken,
      isStreaming,
      markStreaming,
      setThreadChatId,
      t,
      assistantScopedThreadKey,
      threadKey
    ]
  );
  /* sendRef makes retryPendingSend independent of `send`'s identity so we */ /* do not have to add `send` to the retry callback's dep list (which would */ /* create a circular useCallback). The ref is updated on every render with */ /* the latest `send`, so retry always dispatches the freshest closure. */ const sendRef =
    useRef(send);
  sendRef.current = send;
  const retryPendingSend = useCallback(async () => {
    const pending = pendingSendRef.current;
    if (pending === null) return;
    const token = await getToken({ skipCache: true });
    if (token === null) {
      setIssue(toWebChatUxIssue(t("sessionExpired")));
      return;
    }
    setThreadPendingSend(threadKey, { ...pending, status: "reconciling" });
    setMessages((prev) =>
      prev.map((m) => (m.id === pending.userMsgId ? { ...m, status: "reconciling" } : m))
    );
    try {
      for (let attempt = 1; attempt <= PENDING_RECONCILE_MAX_ATTEMPTS; attempt++) {
        const status = await getAssistantWebChatTurnStatus(token, pending.clientTurnId);
        if (
          status.status === "completed" &&
          status.userMessage !== null &&
          status.assistantMessage !== null
        ) {
          const rawCommitted = [
            status.userMessage,
            status.assistantMessage,
            ...(status.followUpAssistantMessage ? [status.followUpAssistantMessage] : [])
          ]
            .map(toCommittedChatMessage)
            .filter((m): m is ChatMessage => m !== null);
          const committed = reconcileServerAssistantMessagesWithLocal(rawCommitted, messages);
          setMessages((prev) => {
            const idsToRemove = new Set<string>([pending.userMsgId]);
            if (pending.assistantMsgId !== null) idsToRemove.add(pending.assistantMsgId);
            return [...prev.filter((m) => !idsToRemove.has(m.id)), ...committed];
          });
          activeTurnSnapshotsRef.current.delete(threadKey);
          setThreadPendingSend(threadKey, null);
          const reconciledChatId = status.chat?.id ?? activeChatIdRef.current ?? chatId;
          if (reconciledChatId !== null) {
            await refreshLatestHistory(reconciledChatId, {
              clearIssueOnReconcile: true,
              targetThreadKey: threadKey
            });
            void refreshCompactionState(reconciledChatId);
          }
          return;
        }
        if (status.status === "accepted" || status.status === "running") {
          const applied = applyTurnStatusState(threadKey, pending.clientTurnId, status);
          if (applied === "running") {
            setThreadPendingSend(threadKey, null);
            return;
          }
          if (attempt < PENDING_RECONCILE_MAX_ATTEMPTS) {
            await wait(PENDING_RECONCILE_INTERVAL_MS);
            continue;
          }
          break;
        }
        break;
      }
    } catch {
      setThreadPendingSend(threadKey, { ...pending, status: "send_failed_unconfirmed" });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pending.userMsgId ? { ...m, status: "send_failed_unconfirmed" } : m
        )
      );
      return;
    }
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
    activeTurnSnapshotsRef.current.delete(threadKey);
    setThreadPendingSend(threadKey, null);
    await sendRef.current(pending.text, pending.files, {
      ...(pending.options ?? {}),
      clientTurnId: pending.clientTurnId,
      clientAttachmentIds: pending.clientAttachmentIds
    });
  }, [
    applyTurnStatusState,
    chatId,
    getToken,
    refreshCompactionState,
    refreshLatestHistory,
    setThreadPendingSend,
    t,
    threadKey
  ]);
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
    activeTurnSnapshotsRef.current.delete(threadKey);
    setThreadPendingSend(threadKey, null);
    return restoredText;
  }, [setThreadPendingSend, threadKey]);
  const markHistoryEmpty = useCallback(() => {
    setHistoryLoading(false);
    replaceActiveMediaJobs([]);
    replaceActiveDocumentJobs([]);
  }, [replaceActiveDocumentJobs, replaceActiveMediaJobs]);
  const loadHistory = useCallback(
    async (targetChatId: string) => {
      const cachedThreadKey = cachedThreadKeyByChatIdRef.current.get(targetChatId);
      const cachedHistory =
        cachedThreadKey === undefined
          ? undefined
          : cachedThreadHistorySnapshotsRef.current.get(cachedThreadKey);
      const targetThreadKey = currentThreadKeyRef.current;
      const activeSnapshot = activeTurnSnapshotsRef.current.get(targetThreadKey);
      if (cachedHistory !== undefined) {
        const merged = mergeCommittedHistoryWithActiveTurn({
          loaded: cachedHistory.messages,
          activeSnapshot
        });
        if (merged.replacedActiveTurn && activeSnapshot !== undefined) {
          clearStoredActiveTurnClientTurnId(targetThreadKey, activeSnapshot.clientTurnId);
          activeTurnSnapshotsRef.current.delete(targetThreadKey);
          abortControllersByThreadRef.current.get(targetThreadKey)?.controller.abort();
          abortControllersByThreadRef.current.delete(targetThreadKey);
          markStreaming(targetThreadKey, false);
          setLiveActivitiesByMessageId({});
          setThreadPendingSend(targetThreadKey, null);
        } else if (activeSnapshot !== undefined) {
          const nextSnapshot = {
            ...activeSnapshot,
            messages: merged.messages,
            chatId: targetChatId
          };
          activeTurnSnapshotsRef.current.set(targetThreadKey, nextSnapshot);
          auditActiveTurnSnapshotMessages(
            "loadHistory:cached-merge",
            targetThreadKey,
            nextSnapshot
          );
        }
        setMessages(merged.messages);
        olderCursorRef.current = cachedHistory.olderCursor;
        activeChatIdRef.current = targetChatId;
        setHasOlderMessages(cachedHistory.hasOlderMessages);
        replaceActiveMediaJobs(cachedHistory.activeMediaJobs);
        replaceActiveDocumentJobs(cachedHistory.activeDocumentJobs);
        setChatId(targetChatId);
        setHistoryLoading(false);
      }
      const token = await getToken();
      if (!token) return;
      setHistoryLoading(cachedHistory === undefined);
      try {
        const page = await getChatMessages(token, targetChatId, undefined, 20);
        const nextActiveMediaJobs = page.activeMediaJobs ?? [];
        const nextActiveDocumentJobs = page.activeDocumentJobs ?? [];
        const loaded: ChatMessage[] = page.messages
          .map(toCommittedChatMessage)
          .filter((message): message is ChatMessage => message !== null);
        const hasAuthoritativeActiveTurn = Object.prototype.hasOwnProperty.call(page, "activeTurn");
        const rawActiveTurn = hasAuthoritativeActiveTurn ? (page.activeTurn ?? null) : null;
        const localActiveSnapshot = activeTurnSnapshotsRef.current.get(targetThreadKey);
        const serverActiveTurnAlreadyCommitted =
          rawActiveTurn !== null && committedHistoryHasActiveTurnResult(loaded, rawActiveTurn);
        const localActiveSnapshotAlreadyCommitted = committedHistoryHasActiveSnapshotResult(
          loaded,
          localActiveSnapshot
        );
        const shouldClearAuthoritativeActiveTurn =
          hasAuthoritativeActiveTurn &&
          (serverActiveTurnAlreadyCommitted ||
            (rawActiveTurn === null && localActiveSnapshotAlreadyCommitted));
        const projectedActiveTurn =
          rawActiveTurn !== null &&
          !serverActiveTurnAlreadyCommitted &&
          localActiveSnapshot === undefined
            ? rawActiveTurn
            : null;
        const activeOverlay = projectedActiveTurn
          ? toActiveTurnOverlayMessages(projectedActiveTurn)
          : {
              messages: [],
              liveActivitiesByMessageId: {},
              liveUserMessageId: null,
              liveAssistantMessageId: null
            };
        let messagesForCache = mergeChatMessagesById(loaded, activeOverlay.messages);
        if (
          loaded.length === 0 &&
          localActiveSnapshot !== undefined &&
          projectedActiveTurn === null
        ) {
          messagesForCache = localActiveSnapshot.messages;
        }
        if (loaded.length > 0) {
          const currentActiveSnapshot =
            projectedActiveTurn !== null ? undefined : localActiveSnapshot;
          if (currentActiveSnapshot !== undefined) {
            const merged = mergeCommittedHistoryWithActiveTurn({
              loaded,
              activeSnapshot: currentActiveSnapshot,
              baseMessages: currentThreadKeyRef.current === targetThreadKey ? messages : undefined
            });
            messagesForCache = merged.messages;
            if (merged.replacedActiveTurn) {
              clearStoredActiveTurnClientTurnId(
                targetThreadKey,
                currentActiveSnapshot.clientTurnId
              );
              activeTurnSnapshotsRef.current.delete(targetThreadKey);
              abortControllersByThreadRef.current.get(targetThreadKey)?.controller.abort();
              abortControllersByThreadRef.current.delete(targetThreadKey);
              markStreaming(targetThreadKey, false);
              setLiveActivitiesByMessageId({});
              setThreadPendingSend(targetThreadKey, null);
            } else {
              const nextSnapshot = {
                ...currentActiveSnapshot,
                messages: merged.messages,
                chatId: targetChatId
              };
              activeTurnSnapshotsRef.current.set(targetThreadKey, nextSnapshot);
              auditActiveTurnSnapshotMessages(
                "loadHistory:authoritative-merge",
                targetThreadKey,
                nextSnapshot
              );
            }
            setMessages(merged.messages);
          } else if (currentThreadKeyRef.current === targetThreadKey) {
            if (hasAuthoritativeActiveTurn) {
              setMessages(messagesForCache);
            } else {
              setMessages((prev) => {
                const loadedIds = new Set(loaded.map((message) => message.id));
                const existingIds = new Set(prev.map((m) => m.id));
                const newHistory = loaded.filter((m) => !existingIds.has(m.id));
                const sanitizedPrev = prev.filter((message) => {
                  if (loadedIds.has(message.id)) return false;
                  return (
                    !isOptimisticLocalMessage(message) &&
                    !isTransientActiveAssistantMessage(message)
                  );
                });
                const nextMessages = [...newHistory, ...sanitizedPrev];
                messagesForCache = nextMessages;
                return nextMessages;
              });
            }
          }
        } else if (currentThreadKeyRef.current === targetThreadKey) {
          setMessages(messagesForCache);
        }
        if (shouldClearAuthoritativeActiveTurn) {
          messagesForCache = messagesForCache.filter(
            (message) => !isTransientActiveAssistantMessage(message)
          );
          const activeClientTurnId =
            localActiveSnapshot?.clientTurnId ?? rawActiveTurn?.clientTurnId;
          if (activeClientTurnId !== undefined) {
            softDetachedClientTurnIdsRef.current.delete(activeClientTurnId);
            clearStoredActiveTurnClientTurnId(targetThreadKey, activeClientTurnId);
          }
          activeTurnSnapshotsRef.current.delete(targetThreadKey);
          abortControllersByThreadRef.current.get(targetThreadKey)?.controller.abort();
          abortControllersByThreadRef.current.delete(targetThreadKey);
          setLiveActivitiesByMessageId({});
          markStreaming(targetThreadKey, false);
          setThreadPendingSend(targetThreadKey, null);
          if (currentThreadKeyRef.current === targetThreadKey) {
            setMessages(messagesForCache);
          }
        }
        if (projectedActiveTurn) {
          const nextSnapshot = {
            clientTurnId: projectedActiveTurn.clientTurnId,
            messages: messagesForCache,
            liveUserMessageId: activeOverlay.liveUserMessageId,
            liveAssistantMessageId:
              activeOverlay.liveAssistantMessageId ??
              `active-assistant-${projectedActiveTurn.clientTurnId}`,
            liveActivitiesByMessageId: activeOverlay.liveActivitiesByMessageId,
            shadowRoutingLabelsByMessageId: {},
            chatId: targetChatId,
            compactionRunning: false
          };
          activeTurnSnapshotsRef.current.set(targetThreadKey, nextSnapshot);
          auditActiveTurnSnapshotMessages(
            "loadHistory:projected-active-turn",
            targetThreadKey,
            nextSnapshot
          );
          writeStoredActiveTurnClientTurnId(targetThreadKey, projectedActiveTurn.clientTurnId);
          setLiveActivitiesByMessageId(activeOverlay.liveActivitiesByMessageId);
          markStreaming(targetThreadKey, true);
        } else if (
          rawActiveTurn !== null &&
          hasAuthoritativeActiveTurn &&
          !activeThreads.has(targetThreadKey) &&
          !abortControllersByThreadRef.current.has(targetThreadKey)
        ) {
          softDetachedClientTurnIdsRef.current.delete(rawActiveTurn.clientTurnId);
          clearStoredActiveTurnClientTurnId(targetThreadKey, rawActiveTurn.clientTurnId);
          activeTurnSnapshotsRef.current.delete(targetThreadKey);
          setLiveActivitiesByMessageId({});
          markStreaming(targetThreadKey, false);
        }
        olderCursorRef.current = page.nextCursor;
        activeChatIdRef.current = targetChatId;
        setHasOlderMessages(page.nextCursor !== null);
        replaceActiveMediaJobs(nextActiveMediaJobs);
        replaceActiveDocumentJobs(nextActiveDocumentJobs);
        if (currentThreadKeyRef.current === targetThreadKey) {
          setCurrentEngagement(page.currentEngagement ?? null);
          applyPendingBrowserLoginForThread(targetThreadKey, page.pendingBrowserLogin ?? null);
        }
        setChatId(targetChatId);
        cachedThreadHistorySnapshotsRef.current.set(targetThreadKey, {
          clientTurnId:
            projectedActiveTurn?.clientTurnId ?? localActiveSnapshot?.clientTurnId ?? "",
          messages: messagesForCache,
          liveUserMessageId:
            projectedActiveTurn !== null
              ? activeOverlay.liveUserMessageId
              : (localActiveSnapshot?.liveUserMessageId ?? null),
          liveAssistantMessageId:
            projectedActiveTurn !== null
              ? (activeOverlay.liveAssistantMessageId ??
                `active-assistant-${projectedActiveTurn.clientTurnId}`)
              : (localActiveSnapshot?.liveAssistantMessageId ??
                `local-assistant-${localActiveSnapshot?.clientTurnId ?? ""}`),
          liveActivitiesByMessageId:
            projectedActiveTurn !== null
              ? activeOverlay.liveActivitiesByMessageId
              : (localActiveSnapshot?.liveActivitiesByMessageId ?? {}),
          shadowRoutingLabelsByMessageId: {},
          chatId: targetChatId,
          compactionRunning: false,
          olderCursor: page.nextCursor,
          hasOlderMessages: page.nextCursor !== null,
          activeMediaJobs: nextActiveMediaJobs,
          activeDocumentJobs: nextActiveDocumentJobs
        });
        cachedThreadKeyByChatIdRef.current.set(targetChatId, targetThreadKey);
        void refreshCompactionState(targetChatId);
        void refreshChatPlan();
        historyLoadedRef.current.add(targetChatId);
      } catch {
        /* non-critical */
      }
      setHistoryLoading(false);
    },
    [
      activeThreads,
      getToken,
      markStreaming,
      messages,
      refreshCompactionState,
      refreshChatPlan,
      setThreadPendingSend
    ]
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
      const loaded: ChatMessage[] = page.messages
        .map(toCommittedChatMessage)
        .filter((message): message is ChatMessage => message !== null);
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
  useEffect(() => {
    if (
      chatId === null ||
      (activeMediaJobs.length === 0 && activeDocumentJobs.length === 0) ||
      isStreaming
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void refreshLatestHistory(chatId, { targetThreadKey: currentThreadKeyRef.current });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [activeDocumentJobs, activeMediaJobs, chatId, isStreaming, refreshLatestHistory]);
  // Drop phantom "thinking" / blinking-cursor placeholders. If a streaming
  // assistant message has empty content AND there's a NEWER assistant
  // message below it, the older one is stale (background turn already
  // landed but its `applyTurnStatusState` cleanup didn't fire for that
  // exact id — e.g. the active turn registry was on a different pod, the
  // GET /turns reattach completed, or the snapshot was constructed by a
  // historical projection). Hide the stale placeholder so the chat area
  // does not render a permanent "Думаю...".
  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") return i;
    }
    return -1;
  })();
  const visibleMessages = messages.filter((message, index) => {
    if (
      message.role === "assistant" &&
      message.status === "streaming" &&
      message.content.trim().length === 0 &&
      index < lastAssistantIndex
    ) {
      return false;
    }
    return true;
  });
  const latestAssistantMessageId =
    [...visibleMessages].reverse().find((message) => message.role === "assistant")?.id ?? null;
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
  for (const m of visibleMessages) {
    entries.push({ kind: "message", message: m });
    const live = liveActivitiesByMessageId[m.id];
    if (live && !isHiddenMediaActivity(live) && m.id === latestAssistantMessageId) {
      const shadowRoutingLabel = shadowRoutingLabelsByMessageId[m.id];
      entries.push({
        kind: "activity",
        event: shadowRoutingLabel === undefined ? live : { ...live, shadowRoutingLabel }
      });
    }
    const linked = activityByMsg.get(m.id);
    if (linked) {
      for (const ev of linked) {
        if (!isHiddenMediaActivity(ev)) {
          entries.push({ kind: "activity", event: ev });
        }
      }
    }
  }
  for (const ev of orphanActivities) {
    if (!isHiddenMediaActivity(ev)) {
      entries.push({ kind: "activity", event: ev });
    }
  }
  return {
    entries,
    messages,
    chatId,
    activeMediaJobs,
    activeDocumentJobs,
    isStreaming,
    historyLoading,
    hasOlderMessages,
    olderMessagesLoading,
    issue,
    compaction,
    recentAutoCompaction,
    compactionRunning,
    chatPlan,
    chatPlanTotalCount,
    chatPlanWindowed,
    refreshChatPlan,
    clearChatPlan,
    currentEngagement,
    pendingBrowserLogin,
    browserLoginModalOpen: pendingBrowserLogin !== null && !browserLoginDismissed,
    dismissBrowserLogin,
    reopenBrowserLogin,
    abortBrowserLogin,
    clearPendingBrowserLogin,
    send,
    sendWelcome,
    compactNow,
    stop,
    clearIssue,
    reportIssue,
    noteDocumentJobStarted,
    loadHistory,
    markHistoryEmpty,
    loadOlderMessages,
    pendingSendStatus,
    retryPendingSend,
    cancelPendingSend
  };
}
