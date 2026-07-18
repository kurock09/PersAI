import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
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
  const clientSource = readFileSync(
    path.resolve(__dirname, "../src/modules/turns/persai-internal-api.client.service.ts"),
    "utf8"
  );
  for (const route of [
    "/api/v1/internal/runtime/media-jobs/v1/enqueue",
    "/api/v1/internal/runtime/document-jobs/v1/enqueue",
    "/api/v1/internal/runtime/async-jobs/v1/status",
    "/api/v1/internal/runtime/async-jobs/v1/subscribe"
  ]) {
    assert.match(clientSource, new RegExp(`"${route}"`), `new runtime must use ${route}`);
  }
  for (const unversionedRoute of [
    "/api/v1/internal/runtime/media-jobs/enqueue",
    "/api/v1/internal/runtime/document-jobs/enqueue",
    "/api/v1/internal/runtime/async-jobs/status",
    "/api/v1/internal/runtime/async-jobs/subscribe"
  ]) {
    assert.doesNotMatch(
      clientSource,
      new RegExp(`"${unversionedRoute}"`),
      `new runtime must not fall back to ${unversionedRoute}`
    );
  }

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
