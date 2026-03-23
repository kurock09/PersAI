import {
  type AdminPlanCreateRequest,
  type AdminPlanVisibilityState,
  type AdminPlanState,
  type AdminPlanUpdateRequest,
  type AssistantTelegramConfigUpdateRequest,
  type TelegramIntegrationState,
  type AssistantWebChatDeleteRequest,
  type AssistantWebChatListItemState,
  type AssistantWebChatRenameRequest,
  type AssistantDraftUpdateRequest,
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
  patchAdminPlan as patchAdminPlanContract,
  patchAssistantWebChat as patchAssistantWebChatContract,
  postAssistantPublish as postAssistantPublishContract,
  postAssistantReset as postAssistantResetContract,
  postAssistantRollback as postAssistantRollbackContract,
  postAssistantWebChatArchive as postAssistantWebChatArchiveContract,
  postAssistantCreate as postAssistantCreateContract,
  postAdminPlanCreate as postAdminPlanCreateContract,
  postAssistantMemoryDoNotRemember as postAssistantMemoryDoNotRememberContract,
  postAssistantMemoryItemForget as postAssistantMemoryItemForgetContract,
  postAssistantTaskItemCancel as postAssistantTaskItemCancelContract,
  postAssistantTaskItemDisable as postAssistantTaskItemDisableContract,
  postAssistantTaskItemEnable as postAssistantTaskItemEnableContract,
  getAdminPlans as getAdminPlansContract
  ,
  getAdminPlanVisibility as getAdminPlanVisibilityContract,
  getAssistantPlanVisibility as getAssistantPlanVisibilityContract,
  getAssistantTelegramIntegration as getAssistantTelegramIntegrationContract,
  patchAssistantTelegramConfig as patchAssistantTelegramConfigContract,
  postAssistantTelegramConnect as postAssistantTelegramConnectContract
} from "@persai/contracts";

function getAuthHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof ContractsApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown API request error.";
}

function getApiBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim().replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    return "/api/v1";
  }

  return "http://localhost:3001/api/v1";
}

function isSuccessStatus(
  status: number
): status is 200 | 201 {
  return status === 200 || status === 201;
}

type WebChatStreamEvent =
  | { event: "started"; data: { chat: unknown; userMessage: unknown } }
  | { event: "delta"; data: { delta: string; accumulated: string } }
  | { event: "runtime_done"; data: { respondedAt: string } }
  | { event: "completed"; data: { transport: unknown } }
  | { event: "interrupted"; data: { transport: unknown } }
  | { event: "failed"; data: { message: string; transport: unknown } };

export interface AssistantWebChatStreamPayload {
  surfaceThreadKey: string;
  message: string;
  title?: string | null;
}

export interface AssistantWebChatStreamHandlers {
  onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
  onDelta?: (payload: { delta: string; accumulated: string }) => void;
  onRuntimeDone?: (payload: { respondedAt: string }) => void;
  onCompleted?: (payload: { transport: unknown }) => void;
  onInterrupted?: (payload: { transport: unknown }) => void;
  onFailed?: (payload: { message: string; transport: unknown }) => void;
}

export type WebChatUxIssueClass =
  | "auth_session"
  | "input_validation"
  | "assistant_not_live"
  | "active_chat_cap"
  | "runtime_unreachable"
  | "runtime_timeout"
  | "runtime_degraded"
  | "runtime_auth"
  | "provider_failure"
  | "tool_failure"
  | "channel_failure"
  | "stream_incomplete"
  | "unknown";

export interface WebChatUxIssue {
  classId: WebChatUxIssueClass;
  message: string;
  guidance: string;
}

function normalizeRawErrorMessage(source: string): string {
  return source.trim().toLowerCase();
}

export function toWebChatUxIssue(error: unknown): WebChatUxIssue {
  const rawMessage =
    typeof error === "string"
      ? error
      : error instanceof ContractsApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Web chat request failed.";

  const normalized = normalizeRawErrorMessage(rawMessage);
  const status = error instanceof ContractsApiError ? error.status : null;

  if (status === 401) {
    return {
      classId: "auth_session",
      message: "Your session has expired for chat actions.",
      guidance: "Sign in again, then retry the message."
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
    if (typeof body.delta !== "string" || typeof body.accumulated !== "string") {
      return null;
    }
    return {
      event: "delta",
      data: { delta: body.delta, accumulated: body.accumulated }
    };
  }
  if (eventName === "runtime_done") {
    if (typeof body.respondedAt !== "string") {
      return null;
    }
    return { event: "runtime_done", data: { respondedAt: body.respondedAt } };
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
      data: { message: body.message, transport: body.transport }
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

    const message =
      typeof errorPayload === "object" &&
      errorPayload !== null &&
      "error" in errorPayload &&
      typeof (errorPayload as { error?: { message?: unknown } }).error?.message === "string"
        ? (errorPayload as { error: { message: string } }).error.message
        : `Request failed with status ${response.status}.`;

    throw new ContractsApiError(message, response.status, errorPayload);
  }

  if (response.body === null) {
    throw new Error("Streaming response has no body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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

      if (streamEvent.event === "started") {
        handlers.onStarted?.(streamEvent.data);
      } else if (streamEvent.event === "delta") {
        handlers.onDelta?.(streamEvent.data);
      } else if (streamEvent.event === "runtime_done") {
        handlers.onRuntimeDone?.(streamEvent.data);
      } else if (streamEvent.event === "completed") {
        handlers.onCompleted?.(streamEvent.data);
      } else if (streamEvent.event === "interrupted") {
        handlers.onInterrupted?.(streamEvent.data);
      } else if (streamEvent.event === "failed") {
        handlers.onFailed?.(streamEvent.data);
      }
    }
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

export async function getAssistantWebChats(token: string): Promise<AssistantWebChatListItemState[]> {
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
      throw new Error("Unexpected non-success response for POST /assistant/chats/web/:chatId/archive.");
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

export async function getAssistantMemoryItems(token: string): Promise<AssistantMemoryRegistryItemState[]> {
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
      throw new Error("Unexpected non-success response for POST /assistant/memory/items/:itemId/forget.");
    }
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function getAssistantTaskItems(token: string): Promise<AssistantTaskRegistryItemState[]> {
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
      throw new Error("Unexpected non-success response for POST /assistant/tasks/items/:itemId/disable.");
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
      throw new Error("Unexpected non-success response for POST /assistant/tasks/items/:itemId/enable.");
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
      throw new Error("Unexpected non-success response for POST /assistant/tasks/items/:itemId/cancel.");
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
      throw new Error("Unexpected non-success response for POST /assistant/memory/do-not-remember.");
    }

    return { forgottenRegistryItems: response.data.forgottenRegistryItems };
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export type { AdminPlanState, AdminPlanCreateRequest, AdminPlanUpdateRequest };
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

export async function getAssistantTelegramIntegration(token: string): Promise<TelegramIntegrationState> {
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
    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for POST /assistant/integrations/telegram/connect.");
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
      throw new Error("Unexpected non-success response for PATCH /assistant/integrations/telegram/config.");
    }
    return response.data.integration;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAdminPlanCreate(
  token: string,
  payload: AdminPlanCreateRequest
): Promise<AdminPlanState> {
  try {
    const response = await postAdminPlanCreateContract(payload, {
      headers: getAuthHeaders(token)
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

export async function patchAdminPlan(
  token: string,
  code: string,
  payload: AdminPlanUpdateRequest
): Promise<AdminPlanState> {
  try {
    const response = await patchAdminPlanContract(code, payload, {
      headers: getAuthHeaders(token)
    });

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for PATCH /admin/plans/:code.");
    }

    return response.data.plan;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}
