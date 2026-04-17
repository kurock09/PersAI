import {
  type AdminBusinessCockpitState,
  type AdminNotificationChannelState,
  type AdminRuntimeProviderSettingsRequest,
  type AdminRuntimeProviderSettingsState,
  type PlatformRolloutState,
  type PostAdminPlatformRolloutRequest,
  type PatchAdminNotificationWebhookChannelRequest,
  type AdminPlanCreateRequest,
  type AdminDangerousActionCode,
  type AdminOpsCockpitState,
  type PostAdminOpsUserPlanOverrideParams,
  type AdminPlanVisibilityState,
  type AdminPlanState,
  type AdminPlanUpdateRequest,
  type PutAdminRuntimeProviderSettingsResponse,
  type AdminAbuseUnblockRequest,
  type PostAdminAbuseUnblockResponse,
  type AssistantTelegramConfigUpdateRequest,
  type TelegramIntegrationState,
  type AssistantWebChatDeleteRequest,
  type AssistantWebChatCompactRequest,
  type AssistantWebChatCompactionResult,
  type AssistantWebChatCompactionState,
  type AssistantWebChatListItemState,
  type AssistantWebChatRenameRequest,
  type AssistantDraftUpdateRequest,
  type AssistantSetupPreviewState,
  type AssistantRollbackRequest,
  type AssistantMemoryDoNotRememberRequest,
  type AssistantMemoryRegistryItemState,
  type AssistantTaskRegistryItemState,
  ContractsApiError,
  type AssistantLifecycleState,
  type UserPlanVisibilityState,
  deleteAssistantWebChat as deleteAssistantWebChatContract,
  getAssistant as getAssistantContract,
  getAssistantMemoryItems as getAssistantMemoryItemsContract,
  getAssistantTaskItems as getAssistantTaskItemsContract,
  getAssistantWebChats as getAssistantWebChatsContract,
  patchAssistantDraft as patchAssistantDraftContract,
  postAssistantSetupPreview as postAssistantSetupPreviewContract,
  patchAdminPlan as patchAdminPlanContract,
  patchAssistantWebChat as patchAssistantWebChatContract,
  postAssistantPublish as postAssistantPublishContract,
  postAssistantReapply as postAssistantReapplyContract,
  postAssistantReset as postAssistantResetContract,
  postAssistantRollback as postAssistantRollbackContract,
  postAssistantWebChatArchive as postAssistantWebChatArchiveContract,
  getAssistantWebChatCompaction as getAssistantWebChatCompactionContract,
  postAssistantCreate as postAssistantCreateContract,
  postAssistantWebChatCompact as postAssistantWebChatCompactContract,
  postAdminPlanCreate as postAdminPlanCreateContract,
  postAdminStepUpChallenge as postAdminStepUpChallengeContract,
  postAssistantMemoryDoNotRemember as postAssistantMemoryDoNotRememberContract,
  postAssistantMemoryItemForget as postAssistantMemoryItemForgetContract,
  postAssistantTaskItemCancel as postAssistantTaskItemCancelContract,
  postAssistantTaskItemDisable as postAssistantTaskItemDisableContract,
  postAssistantTaskItemEnable as postAssistantTaskItemEnableContract,
  getAdminPlans as getAdminPlansContract,
  getAdminBusinessCockpit as getAdminBusinessCockpitContract,
  getAdminNotificationChannels as getAdminNotificationChannelsContract,
  getAdminPlatformRollouts as getAdminPlatformRolloutsContract,
  getAdminOpsCockpit as getAdminOpsCockpitContract,
  postAdminOpsUserPlanOverride as postAdminOpsUserPlanOverrideContract,
  deleteAdminOpsUserPlanOverride as deleteAdminOpsUserPlanOverrideContract,
  getAdminPlanVisibility as getAdminPlanVisibilityContract,
  getAdminRuntimeProviderSettings as getAdminRuntimeProviderSettingsContract,
  getAssistantPlanVisibility as getAssistantPlanVisibilityContract,
  getAssistantTelegramIntegration as getAssistantTelegramIntegrationContract,
  patchAssistantTelegramConfig as patchAssistantTelegramConfigContract,
  patchAdminNotificationWebhookChannel as patchAdminNotificationWebhookChannelContract,
  postAdminAbuseControlsUnblock as postAdminAbuseControlsUnblockContract,
  postAssistantTelegramConnect as postAssistantTelegramConnectContract,
  postAssistantTelegramRevoke as postAssistantTelegramRevokeContract,
  postAdminPlatformRollout as postAdminPlatformRolloutContract,
  postAdminPlatformRolloutRollback as postAdminPlatformRolloutRollbackContract,
  putAdminRuntimeProviderSettings as putAdminRuntimeProviderSettingsContract
} from "@persai/contracts";

function getAuthHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`
  };
}

async function issueAdminStepUpToken(
  token: string,
  action: AdminDangerousActionCode
): Promise<string> {
  const challengeResponse = await postAdminStepUpChallengeContract(
    { action },
    {
      headers: getAuthHeaders(token)
    }
  );
  if (
    !isSuccessStatus(challengeResponse.status) ||
    typeof challengeResponse.data !== "object" ||
    challengeResponse.data === null ||
    !("challenge" in challengeResponse.data) ||
    typeof challengeResponse.data.challenge !== "object" ||
    challengeResponse.data.challenge === null ||
    !("token" in challengeResponse.data.challenge) ||
    typeof challengeResponse.data.challenge.token !== "string"
  ) {
    throw new Error("Unexpected non-success response for POST /admin/step-up/challenge.");
  }
  return challengeResponse.data.challenge.token;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof ContractsApiError) {
    if (error.status === 401) {
      return "Session expired. Sign in again and refresh the page.";
    }
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown API request error.";
}

async function readJsonErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return fallbackMessage;
  }

  try {
    const payload = (await response.json()) as unknown;
    if (typeof payload !== "object" || payload === null) {
      return fallbackMessage;
    }

    const envelope = payload as {
      error?: { message?: unknown };
      message?: unknown;
    };
    if (typeof envelope.error?.message === "string" && envelope.error.message.trim().length > 0) {
      return envelope.error.message;
    }
    if (typeof envelope.message === "string" && envelope.message.trim().length > 0) {
      return envelope.message;
    }
  } catch {
    return fallbackMessage;
  }

  return fallbackMessage;
}

function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const fromEnv = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
      const normalized = fromEnv.trim().replace(/\/$/, "");
      if (!/^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3})(?::\d+)?(?:\/|$)/i.test(normalized)) {
        return normalized;
      }
    }
    return "/api/v1";
  }

  const fromEnv = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim().replace(/\/$/, "");
  }

  return "http://localhost:3001/api/v1";
}

function isSuccessStatus(status: number): status is 200 | 201 {
  return status === 200 || status === 201;
}

type WebChatStreamEvent =
  | { event: "started"; data: { chat: unknown; userMessage: unknown } }
  | { event: "thinking"; data: { delta: string; accumulated: string } }
  | { event: "delta"; data: { delta: string } }
  | {
      event: "tool";
      data: {
        phase: "start" | "end";
        toolName: string;
        toolCallId: string;
        isError: boolean;
      };
    }
  | {
      event: "compaction";
      data: { phase: "start" | "end"; completed: boolean; willRetry: boolean };
    }
  | { event: "runtime_done"; data: { respondedAt: string } }
  | { event: "completed"; data: { transport: unknown } }
  | { event: "interrupted"; data: { transport: unknown } }
  | { event: "failed"; data: { code?: string; message: string; transport: unknown } };

export const WELCOME_THREAD_KEY = "welcome";
export const WELCOME_TURN_SENTINEL = "__welcome_init__";

export interface AssistantWebChatStreamPayload {
  surfaceThreadKey: string;
  message: string;
  clientTurnId?: string;
  title?: string | null;
  deepModeEnabled?: boolean;
  welcomeTurn?: boolean;
  welcomeLocale?: string;
}

export interface AssistantWebChatStreamHandlers {
  onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
  onThinking?: (payload: { delta: string; accumulated: string }) => void;
  onDelta?: (payload: { delta: string }) => void;
  onTool?: (payload: {
    phase: "start" | "end";
    toolName: string;
    toolCallId: string;
    isError: boolean;
  }) => void;
  onCompaction?: (payload: {
    phase: "start" | "end";
    completed: boolean;
    willRetry: boolean;
  }) => void;
  onRuntimeDone?: (payload: { respondedAt: string }) => void;
  onCompleted?: (payload: { transport: unknown }) => void;
  onInterrupted?: (payload: { transport: unknown }) => void;
  onFailed?: (payload: { code?: string; message: string; transport: unknown }) => void;
}

export type WebChatUxIssueClass =
  | "auth_session"
  | "input_validation"
  | "assistant_not_live"
  | "active_chat_cap"
  | "quota_limit_reached"
  | "media_storage_full"
  | "knowledge_storage_full"
  | "workspace_storage_full"
  | "feature_unavailable"
  | "runtime_unreachable"
  | "runtime_timeout"
  | "runtime_degraded"
  | "runtime_auth"
  | "provider_failure"
  | "tool_failure"
  | "channel_failure"
  | "stream_incomplete"
  | "compaction_unavailable"
  | "unknown";

export interface WebChatUxIssue {
  classId: WebChatUxIssueClass;
  message: string;
  guidance: string;
  data?: Record<string, unknown>;
}

async function readApiErrorEnvelope(
  response: Response
): Promise<{ code: string; message: string; details?: Record<string, unknown> } | null> {
  const ct = response.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return null;
  try {
    const payload = (await response.json()) as unknown;
    if (typeof payload !== "object" || payload === null) return null;
    const env = payload as { error?: { code?: unknown; message?: unknown; details?: unknown } };
    const err = env.error;
    if (!err || typeof err.code !== "string" || typeof err.message !== "string") return null;
    const details =
      typeof err.details === "object" && err.details !== null && !Array.isArray(err.details)
        ? (err.details as Record<string, unknown>)
        : null;
    return {
      code: err.code,
      message: err.message,
      ...(details !== null ? { details } : {})
    };
  } catch {
    return null;
  }
}

class ApiStructuredError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

function normalizeRawErrorMessage(source: string): string {
  return source.trim().toLowerCase();
}

function isOversizedAttachmentMessage(normalizedMessage: string): boolean {
  return (
    normalizedMessage.includes("request entity too large") ||
    normalizedMessage.includes("entity.too.large") ||
    normalizedMessage.includes("payload too large") ||
    normalizedMessage.includes("file too large") ||
    normalizedMessage.includes("too large for direct model input")
  );
}

function extractErrorCode(error: unknown): string | null {
  if (
    error instanceof ContractsApiError &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    return error.code;
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const value = (error as { code?: unknown }).code;
    return typeof value === "string" && value.length > 0 ? value : null;
  }
  return null;
}

function extractErrorMessage(error: unknown): string | null {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof ContractsApiError || error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const value = (error as { message?: unknown }).message;
    return typeof value === "string" && value.trim().length > 0 ? value : null;
  }
  return null;
}

export function toWebChatUxIssue(error: unknown): WebChatUxIssue {
  const rawMessage = extractErrorMessage(error) ?? "Web chat request failed.";

  const normalized = normalizeRawErrorMessage(rawMessage);
  const status = error instanceof ContractsApiError ? error.status : null;
  const code = extractErrorCode(error);

  if (
    (code === "native_runtime_request_invalid" && isOversizedAttachmentMessage(normalized)) ||
    isOversizedAttachmentMessage(normalized)
  ) {
    return {
      classId: "input_validation",
      message: "One or more attached files are too large for direct model input.",
      guidance: "Remove some files, split them across messages, or send a smaller file."
    };
  }

  if (code === "assistant_not_live") {
    return {
      classId: "assistant_not_live",
      message: "Chat is unavailable until your assistant is live on the latest publish.",
      guidance: "Publish/apply the assistant first, then retry."
    };
  }

  if (code === "active_chat_cap_reached") {
    return {
      classId: "active_chat_cap",
      message: "You reached the active chat limit for new threads.",
      guidance: "Archive an active chat or continue in an existing thread."
    };
  }

  if (code === "quota_limit_reached") {
    return {
      classId: "quota_limit_reached",
      message: "This turn cannot continue on the current plan limits.",
      guidance:
        "No safe fallback route is available for this request right now. Wait for quota refresh, simplify the request, or upgrade the plan."
    };
  }

  if (code === "media_storage_quota_exceeded") {
    const usedMb =
      error instanceof ApiStructuredError && typeof error.details?.usedMb === "number"
        ? error.details.usedMb
        : null;
    const limitMb =
      error instanceof ApiStructuredError && typeof error.details?.limitMb === "number"
        ? error.details.limitMb
        : null;
    return {
      classId: "media_storage_full",
      message:
        limitMb !== null
          ? `Media storage full: ${usedMb ?? "?"} MB used out of ${limitMb} MB.`
          : "Media storage limit reached.",
      guidance: "Delete old chats or files to free up space, then try uploading again.",
      data: { usedMb, limitMb }
    };
  }

  if (code === "workspace_storage_full") {
    const usedMb =
      error instanceof ApiStructuredError && typeof error.details?.usedMb === "number"
        ? error.details.usedMb
        : null;
    const limitMb =
      error instanceof ApiStructuredError && typeof error.details?.limitMb === "number"
        ? error.details.limitMb
        : null;
    return {
      classId: "workspace_storage_full",
      message:
        limitMb !== null
          ? `Workspace disk full: ${usedMb ?? "?"} MB used out of ${limitMb} MB.`
          : "Workspace disk is full.",
      guidance: "Delete old chats or files to free up space, then try uploading again.",
      data: { usedMb, limitMb }
    };
  }

  if (code === "knowledge_storage_quota_exceeded") {
    const usedMb =
      error instanceof ApiStructuredError && typeof error.details?.usedMb === "number"
        ? error.details.usedMb
        : null;
    const limitMb =
      error instanceof ApiStructuredError && typeof error.details?.limitMb === "number"
        ? error.details.limitMb
        : null;
    return {
      classId: "knowledge_storage_full",
      message:
        limitMb !== null
          ? `Knowledge base storage full: ${usedMb ?? "?"} MB used out of ${limitMb} MB.`
          : "Knowledge base storage limit reached.",
      guidance:
        "Delete older knowledge-base documents or free assistant storage, then try uploading again.",
      data: { usedMb, limitMb }
    };
  }

  if (code === "token_budget_exhausted") {
    return {
      classId: "quota_limit_reached",
      message: "Monthly token budget has been exhausted.",
      guidance:
        "Wait for the next billing cycle or upgrade the plan to continue using the assistant."
    };
  }

  if (code === "tool_daily_limit_reached") {
    return {
      classId: "quota_limit_reached",
      message: "A daily tool usage limit has been reached.",
      guidance: "Try again later or use a request that does not need the exhausted tool."
    };
  }

  if (code === "plan_feature_unavailable") {
    return {
      classId: "feature_unavailable",
      message: "This feature is not available on your current plan.",
      guidance: "Upgrade your plan to unlock this capability."
    };
  }

  if (code === "rate_limited") {
    return {
      classId: "quota_limit_reached",
      message: "Requests are temporarily limited right now.",
      guidance: "Wait a moment, then retry the same thread."
    };
  }

  if (code === "compaction_unavailable") {
    return {
      classId: "compaction_unavailable",
      message: rawMessage,
      guidance:
        "If the runtime session is not ready yet, send a normal message in this thread and try again."
    };
  }

  if (code === "runtime_timeout") {
    return {
      classId: "runtime_timeout",
      message: "The chat response timed out before completion.",
      guidance: "Retry the message. Partial output may already be preserved."
    };
  }

  if (code === "runtime_degraded") {
    return {
      classId: "runtime_degraded",
      message: "Chat runtime is currently degraded.",
      guidance: "Retry shortly, or continue with a simpler request."
    };
  }

  if (code === "runtime_unreachable") {
    return {
      classId: "runtime_unreachable",
      message: "Chat runtime is temporarily unreachable.",
      guidance: "Retry in a moment. Your chat history is preserved."
    };
  }

  if (code === "runtime_auth_failure") {
    return {
      classId: "runtime_auth",
      message: "Runtime authorization failed for this chat turn.",
      guidance: "Try again shortly. If it persists, contact support."
    };
  }

  if (status === 401) {
    return {
      classId: "auth_session",
      message: "Your session has expired for chat actions.",
      guidance: "Sign in again, then retry the message."
    };
  }

  if (
    normalized.includes("no_audio_detected") ||
    normalized.includes("voice transcription returned empty")
  ) {
    return {
      classId: "input_validation",
      message: "No speech was detected in your recording.",
      guidance:
        "Check that the correct microphone is selected in your browser settings and that it is not muted."
    };
  }

  if (status === 400 || normalized.includes("must be") || normalized.includes("payload")) {
    return {
      classId: "input_validation",
      message: "This chat request has invalid input.",
      guidance: "Check message text and thread key, then try again."
    };
  }

  if (normalized.includes("active web chats cap reached")) {
    return {
      classId: "active_chat_cap",
      message: "You reached the active chat limit for new threads.",
      guidance: "Archive an active chat or continue in an existing thread."
    };
  }

  if (
    normalized.includes("media storage quota exceeded") ||
    normalized.includes("media storage full")
  ) {
    return {
      classId: "media_storage_full",
      message: "Media storage limit reached.",
      guidance: "Delete old chats or files to free up space, then try uploading again."
    };
  }

  if (
    normalized.includes("quota limit reached") ||
    normalized.includes("budget limit reached") ||
    normalized.includes("quota refresh")
  ) {
    return {
      classId: "quota_limit_reached",
      message: "You've reached your plan's usage limit.",
      guidance:
        "Your message quota or tool usage limit has been exceeded. Wait for the next billing cycle or upgrade your plan."
    };
  }

  if (
    normalized.includes("unavailable") &&
    (normalized.includes("capability") ||
      normalized.includes("capabilities") ||
      normalized.includes("plan"))
  ) {
    return {
      classId: "feature_unavailable",
      message: "This feature is not available on your current plan.",
      guidance: "Upgrade your plan to unlock this capability."
    };
  }

  if (
    normalized.includes("latest published version") ||
    normalized.includes("successfully applied") ||
    normalized.includes("until at least one version is published")
  ) {
    return {
      classId: "assistant_not_live",
      message: "Chat is unavailable until your assistant is live on the latest publish.",
      guidance: "Publish/apply the assistant first, then retry."
    };
  }

  if (normalized.includes("provider")) {
    return {
      classId: "provider_failure",
      message: "A model provider issue interrupted this chat turn.",
      guidance: "Wait a moment and retry the same thread."
    };
  }

  if (normalized.includes("tool")) {
    return {
      classId: "tool_failure",
      message: "A tool action failed during this chat turn.",
      guidance: "Retry your request or rephrase without the failing tool action."
    };
  }

  if (normalized.includes("channel")) {
    return {
      classId: "channel_failure",
      message: "A channel delivery step failed for this chat turn.",
      guidance: "Retry in the current web thread."
    };
  }

  if (normalized.includes("auth failure")) {
    return {
      classId: "runtime_auth",
      message: "Runtime authorization failed for this chat turn.",
      guidance: "Try again shortly. If it persists, contact support."
    };
  }

  if (normalized.includes("timed out") || normalized.includes("timeout")) {
    return {
      classId: "runtime_timeout",
      message: "The chat response timed out before completion.",
      guidance: "Retry the message. Partial output may already be preserved."
    };
  }

  if (normalized.includes("degraded")) {
    return {
      classId: "runtime_degraded",
      message: "Chat runtime is currently degraded.",
      guidance: "Retry shortly, or continue with a simpler request."
    };
  }

  if (normalized.includes("unreachable")) {
    return {
      classId: "runtime_unreachable",
      message: "Chat runtime is temporarily unreachable.",
      guidance: "Retry in a moment. Your chat history is preserved."
    };
  }

  if (normalized.includes("stream") || normalized.includes("partial")) {
    return {
      classId: "stream_incomplete",
      message: "Streaming ended before a full answer was completed.",
      guidance: "Use the partial response as context and retry in the same thread."
    };
  }

  if (
    normalized.includes("compaction") ||
    normalized.includes("compact") ||
    normalized.includes("active runtime session")
  ) {
    return {
      classId: "compaction_unavailable",
      message: typeof error === "string" ? error : rawMessage,
      guidance:
        "Context compaction could not finish. Send a normal message in this thread, wait for a reply, then try “Compress now” again."
    };
  }

  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized.includes("load failed") ||
    normalized.includes("err_network")
  ) {
    return {
      classId: "stream_incomplete",
      message: "The connection dropped while the reply was still generating.",
      guidance:
        "Long replies (e.g. images) can hit proxy timeouts. Refresh the chat — the answer is often saved. If it repeats, contact support."
    };
  }

  return {
    classId: "unknown",
    message: "Chat could not complete this turn.",
    guidance: "Retry in the same thread. If it keeps failing, contact support."
  };
}

function toStreamEvent(eventName: string, payload: unknown): WebChatStreamEvent | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const body = payload as Record<string, unknown>;
  if (eventName === "started") {
    return { event: "started", data: { chat: body.chat, userMessage: body.userMessage } };
  }
  if (eventName === "delta") {
    if (typeof body.delta !== "string") {
      return null;
    }
    return {
      event: "delta",
      data: { delta: body.delta }
    };
  }
  if (eventName === "thinking") {
    if (typeof body.delta !== "string" || typeof body.accumulated !== "string") {
      return null;
    }
    return {
      event: "thinking",
      data: { delta: body.delta, accumulated: body.accumulated }
    };
  }
  if (eventName === "tool") {
    if (
      (body.phase !== "start" && body.phase !== "end") ||
      typeof body.toolName !== "string" ||
      typeof body.toolCallId !== "string" ||
      typeof body.isError !== "boolean"
    ) {
      return null;
    }
    return {
      event: "tool",
      data: {
        phase: body.phase,
        toolName: body.toolName,
        toolCallId: body.toolCallId,
        isError: body.isError
      }
    };
  }
  if (eventName === "runtime_done") {
    if (typeof body.respondedAt !== "string") {
      return null;
    }
    return { event: "runtime_done", data: { respondedAt: body.respondedAt } };
  }
  if (eventName === "compaction") {
    if (
      (body.phase !== "start" && body.phase !== "end") ||
      typeof body.completed !== "boolean" ||
      typeof body.willRetry !== "boolean"
    ) {
      return null;
    }
    return {
      event: "compaction",
      data: {
        phase: body.phase,
        completed: body.completed,
        willRetry: body.willRetry
      }
    };
  }
  if (eventName === "completed") {
    return { event: "completed", data: { transport: body.transport } };
  }
  if (eventName === "interrupted") {
    return { event: "interrupted", data: { transport: body.transport } };
  }
  if (eventName === "failed") {
    if (typeof body.message !== "string") {
      return null;
    }
    return {
      event: "failed",
      data:
        typeof body.code === "string"
          ? { code: body.code, message: body.message, transport: body.transport }
          : { message: body.message, transport: body.transport }
    };
  }

  return null;
}

function resolveSseBlocks(buffer: string): { blocks: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  return {
    blocks: parts,
    rest
  };
}

function parseSseBlock(block: string): { eventName: string; data: string } | null {
  const lines = block.split("\n");
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    eventName,
    data: dataLines.join("\n")
  };
}

export async function streamAssistantWebChatTurn(
  token: string,
  payload: AssistantWebChatStreamPayload,
  handlers: AssistantWebChatStreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream"
    },
    body: JSON.stringify(payload)
  };
  if (signal !== undefined) {
    requestInit.signal = signal;
  }

  const response = await fetch(`${getApiBaseUrl()}/assistant/chat/web/stream`, requestInit);

  if (!response.ok) {
    let errorPayload: unknown = null;
    try {
      errorPayload = await response.json();
    } catch {
      errorPayload = await response.text();
    }

    const envelope =
      typeof errorPayload === "object" && errorPayload !== null
        ? (errorPayload as {
            error?: { message?: unknown; code?: unknown };
            message?: unknown;
            code?: unknown;
          })
        : null;
    const message =
      typeof envelope?.error?.message === "string"
        ? envelope.error.message
        : typeof envelope?.message === "string"
          ? envelope.message
          : `Request failed with status ${response.status}.`;
    const code =
      typeof envelope?.error?.code === "string"
        ? envelope.error.code
        : typeof envelope?.code === "string"
          ? envelope.code
          : undefined;

    throw new ContractsApiError(message, response.status, errorPayload, code);
  }

  if (response.body === null) {
    throw new Error("Streaming response has no body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawTerminalEvent = false;

  const handleStreamEvent = (streamEvent: WebChatStreamEvent): void => {
    if (streamEvent.event === "started") {
      handlers.onStarted?.(streamEvent.data);
    } else if (streamEvent.event === "thinking") {
      handlers.onThinking?.(streamEvent.data);
    } else if (streamEvent.event === "delta") {
      handlers.onDelta?.(streamEvent.data);
    } else if (streamEvent.event === "tool") {
      handlers.onTool?.(streamEvent.data);
    } else if (streamEvent.event === "compaction") {
      handlers.onCompaction?.(streamEvent.data);
    } else if (streamEvent.event === "runtime_done") {
      handlers.onRuntimeDone?.(streamEvent.data);
    } else if (streamEvent.event === "completed") {
      sawTerminalEvent = true;
      handlers.onCompleted?.(streamEvent.data);
    } else if (streamEvent.event === "interrupted") {
      sawTerminalEvent = true;
      handlers.onInterrupted?.(streamEvent.data);
    } else if (streamEvent.event === "failed") {
      sawTerminalEvent = true;
      handlers.onFailed?.(streamEvent.data);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const { blocks, rest } = resolveSseBlocks(buffer);
    buffer = rest;

    for (const block of blocks) {
      const parsed = parseSseBlock(block);
      if (parsed === null) {
        continue;
      }

      let payloadObject: unknown = null;
      try {
        payloadObject = JSON.parse(parsed.data);
      } catch {
        continue;
      }

      const streamEvent = toStreamEvent(parsed.eventName, payloadObject);
      if (streamEvent === null) {
        continue;
      }

      handleStreamEvent(streamEvent);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim().length > 0) {
    const parsed = parseSseBlock(buffer.trim());
    if (parsed !== null) {
      let payloadObject: unknown = null;
      try {
        payloadObject = JSON.parse(parsed.data);
      } catch {
        payloadObject = null;
      }

      const streamEvent =
        payloadObject === null ? null : toStreamEvent(parsed.eventName, payloadObject);
      if (streamEvent !== null) {
        handleStreamEvent(streamEvent);
      }
    }
  }

  if (!sawTerminalEvent) {
    throw new Error("Stream closed before terminal event.");
  }
}

export async function getAssistant(token: string): Promise<AssistantLifecycleState | null> {
  try {
    const response = await getAssistantContract({
      headers: getAuthHeaders(token)
    });

    if (response.status === 404) {
      return null;
    }

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /assistant.");
    }

    return response.data.assistant;
  } catch (error) {
    if (error instanceof ContractsApiError && error.status === 404) {
      return null;
    }
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantCreate(token: string): Promise<AssistantLifecycleState> {
  try {
    const response = await postAssistantCreateContract({
      headers: getAuthHeaders(token)
    });

    if (
      !isSuccessStatus(response.status) ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("assistant" in response.data)
    ) {
      throw new Error("Unexpected non-success response for POST /assistant.");
    }

    return response.data.assistant;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function patchAssistantDraft(
  token: string,
  payload: AssistantDraftUpdateRequest
): Promise<AssistantLifecycleState> {
  try {
    const response = await patchAssistantDraftContract(payload, {
      headers: getAuthHeaders(token)
    });

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for PATCH /assistant/draft.");
    }

    return response.data.assistant;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantSetupPreview(
  token: string
): Promise<AssistantSetupPreviewState> {
  try {
    const response = await postAssistantSetupPreviewContract({
      headers: getAuthHeaders(token)
    });

    if (
      response.status !== 200 ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("preview" in response.data)
    ) {
      throw new Error("Unexpected non-success response for POST /assistant/setup/preview.");
    }

    return response.data.preview;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantPublish(token: string): Promise<AssistantLifecycleState> {
  try {
    const response = await postAssistantPublishContract({
      headers: getAuthHeaders(token)
    });

    if (
      !isSuccessStatus(response.status) ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("assistant" in response.data)
    ) {
      throw new Error("Unexpected non-success response for POST /assistant/publish.");
    }

    return response.data.assistant;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantRollback(
  token: string,
  payload: AssistantRollbackRequest
): Promise<AssistantLifecycleState> {
  try {
    const response = await postAssistantRollbackContract(payload, {
      headers: getAuthHeaders(token)
    });

    if (
      !isSuccessStatus(response.status) ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("assistant" in response.data)
    ) {
      throw new Error("Unexpected non-success response for POST /assistant/rollback.");
    }

    return response.data.assistant;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantReset(token: string): Promise<AssistantLifecycleState> {
  try {
    const response = await postAssistantResetContract({
      headers: getAuthHeaders(token)
    });

    if (
      !isSuccessStatus(response.status) ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("assistant" in response.data)
    ) {
      throw new Error("Unexpected non-success response for POST /assistant/reset.");
    }

    return response.data.assistant;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getAssistantWebChats(
  token: string
): Promise<AssistantWebChatListItemState[]> {
  try {
    const response = await getAssistantWebChatsContract({
      headers: getAuthHeaders(token)
    });

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /assistant/chats/web.");
    }

    return response.data.chats;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function patchAssistantWebChat(
  token: string,
  chatId: string,
  payload: AssistantWebChatRenameRequest
): Promise<AssistantWebChatListItemState> {
  try {
    const response = await patchAssistantWebChatContract(chatId, payload, {
      headers: getAuthHeaders(token)
    });

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for PATCH /assistant/chats/web/:chatId.");
    }

    return response.data.chat;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantWebChatArchive(
  token: string,
  chatId: string
): Promise<AssistantWebChatListItemState> {
  try {
    const response = await postAssistantWebChatArchiveContract(chatId, {
      headers: getAuthHeaders(token)
    });

    if (
      !isSuccessStatus(response.status) ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("chat" in response.data)
    ) {
      throw new Error(
        "Unexpected non-success response for POST /assistant/chats/web/:chatId/archive."
      );
    }

    return response.data.chat;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function deleteAssistantWebChat(
  token: string,
  chatId: string,
  payload: AssistantWebChatDeleteRequest
): Promise<void> {
  try {
    const response = await deleteAssistantWebChatContract(chatId, payload, {
      headers: getAuthHeaders(token)
    });

    if (response.status !== 200 || response.data.deleted !== true) {
      throw new Error("Unexpected non-success response for DELETE /assistant/chats/web/:chatId.");
    }
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export type { AssistantMemoryRegistryItemState, AssistantTaskRegistryItemState };

export async function getAssistantMemoryItems(
  token: string
): Promise<AssistantMemoryRegistryItemState[]> {
  try {
    const response = await getAssistantMemoryItemsContract({
      headers: getAuthHeaders(token)
    });

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /assistant/memory/items.");
    }

    return response.data.items;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantMemoryItemForget(token: string, itemId: string): Promise<void> {
  try {
    const response = await postAssistantMemoryItemForgetContract(itemId, {
      headers: getAuthHeaders(token)
    });

    if (
      !isSuccessStatus(response.status) ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("forgotten" in response.data) ||
      response.data.forgotten !== true
    ) {
      throw new Error(
        "Unexpected non-success response for POST /assistant/memory/items/:itemId/forget."
      );
    }
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getAssistantTaskItems(
  token: string
): Promise<AssistantTaskRegistryItemState[]> {
  try {
    const response = await getAssistantTaskItemsContract({
      headers: getAuthHeaders(token)
    });

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /assistant/tasks/items.");
    }

    return response.data.items;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantTaskItemDisable(token: string, itemId: string): Promise<void> {
  try {
    const response = await postAssistantTaskItemDisableContract(itemId, {
      headers: getAuthHeaders(token)
    });

    if (
      !isSuccessStatus(response.status) ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("disabled" in response.data) ||
      response.data.disabled !== true
    ) {
      throw new Error(
        "Unexpected non-success response for POST /assistant/tasks/items/:itemId/disable."
      );
    }
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantTaskItemEnable(token: string, itemId: string): Promise<void> {
  try {
    const response = await postAssistantTaskItemEnableContract(itemId, {
      headers: getAuthHeaders(token)
    });

    if (
      !isSuccessStatus(response.status) ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("enabled" in response.data) ||
      response.data.enabled !== true
    ) {
      throw new Error(
        "Unexpected non-success response for POST /assistant/tasks/items/:itemId/enable."
      );
    }
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantTaskItemCancel(token: string, itemId: string): Promise<void> {
  try {
    const response = await postAssistantTaskItemCancelContract(itemId, {
      headers: getAuthHeaders(token)
    });

    if (
      !isSuccessStatus(response.status) ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("cancelled" in response.data) ||
      response.data.cancelled !== true
    ) {
      throw new Error(
        "Unexpected non-success response for POST /assistant/tasks/items/:itemId/cancel."
      );
    }
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantMemoryDoNotRemember(
  token: string,
  payload: AssistantMemoryDoNotRememberRequest
): Promise<{ forgottenRegistryItems: number }> {
  try {
    const response = await postAssistantMemoryDoNotRememberContract(payload, {
      headers: getAuthHeaders(token)
    });

    if (
      !isSuccessStatus(response.status) ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("forgottenRegistryItems" in response.data)
    ) {
      throw new Error(
        "Unexpected non-success response for POST /assistant/memory/do-not-remember."
      );
    }

    return { forgottenRegistryItems: response.data.forgottenRegistryItems };
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export type WorkspaceMemoryItem = {
  id: string;
  content: string;
  createdAt: string | null;
  source: string;
};

export type AssistantPreferredNotificationChannel = "web" | "telegram" | "whatsapp";

export type AssistantNotificationPreferenceState = {
  selectedChannel: AssistantPreferredNotificationChannel;
  availableChannels: AssistantPreferredNotificationChannel[];
};

export type AssistantVoiceSettingsState = {
  schema: "persai.assistantVoiceSettings.v1";
  primaryProviderId: "elevenlabs" | "yandex" | "openai";
  elevenlabs: {
    configured: boolean;
    loadState: "ready" | "not_configured" | "unavailable";
    voices: Array<{
      voiceId: string;
      name: string;
      gender: "male" | "female" | "neutral" | "unknown";
      category: string | null;
      previewUrl: string | null;
    }>;
    warning: string | null;
  } | null;
};

export async function getWorkspaceMemoryItems(token: string): Promise<WorkspaceMemoryItem[]> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/assistant/memory/workspace/items`, {
    headers: getAuthHeaders(token)
  });
  if (!res.ok) throw new Error("Failed to load workspace memory.");
  const data = (await res.json()) as { items: WorkspaceMemoryItem[] };
  return data.items;
}

export async function addWorkspaceMemoryItem(
  token: string,
  content: string
): Promise<WorkspaceMemoryItem> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/assistant/memory/workspace/add`, {
    method: "POST",
    headers: { ...getAuthHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });
  if (!res.ok) throw new Error("Failed to add memory item.");
  const data = (await res.json()) as { item: WorkspaceMemoryItem };
  return data.item;
}

export async function editWorkspaceMemoryItem(
  token: string,
  itemId: string,
  content: string
): Promise<void> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/assistant/memory/workspace/edit`, {
    method: "PATCH",
    headers: { ...getAuthHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ itemId, content })
  });
  if (!res.ok) throw new Error("Failed to edit memory item.");
}

export async function forgetWorkspaceMemoryItem(token: string, itemId: string): Promise<void> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/assistant/memory/workspace/forget`, {
    method: "POST",
    headers: { ...getAuthHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ itemId })
  });
  if (!res.ok) throw new Error("Failed to forget memory item.");
}

export async function searchWorkspaceMemory(
  token: string,
  query: string
): Promise<WorkspaceMemoryItem[]> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/assistant/memory/workspace/search?q=${encodeURIComponent(query)}`,
    { headers: getAuthHeaders(token) }
  );
  if (!res.ok) throw new Error("Failed to search memory.");
  const data = (await res.json()) as { items: WorkspaceMemoryItem[] };
  return data.items;
}

export async function uploadAssistantAvatar(
  token: string,
  file: File
): Promise<{ avatarUrl: string }> {
  const base = getApiBaseUrl();
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${base}/assistant/avatar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });
  if (!res.ok) throw new Error("Failed to upload avatar.");
  return (await res.json()) as { avatarUrl: string };
}

export type ChatHistoryAttachment = {
  id: string;
  attachmentType: string;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: number;
  processingStatus: string;
  createdAt: string;
};

export type ChatHistoryMessage = {
  id: string;
  chatId: string;
  assistantId: string;
  author: "user" | "assistant" | "system";
  content: string;
  attachments: ChatHistoryAttachment[];
  createdAt: string;
};

export type ChatCompactionState = AssistantWebChatCompactionState;

export type ChatCompactionResult = AssistantWebChatCompactionResult;

export async function getChatMessages(
  token: string,
  chatId: string,
  cursor?: string,
  limit?: number
): Promise<{ messages: ChatHistoryMessage[]; nextCursor: string | null }> {
  const base = getApiBaseUrl();
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  const url = `${base}/assistant/chats/web/${encodeURIComponent(chatId)}/messages${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: getAuthHeaders(token) });
  if (!res.ok) throw new Error("Failed to load chat messages.");
  return (await res.json()) as { messages: ChatHistoryMessage[]; nextCursor: string | null };
}

export async function getChatCompactionState(
  token: string,
  chatId: string
): Promise<ChatCompactionState> {
  try {
    const response = await getAssistantWebChatCompactionContract(chatId, {
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200 || !response.data?.state) {
      throw new Error(
        "Unexpected non-success response for GET /assistant/chats/web/{chatId}/compaction."
      );
    }
    return response.data.state;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function compactChat(
  token: string,
  chatId: string,
  instructions?: string
): Promise<{ state: ChatCompactionState; result: ChatCompactionResult }> {
  const body: AssistantWebChatCompactRequest = instructions ? { instructions } : {};
  try {
    const response = await postAssistantWebChatCompactContract(chatId, body, {
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200 || !response.data?.state || !response.data?.result) {
      throw new Error(
        "Unexpected non-success response for POST /assistant/chats/web/{chatId}/compact."
      );
    }
    return {
      state: response.data.state,
      result: response.data.result
    };
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export type { AdminPlanState, AdminPlanCreateRequest, AdminPlanUpdateRequest };
export type { AdminBusinessCockpitState };
export type { AdminOpsCockpitState };
export type { AdminNotificationChannelState, PatchAdminNotificationWebhookChannelRequest };
export type { PlatformRolloutState, PostAdminPlatformRolloutRequest };
export type { UserPlanVisibilityState, AdminPlanVisibilityState };
export type { TelegramIntegrationState, AssistantTelegramConfigUpdateRequest };

export async function getAdminPlans(token: string): Promise<AdminPlanState[]> {
  try {
    const response = await getAdminPlansContract({
      headers: getAuthHeaders(token)
    });

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /admin/plans.");
    }

    return response.data.plans;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getAssistantPlanVisibility(token: string): Promise<UserPlanVisibilityState> {
  try {
    const response = await getAssistantPlanVisibilityContract({
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /assistant/plan-visibility.");
    }
    return response.data.visibility;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getAssistantNotificationPreference(
  token: string
): Promise<AssistantNotificationPreferenceState> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/assistant/notification-preference`, {
      headers: getAuthHeaders(token)
    });
    if (!response.ok) {
      throw new Error(
        "Unexpected non-success response for GET /assistant/notification-preference."
      );
    }

    const payload = (await response.json()) as {
      preference?: AssistantNotificationPreferenceState;
    };
    if (
      typeof payload !== "object" ||
      payload === null ||
      payload.preference === undefined ||
      typeof payload.preference !== "object" ||
      payload.preference === null
    ) {
      throw new Error(
        "Unexpected non-success response for GET /assistant/notification-preference."
      );
    }

    return payload.preference;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getAssistantVoiceSettings(
  token: string
): Promise<AssistantVoiceSettingsState> {
  const response = await fetch(`${getApiBaseUrl()}/assistant/voice/settings`, {
    headers: getAuthHeaders(token)
  });
  if (!response.ok) {
    throw new Error(await readJsonErrorMessage(response, "Failed to load voice settings."));
  }

  const payload = (await response.json()) as {
    settings?: AssistantVoiceSettingsState;
  };
  if (
    typeof payload !== "object" ||
    payload === null ||
    payload.settings === undefined ||
    typeof payload.settings !== "object" ||
    payload.settings === null
  ) {
    throw new Error("Unexpected non-success response for GET /assistant/voice/settings.");
  }

  return payload.settings;
}

export async function patchAssistantNotificationPreference(
  token: string,
  channel: AssistantPreferredNotificationChannel
): Promise<AssistantNotificationPreferenceState> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/assistant/notification-preference`, {
      method: "PATCH",
      headers: {
        ...getAuthHeaders(token),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ channel })
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      const message =
        errorPayload &&
        typeof errorPayload === "object" &&
        "error" in errorPayload &&
        typeof errorPayload.error === "object" &&
        errorPayload.error !== null &&
        "message" in errorPayload.error &&
        typeof errorPayload.error.message === "string"
          ? errorPayload.error.message
          : "Unexpected non-success response for PATCH /assistant/notification-preference.";
      throw new Error(message);
    }

    const payload = (await response.json()) as {
      preference?: AssistantNotificationPreferenceState;
    };
    if (
      typeof payload !== "object" ||
      payload === null ||
      payload.preference === undefined ||
      typeof payload.preference !== "object" ||
      payload.preference === null
    ) {
      throw new Error(
        "Unexpected non-success response for PATCH /assistant/notification-preference."
      );
    }

    return payload.preference;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getAdminPlanVisibility(token: string): Promise<AdminPlanVisibilityState> {
  try {
    const response = await getAdminPlanVisibilityContract({
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /admin/plans/visibility.");
    }
    return response.data.visibility;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getAdminBusinessCockpit(token: string): Promise<AdminBusinessCockpitState> {
  try {
    const response = await getAdminBusinessCockpitContract({
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /admin/business/cockpit.");
    }
    return response.data.cockpit;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export type AdminOverviewRouteHint =
  | { mode: "auto" }
  | { mode: "probe" }
  | { mode: "pinned"; podIp: string };

function getAdminOverviewHeaders(
  token: string,
  routeHint: AdminOverviewRouteHint = { mode: "auto" }
): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`
  };
  if (routeHint.mode === "probe") {
    headers["X-Persai-Admin-Overview-Route"] = "probe";
  } else if (routeHint.mode === "pinned") {
    headers["X-Persai-Admin-Overview-Route"] = "pinned";
    headers["X-Persai-Admin-Overview-Pod-Ip"] = routeHint.podIp;
  }
  return headers;
}

export async function getAdminOverviewDashboard(
  token: string,
  routeHint: AdminOverviewRouteHint = { mode: "auto" }
): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/v1/admin/overview/dashboard`, {
    headers: getAdminOverviewHeaders(token, routeHint)
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const data = (await res.json()) as { dashboard: Record<string, unknown> };
  return data.dashboard;
}

export async function setAdminOverviewLatencyTrace(
  token: string,
  enabled: boolean,
  routeHint: AdminOverviewRouteHint = { mode: "auto" }
): Promise<{ latencyTrace: Record<string, unknown>; dataSource?: Record<string, unknown> }> {
  const res = await fetch(`/api/v1/admin/overview/latency-trace`, {
    method: "POST",
    headers: {
      ...getAdminOverviewHeaders(token, routeHint),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ enabled })
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const data = (await res.json()) as {
    latencyTrace: Record<string, unknown>;
    dataSource?: Record<string, unknown>;
  };
  return data;
}

export async function getAdminBusinessPlatform(token: string): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/v1/admin/business/platform`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const data = (await res.json()) as { platform: Record<string, unknown> };
  return data.platform;
}

export async function getAdminNotificationChannels(
  token: string
): Promise<AdminNotificationChannelState[]> {
  try {
    const response = await getAdminNotificationChannelsContract({
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /admin/notifications/channels.");
    }
    return response.data.channels;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function patchAdminNotificationWebhookChannel(
  token: string,
  input: PatchAdminNotificationWebhookChannelRequest
): Promise<AdminNotificationChannelState> {
  try {
    const response = await patchAdminNotificationWebhookChannelContract(input, {
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error(
        "Unexpected non-success response for PATCH /admin/notifications/channels/webhook."
      );
    }
    return response.data.channel;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getAdminPlatformRollouts(token: string): Promise<PlatformRolloutState[]> {
  try {
    const response = await getAdminPlatformRolloutsContract({
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /admin/platform-rollouts.");
    }
    return response.data.rollouts;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export type { AdminRuntimeProviderSettingsState, PutAdminRuntimeProviderSettingsResponse };

export async function getAdminRuntimeProviderSettings(
  token: string
): Promise<AdminRuntimeProviderSettingsState> {
  try {
    const response = await getAdminRuntimeProviderSettingsContract({
      headers: getAuthHeaders(token)
    });
    if (
      response.status !== 200 ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("settings" in response.data)
    ) {
      throw new Error("Unexpected non-success response for GET /admin/runtime/provider-settings.");
    }
    return response.data.settings;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function putAdminRuntimeProviderSettings(
  token: string,
  input: AdminRuntimeProviderSettingsRequest
): Promise<PutAdminRuntimeProviderSettingsResponse> {
  try {
    const stepUpToken = await issueAdminStepUpToken(
      token,
      "admin.runtime_provider_settings.update"
    );
    const response = await putAdminRuntimeProviderSettingsContract(input, {
      headers: {
        ...getAuthHeaders(token),
        "x-persai-step-up-token": stepUpToken
      }
    });
    if (
      response.status !== 200 ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("settings" in response.data)
    ) {
      throw new Error("Unexpected non-success response for PUT /admin/runtime/provider-settings.");
    }
    return response.data;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAdminPlatformRollout(
  token: string,
  input: PostAdminPlatformRolloutRequest
): Promise<PlatformRolloutState> {
  try {
    const stepUpToken = await issueAdminStepUpToken(token, "admin.rollout.apply");
    const response = await postAdminPlatformRolloutContract(input, {
      headers: {
        ...getAuthHeaders(token),
        "x-persai-step-up-token": stepUpToken
      }
    });
    if (!isSuccessStatus(response.status)) {
      throw new Error("Unexpected non-success response for POST /admin/platform-rollouts.");
    }
    if (
      typeof response.data !== "object" ||
      response.data === null ||
      !("rollout" in response.data)
    ) {
      throw new Error("Unexpected non-success response for POST /admin/platform-rollouts.");
    }
    return response.data.rollout;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAdminPlatformRolloutRollback(
  token: string,
  rolloutId: string
): Promise<PlatformRolloutState> {
  try {
    const stepUpToken = await issueAdminStepUpToken(token, "admin.rollout.rollback");
    const response = await postAdminPlatformRolloutRollbackContract(rolloutId, {
      headers: {
        ...getAuthHeaders(token),
        "x-persai-step-up-token": stepUpToken
      }
    });
    if (!isSuccessStatus(response.status)) {
      throw new Error(
        "Unexpected non-success response for POST /admin/platform-rollouts/{rolloutId}/rollback."
      );
    }
    if (
      typeof response.data !== "object" ||
      response.data === null ||
      !("rollout" in response.data)
    ) {
      throw new Error(
        "Unexpected non-success response for POST /admin/platform-rollouts/{rolloutId}/rollback."
      );
    }
    return response.data.rollout;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getAdminOpsCockpit(token: string): Promise<AdminOpsCockpitState> {
  try {
    const response = await getAdminOpsCockpitContract({
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /admin/ops/cockpit.");
    }
    return response.data.cockpit;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAdminOpsUserPlanOverride(
  token: string,
  userId: string,
  params: PostAdminOpsUserPlanOverrideParams
): Promise<void> {
  try {
    const stepUpToken = await issueAdminStepUpToken(token, "admin.plan.update");
    const response = await postAdminOpsUserPlanOverrideContract(userId, params, {
      headers: {
        ...getAuthHeaders(token),
        "x-persai-step-up-token": stepUpToken
      }
    });
    if (!isSuccessStatus(response.status)) {
      throw new Error(
        "Unexpected non-success response for POST /admin/ops/users/{userId}/plan-override."
      );
    }
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function deleteAdminOpsUserPlanOverride(token: string, userId: string): Promise<void> {
  try {
    const stepUpToken = await issueAdminStepUpToken(token, "admin.plan.update");
    const response = await deleteAdminOpsUserPlanOverrideContract(userId, {
      headers: {
        ...getAuthHeaders(token),
        "x-persai-step-up-token": stepUpToken
      }
    });
    if (!isSuccessStatus(response.status)) {
      throw new Error(
        "Unexpected non-success response for DELETE /admin/ops/users/{userId}/plan-override."
      );
    }
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAdminOpsUserWorkspaceSubscription(
  token: string,
  userId: string,
  payload: { planCode: string }
): Promise<void> {
  try {
    const stepUpToken = await issueAdminStepUpToken(token, "admin.plan.update");
    const base = getApiBaseUrl();
    const res = await fetch(
      `${base}/admin/ops/users/${encodeURIComponent(userId)}/workspace-subscription`,
      {
        method: "POST",
        headers: {
          ...getAuthHeaders(token),
          "Content-Type": "application/json",
          "x-persai-step-up-token": stepUpToken
        },
        body: JSON.stringify({
          planCode: payload.planCode,
          status: "active"
        })
      }
    );
    if (!res.ok) {
      throw new Error(await readJsonErrorMessage(res, "Failed to apply workspace subscription."));
    }
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function deleteAdminOpsUserWorkspaceSubscription(
  token: string,
  userId: string
): Promise<void> {
  try {
    const stepUpToken = await issueAdminStepUpToken(token, "admin.plan.update");
    const base = getApiBaseUrl();
    const res = await fetch(
      `${base}/admin/ops/users/${encodeURIComponent(userId)}/workspace-subscription`,
      {
        method: "DELETE",
        headers: {
          ...getAuthHeaders(token),
          "x-persai-step-up-token": stepUpToken
        }
      }
    );
    if (!res.ok) {
      throw new Error(await readJsonErrorMessage(res, "Failed to reset workspace subscription."));
    }
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getAssistantTelegramIntegration(
  token: string
): Promise<TelegramIntegrationState> {
  try {
    const response = await getAssistantTelegramIntegrationContract({
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /assistant/integrations/telegram.");
    }
    return response.data.integration;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantTelegramConnect(
  token: string,
  payload: { botToken: string }
): Promise<TelegramIntegrationState> {
  try {
    const response = await postAssistantTelegramConnectContract(payload, {
      headers: getAuthHeaders(token)
    });
    if (
      !isSuccessStatus(response.status) ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("integration" in response.data)
    ) {
      throw new Error(
        "Unexpected non-success response for POST /assistant/integrations/telegram/connect."
      );
    }
    return response.data.integration;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function patchAssistantTelegramConfig(
  token: string,
  payload: AssistantTelegramConfigUpdateRequest
): Promise<TelegramIntegrationState> {
  try {
    const response = await patchAssistantTelegramConfigContract(payload, {
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error(
        "Unexpected non-success response for PATCH /assistant/integrations/telegram/config."
      );
    }
    return response.data.integration;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantTelegramDisconnect(
  token: string,
  payload?: { reason?: string | null }
): Promise<TelegramIntegrationState> {
  try {
    const response = await postAssistantTelegramRevokeContract(payload ?? {}, {
      headers: getAuthHeaders(token)
    });
    if (
      !isSuccessStatus(response.status) ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("integration" in response.data)
    ) {
      throw new Error(
        "Unexpected non-success response for POST /assistant/integrations/telegram/revoke."
      );
    }
    return response.data.integration;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantTelegramResendOwnerMessage(
  token: string
): Promise<TelegramIntegrationState> {
  try {
    const response = await fetch("/api/v1/assistant/integrations/telegram/resend-owner-message", {
      method: "POST",
      headers: getAuthHeaders(token)
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const data = (await response.json()) as { integration?: TelegramIntegrationState };
    if (!data.integration) {
      throw new Error(
        "Unexpected non-success response for POST /assistant/integrations/telegram/resend-owner-message."
      );
    }
    return data.integration;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export type TelegramGroupInfo = {
  id: string;
  telegramChatId: string;
  title: string;
  memberCount: number | null;
  status: string;
  joinedAt: string;
};

export async function fetchAssistantTelegramGroups(token: string): Promise<TelegramGroupInfo[]> {
  try {
    const response = await fetch("/api/v1/assistant/integrations/telegram/groups", {
      headers: getAuthHeaders(token)
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { groups?: TelegramGroupInfo[] };
    return data.groups ?? [];
  } catch {
    return [];
  }
}

export async function postAdminPlanCreate(
  token: string,
  payload: AdminPlanCreateRequest
): Promise<AdminPlanState> {
  try {
    const stepUpToken = await issueAdminStepUpToken(token, "admin.plan.create");
    const response = await postAdminPlanCreateContract(payload, {
      headers: {
        ...getAuthHeaders(token),
        "x-persai-step-up-token": stepUpToken
      }
    });

    if (
      !isSuccessStatus(response.status) ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("plan" in response.data)
    ) {
      throw new Error("Unexpected non-success response for POST /admin/plans.");
    }

    return response.data.plan;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantReapply(token: string): Promise<AssistantLifecycleState> {
  try {
    const response = await postAssistantReapplyContract({
      headers: getAuthHeaders(token)
    });
    if (
      !isSuccessStatus(response.status) ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("assistant" in response.data)
    ) {
      throw new Error("Unexpected non-success response for POST /assistant/reapply.");
    }
    return response.data.assistant;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function patchAdminPlan(
  token: string,
  code: string,
  payload: AdminPlanUpdateRequest
): Promise<AdminPlanState> {
  try {
    const stepUpToken = await issueAdminStepUpToken(token, "admin.plan.update");
    const response = await patchAdminPlanContract(code, payload, {
      headers: {
        ...getAuthHeaders(token),
        "x-persai-step-up-token": stepUpToken
      }
    });

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for PATCH /admin/plans/:code.");
    }

    return response.data.plan;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function deleteAdminPlan(token: string, code: string): Promise<void> {
  try {
    const stepUpToken = await issueAdminStepUpToken(token, "admin.plan.delete");
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/admin/plans/${encodeURIComponent(code)}`, {
      method: "DELETE",
      headers: {
        ...getAuthHeaders(token),
        "x-persai-step-up-token": stepUpToken
      }
    });
    if (!res.ok) {
      throw new Error(await readJsonErrorMessage(res, "Failed to delete plan."));
    }
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAdminAbuseUnblock(
  token: string,
  payload: AdminAbuseUnblockRequest
): Promise<{ assistantId: string; affectedUserRows: number; affectedAssistantRows: number }> {
  try {
    const response = await postAdminAbuseControlsUnblockContract(payload, {
      headers: getAuthHeaders(token)
    });

    if (!isSuccessStatus(response.status)) {
      throw new Error("Unexpected non-success response for POST /admin/abuse-controls/unblock.");
    }

    return (response.data as PostAdminAbuseUnblockResponse).unblock;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export type ForceReapplyAllSummary = {
  totalAssistants: number;
  withPublishedVersion: number;
  succeeded: number;
  degraded: number;
  failed: number;
  skipped: number;
};

export function getAttachmentDownloadUrl(attachmentId: string): string {
  return `/api/attachment/${encodeURIComponent(attachmentId)}`;
}

export type UploadedAttachment = {
  id: string;
  messageId: string;
  chatId: string;
  attachmentType: string;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: number;
  processingStatus: string;
  createdAt: string;
};

export type StagedAttachmentResult = {
  chatId: string;
  messageId: string;
  attachment: UploadedAttachment;
};

export type UploadedKnowledgeSource = {
  id: string;
  displayName: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: "processing" | "ready" | "failed";
  currentVersion: number;
  chunkCount: number;
  lastIndexedAt: string | null;
  lastReindexRequestedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function stageWebChatAttachment(
  token: string,
  surfaceThreadKey: string,
  file: File
): Promise<StagedAttachmentResult> {
  const base = getApiBaseUrl();
  const formData = new FormData();
  formData.append("surfaceThreadKey", surfaceThreadKey);
  formData.append("file", file);
  const res = await fetch(`${base}/assistant/chat/web/stage-attachment`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });
  if (!res.ok) {
    const envelope = await readApiErrorEnvelope(res);
    if (envelope) {
      throw new ApiStructuredError(envelope.message, envelope.code, envelope.details);
    }
    throw new Error("Failed to stage attachment.");
  }
  const data = (await res.json()) as StagedAttachmentResult;
  return data;
}

export async function uploadChatAttachment(
  token: string,
  chatId: string,
  messageId: string,
  file: File
): Promise<UploadedAttachment> {
  const base = getApiBaseUrl();
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(
    `${base}/assistant/chat/${encodeURIComponent(chatId)}/message/${encodeURIComponent(messageId)}/attachment`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    }
  );
  if (!res.ok) {
    const envelope = await readApiErrorEnvelope(res);
    if (envelope) {
      throw new ApiStructuredError(envelope.message, envelope.code, envelope.details);
    }
    throw new Error("Failed to upload attachment.");
  }
  const data = (await res.json()) as { attachment: UploadedAttachment };
  return data.attachment;
}

export async function uploadAssistantKnowledgeSource(
  token: string,
  file: File,
  options?: {
    displayName?: string | null | undefined;
  }
): Promise<UploadedKnowledgeSource> {
  const base = getApiBaseUrl();
  const formData = new FormData();
  const displayName = options?.displayName?.trim();
  if (displayName) {
    formData.append("displayName", displayName);
  }
  formData.append("file", file);
  const res = await fetch(`${base}/assistant/knowledge-sources`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });
  if (!res.ok) {
    const envelope = await readApiErrorEnvelope(res);
    if (envelope) {
      throw new ApiStructuredError(envelope.message, envelope.code, envelope.details);
    }
    throw new Error("Failed to upload knowledge source.");
  }
  const data = (await res.json()) as { source?: UploadedKnowledgeSource };
  if (!data.source) {
    throw new Error("Knowledge source upload returned an unexpected response.");
  }
  if (data.source.status !== "ready") {
    throw new ApiStructuredError(
      data.source.lastErrorMessage ?? "Knowledge source indexing did not complete.",
      data.source.lastErrorCode ?? "knowledge_source_not_ready"
    );
  }
  return data.source;
}

export async function postAdminForceReapplyAll(token: string): Promise<ForceReapplyAllSummary> {
  try {
    const stepUpToken = await issueAdminStepUpToken(token, "admin.force_reapply_all");
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/admin/runtime/force-reapply-all`, {
      method: "POST",
      headers: {
        ...getAuthHeaders(token),
        "x-persai-step-up-token": stepUpToken,
        "Content-Type": "application/json"
      }
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg =
        body && typeof body === "object" && "message" in body
          ? String((body as Record<string, unknown>).message)
          : `Force reapply failed (${String(res.status)}).`;
      throw new Error(msg);
    }
    const data = (await res.json()) as { summary: ForceReapplyAllSummary };
    return data.summary;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function transcribeVoice(
  token: string,
  audioBlob: Blob,
  filename: string
): Promise<string> {
  const base = getApiBaseUrl();
  const formData = new FormData();
  formData.append("file", audioBlob, filename);
  const res = await fetch(`${base}/assistant/voice/transcribe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === "object" && "message" in body
        ? String((body as Record<string, unknown>).message)
        : "Voice transcription failed.";
    throw new Error(message);
  }
  const data = (await res.json()) as { text: string };
  return data.text;
}
