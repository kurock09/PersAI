import crypto from "node:crypto";
import type { SmokeEnv } from "./workspace";

export interface SmokeWebChatRequest {
  surfaceThreadKey: string;
  message: string;
  clientTurnId?: string;
}

export interface SmokeWebChatTurnResponse {
  ok: true;
  requestId: string | null;
  status: number;
  latencyMs: number;
  responseText: string;
  rawTransport: unknown;
}

export interface SmokeWebChatTurnFailure {
  ok: false;
  requestId: string | null;
  status: number;
  latencyMs: number;
  errorCode: string;
  errorMessage: string;
}

export type SmokeWebChatOutcome = SmokeWebChatTurnResponse | SmokeWebChatTurnFailure;

export interface SmokeReceiptUsageEntry {
  stepType: string;
  modelRole: string | null;
  providerKey: string | null;
  modelKey: string | null;
  toolCode: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface SmokeReceiptUsage {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  entries: SmokeReceiptUsageEntry[];
}

export interface SmokeReceiptToolInvocation {
  name: string;
  iteration: number;
  ok: boolean;
  executionMode: string | null;
}

export interface SmokeReceipt {
  receiptId: string;
  requestId: string;
  status: string;
  channel: string;
  mode: string;
  conversationKey: string;
  externalThreadKey: string;
  bundleHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  usage: SmokeReceiptUsage | null;
  toolCalls: Array<{ toolCode: string; count: number }>;
  toolCallsSource?: "tool_invocations" | "usage_entries" | "none";
  toolInvocations?: SmokeReceiptToolInvocation[];
  routingMode: string | null;
  routingExecutionMode: string | null;
  autoCompactionTokensBefore: number | null;
  autoCompactionTokensAfter: number | null;
}

export class SmokeApiClient {
  constructor(private readonly env: SmokeEnv) {}

  newClientTurnId(): string {
    return crypto.randomUUID();
  }

  async sendWebChatSync(req: SmokeWebChatRequest): Promise<SmokeWebChatOutcome> {
    const body = {
      surfaceThreadKey: req.surfaceThreadKey,
      message: req.message,
      clientTurnId: req.clientTurnId ?? this.newClientTurnId()
    };
    const startedAt = Date.now();
    const timeout = createAbort(this.env.fetchTimeoutMs);
    try {
      const response = await fetch(`${this.env.apiBaseUrl}/api/v1/assistant/chat/web`, {
        method: "POST",
        headers: this.userJsonHeaders(),
        body: JSON.stringify(body),
        signal: timeout.signal
      });
      const latencyMs = Date.now() - startedAt;
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        return failureFromPayload(response.status, latencyMs, payload);
      }
      const obj = payload as {
        requestId?: string | null;
        transport?: {
          assistantMessage?: { content?: string };
        };
      } | null;
      const requestId = typeof obj?.requestId === "string" ? obj.requestId : null;
      const responseText =
        typeof obj?.transport?.assistantMessage?.content === "string"
          ? obj.transport.assistantMessage.content
          : "";
      return {
        ok: true,
        requestId,
        status: response.status,
        latencyMs,
        responseText,
        rawTransport: obj?.transport ?? null
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      return {
        ok: false,
        requestId: null,
        status: 0,
        latencyMs,
        errorCode: "fetch_failed",
        errorMessage: error instanceof Error ? error.message : String(error)
      };
    } finally {
      timeout.clear();
    }
  }

  async sendWebChatStream(req: SmokeWebChatRequest): Promise<SmokeWebChatOutcome> {
    const body = {
      surfaceThreadKey: req.surfaceThreadKey,
      message: req.message,
      clientTurnId: req.clientTurnId ?? this.newClientTurnId()
    };
    const startedAt = Date.now();
    const timeout = createAbort(this.env.fetchTimeoutMs);
    try {
      const response = await fetch(`${this.env.apiBaseUrl}/api/v1/assistant/chat/web/stream`, {
        method: "POST",
        headers: this.userJsonHeaders(),
        body: JSON.stringify(body),
        signal: timeout.signal
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        return failureFromPayload(response.status, Date.now() - startedAt, payload);
      }
      if (!response.body) {
        return {
          ok: false,
          requestId: null,
          status: response.status,
          latencyMs: Date.now() - startedAt,
          errorCode: "stream_body_missing",
          errorMessage: "SSE response had no body."
        };
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let requestId: string | null = null;
      let assistantText = "";
      let terminal: { event: string; data: unknown } | null = null;
      let streaming = true;
      while (streaming) {
        const { done, value } = await reader.read();
        if (done) {
          streaming = false;
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const lines = chunk
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
          const eventLine = lines.find((line) => line.startsWith("event:"));
          const dataLine = lines.find((line) => line.startsWith("data:"));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.slice("event:".length).trim();
          let data: unknown = null;
          try {
            data = JSON.parse(dataLine.slice("data:".length).trim());
          } catch {
            data = null;
          }
          if (event === "started") {
            const obj = data as { requestId?: string | null } | null;
            if (typeof obj?.requestId === "string") requestId = obj.requestId;
          } else if (event === "delta") {
            const obj = data as { delta?: string } | null;
            if (typeof obj?.delta === "string") assistantText += obj.delta;
          } else if (event === "completed" || event === "failed" || event === "interrupted") {
            terminal = { event, data };
          }
        }
        if (terminal) {
          streaming = false;
          break;
        }
      }
      const latencyMs = Date.now() - startedAt;
      if (terminal?.event === "completed") {
        const obj = terminal.data as {
          transport?: { assistantMessage?: { content?: string } };
        } | null;
        const fallbackText =
          typeof obj?.transport?.assistantMessage?.content === "string"
            ? obj.transport.assistantMessage.content
            : "";
        return {
          ok: true,
          requestId,
          status: response.status,
          latencyMs,
          responseText: assistantText.length > 0 ? assistantText : fallbackText,
          rawTransport: obj?.transport ?? null
        };
      }
      const data = (terminal?.data ?? {}) as { code?: string; message?: string };
      return {
        ok: false,
        requestId,
        status: response.status,
        latencyMs,
        errorCode: typeof data.code === "string" ? data.code : "stream_terminated",
        errorMessage:
          typeof data.message === "string"
            ? data.message
            : `Stream ended with event ${terminal?.event ?? "<none>"}.`
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      return {
        ok: false,
        requestId: null,
        status: 0,
        latencyMs,
        errorCode: "fetch_failed",
        errorMessage: error instanceof Error ? error.message : String(error)
      };
    } finally {
      timeout.clear();
    }
  }

  async findReceiptForThreadAfter(
    externalThreadKey: string,
    afterCursorIso: string
  ): Promise<SmokeReceipt | null> {
    const url = new URL(`${this.env.apiInternalBaseUrl}/api/v1/internal/smoke/turn-receipts`);
    url.searchParams.set("assistantId", this.env.assistantId);
    url.searchParams.set("afterCursor", afterCursorIso);
    url.searchParams.set("limit", "20");
    const deadline = Date.now() + this.env.receiptPollTimeoutMs;
    while (Date.now() < deadline) {
      const result = await this.fetchInternalReceipts(url.toString());
      const candidate = result.items.find(
        (item) => item.externalThreadKey === externalThreadKey && item.status !== "accepted"
      );
      if (candidate) {
        return candidate;
      }
      await sleep(this.env.receiptPollIntervalMs);
    }
    return null;
  }

  private async fetchInternalReceipts(url: string): Promise<{
    ok: true;
    items: SmokeReceipt[];
    nextCursor: string | null;
  }> {
    const timeout = createAbort(this.env.fetchTimeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.env.internalToken}` },
        signal: timeout.signal
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const detail = payload === null ? "<no body>" : JSON.stringify(payload);
        throw new Error(`Internal smoke receipts endpoint returned ${response.status}: ${detail}`);
      }
      return (await response.json()) as {
        ok: true;
        items: SmokeReceipt[];
        nextCursor: string | null;
      };
    } finally {
      timeout.clear();
    }
  }

  private userJsonHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.env.userBearer}`,
      "Content-Type": "application/json"
    };
  }
}

function createAbort(timeoutMs: number): { signal: AbortSignal; clear(): void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)),
    timeoutMs
  );
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
    }
  };
}

function failureFromPayload(
  status: number,
  latencyMs: number,
  payload: unknown
): SmokeWebChatTurnFailure {
  let errorCode = "request_failed";
  let errorMessage = `Request failed with status ${status}.`;
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const obj = payload as { error?: { code?: unknown; message?: unknown } };
    if (typeof obj.error?.code === "string") errorCode = obj.error.code;
    if (typeof obj.error?.message === "string") errorMessage = obj.error.message;
  }
  return {
    ok: false,
    requestId: null,
    status,
    latencyMs,
    errorCode,
    errorMessage
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
