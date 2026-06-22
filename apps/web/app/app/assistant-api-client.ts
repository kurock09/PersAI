import {
  type AdminBusinessCockpitState,
  type AdminBusinessPlatformState,
  type AdminRuntimeProviderSettingsRequest,
  type AdminRuntimeProviderSettingsState,
  type AdminBillingLifecycleSettingsRequest,
  type AdminBillingLifecycleSettingsState,
  type GetAdminPlatformRolloutFailedItemsResponse,
  type PutAdminBillingLifecycleSettingsResponse,
  type AssistantSkillCatalogItemState,
  type MaterializationRolloutItemView,
  type MaterializationRolloutView,
  type PostAdminPlatformRolloutCancelPendingResponse,
  type PostAdminPlatformRolloutRetryFailedResponse,
  type AdminSkillState,
  type AdminSkillUpsertRequest,
  type GetAssistantSkillsResponse,
  type KnowledgeIndexingJobState,
  type PutAssistantSkillAssignmentsRequest,
  type SkillDocumentState,
  type AdminPlanCreateRequest,
  type AdminDangerousActionCode,
  type AdminOpsCockpitState,
  type GetAdminOpsCockpitParams,
  type PostAdminOpsUserPlanOverrideParams,
  type AdminPlanVisibilityState,
  type AdminPlanState,
  type AdminPlanUpdateRequest,
  type PutAdminRuntimeProviderSettingsResponse,
  type ProductKnowledgeTextEntryInput,
  type ProductKnowledgeTextEntryState,
  type AdminAbuseAssistantLookupItem,
  type AdminAbuseUnblockRequest,
  type GetAdminAbuseAssistantsResponse,
  type PostAdminAbuseUnblockResponse,
  type AdminSafetyRestrictRequest,
  type AdminSafetyUnblockRequest,
  type PostAdminSafetyControlsRestrictResponse,
  type PostAdminSafetyControlsUnblockResponse,
  type GetAdminSafetyControlsCasesResponse,
  type GetAdminSafetyPolicyHeuristicRulesParams,
  type GetAdminSafetyPolicyHeuristicRulesResponse,
  type GetAdminSafetyPolicySettingsResponse,
  type PutAdminSafetyPolicyHeuristicRulesRequest,
  type PutAdminSafetyPolicyHeuristicRulesResponse,
  type PutAdminSafetyPolicySettingsRequest,
  type PutAdminSafetyPolicySettingsResponse,
  type SafetyHeuristicRuleState,
  type SafetyPolicySettingsState,
  type AssistantTelegramConfigUpdateRequest,
  type TelegramIntegrationState,
  type SkillKnowledgeCardInput,
  type SkillKnowledgeCardState,
  type AssistantWebChatDeleteRequest,
  type AssistantWebChatCompactRequest,
  type AssistantWebChatCompactionResult,
  type AssistantWebChatCompactionState,
  type AssistantWebChatActiveMediaJobState,
  type AssistantWebChatListItemState,
  type AssistantWebChatRuntimeState,
  type AssistantWebChatState,
  type getAssistantPersonaArchetypesResponse200,
  type AssistantWebChatRenameRequest,
  type AssistantDraftUpdateRequest,
  type AssistantSetupPreviewState,
  type AssistantLimitState,
  type AssistantListItemState,
  type AssistantRollbackRequest,
  type AssistantMemoryDoNotRememberRequest,
  type AssistantMemoryRegistryItemState,
  type AssistantTaskRegistryItemState,
  type AssistantBillingPaymentIntentState,
  type AssistantBillingSubscriptionActionResult,
  type AssistantBillingSubscriptionManagementState,
  type PostAssistantBillingChangePlanRequest,
  type PostAssistantBillingEnableAutoRenewRequest,
  type PostAssistantBillingPaymentIntentRequest,
  ContractsApiError,
  type AssistantLifecycleState,
  type UserPlanVisibilityState,
  deleteAssistantWebChat as deleteAssistantWebChatContract,
  getAssistant as getAssistantContract,
  getAssistantList as getAssistantListContract,
  getAssistantPersonaArchetypes as getAssistantPersonaArchetypesContract,
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
  postAssistantSwitch as postAssistantSwitchContract,
  postAssistantWebChatCompact as postAssistantWebChatCompactContract,
  postAdminPlanCreate as postAdminPlanCreateContract,
  postAdminStepUpChallenge as postAdminStepUpChallengeContract,
  postAssistantMemoryDoNotRemember as postAssistantMemoryDoNotRememberContract,
  postAssistantBillingPaymentIntent as postAssistantBillingPaymentIntentContract,
  postAssistantBillingEnableAutoRenew as postAssistantBillingEnableAutoRenewContract,
  postAssistantBillingChangePlan as postAssistantBillingChangePlanContract,
  postAssistantBillingDisableAutoRenew as postAssistantBillingDisableAutoRenewContract,
  postAssistantMemoryItemForget as postAssistantMemoryItemForgetContract,
  postAssistantMemoryItemCloseOpenLoop as postAssistantMemoryItemCloseOpenLoopContract,
  postAssistantTaskItemCancel as postAssistantTaskItemCancelContract,
  postAssistantTaskItemDisable as postAssistantTaskItemDisableContract,
  postAssistantTaskItemEnable as postAssistantTaskItemEnableContract,
  getAdminPlans as getAdminPlansContract,
  getAdminBusinessCockpit as getAdminBusinessCockpitContract,
  getAdminBusinessPlatform as getAdminBusinessPlatformContract,
  getAdminNotificationChannels as getAdminNotificationChannelsContract,
  getAdminPlatformRollouts as getAdminPlatformRolloutsContract,
  getAdminOpsCockpit as getAdminOpsCockpitContract,
  postAdminOpsUserPlanOverride as postAdminOpsUserPlanOverrideContract,
  deleteAdminOpsUserPlanOverride as deleteAdminOpsUserPlanOverrideContract,
  getAdminPlanVisibility as getAdminPlanVisibilityContract,
  getAdminRuntimeProviderSettings as getAdminRuntimeProviderSettingsContract,
  getAdminBillingLifecycleSettings as getAdminBillingLifecycleSettingsContract,
  getAssistantBillingPaymentIntent as getAssistantBillingPaymentIntentContract,
  getAssistantBillingSubscription as getAssistantBillingSubscriptionContract,
  getAssistantPlanVisibility as getAssistantPlanVisibilityContract,
  getAssistantSkills as getAssistantSkillsContract,
  getAssistantTelegramIntegration as getAssistantTelegramIntegrationContract,
  getAdminAbuseControlsAssistants as getAdminAbuseControlsAssistantsContract,
  patchAssistantTelegramConfig as patchAssistantTelegramConfigContract,
  postAdminAbuseControlsUnblock as postAdminAbuseControlsUnblockContract,
  postAdminSafetyControlsRestrict as postAdminSafetyControlsRestrictContract,
  postAdminSafetyControlsUnblock as postAdminSafetyControlsUnblockContract,
  getAdminSafetyControlsCases as getAdminSafetyControlsCasesContract,
  getAdminSafetyPolicyHeuristicRules as getAdminSafetyPolicyHeuristicRulesContract,
  getAdminSafetyPolicySettings as getAdminSafetyPolicySettingsContract,
  putAdminSafetyPolicyHeuristicRules as putAdminSafetyPolicyHeuristicRulesContract,
  putAdminSafetyPolicySettings as putAdminSafetyPolicySettingsContract,
  putAssistantSkillAssignments as putAssistantSkillAssignmentsContract,
  postAssistantTelegramConnect as postAssistantTelegramConnectContract,
  postAssistantTelegramRevoke as postAssistantTelegramRevokeContract,
  putAdminRuntimeProviderSettings as putAdminRuntimeProviderSettingsContract,
  putAdminBillingLifecycleSettings as putAdminBillingLifecycleSettingsContract,
  // ADR-088 unified notification platform
  patchUnifiedNotificationChannel as patchUnifiedNotificationChannelContract,
  listNotificationPolicies as listNotificationPoliciesContract,
  patchNotificationPolicy as patchNotificationPolicyContract,
  getNotificationQuietHours as getNotificationQuietHoursContract,
  patchNotificationQuietHours as patchNotificationQuietHoursContract,
  listNotificationDeliveries as listNotificationDeliveriesContract,
  getNotificationDelivery as getNotificationDeliveryContract,
  listNotificationDeadLetters as listNotificationDeadLettersContract,
  replayNotificationDeadLetter as replayNotificationDeadLetterContract,
  discardNotificationDeadLetter as discardNotificationDeadLetterContract,
  previewNotification as previewNotificationContract,
  type NotificationChannelView,
  type NotificationPolicyView,
  type NotificationQuietHoursView,
  type DeliveryIntentView,
  type NotificationDeadLetterView,
  type PatchNotificationChannelRequest,
  type PatchNotificationPolicyRequest,
  type PatchNotificationQuietHoursRequest,
  type NotificationPreviewRequest,
  type NotificationPreviewResult,
  type GetNotificationDeliveriesResponse,
  type GetNotificationDeadLettersResponse,
  type ListNotificationDeliveriesParams,
  type ListNotificationDeadLettersParams,
  type AssistantWebChatMessageAttachmentState,
  type AssistantFilesCleanupSummary
} from "@persai/contracts";
import type { RuntimeTodoItem } from "@persai/runtime-contract";
export type {
  AssistantBillingSubscriptionActionResult,
  AssistantBillingSubscriptionManagementState
} from "@persai/contracts";
import {
  uploadWithProgress,
  XhrAbortError,
  XhrNetworkError,
  XhrStallError,
  XhrTimeoutError,
  type XhrUploadOptions,
  type XhrUploadProgress
} from "./upload-with-progress";

export { XhrAbortError, XhrNetworkError, XhrStallError, XhrTimeoutError, type XhrUploadProgress };

function getAuthHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`
  };
}

export async function issueAdminStepUpToken(
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
    if (error.status === 403) {
      return error.message || "Admin access denied.";
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
      event: "activity";
      data: {
        source: "skill" | "user" | "product" | "web";
        phase: "start";
        resultCount: number;
        skillName?: string | null;
        skillIconEmoji?: string | null;
      };
    }
  | {
      event: "project_activity";
      data: {
        stage: "plan" | "gather" | "analyze" | "replan" | "synthesize";
        status: "started" | "completed";
        summary: string;
        detail?: string | null;
        sourceClass?: "files" | "skill" | "knowledge" | "web" | "tool" | null;
        resultCount?: number | null;
      };
    }
  | {
      event: "project_reasoning_summary";
      data: {
        kind: "plan" | "check" | "gap" | "conflict" | "interim" | "replan" | "synthesis";
        summary: string;
        detail?: string | null;
      };
    }
  | {
      event: "compaction";
      data: { phase: "start" | "end"; completed: boolean; willRetry: boolean };
    }
  | { event: "runtime_done"; data: { respondedAt: string } }
  | { event: "stream_reset"; data: { reason: string; attempt: number } }
  | { event: "completed"; data: { transport: unknown } }
  | { event: "interrupted"; data: { transport: unknown } }
  | { event: "failed"; data: { code?: string; message: string; transport: unknown } }
  | { event: "turn_status"; data: { turn: WebChatTurnStatusState } }
  | { event: "reattached"; data: { turn: WebChatTurnStatusState; live: boolean } };

export const WELCOME_THREAD_KEY = "welcome";
export const WELCOME_TURN_SENTINEL = "__welcome_init__";
export const REATTACH_STREAM_IDLE_TIMEOUT_MS = 30_000;
export type AssistantChatMode = "normal" | "smart" | "project";

export interface AssistantWebChatStreamPayload {
  surfaceThreadKey: string;
  message: string;
  clientTurnId?: string;
  title?: string | null;
  chatMode?: AssistantChatMode;
  deepModeEnabled?: boolean;
  welcomeTurn?: boolean;
  welcomeLocale?: string;
}

export interface AssistantWebChatStreamHandlers {
  /**
   * Fired exactly once, the moment the server accepts the request and we
   * receive 2xx response headers (before any SSE event has been parsed).
   *
   * This is the "message has flown out" signal — it is what the chat-input
   * pending-slot uses to clear the "sending" state. We deliberately do NOT
   * tie success to the first SSE event because tool turns (e.g. image
   * generation) can keep the stream silent for 30-60s while still being a
   * fully accepted in-flight request. See ADR-075 "Single-slot pending send".
   */
  onHeadersOk?: () => void;
  onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
  onThinking?: (payload: { delta: string; accumulated: string }) => void;
  onDelta?: (payload: { delta: string }) => void;
  onTool?: (payload: {
    phase: "start" | "end";
    toolName: string;
    toolCallId: string;
    isError: boolean;
  }) => void;
  onActivity?: (payload: {
    source: "skill" | "user" | "product" | "web";
    phase: "start";
    resultCount: number;
    skillName?: string | null;
    skillIconEmoji?: string | null;
  }) => void;
  onProjectActivity?: (payload: {
    stage: "plan" | "gather" | "analyze" | "replan" | "synthesize";
    status: "started" | "completed";
    summary: string;
    detail?: string | null;
    sourceClass?: "files" | "skill" | "knowledge" | "web" | "tool" | null;
    resultCount?: number | null;
  }) => void;
  onProjectReasoningSummary?: (payload: {
    kind: "plan" | "check" | "gap" | "conflict" | "interim" | "replan" | "synthesis";
    summary: string;
    detail?: string | null;
  }) => void;
  onCompaction?: (payload: {
    phase: "start" | "end";
    completed: boolean;
    willRetry: boolean;
  }) => void;
  onRuntimeDone?: (payload: { respondedAt: string }) => void;
  onStreamReset?: (payload: { reason: string; attempt: number }) => void;
  onTurnStatus?: (payload: { turn: WebChatTurnStatusState }) => void;
  onReattached?: (payload: { turn: WebChatTurnStatusState; live: boolean }) => void;
  onCompleted?: (payload: { transport: unknown }) => void;
  onInterrupted?: (payload: { transport: unknown }) => void;
  onFailed?: (payload: { code?: string; message: string; transport: unknown }) => void;
}

export type WebChatUxIssueClass =
  | "auth_session"
  | "input_validation"
  | "voice_transcription_empty"
  | "assistant_not_live"
  | "assistant_activating"
  | "assistant_activation_failed"
  | "active_chat_cap"
  | "chat_message_limit"
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
  | "safety_restricted"
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
    return parseApiErrorEnvelope(payload);
  } catch {
    return null;
  }
}

function parseApiErrorEnvelope(
  payload: unknown
): { code: string; message: string; details?: Record<string, unknown> } | null {
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
}

function readXhrErrorEnvelope(
  responseText: string,
  contentType: string
): { code: string; message: string; details?: Record<string, unknown> } | null {
  if (!contentType.toLowerCase().includes("application/json")) return null;
  try {
    return parseApiErrorEnvelope(JSON.parse(responseText) as unknown);
  } catch {
    return null;
  }
}

export class ApiStructuredError extends Error {
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

function extractStructuredErrorDetails(error: unknown): Record<string, unknown> | null {
  if (error instanceof ApiStructuredError) {
    return error.details ?? null;
  }
  if (error instanceof ContractsApiError) {
    return parseApiErrorEnvelope(error.payload)?.details ?? null;
  }
  if (typeof error === "object" && error !== null && "details" in error) {
    const value = (error as { details?: unknown }).details;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

function extractStructuredGuidance(error: unknown): string | null {
  const value = extractStructuredErrorDetails(error)?.userFacingGuidance;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function toWebChatUxIssue(error: unknown): WebChatUxIssue {
  const rawMessage = extractErrorMessage(error) ?? "Web chat request failed.";
  const structuredGuidance = extractStructuredGuidance(error);
  const details = extractStructuredErrorDetails(error);

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

  if (code === "assistant_activating") {
    return {
      classId: "assistant_activating",
      message: "Your assistant settings are still activating.",
      guidance: "Wait a moment, then retry in the same thread."
    };
  }

  if (code === "assistant_activation_failed") {
    return {
      classId: "assistant_activation_failed",
      message: "Assistant settings activation failed.",
      guidance: "Retry the rollout in Admin > Rollouts, then try again."
    };
  }

  if (code === "active_chat_cap_reached") {
    return {
      classId: "active_chat_cap",
      message: "You already have the maximum number of active chats for this plan.",
      guidance:
        "Continue in an existing chat, archive one you no longer need, or upgrade for fewer limits."
    };
  }

  if (code === "chat_message_limit_reached") {
    return {
      classId: "chat_message_limit",
      message: "This chat has reached its message limit.",
      guidance: "Continue in a new chat, or upgrade if you want longer ongoing conversations."
    };
  }

  if (code === "quota_limit_reached") {
    return {
      classId: "quota_limit_reached",
      message: rawMessage,
      guidance:
        structuredGuidance ??
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
      message: limitMb !== null ? rawMessage : rawMessage,
      guidance:
        structuredGuidance ??
        "Delete old chats or files to free up space, then try uploading again.",
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
      message: limitMb !== null ? rawMessage : rawMessage,
      guidance:
        structuredGuidance ??
        "Delete old chats or files to free up space, then try uploading again.",
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
      message: rawMessage,
      guidance:
        structuredGuidance ??
        "Delete older knowledge-base documents or free assistant storage, then try uploading again.",
      data: { usedMb, limitMb }
    };
  }

  if (code === "token_budget_exhausted") {
    return {
      classId: "quota_limit_reached",
      message: rawMessage,
      guidance:
        structuredGuidance ??
        "Wait for the next billing cycle or upgrade the plan to continue using the assistant."
    };
  }

  if (code === "monthly_media_quota_exceeded" || code === "monthly_media_quota_rejected") {
    return {
      classId: "quota_limit_reached",
      message: rawMessage,
      guidance:
        structuredGuidance ??
        "Wait for the next billing cycle, upgrade the plan, or use a request that does not need media generation."
    };
  }

  if (code === "tool_daily_limit_reached") {
    return {
      classId: "quota_limit_reached",
      message: rawMessage,
      guidance:
        structuredGuidance ??
        "Try again later or use a request that does not need the exhausted tool."
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
      classId: "channel_failure",
      message: rawMessage,
      guidance: "Wait a moment, then retry the same thread."
    };
  }

  if (code === "safety_restricted") {
    return {
      classId: "safety_restricted",
      message: "",
      guidance: "",
      ...(typeof details?.reasonCode === "string"
        ? { data: { reasonCode: details.reasonCode } }
        : {})
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
    code === "voice_transcription_empty" ||
    code === "voice_transcription_failed" ||
    normalized.includes("no_audio_detected") ||
    normalized.includes("voice transcription returned empty") ||
    normalized.includes("voice transcription failed") ||
    (normalized.includes("voice") &&
      (normalized.includes("transcri") ||
        normalized.includes("speech") ||
        normalized.includes("stt") ||
        normalized.includes("audio")))
  ) {
    return {
      classId: "voice_transcription_empty",
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
      message: "You already have the maximum number of active chats for this plan.",
      guidance:
        "Continue in an existing chat, archive one you no longer need, or upgrade for fewer limits."
    };
  }

  if (normalized.includes("chat reached its message limit")) {
    return {
      classId: "chat_message_limit",
      message: "This chat has reached its message limit.",
      guidance: "Continue in a new chat, or upgrade if you want longer ongoing conversations."
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

  if (normalized.includes("settings are still activating")) {
    return {
      classId: "assistant_activating",
      message: "Your assistant settings are still activating.",
      guidance: "Wait a moment, then retry in the same thread."
    };
  }

  if (normalized.includes("settings activation failed")) {
    return {
      classId: "assistant_activation_failed",
      message: "Assistant settings activation failed.",
      guidance: "Retry the rollout in Admin > Rollouts, then try again."
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
  if (eventName === "activity") {
    if (
      (body.source !== "skill" &&
        body.source !== "user" &&
        body.source !== "product" &&
        body.source !== "web") ||
      body.phase !== "start" ||
      typeof body.resultCount !== "number"
    ) {
      return null;
    }
    return {
      event: "activity",
      data: {
        source: body.source,
        phase: body.phase,
        resultCount: Math.max(0, body.resultCount),
        ...(typeof body.skillName === "string" || body.skillName === null
          ? { skillName: body.skillName }
          : {}),
        ...(typeof body.skillIconEmoji === "string" || body.skillIconEmoji === null
          ? { skillIconEmoji: body.skillIconEmoji }
          : {})
      }
    };
  }
  if (eventName === "project_activity") {
    if (
      (body.stage !== "plan" &&
        body.stage !== "gather" &&
        body.stage !== "analyze" &&
        body.stage !== "replan" &&
        body.stage !== "synthesize") ||
      (body.status !== "started" && body.status !== "completed") ||
      typeof body.summary !== "string"
    ) {
      return null;
    }
    return {
      event: "project_activity",
      data: {
        stage: body.stage,
        status: body.status,
        summary: body.summary,
        ...(typeof body.detail === "string" || body.detail === null ? { detail: body.detail } : {}),
        ...(body.sourceClass === "files" ||
        body.sourceClass === "skill" ||
        body.sourceClass === "knowledge" ||
        body.sourceClass === "web" ||
        body.sourceClass === "tool"
          ? { sourceClass: body.sourceClass }
          : body.sourceClass === null
            ? { sourceClass: null }
            : {}),
        ...(typeof body.resultCount === "number" || body.resultCount === null
          ? { resultCount: body.resultCount }
          : {})
      }
    };
  }
  if (eventName === "project_reasoning_summary") {
    if (
      (body.kind !== "plan" &&
        body.kind !== "check" &&
        body.kind !== "gap" &&
        body.kind !== "conflict" &&
        body.kind !== "interim" &&
        body.kind !== "replan" &&
        body.kind !== "synthesis") ||
      typeof body.summary !== "string"
    ) {
      return null;
    }
    return {
      event: "project_reasoning_summary",
      data: {
        kind: body.kind,
        summary: body.summary,
        ...(typeof body.detail === "string" || body.detail === null ? { detail: body.detail } : {})
      }
    };
  }
  if (eventName === "runtime_done") {
    if (typeof body.respondedAt !== "string") {
      return null;
    }
    return { event: "runtime_done", data: { respondedAt: body.respondedAt } };
  }
  if (eventName === "stream_reset") {
    const reason = typeof body.reason === "string" ? body.reason : "unknown";
    const attempt = typeof body.attempt === "number" ? body.attempt : 0;
    return { event: "stream_reset", data: { reason, attempt } };
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
  if (eventName === "turn_status") {
    if (typeof body.turn !== "object" || body.turn === null) {
      return null;
    }
    return { event: "turn_status", data: { turn: body.turn as WebChatTurnStatusState } };
  }
  if (eventName === "reattached") {
    if (typeof body.turn !== "object" || body.turn === null || typeof body.live !== "boolean") {
      return null;
    }
    return {
      event: "reattached",
      data: { turn: body.turn as WebChatTurnStatusState, live: body.live }
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

  // Signal that the SSE transport is open as soon as 2xx headers arrive.
  // The UI may still wait for a later `started`/terminal event before it
  // treats the turn as fully accepted.
  handlers.onHeadersOk?.();

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
    } else if (streamEvent.event === "activity") {
      handlers.onActivity?.(streamEvent.data);
    } else if (streamEvent.event === "project_activity") {
      handlers.onProjectActivity?.(streamEvent.data);
    } else if (streamEvent.event === "project_reasoning_summary") {
      handlers.onProjectReasoningSummary?.(streamEvent.data);
    } else if (streamEvent.event === "compaction") {
      handlers.onCompaction?.(streamEvent.data);
    } else if (streamEvent.event === "runtime_done") {
      handlers.onRuntimeDone?.(streamEvent.data);
    } else if (streamEvent.event === "stream_reset") {
      handlers.onStreamReset?.(streamEvent.data);
    } else if (streamEvent.event === "turn_status") {
      handlers.onTurnStatus?.(streamEvent.data);
    } else if (streamEvent.event === "reattached") {
      handlers.onReattached?.(streamEvent.data);
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

export async function reattachAssistantWebChatTurnStream(
  token: string,
  clientTurnId: string,
  handlers: AssistantWebChatStreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  const requestInit: RequestInit = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream"
    }
  };
  if (signal !== undefined) {
    requestInit.signal = signal;
  }

  const response = await fetch(
    `${getApiBaseUrl()}/assistant/chat/web/turns/${encodeURIComponent(clientTurnId)}/stream`,
    requestInit
  );
  if (!response.ok) {
    throw new Error("Failed to reattach web chat turn stream.");
  }
  handlers.onHeadersOk?.();
  if (response.body === null) {
    throw new Error("Streaming response has no body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawTerminalEvent = false;
  let idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
  const clearIdleTimeout = (): void => {
    if (idleTimeoutId !== null) {
      clearTimeout(idleTimeoutId);
      idleTimeoutId = null;
    }
  };
  const readWithIdleTimeout = (): Promise<ReadableStreamReadResult<Uint8Array>> =>
    Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
        clearIdleTimeout();
        idleTimeoutId = setTimeout(() => {
          reject(new Error("Reattach stream stalled before terminal event."));
        }, REATTACH_STREAM_IDLE_TIMEOUT_MS);
      })
    ]);
  const handleStreamEvent = (streamEvent: WebChatStreamEvent): void => {
    if (streamEvent.event === "delta") handlers.onDelta?.(streamEvent.data);
    else if (streamEvent.event === "thinking") handlers.onThinking?.(streamEvent.data);
    else if (streamEvent.event === "tool") handlers.onTool?.(streamEvent.data);
    else if (streamEvent.event === "activity") handlers.onActivity?.(streamEvent.data);
    else if (streamEvent.event === "project_activity")
      handlers.onProjectActivity?.(streamEvent.data);
    else if (streamEvent.event === "project_reasoning_summary")
      handlers.onProjectReasoningSummary?.(streamEvent.data);
    else if (streamEvent.event === "compaction") handlers.onCompaction?.(streamEvent.data);
    else if (streamEvent.event === "runtime_done") handlers.onRuntimeDone?.(streamEvent.data);
    else if (streamEvent.event === "stream_reset") handlers.onStreamReset?.(streamEvent.data);
    else if (streamEvent.event === "turn_status") handlers.onTurnStatus?.(streamEvent.data);
    else if (streamEvent.event === "reattached") handlers.onReattached?.(streamEvent.data);
    else if (streamEvent.event === "completed") {
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

  try {
    for (;;) {
      const { done, value } = await readWithIdleTimeout();
      clearIdleTimeout();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { blocks, rest } = resolveSseBlocks(buffer);
      buffer = rest;
      for (const block of blocks) {
        const parsed = parseSseBlock(block);
        if (parsed === null) continue;
        let payloadObject: unknown = null;
        try {
          payloadObject = JSON.parse(parsed.data);
        } catch {
          continue;
        }
        const streamEvent = toStreamEvent(parsed.eventName, payloadObject);
        if (streamEvent !== null) {
          handleStreamEvent(streamEvent);
        }
      }
    }
  } finally {
    clearIdleTimeout();
  }

  // Flush trailing SSE block. The primary stream (above) handles the
  // `\n\n`-less last block via `decoder.decode()` + `parseSseBlock(buffer)`;
  // the reattach stream MUST do the same, otherwise a server-side
  // `completed` / `interrupted` / `failed` event arriving on a connection
  // close without a final blank line is silently dropped, leaving the
  // client in "still streaming" state forever (and the reattach loop spins
  // on "Stream closed before terminal event" → retry → spins again).
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

/**
 * Pre-prod polish 2026 / FIX 1, Slice 1.2 — explicit hard-stop signal.
 *
 * Pairs with `POST /assistant/chat/web/stop` on the API. Used by
 * `useChat.stop()` to tell the API "this Stop click is a hard abort, not
 * just a tab-switch" *before* tearing down the local SSE controller.
 * Best-effort: the call is fire-and-forget from the caller's POV, but we
 * still await the network round-trip so transient errors surface in the
 * console without blocking the local abort path. A failure here only
 * means the runtime keeps producing in the background — which is the
 * documented soft-detach behavior, strictly safer than the pre-Slice-1.2
 * "always abort on any disconnect" default.
 */
export async function stopAssistantWebChatTurn(token: string, clientTurnId: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/assistant/chat/web/stop`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ clientTurnId })
  });

  if (!response.ok && response.status !== 204) {
    let errorPayload: unknown = null;
    try {
      errorPayload = await response.json();
    } catch {
      errorPayload = await response.text();
    }
    throw new ContractsApiError(
      `Stop request failed with status ${response.status}.`,
      response.status,
      errorPayload
    );
  }
}

export interface AssistantDirectoryState {
  assistants: AssistantListItemState[];
  activeAssistantId: string | null;
  assistantLimit: AssistantLimitState;
}

export interface AssistantLifecycleViewState extends AssistantDirectoryState {
  assistant: AssistantLifecycleState | null;
}

export type UserSafetyStandingState = {
  standing: "none" | "warn" | "restricted";
  observationEndsAt: string | null;
  daysRemaining: number | null;
  reasonCode: string | null;
};

export async function getUserSafetyStanding(token: string): Promise<UserSafetyStandingState> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/app/user-safety-standing`, {
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error("Unexpected non-success response for GET /app/user-safety-standing.");
  }
  const payload = (await res.json()) as { standing?: UserSafetyStandingState };
  if (payload.standing === undefined) {
    throw new Error("User safety standing returned an unexpected response.");
  }
  return payload.standing;
}

export async function getAssistantList(token: string): Promise<AssistantDirectoryState> {
  try {
    const response = await getAssistantListContract({
      headers: getAuthHeaders(token)
    });

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /assistant/list.");
    }

    return {
      assistants: response.data.assistants,
      activeAssistantId: response.data.activeAssistantId,
      assistantLimit: response.data.assistantLimit
    };
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getAssistantLifecycleView(
  token: string
): Promise<AssistantLifecycleViewState> {
  try {
    const response = await getAssistantContract({
      headers: getAuthHeaders(token)
    });

    if (response.status === 404) {
      try {
        return {
          assistant: null,
          ...(await getAssistantList(token))
        };
      } catch {
        return {
          assistant: null,
          assistants: [],
          activeAssistantId: null,
          assistantLimit: {
            usedAssistants: 0,
            maxAssistants: 1
          }
        };
      }
    }

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /assistant.");
    }

    return {
      assistant: response.data.assistant,
      assistants: response.data.assistants,
      activeAssistantId: response.data.activeAssistantId,
      assistantLimit: response.data.assistantLimit
    };
  } catch (error) {
    if (error instanceof ContractsApiError && error.status === 404) {
      try {
        return {
          assistant: null,
          ...(await getAssistantList(token))
        };
      } catch {
        return {
          assistant: null,
          assistants: [],
          activeAssistantId: null,
          assistantLimit: {
            usedAssistants: 0,
            maxAssistants: 1
          }
        };
      }
    }
    throw new Error(toErrorMessage(error));
  }
}

export async function getAssistant(token: string): Promise<AssistantLifecycleState | null> {
  return (await getAssistantLifecycleView(token)).assistant;
}

export type AssistantPersonaArchetypeState =
  getAssistantPersonaArchetypesResponse200["data"]["archetypes"][number];

export async function getAssistantPersonaArchetypes(
  token: string
): Promise<AssistantPersonaArchetypeState[]> {
  try {
    const response = await getAssistantPersonaArchetypesContract({
      headers: getAuthHeaders(token)
    });

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /assistant/persona-archetypes.");
    }

    return response.data.archetypes;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantCreate(token: string): Promise<AssistantLifecycleState> {
  const view = await postAssistantCreateLifecycleView(token);
  if (view.assistant === null) {
    throw new Error("Assistant create response did not include an active assistant.");
  }
  return view.assistant;
}

export async function postAssistantCreateLifecycleView(
  token: string
): Promise<AssistantLifecycleViewState> {
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

    return {
      assistant: response.data.assistant,
      assistants: response.data.assistants,
      activeAssistantId: response.data.activeAssistantId,
      assistantLimit: response.data.assistantLimit
    };
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantSwitch(
  token: string,
  assistantId: string
): Promise<AssistantLifecycleViewState> {
  try {
    const response = await postAssistantSwitchContract(
      { assistantId },
      {
        headers: getAuthHeaders(token)
      }
    );

    if (
      response.status !== 200 ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("assistant" in response.data)
    ) {
      throw new Error("Unexpected non-success response for POST /assistant/switch.");
    }

    return {
      assistant: response.data.assistant,
      assistants: response.data.assistants,
      activeAssistantId: response.data.activeAssistantId,
      assistantLimit: response.data.assistantLimit
    };
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

export type AssistantBackgroundTaskRunState = {
  id: string;
  status: "running" | "no_push" | "pushed" | "completed" | "failed" | "skipped";
  scheduledRunAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  pushText: string | null;
  deliveryTarget: string | null;
  errorMessage: string | null;
};

export type AssistantBackgroundTaskItemState = {
  id: string;
  title: string;
  brief: string;
  mode: "llm_evaluate";
  status: "active" | "disabled" | "completed" | "failed" | "cancelled";
  nextRunAt: string | null;
  externalRef: string | null;
  runCount: number;
  lastRunAt: string | null;
  lastRunStatus: AssistantBackgroundTaskRunState["status"] | null;
  lastPushAt: string | null;
  lastErrorMessage: string | null;
  recentRuns: AssistantBackgroundTaskRunState[];
};

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

// ADR-074 Slice M3.1 — Memory Center "Mark as closed" button calls this to
// close one open-loop registry item by id. Treats both `closed` and
// `already_closed` reasons as success (idempotent); the caller refreshes the
// list, which causes the closed loop to drop out (the list endpoint only
// returns active rows).
export async function postAssistantMemoryItemCloseOpenLoop(
  token: string,
  itemId: string
): Promise<void> {
  try {
    const response = await postAssistantMemoryItemCloseOpenLoopContract(itemId, {
      headers: getAuthHeaders(token)
    });

    if (
      !isSuccessStatus(response.status) ||
      typeof response.data !== "object" ||
      response.data === null ||
      !("closed" in response.data)
    ) {
      throw new Error(
        "Unexpected non-success response for POST /assistant/memory/items/:itemId/close-open-loop."
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

function isBackgroundTaskRun(value: unknown): value is AssistantBackgroundTaskRunState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    (row.status === "running" ||
      row.status === "no_push" ||
      row.status === "pushed" ||
      row.status === "completed" ||
      row.status === "failed" ||
      row.status === "skipped") &&
    typeof row.scheduledRunAt === "string" &&
    (row.startedAt === null || typeof row.startedAt === "string") &&
    (row.finishedAt === null || typeof row.finishedAt === "string") &&
    (row.pushText === null || typeof row.pushText === "string") &&
    (row.deliveryTarget === null || typeof row.deliveryTarget === "string") &&
    (row.errorMessage === null || typeof row.errorMessage === "string")
  );
}

function isBackgroundTaskItem(value: unknown): value is AssistantBackgroundTaskItemState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.title === "string" &&
    typeof row.brief === "string" &&
    row.mode === "llm_evaluate" &&
    (row.status === "active" ||
      row.status === "disabled" ||
      row.status === "completed" ||
      row.status === "failed" ||
      row.status === "cancelled") &&
    (row.nextRunAt === null || typeof row.nextRunAt === "string") &&
    (row.externalRef === null || typeof row.externalRef === "string") &&
    typeof row.runCount === "number" &&
    (row.lastRunAt === null || typeof row.lastRunAt === "string") &&
    (row.lastRunStatus === null ||
      row.lastRunStatus === "running" ||
      row.lastRunStatus === "no_push" ||
      row.lastRunStatus === "pushed" ||
      row.lastRunStatus === "completed" ||
      row.lastRunStatus === "failed" ||
      row.lastRunStatus === "skipped") &&
    (row.lastPushAt === null || typeof row.lastPushAt === "string") &&
    (row.lastErrorMessage === null || typeof row.lastErrorMessage === "string") &&
    Array.isArray(row.recentRuns) &&
    row.recentRuns.every(isBackgroundTaskRun)
  );
}

export async function getAssistantBackgroundTaskItems(
  token: string
): Promise<AssistantBackgroundTaskItemState[]> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/assistant/background-tasks/items`, {
      headers: getAuthHeaders(token)
    });
    if (!response.ok) {
      throw new Error(
        await readJsonErrorMessage(
          response,
          "Unexpected non-success response for GET /assistant/background-tasks/items."
        )
      );
    }
    const payload = (await response.json()) as unknown;
    if (typeof payload !== "object" || payload === null || !("items" in payload)) {
      throw new Error("Unexpected response for GET /assistant/background-tasks/items.");
    }
    const items = (payload as { items: unknown }).items;
    if (!Array.isArray(items) || !items.every(isBackgroundTaskItem)) {
      throw new Error("Unexpected background task item shape.");
    }
    return items;
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

async function postAssistantBackgroundTaskItemAction(
  token: string,
  itemId: string,
  action: "disable" | "enable" | "cancel"
): Promise<void> {
  try {
    const response = await fetch(
      `${getApiBaseUrl()}/assistant/background-tasks/items/${encodeURIComponent(itemId)}/${action}`,
      {
        method: "POST",
        headers: getAuthHeaders(token)
      }
    );
    if (!response.ok) {
      throw new Error(
        await readJsonErrorMessage(
          response,
          `Unexpected non-success response for POST /assistant/background-tasks/items/:itemId/${action}.`
        )
      );
    }
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export function postAssistantBackgroundTaskItemDisable(
  token: string,
  itemId: string
): Promise<void> {
  return postAssistantBackgroundTaskItemAction(token, itemId, "disable");
}

export function postAssistantBackgroundTaskItemEnable(
  token: string,
  itemId: string
): Promise<void> {
  return postAssistantBackgroundTaskItemAction(token, itemId, "enable");
}

export function postAssistantBackgroundTaskItemCancel(
  token: string,
  itemId: string
): Promise<void> {
  return postAssistantBackgroundTaskItemAction(token, itemId, "cancel");
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
  memoryClass?: AssistantMemoryRegistryItemState["memoryClass"] | undefined;
  kind?: AssistantMemoryRegistryItemState["kind"] | undefined;
  resolvedAt?: string | null | undefined;
};

export type AssistantPreferredNotificationChannel = "web" | "telegram";

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
    voices: AssistantVoiceCatalogEntry[];
    warning: string | null;
    admin: {
      voices: AssistantAdminVoiceCatalogEntry[];
      publicVoices: AssistantVoiceCatalogEntry[];
    } | null;
  } | null;
};

export type AssistantVoiceCatalogEntry = {
  voiceId: string;
  name: string;
  gender: "male" | "female" | "neutral" | "unknown";
  category: string | null;
  language: string | null;
  languageBucket: "ru" | "en" | "other";
  previewUrl: string | null;
};

export type AssistantAdminVoiceCatalogEntry = AssistantVoiceCatalogEntry & {
  approved: boolean;
  hidden: boolean;
  rank: number | null;
  previewOk: boolean | null;
  public: boolean;
};

export type AssistantVoiceCurationPatch = {
  voiceId: string;
  approved?: boolean;
  hidden?: boolean;
  previewOk?: boolean | null;
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

export type { AssistantWebChatMessageAttachmentState };
export type ChatHistoryAttachment = AssistantWebChatMessageAttachmentState;

export type ChatHistoryMessage = {
  id: string;
  chatId: string;
  assistantId: string;
  author: "user" | "assistant" | "system";
  content: string;
  attachments: ChatHistoryAttachment[];
  createdAt: string;
  platformNotice?: {
    kind: "safety_inbound_warn" | "safety_inbound_restricted";
    reasonCode: string;
  } | null;
  workingNotes?: string[];
};

export type ChatCompactionState = AssistantWebChatCompactionState & {
  exhaustedAtPlanLimit: boolean;
  recentAutoCompactionStreak: number;
};

export type ChatCompactionResult = AssistantWebChatCompactionResult;

function normalizeChatCompactionState(state: AssistantWebChatCompactionState): ChatCompactionState {
  const row = state as AssistantWebChatCompactionState & Partial<ChatCompactionState>;
  return {
    ...state,
    exhaustedAtPlanLimit: row.exhaustedAtPlanLimit === true,
    recentAutoCompactionStreak:
      typeof row.recentAutoCompactionStreak === "number" ? row.recentAutoCompactionStreak : 0
  };
}

export async function getChatMessages(
  token: string,
  chatId: string,
  cursor?: string,
  limit?: number
): Promise<{
  messages: ChatHistoryMessage[];
  nextCursor: string | null;
  activeTurn?: WebChatActiveTurnState | null;
  activeMediaJobs?: WebChatActiveMediaJobState[];
  activeDocumentJobs?: WebChatActiveDocumentJobState[];
}> {
  const base = getApiBaseUrl();
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  const url = `${base}/assistant/chats/web/${encodeURIComponent(chatId)}/messages${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: getAuthHeaders(token) });
  if (!res.ok) throw new Error("Failed to load chat messages.");
  return (await res.json()) as {
    messages: ChatHistoryMessage[];
    nextCursor: string | null;
    activeTurn?: WebChatActiveTurnState | null;
    activeMediaJobs?: WebChatActiveMediaJobState[];
    activeDocumentJobs?: WebChatActiveDocumentJobState[];
  };
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
    return normalizeChatCompactionState(response.data.state);
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
      state: normalizeChatCompactionState(response.data.state),
      result: response.data.result
    };
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export type { AdminPlanState, AdminPlanCreateRequest, AdminPlanUpdateRequest };
export type { AdminBusinessCockpitState };
export type { AdminOpsCockpitState };
export type { MaterializationRolloutView, MaterializationRolloutItemView };
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

export async function getAssistantBillingSubscription(
  token: string
): Promise<AssistantBillingSubscriptionManagementState> {
  try {
    const response = await getAssistantBillingSubscriptionContract({
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /assistant/billing/subscription.");
    }
    return response.data.subscription;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantBillingDisableAutoRenew(
  token: string
): Promise<AssistantBillingSubscriptionManagementState> {
  try {
    const response = await postAssistantBillingDisableAutoRenewContract({
      headers: getAuthHeaders(token)
    });
    if (!isSuccessStatus(response.status)) {
      throw new Error(
        "Unexpected non-success response for POST /assistant/billing/subscription/disable-auto-renew."
      );
    }
    if (
      typeof response.data !== "object" ||
      response.data === null ||
      !("subscription" in response.data)
    ) {
      throw new Error(
        "Unexpected response payload for POST /assistant/billing/subscription/disable-auto-renew."
      );
    }
    return response.data.subscription;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantBillingEnableAutoRenew(
  token: string,
  input: PostAssistantBillingEnableAutoRenewRequest
): Promise<AssistantBillingSubscriptionActionResult> {
  try {
    const response = await postAssistantBillingEnableAutoRenewContract(input, {
      headers: getAuthHeaders(token)
    });
    if (!isSuccessStatus(response.status)) {
      throw new Error(
        "Unexpected non-success response for POST /assistant/billing/subscription/enable-auto-renew."
      );
    }
    if (
      typeof response.data !== "object" ||
      response.data === null ||
      !("result" in response.data)
    ) {
      throw new Error(
        "Unexpected response payload for POST /assistant/billing/subscription/enable-auto-renew."
      );
    }
    return response.data.result;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantBillingChangePlan(
  token: string,
  input: PostAssistantBillingChangePlanRequest
): Promise<AssistantBillingSubscriptionActionResult> {
  try {
    const response = await postAssistantBillingChangePlanContract(input, {
      headers: getAuthHeaders(token)
    });
    if (!isSuccessStatus(response.status)) {
      throw new Error(
        "Unexpected non-success response for POST /assistant/billing/subscription/change-plan."
      );
    }
    if (
      typeof response.data !== "object" ||
      response.data === null ||
      !("result" in response.data)
    ) {
      throw new Error(
        "Unexpected response payload for POST /assistant/billing/subscription/change-plan."
      );
    }
    return response.data.result;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantBillingPaymentIntent(
  token: string,
  input: PostAssistantBillingPaymentIntentRequest
): Promise<AssistantBillingPaymentIntentState> {
  try {
    const response = await postAssistantBillingPaymentIntentContract(input, {
      headers: getAuthHeaders(token)
    });
    if (!isSuccessStatus(response.status)) {
      throw new Error(
        "Unexpected non-success response for POST /assistant/billing/payment-intents."
      );
    }
    if (
      typeof response.data !== "object" ||
      response.data === null ||
      !("paymentIntent" in response.data)
    ) {
      throw new Error("Unexpected response payload for POST /assistant/billing/payment-intents.");
    }
    return response.data.paymentIntent;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getAssistantBillingPaymentIntent(
  token: string,
  paymentIntentId: string
): Promise<AssistantBillingPaymentIntentState> {
  try {
    const response = await getAssistantBillingPaymentIntentContract(paymentIntentId, {
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error(
        "Unexpected non-success response for GET /assistant/billing/payment-intents/:paymentIntentId."
      );
    }
    return response.data.paymentIntent;
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

export async function patchAssistantElevenLabsVoiceCuration(
  token: string,
  patches: AssistantVoiceCurationPatch[]
): Promise<AssistantVoiceSettingsState> {
  const response = await fetch(`${getApiBaseUrl()}/assistant/voice/elevenlabs/curation`, {
    method: "PATCH",
    headers: {
      ...getAuthHeaders(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ patches })
  });
  if (!response.ok) {
    throw new Error(await readJsonErrorMessage(response, "Failed to update voice curation."));
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
    throw new Error(
      "Unexpected non-success response for PATCH /assistant/voice/elevenlabs/curation."
    );
  }
  return payload.settings;
}

export async function postAssistantElevenLabsVoiceCatalogRefresh(
  token: string
): Promise<AssistantVoiceSettingsState> {
  const response = await fetch(`${getApiBaseUrl()}/assistant/voice/elevenlabs/refresh`, {
    method: "POST",
    headers: getAuthHeaders(token)
  });
  if (!response.ok) {
    throw new Error(await readJsonErrorMessage(response, "Failed to refresh voice catalog."));
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
    throw new Error(
      "Unexpected non-success response for POST /assistant/voice/elevenlabs/refresh."
    );
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

export async function getAdminBusinessPlatform(token: string): Promise<AdminBusinessPlatformState> {
  try {
    const response = await getAdminBusinessPlatformContract({
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /admin/business/platform.");
    }
    return response.data.platform;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getAdminNotificationChannels(
  token: string
): Promise<NotificationChannelView[]> {
  try {
    const response = await getAdminNotificationChannelsContract({
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /admin/notifications/channels.");
    }
    return response.data.channels as NotificationChannelView[];
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

// ── ADR-088: Unified notification platform ─────────────────────────────────

export type { NotificationChannelView, NotificationPolicyView, NotificationQuietHoursView };
export type { DeliveryIntentView, NotificationDeadLetterView };
export type { PatchNotificationChannelRequest, PatchNotificationPolicyRequest };
export type {
  PatchNotificationQuietHoursRequest,
  NotificationPreviewRequest,
  NotificationPreviewResult
};
export type { GetNotificationDeliveriesResponse, ListNotificationDeliveriesParams };
export type NotificationTemplateCatalogResult = {
  requestId: string | null;
  templateIds: string[];
};
export type TestSendNotificationChannelInput = {
  renderStrategy?: "grounded_llm" | "template" | "static_fallback";
  templateId?: string | null;
  renderInstructionRef?: string | null;
  factPayload?: Record<string, unknown>;
};

export async function patchUnifiedNotificationChannel(
  token: string,
  channelType: string,
  input: PatchNotificationChannelRequest
): Promise<NotificationChannelView> {
  try {
    const response = await patchUnifiedNotificationChannelContract(channelType, input, {
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error(
        `Unexpected non-success response for PATCH /admin/notifications/channels/${channelType}.`
      );
    }
    return response.data as NotificationChannelView;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export type TestSendNotificationChannelResult = {
  channelType: string;
  ok: boolean;
  status: "delivered" | "failed" | "not_configured" | "adapter_not_found";
  error: Record<string, unknown> | null;
};

export type TestSendForSourceInput = {
  eventCode?: string | null;
  channelOverride?: string | null;
};

export type TestSendForSourceResult = {
  source: string;
  channelType: string;
  ok: boolean;
  status: "delivered" | "failed" | "not_configured" | "adapter_not_found";
  error: Record<string, unknown> | null;
};

export async function testSendNotificationForSource(
  token: string,
  source: string,
  input?: TestSendForSourceInput
): Promise<TestSendForSourceResult> {
  const response = await fetch(`${getApiBaseUrl()}/admin/notifications/policies/${source}/test`, {
    method: "POST",
    headers: {
      ...getAuthHeaders(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input ?? {})
  });
  if (!response.ok) {
    throw new Error(
      await readJsonErrorMessage(
        response,
        `Unexpected non-success response for POST /admin/notifications/policies/${source}/test.`
      )
    );
  }
  return (await response.json()) as TestSendForSourceResult;
}

export async function listNotificationTemplates(
  token: string
): Promise<NotificationTemplateCatalogResult> {
  const response = await fetch(`${getApiBaseUrl()}/admin/notifications/templates`, {
    headers: {
      ...getAuthHeaders(token)
    }
  });
  if (!response.ok) {
    throw new Error(
      await readJsonErrorMessage(
        response,
        "Unexpected non-success response for GET /admin/notifications/templates."
      )
    );
  }
  return (await response.json()) as NotificationTemplateCatalogResult;
}

export async function testSendNotificationChannel(
  token: string,
  channelType: string,
  input?: TestSendNotificationChannelInput
): Promise<TestSendNotificationChannelResult> {
  const response = await fetch(
    `${getApiBaseUrl()}/admin/notifications/channels/${channelType}/test-send`,
    {
      method: "POST",
      headers: {
        ...getAuthHeaders(token),
        "Content-Type": "application/json"
      },
      ...(input !== undefined ? { body: JSON.stringify(input) } : {})
    }
  );
  if (!response.ok) {
    throw new Error(
      await readJsonErrorMessage(
        response,
        `Unexpected non-success response for POST /admin/notifications/channels/${channelType}/test-send.`
      )
    );
  }
  return (await response.json()) as TestSendNotificationChannelResult;
}

export async function listNotificationPolicies(token: string): Promise<NotificationPolicyView[]> {
  try {
    const response = await listNotificationPoliciesContract({ headers: getAuthHeaders(token) });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /admin/notifications/policies.");
    }
    return response.data.policies as NotificationPolicyView[];
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function patchNotificationPolicy(
  token: string,
  source: string,
  input: PatchNotificationPolicyRequest
): Promise<NotificationPolicyView> {
  try {
    const response = await patchNotificationPolicyContract(source, input, {
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error(
        `Unexpected non-success response for PATCH /admin/notifications/policies/${source}.`
      );
    }
    return response.data as NotificationPolicyView;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getNotificationQuietHours(
  token: string
): Promise<NotificationQuietHoursView | null> {
  try {
    const response = await getNotificationQuietHoursContract({
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /admin/notifications/quiet-hours.");
    }
    return (response.data.quietHours as NotificationQuietHoursView | undefined) ?? null;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function patchNotificationQuietHours(
  token: string,
  input: PatchNotificationQuietHoursRequest
): Promise<NotificationQuietHoursView> {
  try {
    const response = await patchNotificationQuietHoursContract(input, {
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error(
        "Unexpected non-success response for PATCH /admin/notifications/quiet-hours."
      );
    }
    return response.data as NotificationQuietHoursView;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function listNotificationDeliveries(
  token: string,
  params?: ListNotificationDeliveriesParams
): Promise<GetNotificationDeliveriesResponse> {
  try {
    const response = await listNotificationDeliveriesContract(params, {
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /admin/notifications/deliveries.");
    }
    return response.data as GetNotificationDeliveriesResponse;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getNotificationDelivery(
  token: string,
  intentId: string
): Promise<DeliveryIntentView> {
  try {
    const response = await getNotificationDeliveryContract(intentId, {
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error(
        `Unexpected non-success response for GET /admin/notifications/deliveries/${intentId}.`
      );
    }
    return response.data as DeliveryIntentView;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function listNotificationDeadLetters(
  token: string,
  params?: ListNotificationDeadLettersParams
): Promise<GetNotificationDeadLettersResponse> {
  try {
    const response = await listNotificationDeadLettersContract(params, {
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /admin/notifications/dead-letters.");
    }
    return response.data as GetNotificationDeadLettersResponse;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function replayNotificationDeadLetter(
  token: string,
  id: string
): Promise<{ intentId: string }> {
  try {
    const response = await replayNotificationDeadLetterContract(id, {
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error(
        `Unexpected non-success response for POST /admin/notifications/dead-letters/${id}/replay.`
      );
    }
    return { intentId: (response.data as { intentId: string }).intentId };
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function discardNotificationDeadLetter(token: string, id: string): Promise<void> {
  try {
    const response = await discardNotificationDeadLetterContract(id, {
      headers: getAuthHeaders(token)
    });
    if (response.status !== 204) {
      throw new Error(
        `Unexpected non-success response for POST /admin/notifications/dead-letters/${id}/discard.`
      );
    }
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function previewNotification(
  token: string,
  input: NotificationPreviewRequest
): Promise<NotificationPreviewResult> {
  try {
    const response = await previewNotificationContract(input, {
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for POST /admin/notifications/preview.");
    }
    return response.data as NotificationPreviewResult;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getAdminPlatformRollouts(
  token: string
): Promise<MaterializationRolloutView[]> {
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

export async function getAdminPlatformRolloutFailedItems(
  token: string,
  rolloutId: string
): Promise<GetAdminPlatformRolloutFailedItemsResponse> {
  try {
    const base = getApiBaseUrl();
    const res = await fetch(
      `${base}/admin/platform-rollouts/${encodeURIComponent(rolloutId)}/failed-items`,
      {
        headers: getAuthHeaders(token)
      }
    );
    if (!res.ok) {
      throw new Error(
        await readJsonErrorMessage(
          res,
          `Failed to load failed rollout items (${String(res.status)}).`
        )
      );
    }
    return (await res.json()) as GetAdminPlatformRolloutFailedItemsResponse;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAdminPlatformRolloutRetryFailed(
  token: string,
  rolloutId: string
): Promise<PostAdminPlatformRolloutRetryFailedResponse> {
  try {
    const stepUpToken = await issueAdminStepUpToken(token, "admin.force_reapply_all");
    const base = getApiBaseUrl();
    const res = await fetch(
      `${base}/admin/platform-rollouts/${encodeURIComponent(rolloutId)}/retry-failed`,
      {
        method: "POST",
        headers: {
          ...getAuthHeaders(token),
          "x-persai-step-up-token": stepUpToken
        }
      }
    );
    if (!res.ok) {
      throw new Error(
        await readJsonErrorMessage(
          res,
          `Retry failed rollout items failed (${String(res.status)}).`
        )
      );
    }
    return (await res.json()) as PostAdminPlatformRolloutRetryFailedResponse;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAdminPlatformRolloutCancelPending(
  token: string,
  rolloutId: string
): Promise<PostAdminPlatformRolloutCancelPendingResponse> {
  try {
    const stepUpToken = await issueAdminStepUpToken(token, "admin.force_reapply_all");
    const base = getApiBaseUrl();
    const res = await fetch(
      `${base}/admin/platform-rollouts/${encodeURIComponent(rolloutId)}/cancel-pending`,
      {
        method: "POST",
        headers: {
          ...getAuthHeaders(token),
          "x-persai-step-up-token": stepUpToken
        }
      }
    );
    if (!res.ok) {
      throw new Error(
        await readJsonErrorMessage(
          res,
          `Cancel pending rollout items failed (${String(res.status)}).`
        )
      );
    }
    return (await res.json()) as PostAdminPlatformRolloutCancelPendingResponse;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export type {
  AdminRuntimeProviderSettingsState,
  PutAdminRuntimeProviderSettingsResponse,
  AdminBillingLifecycleSettingsRequest,
  AdminBillingLifecycleSettingsState,
  PutAdminBillingLifecycleSettingsResponse
};

export async function getAdminBillingLifecycleSettings(
  token: string
): Promise<AdminBillingLifecycleSettingsState> {
  try {
    const response = await getAdminBillingLifecycleSettingsContract({
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /admin/billing/lifecycle-settings.");
    }
    return response.data.settings;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function putAdminBillingLifecycleSettings(
  token: string,
  input: AdminBillingLifecycleSettingsRequest
): Promise<PutAdminBillingLifecycleSettingsResponse> {
  try {
    const stepUpToken = await issueAdminStepUpToken(
      token,
      "admin.billing_lifecycle_settings.update"
    );
    const response = await putAdminBillingLifecycleSettingsContract(input, {
      headers: {
        ...getAuthHeaders(token),
        "x-persai-step-up-token": stepUpToken
      }
    });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for PUT /admin/billing/lifecycle-settings.");
    }
    return response.data;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

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

export async function getAdminOpsCockpit(
  token: string,
  params?: GetAdminOpsCockpitParams
): Promise<AdminOpsCockpitState> {
  try {
    const response = await getAdminOpsCockpitContract(params, {
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

export async function deleteAdminOpsUserPlanOverride(
  token: string,
  userId: string,
  assistantId?: string | null
): Promise<void> {
  try {
    const stepUpToken = await issueAdminStepUpToken(token, "admin.plan.update");
    const response = await deleteAdminOpsUserPlanOverrideContract(
      userId,
      assistantId ? { assistantId } : undefined,
      {
        headers: {
          ...getAuthHeaders(token),
          "x-persai-step-up-token": stepUpToken
        }
      }
    );
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
          planCode: payload.planCode
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

export async function postAdminOpsUserBillingSupportAction(
  token: string,
  userId: string,
  payload: {
    action:
      | "initialize_lifecycle_now"
      | "extend_trial"
      | "grant_grace"
      | "extend_grace"
      | "send_billing_reminder"
      | "apply_fallback_now"
      | "activate_paid_manually";
    manualPayment?: {
      planCode: string;
      billingPeriod: "month" | "year";
    };
  }
): Promise<{ summary: string }> {
  try {
    const stepUpToken = await issueAdminStepUpToken(token, "admin.plan.update");
    const base = getApiBaseUrl();
    const res = await fetch(
      `${base}/admin/ops/users/${encodeURIComponent(userId)}/billing-support-action`,
      {
        method: "POST",
        headers: {
          ...getAuthHeaders(token),
          "Content-Type": "application/json",
          "x-persai-step-up-token": stepUpToken
        },
        body: JSON.stringify(payload)
      }
    );
    if (!res.ok) {
      throw new Error(await readJsonErrorMessage(res, "Failed to run billing support action."));
    }
    const response = (await res.json()) as { summary?: unknown };
    return {
      summary:
        typeof response.summary === "string"
          ? response.summary
          : "Billing support action completed."
    };
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

export async function postAssistantTelegramGroupsRefresh(token: string): Promise<void> {
  try {
    const response = await fetch("/api/v1/assistant/integrations/telegram/groups/refresh", {
      method: "POST",
      headers: getAuthHeaders(token)
    });
    if (!response.ok) {
      throw new Error(
        await readJsonErrorMessage(
          response,
          "Unexpected non-success response for POST /assistant/integrations/telegram/groups/refresh."
        )
      );
    }
  } catch (error) {
    throw new Error(toErrorMessage(error));
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
): Promise<{
  assistantId: string;
  userId: string | null;
  surface: "web_chat" | "telegram" | "whatsapp" | "max";
  adminOverrideUntil: string;
  affectedUserRows: number;
  affectedAssistantRows: number;
}> {
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

export async function postAdminSafetyUnblock(
  token: string,
  payload: AdminSafetyUnblockRequest
): Promise<{ userId: string; cleared: boolean }> {
  try {
    const response = await postAdminSafetyControlsUnblockContract(payload, {
      headers: getAuthHeaders(token)
    });
    if (!isSuccessStatus(response.status)) {
      throw new Error("Unexpected non-success response for POST /admin/safety-controls/unblock.");
    }
    return (response.data as PostAdminSafetyControlsUnblockResponse).unblock;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAdminSafetyRestrict(
  token: string,
  payload: AdminSafetyRestrictRequest
): Promise<{ userId: string; restricted: boolean; reasonCode: string }> {
  try {
    const stepUpToken = await issueAdminStepUpToken(token, "admin.safety_user.restrict");
    const response = await postAdminSafetyControlsRestrictContract(payload, {
      headers: {
        ...getAuthHeaders(token),
        "x-persai-step-up-token": stepUpToken
      }
    });
    if (!isSuccessStatus(response.status)) {
      throw new Error("Unexpected non-success response for POST /admin/safety-controls/restrict.");
    }
    return (response.data as PostAdminSafetyControlsRestrictResponse).restrict;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getAdminSafetyModerationCases(
  token: string,
  params: { userId?: string; caseId?: string }
): Promise<GetAdminSafetyControlsCasesResponse["cases"]> {
  try {
    const response = await getAdminSafetyControlsCasesContract(params, {
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /admin/safety-controls/cases.");
    }
    return response.data.cases;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getAdminSafetyPolicyHeuristicRules(
  token: string,
  params?: GetAdminSafetyPolicyHeuristicRulesParams
): Promise<SafetyHeuristicRuleState[]> {
  try {
    const response = await getAdminSafetyPolicyHeuristicRulesContract(params, {
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error(
        "Unexpected non-success response for GET /admin/safety-policy/heuristic-rules."
      );
    }
    return (response.data as GetAdminSafetyPolicyHeuristicRulesResponse).rules;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function putAdminSafetyPolicyHeuristicRules(
  token: string,
  payload: PutAdminSafetyPolicyHeuristicRulesRequest
): Promise<SafetyHeuristicRuleState[]> {
  try {
    const response = await putAdminSafetyPolicyHeuristicRulesContract(payload, {
      headers: getAuthHeaders(token)
    });
    if (!isSuccessStatus(response.status)) {
      throw new Error(
        "Unexpected non-success response for PUT /admin/safety-policy/heuristic-rules."
      );
    }
    return (response.data as PutAdminSafetyPolicyHeuristicRulesResponse).rules;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getAdminSafetyPolicySettings(
  token: string
): Promise<SafetyPolicySettingsState> {
  try {
    const response = await getAdminSafetyPolicySettingsContract({
      headers: getAuthHeaders(token)
    });
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /admin/safety-policy/settings.");
    }
    return (response.data as GetAdminSafetyPolicySettingsResponse).settings;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function putAdminSafetyPolicySettings(
  token: string,
  payload: PutAdminSafetyPolicySettingsRequest
): Promise<SafetyPolicySettingsState> {
  try {
    const response = await putAdminSafetyPolicySettingsContract(payload, {
      headers: getAuthHeaders(token)
    });
    if (!isSuccessStatus(response.status)) {
      throw new Error("Unexpected non-success response for PUT /admin/safety-policy/settings.");
    }
    return (response.data as PutAdminSafetyPolicySettingsResponse).settings;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function lookupAdminAbuseAssistantsByEmail(
  token: string,
  email: string
): Promise<AdminAbuseAssistantLookupItem[]> {
  try {
    const normalizedEmail = email.trim();
    if (normalizedEmail.length === 0) {
      throw new Error("Email is required.");
    }
    const response = await getAdminAbuseControlsAssistantsContract(
      { email: normalizedEmail },
      {
        headers: getAuthHeaders(token)
      }
    );
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /admin/abuse-controls/assistants.");
    }
    return (response.data as GetAdminAbuseAssistantsResponse).assistants;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export type { AdminAbuseAssistantLookupItem };

export type AdminAbuseActiveOverrideItem = {
  assistantId: string;
  assistantDisplayName: string | null;
  userId: string;
  userEmail: string;
  userDisplayName: string | null;
  workspaceId: string;
  surface: "web_chat" | "telegram" | "whatsapp" | "max";
  adminOverrideUntil: string;
  lastSeenAt: string;
};

export async function listAdminAbuseActiveOverrides(
  token: string
): Promise<AdminAbuseActiveOverrideItem[]> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/admin/abuse-controls/active-overrides`, {
      headers: getAuthHeaders(token)
    });
    if (!response.ok) {
      throw new Error(
        await readJsonErrorMessage(response, "Failed to load active abuse overrides.")
      );
    }
    const payload = (await response.json()) as {
      overrides?: AdminAbuseActiveOverrideItem[];
    };
    return Array.isArray(payload.overrides) ? payload.overrides : [];
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export type MediaPackageCatalogItem = {
  id: string;
  packageType: "image_generate" | "image_edit" | "video_generate" | "document";
  units: number;
  amountMinor: number;
  currency: "RUB" | "USD";
  isActive: boolean;
  displayOrder: number;
  highlighted: boolean;
  title: { ru: string; en: string };
  subtitle: { ru: string; en: string };
  ctaLabel: { ru: string; en: string };
  createdAt: string;
  updatedAt: string;
};

export async function getAdminMediaPackages(token: string): Promise<MediaPackageCatalogItem[]> {
  try {
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/admin/plans/packages`, {
      method: "GET",
      headers: getAuthHeaders(token)
    });
    if (!res.ok) {
      throw new Error(await readJsonErrorMessage(res, "Failed to fetch package offers."));
    }
    const data = (await res.json()) as { packages: MediaPackageCatalogItem[] };
    return data.packages;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAdminMediaPackage(
  token: string,
  payload: {
    packageType: "image_generate" | "image_edit" | "video_generate" | "document";
    units: number;
    amountMinor: number;
    currency: "RUB" | "USD";
    isActive: boolean;
    displayOrder: number;
    highlighted?: boolean;
    titleRu: string;
    titleEn: string;
    subtitleRu?: string;
    subtitleEn?: string;
  }
): Promise<MediaPackageCatalogItem> {
  try {
    const stepUpToken = await issueAdminStepUpToken(token, "admin.plan.update");
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/admin/plans/packages`, {
      method: "POST",
      headers: {
        ...getAuthHeaders(token),
        "x-persai-step-up-token": stepUpToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      throw new Error(await readJsonErrorMessage(res, "Failed to create package offer."));
    }
    const data = (await res.json()) as { package: MediaPackageCatalogItem };
    return data.package;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function patchAdminMediaPackage(
  token: string,
  id: string,
  patch: Partial<{
    packageType: "image_generate" | "image_edit" | "video_generate" | "document";
    units: number;
    amountMinor: number;
    currency: "RUB" | "USD";
    isActive: boolean;
    displayOrder: number;
    highlighted: boolean;
    titleRu: string;
    titleEn: string;
    subtitleRu: string;
    subtitleEn: string;
  }>
): Promise<MediaPackageCatalogItem> {
  try {
    const stepUpToken = await issueAdminStepUpToken(token, "admin.plan.update");
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/admin/plans/packages/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        ...getAuthHeaders(token),
        "x-persai-step-up-token": stepUpToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(patch)
    });
    if (!res.ok) {
      throw new Error(await readJsonErrorMessage(res, "Failed to update package offer."));
    }
    const data = (await res.json()) as { package: MediaPackageCatalogItem };
    return data.package;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function deleteAdminMediaPackage(token: string, id: string): Promise<void> {
  try {
    const stepUpToken = await issueAdminStepUpToken(token, "admin.plan.update");
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/admin/plans/packages/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: {
        ...getAuthHeaders(token),
        "x-persai-step-up-token": stepUpToken
      }
    });
    if (!res.ok) {
      throw new Error(await readJsonErrorMessage(res, "Failed to delete package offer."));
    }
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getPublicMediaPackages(token: string): Promise<MediaPackageCatalogItem[]> {
  try {
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/assistant/billing/packages/catalog`, {
      method: "GET",
      headers: getAuthHeaders(token)
    });
    if (!res.ok) {
      throw new Error(await readJsonErrorMessage(res, "Failed to fetch package offers."));
    }
    const data = (await res.json()) as { packages: MediaPackageCatalogItem[] };
    return data.packages;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantBillingPackagePaymentIntent(
  token: string,
  payload: {
    packageItemIds: string[];
    paymentMethodClass: "card" | "sbp_qr";
    idempotencyKey: string;
    returnUrl: string;
  }
): Promise<{ id: string; status: string; checkoutPayload: Record<string, unknown> | null }> {
  try {
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/assistant/billing/packages/payment-intents`, {
      method: "POST",
      headers: {
        ...getAuthHeaders(token),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      throw new Error(await readJsonErrorMessage(res, "Failed to create package payment intent."));
    }
    const data = (await res.json()) as {
      paymentIntent: {
        id: string;
        status: string;
        checkout: { payload: Record<string, unknown> | null } | null;
      };
    };
    return {
      id: data.paymentIntent.id,
      status: data.paymentIntent.status,
      checkoutPayload: data.paymentIntent.checkout?.payload ?? null
    };
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export type ForceReapplyAllSummary = {
  rolloutId: string;
  targetGeneration: number;
  totalItems: number;
  pendingCount: number;
  runningCount: number;
  succeeded: number;
  degraded: number;
  failed: number;
  skipped: number;
  cancelledCount: number;
  status: string;
};

export function getAssistantFileDownloadUrl(
  fileRef: string,
  options?: { download?: boolean }
): string {
  const url = new URL(`/api/assistant-file/${encodeURIComponent(fileRef)}`, "https://persai.local");
  if (options?.download === true) {
    url.searchParams.set("download", "1");
  }
  return `${url.pathname}${url.search}`;
}

export function getAssistantAttachmentPreviewUrl(input: {
  fileRef: string | null;
  thumbnailFileRef?: string | null | undefined;
  posterFileRef?: string | null | undefined;
  attachmentType?: string | null | undefined;
}): string | null {
  if (input.attachmentType === "image" && typeof input.thumbnailFileRef === "string") {
    return getAssistantFileDownloadUrl(input.thumbnailFileRef);
  }
  if (input.attachmentType === "video" && typeof input.posterFileRef === "string") {
    return getAssistantFileDownloadUrl(input.posterFileRef);
  }
  if (typeof input.fileRef === "string") {
    return getAssistantFileDownloadUrl(input.fileRef);
  }
  return null;
}

export function getAssistantDocumentPptxPrepareUrl(
  docId: string,
  options: { versionId?: string | null }
): string {
  // Route through the Next.js BFF so Clerk cookie auth and the same-origin
  // session-token fallback stay browser-local. The API then enqueues a
  // separate user-confirmed PPTX render through the document job lane.
  const url = new URL(
    `/api/assistant-document/${encodeURIComponent(docId)}/prepare-pptx`,
    "https://persai.local"
  );
  if (typeof options.versionId === "string" && options.versionId.trim().length > 0) {
    url.searchParams.set("versionId", options.versionId.trim());
  }
  return `${url.pathname}${url.search}`;
}

export type UploadedAttachment = AssistantWebChatMessageAttachmentState & {
  messageId: string;
  chatId: string;
};

export type StagedAttachmentResult = {
  chatId: string;
  messageId: string;
  attachment: UploadedAttachment;
};

export type WebChatTurnStatus =
  | "unknown"
  | "accepted"
  | "running"
  | "completed"
  | "failed"
  | "interrupted";

export type WebChatTurnStatusState = {
  status: WebChatTurnStatus;
  chat: AssistantWebChatState | null;
  userMessage: ChatHistoryMessage | null;
  assistantMessage: ChatHistoryMessage | null;
  followUpAssistantMessage?: ChatHistoryMessage | null;
  currentActivity: WebChatTurnCurrentActivityState | null;
  runtime: AssistantWebChatRuntimeState | null;
  error: { code: string | null; message: string | null } | null;
};

export type WebChatActiveTurnState = {
  clientTurnId: string;
  status: "accepted" | "running";
  updatedAt: string;
  currentActivity: WebChatTurnCurrentActivityState | null;
  pendingUserMessageId: string | null;
  assistantMessageId: string | null;
  chat: AssistantWebChatState | null;
  userMessage: ChatHistoryMessage | null;
  assistantMessage: ChatHistoryMessage | null;
  canReattach: boolean;
};

export type WebChatActiveMediaJobState = AssistantWebChatActiveMediaJobState;

export type WebChatActiveDocumentJobState = {
  id: string;
  documentType: "pdf_document" | "presentation";
  descriptorMode:
    | "create_pdf_document"
    | "create_presentation"
    | "revise_document"
    | "export_or_redeliver";
  status: "queued" | "running" | "provider_processing" | "fetching_output" | "ready_for_delivery";
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
};

export type WebChatTurnCurrentActivityState = {
  type: "tool_use";
  toolName: string;
  toolCallId: string;
  phase: "start" | "end";
  isError: boolean;
  updatedAt: string;
};

export type UploadedKnowledgeSource = {
  id: string;
  namespace?: string;
  sourceKind?: string;
  displayName: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: "processing" | "ready" | "failed" | "needs_review";
  currentVersion: number;
  chunkCount: number;
  processorProviderKey?: string | null;
  processorMode?: "auto" | "local" | "default_provider" | "high_quality_fallback" | null;
  processingQuality?: Record<string, unknown> | null;
  lastIndexedAt: string | null;
  lastReindexRequestedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AssistantKnowledgeSourceListState = {
  quota: {
    usedBytes: number;
    limitBytes: number | null;
  };
  sources: UploadedKnowledgeSource[];
};

export type AssistantKnowledgeSourceInspectState = {
  sourceId: string;
  originalFilename: string;
  sizeBytes: number;
  chunkCount: number;
  textChars: number;
  firstChunkPreview: string | null;
  processorProviderKey: string | null;
  processorMode: "auto" | "local" | "default_provider" | "high_quality_fallback" | null;
  processingQuality: Record<string, unknown> | null;
  chunks: Array<{
    chunkIndex: number;
    contentPreview: string;
    looksLikeTocHeadingOnly: boolean;
  }>;
};

export type AdminKnowledgeSourceState = {
  id: string;
  scope: "product";
  displayName: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: "processing" | "ready" | "failed" | "needs_review";
  currentVersion: number;
  chunkCount: number;
  lastIndexedAt: string | null;
  lastReindexRequestedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminKnowledgeRetrievalMetricSummary = {
  searchesTotal: number;
  fetchesTotal: number;
  successTotal: number;
  emptyTotal: number;
  errorTotal: number;
  lexicalTotal: number;
  hybridTotal: number;
  helperAppliedTotal: number;
  embeddingQueryTotal: number;
  avgDurationMs: number;
  maxDurationMs: number;
  avgResultCount: number;
  avgLexicalCandidates: number;
  avgVectorCandidates: number;
  avgFetchDepth: number;
  maxFetchDepth: number;
  avgFetchedChars: number;
  maxFetchedChars: number;
  helperInputTokensTotal: number;
  helperOutputTokensTotal: number;
  helperTotalTokensTotal: number;
  emptyRate: number;
  errorRate: number;
  hybridRate: number;
  helperAppliedRate: number;
};

export type AdminKnowledgeRetrievalSourceSummary = AdminKnowledgeRetrievalMetricSummary & {
  source: "document" | "global" | "product" | "skill" | "memory" | "chat" | "subscription" | "web";
};

export type AdminKnowledgeRetrievalRecentSearch = {
  at: string;
  eventKind: "search" | "fetch";
  source: "document" | "global" | "product" | "skill" | "memory" | "chat" | "subscription" | "web";
  retrievalMode: "lexical" | "hybrid";
  outcome: "success" | "empty" | "error";
  durationMs: number;
  resultCount: number;
  lexicalCandidateCount: number;
  vectorCandidateCount: number;
  helperApplied: boolean;
  fetchDepth: number;
  fetchedChars: number;
  embeddingModelKey: string | null;
  helperModelKey: string | null;
  helperProviderKey: string | null;
  helperTotalTokens: number | null;
  errorCode: string | null;
};

export type AdminKnowledgeObservabilityState = {
  updatedAt: string | null;
  totals: AdminKnowledgeRetrievalMetricSummary;
  bySource: AdminKnowledgeRetrievalSourceSummary[];
  recent: AdminKnowledgeRetrievalRecentSearch[];
};

export type AdminKnowledgeRetrievalPolicyState = {
  schema: "persai.adminKnowledgeRetrievalPolicy.v1";
  embeddingModelKey: string | null;
  retrievalModelKey: string | null;
  authoringModelKey: string | null;
  /**
   * ADR-094 — admin-owned hard ceilings and the "form of response" toggle for
   * the smart `knowledge_search` and the flexible `knowledge_fetch`. Per-plan
   * volume values live separately in `billingHints.retrievalPolicy` and are
   * capped by these ceilings at runtime.
   */
  smartSearchEnabled: boolean;
  smartSearchLongDocSummaryChars: number;
  fetchFullModeAbsoluteMaxChars: number;
  fetchFullModeAbsoluteMaxChatMessages: number;
  embeddingChangeImpact: {
    fromEmbeddingModelKey: string | null;
    toEmbeddingModelKey: string | null;
    requiresDangerousConfirmation: boolean;
    vectorSearchWillBeDisabled: boolean;
    alreadyIndexedSourceCount: number;
    affectedSourceCount: number;
    affectedChunkCount: number;
    affectedBytes: number;
    sources: Array<{
      sourceType:
        | "assistant_knowledge_source"
        | "global_knowledge_source"
        | "product_knowledge_text_entry"
        | "skill_document"
        | "skill_knowledge_card";
      label: string;
      affectedSourceCount: number;
      totalChunks: number;
      totalBytes: number;
    }>;
  } | null;
  notes: string[];
};

export type AdminKnowledgeEmbeddingChangeImpactState = NonNullable<
  AdminKnowledgeRetrievalPolicyState["embeddingChangeImpact"]
>;

export type SkillAuthoringDraftKnowledgeCardProposal = {
  title: string;
  body: string;
  locale: string | null;
  tags: string[];
  lifecycleStatus: "draft";
  provenanceKind: "assistant_generated";
};

export type SkillAuthoringDraftProposalState = {
  schema: "persai.skillAuthoringDraftProposal.v1";
  providerKey: "openai" | "anthropic";
  modelKey: string;
  generatedAt: string;
  skillDraft: Partial<AdminSkillUpsertRequest>;
  knowledgeCards: SkillAuthoringDraftKnowledgeCardProposal[];
  warnings: string[];
};

export type AssistantFileState = {
  fileRef: string;
  origin: "uploaded_attachment" | "runtime_output" | "sandbox_output";
  displayName: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  logicalSizeBytes: number | null;
  fileBucket: "user_files" | "assistant_created" | "documents" | "media_uploads" | "cache_history";
  cleanupEligible: boolean;
  cleanupReason: "voice_upload_cache" | null;
  documentLink?: AssistantFileDocumentLink | null;
  createdAt: string;
};

export type AssistantFileDocumentLink = {
  docId: string;
  versionId: string;
  versionNumber: number | null;
  descriptorMode: string | null;
  documentType: string | null;
  documentStatus: string | null;
  versionStatus: string | null;
  isCurrentOutput: boolean;
};

export type { AssistantFilesCleanupSummary };

export type AssistantFilesCleanupResult = AssistantFilesCleanupSummary & {
  deletedCount: number;
  deletedBytes: number;
  skippedPinnedCount?: number;
};

export type AdminKnowledgeConnectorState = {
  kind: "google_drive" | "yandex_disk" | "mailru_cloud";
  label: string;
  status: "planned";
  authMode: "oauth_deferred";
  targetScope: "product";
  syncMode: "pull_snapshot_then_index";
  storageTarget: "persai_owned_object_storage";
  indexingTarget: "knowledge_indexing_service";
  supportsScopes: Array<"product">;
  pipeline: string[];
  notes: string[];
};

export interface UploadResilienceOptions {
  signal?: AbortSignal;
  onProgress?: (progress: XhrUploadProgress) => void;
  /** Abort the upload if no upload-progress event fires within this many ms. */
  stallTimeoutMs?: number;
  /** Hard upper bound (ms) for the entire upload (covers slow-but-progressing too). */
  hardTimeoutMs?: number;
}

function toXhrOptions(token: string, opts?: UploadResilienceOptions): XhrUploadOptions {
  return {
    authToken: token,
    ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
    ...(opts?.onProgress !== undefined ? { onProgress: opts.onProgress } : {}),
    ...(opts?.stallTimeoutMs !== undefined ? { stallTimeoutMs: opts.stallTimeoutMs } : {}),
    ...(opts?.hardTimeoutMs !== undefined ? { hardTimeoutMs: opts.hardTimeoutMs } : {})
  };
}

export async function stageWebChatAttachment(
  token: string,
  surfaceThreadKey: string,
  clientTurnId: string,
  clientAttachmentId: string,
  file: File,
  opts?: UploadResilienceOptions
): Promise<StagedAttachmentResult> {
  const base = getApiBaseUrl();
  const formData = new FormData();
  formData.append("surfaceThreadKey", surfaceThreadKey);
  formData.append("clientTurnId", clientTurnId);
  formData.append("clientAttachmentId", clientAttachmentId);
  formData.append("file", file);
  const res = await uploadWithProgress(
    `${base}/assistant/chat/web/stage-attachment`,
    formData,
    toXhrOptions(token, opts)
  );
  if (!res.ok) {
    const envelope = readXhrErrorEnvelope(res.responseText, res.headers.get("content-type") ?? "");
    if (envelope) {
      throw new ApiStructuredError(envelope.message, envelope.code, envelope.details);
    }
    throw new Error("Failed to stage attachment.");
  }
  return JSON.parse(res.responseText) as StagedAttachmentResult;
}

export async function getAssistantWebChatTurnStatus(
  token: string,
  clientTurnId: string
): Promise<WebChatTurnStatusState> {
  const response = await fetch(
    `${getApiBaseUrl()}/assistant/chat/web/turns/${encodeURIComponent(clientTurnId)}`,
    {
      headers: getAuthHeaders(token)
    }
  );
  if (!response.ok) {
    const envelope = await readApiErrorEnvelope(response);
    if (envelope) {
      throw new ApiStructuredError(envelope.message, envelope.code, envelope.details);
    }
    throw new Error("Failed to read web chat turn status.");
  }
  const payload = (await response.json()) as { turn: WebChatTurnStatusState };
  return payload.turn;
}

export async function getAssistantFiles(
  token: string,
  options?: { query?: string | null; limit?: number }
): Promise<{ files: AssistantFileState[]; cleanup: AssistantFilesCleanupSummary }> {
  const base = getApiBaseUrl();
  const params = new URLSearchParams();
  const query = options?.query?.trim();
  if (query) {
    params.set("q", query);
  }
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const qs = params.toString();
  const res = await fetch(`${base}/assistant/files${qs ? `?${qs}` : ""}`, {
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to load assistant files."));
  }
  const data = (await res.json()) as {
    files: AssistantFileState[];
    cleanup?: AssistantFilesCleanupSummary;
  };
  return {
    files: data.files,
    cleanup: data.cleanup ?? { eligibleCount: 0, eligibleBytes: 0 }
  };
}

export async function cleanupAssistantFilesCache(
  token: string
): Promise<AssistantFilesCleanupResult> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/assistant/files/cleanup-cache`, {
    method: "POST",
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to clean assistant file cache."));
  }
  const data = (await res.json()) as { cleanup: AssistantFilesCleanupResult };
  return data.cleanup;
}

export async function patchAssistantFileDisplayName(
  token: string,
  fileRef: string,
  displayName: string
): Promise<AssistantFileState> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/assistant/files/${encodeURIComponent(fileRef)}`, {
    method: "PATCH",
    headers: { ...getAuthHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ displayName })
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to rename assistant file."));
  }
  const data = (await res.json()) as { file: AssistantFileState };
  return data.file;
}

export async function deleteAssistantFile(token: string, fileRef: string): Promise<void> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/assistant/files/${encodeURIComponent(fileRef)}`, {
    method: "DELETE",
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to delete assistant file."));
  }
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
  return data.source;
}

export async function getAssistantKnowledgeSources(
  token: string
): Promise<AssistantKnowledgeSourceListState> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/assistant/knowledge-sources`, {
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to load knowledge sources."));
  }
  const data = (await res.json()) as AssistantKnowledgeSourceListState;
  return {
    quota: data.quota ?? { usedBytes: 0, limitBytes: null },
    sources: data.sources ?? []
  };
}

export async function deleteAssistantKnowledgeSource(
  token: string,
  sourceId: string
): Promise<void> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/assistant/knowledge-sources/${encodeURIComponent(sourceId)}`, {
    method: "DELETE",
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to delete knowledge source."));
  }
}

export async function reindexAssistantKnowledgeSource(
  token: string,
  sourceId: string
): Promise<UploadedKnowledgeSource> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/assistant/knowledge-sources/${encodeURIComponent(sourceId)}/reindex`,
    {
      method: "POST",
      headers: getAuthHeaders(token)
    }
  );
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to reindex knowledge source."));
  }
  const data = (await res.json()) as { source?: UploadedKnowledgeSource };
  if (!data.source) {
    throw new Error("Knowledge source reindex returned an unexpected response.");
  }
  return data.source;
}

export async function inspectAssistantKnowledgeSource(
  token: string,
  sourceId: string
): Promise<AssistantKnowledgeSourceInspectState> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/assistant/knowledge-sources/${encodeURIComponent(sourceId)}/inspect`,
    {
      headers: getAuthHeaders(token)
    }
  );
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to inspect knowledge source."));
  }
  const data = (await res.json()) as { inspect?: AssistantKnowledgeSourceInspectState };
  if (!data.inspect) {
    throw new Error("Knowledge source inspect returned an unexpected response.");
  }
  return data.inspect;
}

export async function getAdminKnowledgeSources(
  token: string,
  scope: "product"
): Promise<AdminKnowledgeSourceState[]> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/knowledge-sources?scope=${encodeURIComponent(scope)}`, {
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to load admin knowledge sources."));
  }
  const data = (await res.json()) as { sources?: AdminKnowledgeSourceState[] };
  return data.sources ?? [];
}

export async function getAdminKnowledgeObservability(
  token: string
): Promise<AdminKnowledgeObservabilityState> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/knowledge-sources/observability`, {
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(
      await readJsonErrorMessage(res, "Failed to load admin knowledge observability.")
    );
  }
  const data = (await res.json()) as { observability?: AdminKnowledgeObservabilityState };
  return (
    data.observability ?? {
      updatedAt: null,
      totals: {
        searchesTotal: 0,
        fetchesTotal: 0,
        successTotal: 0,
        emptyTotal: 0,
        errorTotal: 0,
        lexicalTotal: 0,
        hybridTotal: 0,
        helperAppliedTotal: 0,
        embeddingQueryTotal: 0,
        avgDurationMs: 0,
        maxDurationMs: 0,
        avgResultCount: 0,
        avgLexicalCandidates: 0,
        avgVectorCandidates: 0,
        avgFetchDepth: 0,
        maxFetchDepth: 0,
        avgFetchedChars: 0,
        maxFetchedChars: 0,
        helperInputTokensTotal: 0,
        helperOutputTokensTotal: 0,
        helperTotalTokensTotal: 0,
        emptyRate: 0,
        errorRate: 0,
        hybridRate: 0,
        helperAppliedRate: 0
      },
      bySource: [],
      recent: []
    }
  );
}

export async function getAdminKnowledgeRetrievalPolicy(
  token: string
): Promise<AdminKnowledgeRetrievalPolicyState> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/knowledge-sources/retrieval-policy`, {
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to load admin retrieval policy."));
  }
  const data = (await res.json()) as { policy?: AdminKnowledgeRetrievalPolicyState };
  return (
    data.policy ?? {
      schema: "persai.adminKnowledgeRetrievalPolicy.v1",
      embeddingModelKey: null,
      retrievalModelKey: null,
      authoringModelKey: null,
      smartSearchEnabled: true,
      smartSearchLongDocSummaryChars: 800,
      fetchFullModeAbsoluteMaxChars: 100_000,
      fetchFullModeAbsoluteMaxChatMessages: 800,
      embeddingChangeImpact: null,
      notes: []
    }
  );
}

export async function updateAdminKnowledgeRetrievalPolicy(
  token: string,
  input: {
    embeddingModelKey: string | null;
    retrievalModelKey: string | null;
    authoringModelKey: string | null;
    smartSearchEnabled: boolean;
    smartSearchLongDocSummaryChars: number;
    fetchFullModeAbsoluteMaxChars: number;
    fetchFullModeAbsoluteMaxChatMessages: number;
  },
  options?: { stepUpToken?: string | null }
): Promise<AdminKnowledgeRetrievalPolicyState> {
  const base = getApiBaseUrl();
  const stepUpToken = options?.stepUpToken?.trim() || null;
  const res = await fetch(`${base}/admin/knowledge-sources/retrieval-policy`, {
    method: "POST",
    headers: {
      ...getAuthHeaders(token),
      "Content-Type": "application/json",
      ...(stepUpToken !== null ? { "x-persai-step-up-token": stepUpToken } : {})
    },
    body: JSON.stringify(input)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to save admin retrieval policy."));
  }
  const data = (await res.json()) as { policy?: AdminKnowledgeRetrievalPolicyState };
  if (data.policy === undefined) {
    throw new Error("Admin retrieval policy response is missing policy.");
  }
  return data.policy;
}

export async function previewAdminKnowledgeEmbeddingChange(
  token: string,
  input: { embeddingModelKey: string | null }
): Promise<AdminKnowledgeEmbeddingChangeImpactState> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/admin/knowledge-sources/retrieval-policy/embedding-change-preview`,
    {
      method: "POST",
      headers: { ...getAuthHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  );
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to preview embedding model change."));
  }
  const data = (await res.json()) as { impact?: AdminKnowledgeEmbeddingChangeImpactState };
  if (data.impact === undefined) {
    throw new Error("Embedding model impact response is missing impact.");
  }
  return data.impact;
}

export async function getAdminKnowledgeConnectors(
  token: string,
  scope: "product"
): Promise<AdminKnowledgeConnectorState[]> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/admin/knowledge-sources/connectors?scope=${encodeURIComponent(scope)}`,
    {
      headers: getAuthHeaders(token)
    }
  );
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to load knowledge connectors."));
  }
  const data = (await res.json()) as { connectors?: AdminKnowledgeConnectorState[] };
  return data.connectors ?? [];
}

export async function uploadAdminKnowledgeSource(
  token: string,
  scope: "product",
  file: File,
  options?: { displayName?: string | null | undefined }
): Promise<AdminKnowledgeSourceState> {
  const base = getApiBaseUrl();
  const formData = new FormData();
  const displayName = options?.displayName?.trim();
  if (displayName) {
    formData.append("displayName", displayName);
  }
  formData.append("file", file);
  const res = await fetch(`${base}/admin/knowledge-sources/${encodeURIComponent(scope)}`, {
    method: "POST",
    headers: getAuthHeaders(token),
    body: formData
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to upload admin knowledge source."));
  }
  const data = (await res.json()) as { source?: AdminKnowledgeSourceState };
  if (!data.source) {
    throw new Error("Admin knowledge source upload returned an unexpected response.");
  }
  return data.source;
}

export async function deleteAdminKnowledgeSource(token: string, sourceId: string): Promise<void> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/knowledge-sources/${encodeURIComponent(sourceId)}`, {
    method: "DELETE",
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to delete admin knowledge source."));
  }
}

export async function reindexAdminKnowledgeSource(
  token: string,
  sourceId: string
): Promise<AdminKnowledgeSourceState> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/admin/knowledge-sources/${encodeURIComponent(sourceId)}/reindex`,
    {
      method: "POST",
      headers: getAuthHeaders(token)
    }
  );
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to reindex admin knowledge source."));
  }
  const data = (await res.json()) as { source?: AdminKnowledgeSourceState };
  if (!data.source) {
    throw new Error("Admin knowledge source reindex returned an unexpected response.");
  }
  return data.source;
}

export type {
  AssistantSkillCatalogItemState,
  AdminSkillState,
  AdminSkillUpsertRequest,
  GetAssistantSkillsResponse as AssistantSkillsState,
  KnowledgeIndexingJobState,
  ProductKnowledgeTextEntryInput,
  ProductKnowledgeTextEntryState,
  SkillKnowledgeCardInput,
  SkillKnowledgeCardState,
  SkillDocumentState
};

export async function getAdminProductKnowledgeTextEntries(
  token: string
): Promise<ProductKnowledgeTextEntryState[]> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/knowledge-sources/product/text-entries`, {
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to load Product KB text entries."));
  }
  const data = (await res.json()) as { entries?: ProductKnowledgeTextEntryState[] };
  return data.entries ?? [];
}

export async function createAdminProductKnowledgeTextEntry(
  token: string,
  payload: ProductKnowledgeTextEntryInput
): Promise<{
  entry: ProductKnowledgeTextEntryState;
  indexingJob: KnowledgeIndexingJobState | null;
}> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/knowledge-sources/product/text-entries`, {
    method: "POST",
    headers: {
      ...getAuthHeaders(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to create Product KB text entry."));
  }
  const data = (await res.json()) as {
    entry?: ProductKnowledgeTextEntryState;
    indexingJob?: KnowledgeIndexingJobState | null;
  };
  if (!data.entry) {
    throw new Error("Product KB text entry create returned an unexpected response.");
  }
  return { entry: data.entry, indexingJob: data.indexingJob ?? null };
}

export async function updateAdminProductKnowledgeTextEntry(
  token: string,
  entryId: string,
  payload: ProductKnowledgeTextEntryInput
): Promise<{
  entry: ProductKnowledgeTextEntryState;
  indexingJob: KnowledgeIndexingJobState | null;
}> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/admin/knowledge-sources/product/text-entries/${encodeURIComponent(entryId)}`,
    {
      method: "PATCH",
      headers: {
        ...getAuthHeaders(token),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to update Product KB text entry."));
  }
  const data = (await res.json()) as {
    entry?: ProductKnowledgeTextEntryState;
    indexingJob?: KnowledgeIndexingJobState | null;
  };
  if (!data.entry) {
    throw new Error("Product KB text entry update returned an unexpected response.");
  }
  return { entry: data.entry, indexingJob: data.indexingJob ?? null };
}

export async function archiveAdminProductKnowledgeTextEntry(
  token: string,
  entryId: string
): Promise<void> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/admin/knowledge-sources/product/text-entries/${encodeURIComponent(entryId)}`,
    {
      method: "DELETE",
      headers: getAuthHeaders(token)
    }
  );
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to archive Product KB text entry."));
  }
}

export async function reindexAdminProductKnowledgeTextEntry(
  token: string,
  entryId: string
): Promise<{
  entry: ProductKnowledgeTextEntryState;
  indexingJob: KnowledgeIndexingJobState | null;
}> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/admin/knowledge-sources/product/text-entries/${encodeURIComponent(entryId)}/reindex`,
    {
      method: "POST",
      headers: getAuthHeaders(token)
    }
  );
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to reindex Product KB text entry."));
  }
  const data = (await res.json()) as {
    entry?: ProductKnowledgeTextEntryState;
    indexingJob?: KnowledgeIndexingJobState | null;
  };
  if (!data.entry) {
    throw new Error("Product KB text entry reindex returned an unexpected response.");
  }
  return { entry: data.entry, indexingJob: data.indexingJob ?? null };
}

export async function getAssistantSkills(token: string): Promise<GetAssistantSkillsResponse> {
  const response = await getAssistantSkillsContract({
    headers: getAuthHeaders(token)
  });
  if (
    !isSuccessStatus(response.status) ||
    typeof response.data !== "object" ||
    response.data === null ||
    !("skills" in response.data) ||
    !("assignedSkillIds" in response.data)
  ) {
    throw new Error("Unexpected non-success response for GET /assistant/skills.");
  }
  return response.data;
}

export async function updateAssistantSkillAssignments(
  token: string,
  payload: PutAssistantSkillAssignmentsRequest
): Promise<GetAssistantSkillsResponse> {
  const response = await putAssistantSkillAssignmentsContract(payload, {
    headers: getAuthHeaders(token)
  });
  if (
    !isSuccessStatus(response.status) ||
    typeof response.data !== "object" ||
    response.data === null ||
    !("skills" in response.data) ||
    !("assignedSkillIds" in response.data)
  ) {
    throw new Error("Unexpected non-success response for PUT /assistant/skills.");
  }
  return response.data;
}

export async function getAdminSkills(token: string): Promise<AdminSkillState[]> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/skills`, {
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to load admin Skills."));
  }
  const data = (await res.json()) as { skills?: AdminSkillState[] };
  return data.skills ?? [];
}

export async function createAdminSkill(
  token: string,
  payload: AdminSkillUpsertRequest
): Promise<AdminSkillState> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/skills`, {
    method: "POST",
    headers: {
      ...getAuthHeaders(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to create Skill."));
  }
  const data = (await res.json()) as { skill?: AdminSkillState };
  if (!data.skill) {
    throw new Error("Skill create returned an unexpected response.");
  }
  return data.skill;
}

export async function updateAdminSkill(
  token: string,
  skillId: string,
  payload: AdminSkillUpsertRequest
): Promise<AdminSkillState> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/skills/${encodeURIComponent(skillId)}`, {
    method: "PATCH",
    headers: {
      ...getAuthHeaders(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to update Skill."));
  }
  const data = (await res.json()) as { skill?: AdminSkillState };
  if (!data.skill) {
    throw new Error("Skill update returned an unexpected response.");
  }
  return data.skill;
}

export async function archiveAdminSkill(token: string, skillId: string): Promise<void> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/skills/${encodeURIComponent(skillId)}`, {
    method: "DELETE",
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to archive Skill."));
  }
}

export async function uploadAdminSkillDocument(
  token: string,
  skillId: string,
  file: File,
  options?: { displayName?: string | null; description?: string | null }
): Promise<{ document: SkillDocumentState; indexingJob: KnowledgeIndexingJobState }> {
  const base = getApiBaseUrl();
  const formData = new FormData();
  const displayName = options?.displayName?.trim();
  const description = options?.description?.trim();
  if (displayName) {
    formData.append("displayName", displayName);
  }
  if (description) {
    formData.append("description", description);
  }
  formData.append("file", file);
  const res = await fetch(`${base}/admin/skills/${encodeURIComponent(skillId)}/documents`, {
    method: "POST",
    headers: getAuthHeaders(token),
    body: formData
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to upload Skill document."));
  }
  const data = (await res.json()) as {
    document?: SkillDocumentState;
    indexingJob?: KnowledgeIndexingJobState;
  };
  if (!data.document || !data.indexingJob) {
    throw new Error("Skill document upload returned an unexpected response.");
  }
  return { document: data.document, indexingJob: data.indexingJob };
}

export async function deleteAdminSkillDocument(
  token: string,
  skillId: string,
  documentId: string
): Promise<void> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/admin/skills/${encodeURIComponent(skillId)}/documents/${encodeURIComponent(documentId)}`,
    {
      method: "DELETE",
      headers: getAuthHeaders(token)
    }
  );
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to delete Skill document."));
  }
}

export async function reindexAdminSkillDocument(
  token: string,
  skillId: string,
  documentId: string
): Promise<{ document: SkillDocumentState; indexingJob: KnowledgeIndexingJobState }> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/admin/skills/${encodeURIComponent(skillId)}/documents/${encodeURIComponent(documentId)}/reindex`,
    {
      method: "POST",
      headers: getAuthHeaders(token)
    }
  );
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to reindex Skill document."));
  }
  const data = (await res.json()) as {
    document?: SkillDocumentState;
    indexingJob?: KnowledgeIndexingJobState;
  };
  if (!data.document || !data.indexingJob) {
    throw new Error("Skill document reindex returned an unexpected response.");
  }
  return { document: data.document, indexingJob: data.indexingJob };
}

export async function generateAdminSkillAuthoringDraft(
  token: string,
  skillId: string,
  payload: {
    prompt: string | null;
    currentDraft: Partial<AdminSkillUpsertRequest> | null;
  }
): Promise<SkillAuthoringDraftProposalState> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/skills/${encodeURIComponent(skillId)}/authoring/draft`, {
    method: "POST",
    headers: {
      ...getAuthHeaders(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to generate Skill draft."));
  }
  const data = (await res.json()) as { proposal?: SkillAuthoringDraftProposalState };
  if (!data.proposal) {
    throw new Error("Skill authoring draft returned an unexpected response.");
  }
  return data.proposal;
}

export async function createAdminSkillKnowledgeCard(
  token: string,
  skillId: string,
  payload: SkillKnowledgeCardInput
): Promise<{ card: SkillKnowledgeCardState; indexingJob: KnowledgeIndexingJobState | null }> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/skills/${encodeURIComponent(skillId)}/knowledge-cards`, {
    method: "POST",
    headers: {
      ...getAuthHeaders(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to create Skill knowledge card."));
  }
  const data = (await res.json()) as {
    card?: SkillKnowledgeCardState;
    indexingJob?: KnowledgeIndexingJobState | null;
  };
  if (!data.card) {
    throw new Error("Skill knowledge card create returned an unexpected response.");
  }
  return { card: data.card, indexingJob: data.indexingJob ?? null };
}

export async function updateAdminSkillKnowledgeCard(
  token: string,
  skillId: string,
  cardId: string,
  payload: SkillKnowledgeCardInput
): Promise<{ card: SkillKnowledgeCardState; indexingJob: KnowledgeIndexingJobState | null }> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/admin/skills/${encodeURIComponent(skillId)}/knowledge-cards/${encodeURIComponent(cardId)}`,
    {
      method: "PATCH",
      headers: {
        ...getAuthHeaders(token),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to update Skill knowledge card."));
  }
  const data = (await res.json()) as {
    card?: SkillKnowledgeCardState;
    indexingJob?: KnowledgeIndexingJobState | null;
  };
  if (!data.card) {
    throw new Error("Skill knowledge card update returned an unexpected response.");
  }
  return { card: data.card, indexingJob: data.indexingJob ?? null };
}

export async function archiveAdminSkillKnowledgeCard(
  token: string,
  skillId: string,
  cardId: string
): Promise<void> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/admin/skills/${encodeURIComponent(skillId)}/knowledge-cards/${encodeURIComponent(cardId)}`,
    {
      method: "DELETE",
      headers: getAuthHeaders(token)
    }
  );
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to archive Skill knowledge card."));
  }
}

export async function reindexAdminSkillKnowledgeCard(
  token: string,
  skillId: string,
  cardId: string
): Promise<{ card: SkillKnowledgeCardState; indexingJob: KnowledgeIndexingJobState | null }> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/admin/skills/${encodeURIComponent(skillId)}/knowledge-cards/${encodeURIComponent(cardId)}/reindex`,
    {
      method: "POST",
      headers: getAuthHeaders(token)
    }
  );
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to reindex Skill knowledge card."));
  }
  const data = (await res.json()) as {
    card?: SkillKnowledgeCardState;
    indexingJob?: KnowledgeIndexingJobState | null;
  };
  if (!data.card) {
    throw new Error("Skill knowledge card reindex returned an unexpected response.");
  }
  return { card: data.card, indexingJob: data.indexingJob ?? null };
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
  filename: string,
  opts?: UploadResilienceOptions
): Promise<string> {
  const base = getApiBaseUrl();
  const formData = new FormData();
  formData.append("file", audioBlob, filename);
  const res = await uploadWithProgress(
    `${base}/assistant/voice/transcribe`,
    formData,
    toXhrOptions(token, opts)
  );
  if (!res.ok) {
    let message = "Voice transcription failed.";
    let code: string | null = null;
    try {
      const body = JSON.parse(res.responseText) as unknown;
      if (typeof body === "object" && body !== null) {
        const record = body as Record<string, unknown>;
        const directMessage = record.message;
        if (typeof directMessage === "string" && directMessage.trim().length > 0) {
          message = directMessage;
        }
        const directCode = record.code;
        if (typeof directCode === "string" && directCode.trim().length > 0) {
          code = directCode;
        }
        const nestedError =
          typeof record.error === "object" && record.error !== null
            ? (record.error as Record<string, unknown>)
            : null;
        if (nestedError) {
          const nestedMessage = nestedError.message;
          if (typeof nestedMessage === "string" && nestedMessage.trim().length > 0) {
            message = nestedMessage;
          }
          const nestedCode = nestedError.code;
          if (typeof nestedCode === "string" && nestedCode.trim().length > 0) {
            code = nestedCode;
          }
        }
      }
    } catch {
      /* keep default message */
    }
    throw code ? { code, message } : new Error(message);
  }
  const data = JSON.parse(res.responseText) as { text: string };
  return data.text;
}

export type SupportTicketStatus = "open" | "pending" | "answered" | "closed";

export type SupportTicketAttachment = {
  id: string;
  mimeType: string;
  fileName: string | null;
  sizeBytes: number;
  createdAt: string;
};

export type SupportTicketSummary = {
  id: string;
  shortId: string;
  status: SupportTicketStatus;
  subject: string | null;
  preview: string;
  createdAt: string;
  updatedAt: string;
  answeredAt: string | null;
  closedAt: string | null;
  hasUnread: boolean;
  userEmail?: string;
};

export type SupportTicketMessage = {
  id: string;
  author: "user" | "admin" | "system";
  body: string;
  createdAt: string;
  adminDisplayName: string | null;
  attachments: SupportTicketAttachment[];
};

export type SupportTicketDetail = SupportTicketSummary & {
  assistantId: string;
  workspaceId: string;
  userId: string;
  userEmail: string;
  assistantDisplayName: string | null;
  messages: SupportTicketMessage[];
};

export function getSupportAttachmentUrl(attachmentId: string): string {
  return `/api/support-attachment/${encodeURIComponent(attachmentId)}`;
}

export function getAdminSupportAttachmentUrl(attachmentId: string): string {
  return `/api/admin-support-attachment/${encodeURIComponent(attachmentId)}`;
}

export async function postAssistantSupportTicket(
  token: string,
  payload: {
    assistantId: string;
    body: string;
    subject: string | null;
    attachment?: File | null;
  }
): Promise<SupportTicketDetail> {
  const base = getApiBaseUrl();
  const form = new FormData();
  form.set("assistantId", payload.assistantId);
  form.set("body", payload.body);
  if (payload.subject) {
    form.set("subject", payload.subject);
  }
  if (payload.attachment) {
    form.set("attachment", payload.attachment);
  }
  const res = await fetch(`${base}/support/tickets`, {
    method: "POST",
    headers: getAuthHeaders(token),
    body: form
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to create support ticket."));
  }
  const data = (await res.json()) as { ticket?: SupportTicketDetail };
  if (!data.ticket) throw new Error("Support ticket response missing ticket.");
  return data.ticket;
}

export async function getAssistantSupportTickets(
  token: string,
  assistantId: string
): Promise<SupportTicketSummary[]> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/support/assistants/${encodeURIComponent(assistantId)}/tickets`, {
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to load support tickets."));
  }
  const data = (await res.json()) as { tickets?: SupportTicketSummary[] };
  return data.tickets ?? [];
}

export async function getAssistantSupportTicket(
  token: string,
  ticketId: string
): Promise<SupportTicketDetail> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/support/tickets/${encodeURIComponent(ticketId)}`, {
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to load support ticket."));
  }
  const data = (await res.json()) as { ticket?: SupportTicketDetail };
  if (!data.ticket) throw new Error("Support ticket response missing ticket.");
  return data.ticket;
}

export async function postAssistantSupportTicketRead(
  token: string,
  ticketId: string
): Promise<SupportTicketDetail> {
  const encodedTicketId = encodeURIComponent(ticketId);
  const res =
    typeof window !== "undefined"
      ? await fetch(`/api/support-ticket/${encodedTicketId}/read`, {
          method: "POST",
          credentials: "include",
          headers: {
            "x-persai-session-token": token
          }
        })
      : await fetch(`${getApiBaseUrl()}/support/tickets/${encodedTicketId}/read`, {
          method: "POST",
          headers: getAuthHeaders(token)
        });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to mark support ticket read."));
  }
  const data = (await res.json()) as { ticket?: SupportTicketDetail };
  if (!data.ticket) throw new Error("Support ticket read response missing ticket.");
  return data.ticket;
}

export async function getAdminSupportTickets(
  token: string,
  params?: { status?: string; limit?: number }
): Promise<SupportTicketSummary[]> {
  const base = getApiBaseUrl();
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.limit) query.set("limit", String(params.limit));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const res = await fetch(`${base}/admin/support/tickets${suffix}`, {
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to load admin support tickets."));
  }
  const data = (await res.json()) as { tickets?: SupportTicketSummary[] };
  return data.tickets ?? [];
}

export async function getAdminSupportTicket(
  token: string,
  ticketId: string
): Promise<SupportTicketDetail> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/support/tickets/${encodeURIComponent(ticketId)}`, {
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to load admin support ticket."));
  }
  const data = (await res.json()) as { ticket?: SupportTicketDetail };
  if (!data.ticket) throw new Error("Support ticket response missing ticket.");
  return data.ticket;
}

export async function postAdminSupportTicketReply(
  token: string,
  ticketId: string,
  body: string
): Promise<SupportTicketDetail> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/support/tickets/${encodeURIComponent(ticketId)}/reply`, {
    method: "POST",
    headers: { ...getAuthHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ body })
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to send support reply."));
  }
  const data = (await res.json()) as { ticket?: SupportTicketDetail };
  if (!data.ticket) throw new Error("Support reply response missing ticket.");
  return data.ticket;
}

export async function postAdminSupportTicketPending(
  token: string,
  ticketId: string
): Promise<SupportTicketDetail> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/support/tickets/${encodeURIComponent(ticketId)}/pending`, {
    method: "POST",
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to mark ticket pending."));
  }
  const data = (await res.json()) as { ticket?: SupportTicketDetail };
  if (!data.ticket) throw new Error("Support pending response missing ticket.");
  return data.ticket;
}

export async function postAdminSupportTicketClose(
  token: string,
  ticketId: string
): Promise<SupportTicketDetail> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/support/tickets/${encodeURIComponent(ticketId)}/close`, {
    method: "POST",
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(await readJsonErrorMessage(res, "Failed to close support ticket."));
  }
  const data = (await res.json()) as { ticket?: SupportTicketDetail };
  if (!data.ticket) throw new Error("Support close response missing ticket.");
  return data.ticket;
}

// ── ADR-109 Slice 9 — video persona + voice catalog API client ──────────────

export type PersonaListItemDto = {
  id: string;
  displayName: string;
  portraitImageUrl: string;
  videoFormat: "16:9" | "9:16" | "1:1";
  heygenVoiceId: string;
  heygenVoiceLabel: string;
  clonedVoiceId: string | null;
  clonedVoiceDisplayName: string | null;
  createdAt: string;
};

export type PersonaListResponse = {
  personas: PersonaListItemDto[];
  limit: number;
  creationVcoinCost: number;
};

export type VoiceCatalogEntry = {
  catalogId?: string | null;
  voiceId: string;
  name: string;
  language: string | null;
  gender: string;
  previewAudioUrl: string | null;
  languageBucket?: "ru" | "en" | "other" | null;
  source?: "heygen" | "elevenlabs" | "gemini" | "unknown" | null;
  qualityTags?: Array<"professional" | "natural" | "lifelike"> | null;
  qualityRank?: number | null;
  previewAvailable?: boolean | null;
  localeControl?: boolean | null;
  pauseSupport?: boolean | null;
};

export type VoiceCatalogResponse = {
  provider: "heygen";
  voices: VoiceCatalogEntry[];
};

export type WorkspaceVideoClonedVoiceDto = {
  id: string;
  displayName: string;
  status: "pending" | "ready" | "failed";
  languageHint: string | null;
  isDefault: boolean;
  previewAudioUrl: string | null;
  createdAt: string;
};

export type WorkspaceVideoClonedVoiceListResponse = {
  clonedVoices: WorkspaceVideoClonedVoiceDto[];
  limit: number;
  creationVcoinCost: number;
};

export async function getWorkspaceVideoClonedVoices(
  token: string,
  workspaceId: string
): Promise<WorkspaceVideoClonedVoiceListResponse> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/workspaces/${encodeURIComponent(workspaceId)}/video-cloned-voices`,
    {
      headers: getAuthHeaders(token)
    }
  );
  if (!res.ok) {
    const envelope = await readApiErrorEnvelope(res);
    if (envelope) throw new ApiStructuredError(envelope.message, envelope.code, envelope.details);
    throw new Error("Failed to load cloned voices.");
  }
  return res.json() as Promise<WorkspaceVideoClonedVoiceListResponse>;
}

export async function createWorkspaceVideoClonedVoice(
  token: string,
  workspaceId: string,
  payload: {
    displayName: string;
    audio: File;
    languageHint?: string | null;
    removeBackgroundNoise?: boolean;
  },
  opts?: UploadResilienceOptions
): Promise<{
  clonedVoice: WorkspaceVideoClonedVoiceDto;
  walletBalanceVc: number;
}> {
  const base = getApiBaseUrl();
  const form = new FormData();
  form.set("displayName", payload.displayName);
  form.set("audio", payload.audio);
  if (typeof payload.languageHint === "string" && payload.languageHint.trim().length > 0) {
    form.set("languageHint", payload.languageHint.trim());
  }
  if (payload.removeBackgroundNoise === true) {
    form.set("removeBackgroundNoise", "true");
  }
  const res = await uploadWithProgress(
    `${base}/workspaces/${encodeURIComponent(workspaceId)}/video-cloned-voices`,
    form,
    toXhrOptions(token, opts)
  );
  if (!res.ok) {
    const envelope = readXhrErrorEnvelope(res.responseText, res.headers.get("content-type") ?? "");
    if (envelope) {
      throw new ApiStructuredError(envelope.message, envelope.code, envelope.details);
    }
    throw new ApiStructuredError("Cloned voice creation failed", "create_failed");
  }
  return JSON.parse(res.responseText) as {
    clonedVoice: WorkspaceVideoClonedVoiceDto;
    walletBalanceVc: number;
  };
}

export async function archiveWorkspaceVideoClonedVoice(
  token: string,
  workspaceId: string,
  clonedVoiceId: string
): Promise<void> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/workspaces/${encodeURIComponent(workspaceId)}/video-cloned-voices/${encodeURIComponent(clonedVoiceId)}`,
    { method: "DELETE", headers: getAuthHeaders(token) }
  );
  if (!res.ok) {
    const envelope = await readApiErrorEnvelope(res);
    if (envelope) throw new ApiStructuredError(envelope.message, envelope.code, envelope.details);
    throw new Error("Failed to archive cloned voice.");
  }
}

export async function setWorkspaceVideoClonedVoiceDefault(
  token: string,
  workspaceId: string,
  clonedVoiceId: string
): Promise<WorkspaceVideoClonedVoiceDto> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/workspaces/${encodeURIComponent(workspaceId)}/video-cloned-voices/${encodeURIComponent(clonedVoiceId)}/default`,
    { method: "POST", headers: getAuthHeaders(token) }
  );
  if (!res.ok) {
    const envelope = await readApiErrorEnvelope(res);
    if (envelope) throw new ApiStructuredError(envelope.message, envelope.code, envelope.details);
    throw new Error("Failed to set default cloned voice.");
  }
  const data = (await res.json()) as { clonedVoice?: WorkspaceVideoClonedVoiceDto };
  if (!data.clonedVoice) {
    throw new Error("Cloned voice default response missing clonedVoice.");
  }
  return data.clonedVoice;
}

export async function getWorkspaceVideoPersonas(
  token: string,
  workspaceId: string
): Promise<PersonaListResponse> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/video-personas`, {
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    const envelope = await readApiErrorEnvelope(res);
    if (envelope) throw new ApiStructuredError(envelope.message, envelope.code, envelope.details);
    throw new Error("Failed to load video personas.");
  }
  return res.json() as Promise<PersonaListResponse>;
}

export async function getWorkspaceVoiceCatalog(
  token: string,
  workspaceId: string
): Promise<VoiceCatalogResponse> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/workspaces/${encodeURIComponent(workspaceId)}/video-personas/voice-catalog`,
    { headers: getAuthHeaders(token) }
  );
  if (!res.ok) {
    const envelope = await readApiErrorEnvelope(res);
    if (envelope) throw new ApiStructuredError(envelope.message, envelope.code, envelope.details);
    throw new Error("Failed to load voice catalog.");
  }
  return res.json() as Promise<VoiceCatalogResponse>;
}

export function getWorkspaceVideoPersonaPreviewUrl(workspaceId: string, personaId: string): string {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/video-personas/${encodeURIComponent(personaId)}/preview`;
}

export function getWorkspaceVoiceCatalogPreviewUrl(workspaceId: string, voiceId: string): string {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/video-personas/voice-catalog/${encodeURIComponent(voiceId)}/preview`;
}

export function getWorkspaceVideoClonedVoicePreviewUrl(
  workspaceId: string,
  clonedVoiceId: string
): string {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/video-cloned-voices/${encodeURIComponent(clonedVoiceId)}/preview`;
}

export async function createWorkspaceVideoPersona(
  token: string,
  workspaceId: string,
  payload: {
    displayName: string;
    videoFormat: "16:9" | "9:16" | "1:1";
    heygenVoiceId: string;
    clonedVoiceId?: string | null;
    portrait: File;
  }
): Promise<{
  persona: PersonaListItemDto;
  walletBalanceVc: number;
  storageWarning: string | null;
}> {
  const base = getApiBaseUrl();
  const form = new FormData();
  form.set("displayName", payload.displayName);
  form.set("videoFormat", payload.videoFormat);
  form.set("heygenVoiceId", payload.heygenVoiceId);
  if (payload.clonedVoiceId !== undefined) {
    form.set("clonedVoiceId", payload.clonedVoiceId ?? "");
  }
  form.set("portrait", payload.portrait);

  const res = await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/video-personas`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  if (!res.ok) {
    const envelope = await readApiErrorEnvelope(res);
    if (envelope) throw new ApiStructuredError(envelope.message, envelope.code, envelope.details);
    throw new ApiStructuredError("Persona creation failed", "create_failed");
  }
  const data = (await res.json()) as {
    persona: PersonaListItemDto;
    walletBalanceVc: number;
    storageWarning: string | null;
  };
  return data;
}

export async function updateWorkspaceVideoPersona(
  token: string,
  workspaceId: string,
  personaId: string,
  payload: {
    displayName: string;
    videoFormat?: "16:9" | "9:16" | "1:1";
    heygenVoiceId?: string;
    clonedVoiceId?: string | null;
  }
): Promise<{
  persona: PersonaListItemDto;
}> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/workspaces/${encodeURIComponent(workspaceId)}/video-personas/${encodeURIComponent(personaId)}`,
    {
      method: "PATCH",
      headers: {
        ...getAuthHeaders(token),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        displayName: payload.displayName,
        ...(payload.videoFormat !== undefined ? { videoFormat: payload.videoFormat } : {}),
        ...(payload.heygenVoiceId !== undefined ? { heygenVoiceId: payload.heygenVoiceId } : {}),
        ...(payload.clonedVoiceId !== undefined ? { clonedVoiceId: payload.clonedVoiceId } : {})
      })
    }
  );
  if (!res.ok) {
    const envelope = await readApiErrorEnvelope(res);
    if (envelope) throw new ApiStructuredError(envelope.message, envelope.code, envelope.details);
    throw new ApiStructuredError("Persona update failed", "update_failed");
  }
  return res.json() as Promise<{ persona: PersonaListItemDto }>;
}

export async function deleteWorkspaceVideoPersona(
  token: string,
  workspaceId: string,
  personaId: string
): Promise<void> {
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/workspaces/${encodeURIComponent(workspaceId)}/video-personas/${encodeURIComponent(personaId)}`,
    { method: "DELETE", headers: getAuthHeaders(token) }
  );
  if (!res.ok) {
    const envelope = await readApiErrorEnvelope(res);
    if (envelope) throw new ApiStructuredError(envelope.message, envelope.code, envelope.details);
    throw new Error("Failed to delete persona.");
  }
}

export interface WebChatPlanResponse {
  requestId: string;
  chatId: string;
  todos: RuntimeTodoItem[];
  windowed: boolean;
  totalCount: number;
}

export async function getAssistantWebChatPlan(
  token: string | null,
  chatId: string
): Promise<WebChatPlanResponse> {
  if (!token) throw new Error("Not authenticated.");
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/assistant/chats/web/${encodeURIComponent(chatId)}/plan`, {
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(`Failed to load chat plan (${res.status}).`);
  }
  return res.json() as Promise<WebChatPlanResponse>;
}

export async function clearAssistantWebChatPlan(
  token: string | null,
  chatId: string
): Promise<void> {
  if (!token) throw new Error("Not authenticated.");
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/assistant/chats/web/${encodeURIComponent(chatId)}/plan`, {
    method: "DELETE",
    headers: getAuthHeaders(token)
  });
  if (!res.ok) {
    throw new Error(`Failed to clear chat plan (${res.status}).`);
  }
}
