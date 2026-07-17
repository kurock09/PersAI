import assert from "node:assert/strict";
import {
  AsyncJobStatusDeadlineExceededError,
  PersaiInternalApiClientService
} from "../src/modules/turns/persai-internal-api.client.service";

const input = {
  jobRef: `jr1.media.${"A".repeat(32)}`,
  assistantId: "assistant-1",
  workspaceId: "workspace-1",
  chatId: "chat-1",
  channel: "web" as const,
  threadKey: "thread-1"
};

export async function runPersaiInternalApiAsyncJobStatusTest(): Promise<void> {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = abortAwarePendingFetch;
    const client = new PersaiInternalApiClientService({
      PERSAI_API_BASE_URL: "https://api.persai.test",
      PERSAI_INTERNAL_API_TOKEN: "token"
    } as never);
    await assert.rejects(
      () => client.resolveAsyncJobStatus({ ...input, timeoutMs: 1 }),
      (error: unknown) => error instanceof AsyncJobStatusDeadlineExceededError
    );

    const stop = new AbortController();
    stop.abort();
    await assert.rejects(
      () =>
        client.resolveAsyncJobStatus({
          ...input,
          timeoutMs: 1,
          abortSignal: stop.signal
        }),
      (error: unknown) => error instanceof DOMException && error.name === "AbortError"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const abortAwarePendingFetch: typeof fetch = async (_input, init) => {
  const signal = init?.signal;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
      once: true
    });
  });
};
