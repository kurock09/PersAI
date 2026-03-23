import {
  type AssistantDraftUpdateRequest,
  type AssistantRollbackRequest,
  ContractsApiError,
  type AssistantLifecycleState,
  getAssistant as getAssistantContract,
  patchAssistantDraft as patchAssistantDraftContract,
  postAssistantPublish as postAssistantPublishContract,
  postAssistantReset as postAssistantResetContract,
  postAssistantRollback as postAssistantRollbackContract,
  postAssistantCreate as postAssistantCreateContract
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

  while (true) {
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

    if (response.status !== 200) {
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

    if (response.status !== 200) {
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

    if (response.status !== 200) {
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

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for POST /assistant/reset.");
    }

    return response.data.assistant;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}
