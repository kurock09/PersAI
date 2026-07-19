import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import {
  AsyncContinuationDispatchAmbiguousError,
  AsyncContinuationInterruptedError,
  InternalRuntimeAsyncContinuationClientService
} from "../src/modules/workspace-management/application/internal-runtime-async-continuation.client.service";

const ORIGINAL_ENV = process.env;

describe("InternalRuntimeAsyncContinuationClientService", () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      APP_ENV: "local",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public",
      CLERK_SECRET_KEY: "clerk-secret",
      PERSAI_INTERNAL_API_TOKEN: "persai-internal-token",
      PERSAI_RUNTIME_BASE_URL: "http://runtime.local",
      PERSAI_RUNTIME_TURN_WALL_CLOCK_MS: "1800000",
      PERSAI_RUNTIME_TURN_IDLE_STALL_MS: "300000"
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    mock.restoreAll();
  });

  test("aborts a hung dispatch and reports an ambiguous accepted-state outcome", async () => {
    let signal: AbortSignal | undefined;
    mock.method(globalThis, "fetch", async (_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true
        });
      });
    });

    const service = new InternalRuntimeAsyncContinuationClientService();
    await assert.rejects(
      service.execute({ requestId: "dispatch-1" } as never, { timeoutMs: 5 }),
      (error: unknown) =>
        error instanceof AsyncContinuationDispatchAmbiguousError &&
        error.message.includes("timed out")
    );
    assert.equal(signal?.aborted, true);
  });

  test("caller AbortSignal on stream throws InterruptedError not AmbiguousError", async () => {
    const caller = new AbortController();
    mock.method(globalThis, "fetch", async (_url, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true
        });
      });
    });

    const service = new InternalRuntimeAsyncContinuationClientService();
    const streamPromise = service.stream({ requestId: "stream-abort-1" } as never, {
      timeoutMs: 30_000,
      signal: caller.signal
    });
    caller.abort();
    await assert.rejects(
      streamPromise,
      (error: unknown) =>
        error instanceof AsyncContinuationInterruptedError &&
        error.message.includes("aborted by caller")
    );
  });

  test("aborts a hung inspection at its deadline and returns the safe ambiguous fallback", async () => {
    let signal: AbortSignal | undefined;
    mock.method(globalThis, "fetch", async (_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true
        });
      });
    });

    const service = new InternalRuntimeAsyncContinuationClientService();
    assert.deepEqual(
      await service.inspect({ requestId: "inspect-1", sessionId: "session-1" } as never, {
        timeoutMs: 5
      }),
      { proof: "ambiguous", receiptStatus: "absent", exactInFlight: false }
    );
    assert.equal(signal?.aborted, true);
  });

  for (const outcome of ["busy", "duplicate"] as const) {
    test(`accepts the exact ${outcome} response shape`, async () => {
      mock.method(globalThis, "fetch", async () => Response.json({ outcome }, { status: 200 }));
      const service = new InternalRuntimeAsyncContinuationClientService();
      assert.deepEqual(
        await service.execute({ requestId: "dispatch-1" } as never, { timeoutMs: 100 }),
        { outcome }
      );
    });
  }

  test("accepts a safe failed response", async () => {
    mock.method(globalThis, "fetch", async () =>
      Response.json({ outcome: "failed", code: "provider_failed" }, { status: 200 })
    );
    const service = new InternalRuntimeAsyncContinuationClientService();
    assert.deepEqual(
      await service.execute({ requestId: "dispatch-1" } as never, { timeoutMs: 100 }),
      { outcome: "failed", code: "provider_failed" }
    );
  });

  test("accepts a completed response only with essential RuntimeTurnResult fields", async () => {
    const result = {
      requestId: "runtime-request-1",
      sessionId: "session-1",
      assistantText: "Done.",
      answerText: "Done.",
      artifacts: [],
      respondedAt: "2026-07-18T00:00:00.000Z",
      usage: null
    };
    mock.method(globalThis, "fetch", async () =>
      Response.json({ outcome: "completed", result, duplicate: false }, { status: 200 })
    );
    const service = new InternalRuntimeAsyncContinuationClientService();
    assert.deepEqual(
      await service.execute({ requestId: "dispatch-1" } as never, { timeoutMs: 100 }),
      { outcome: "completed", result, duplicate: false }
    );
  });

  for (const malformed of [
    { outcome: "busy", extra: true },
    { outcome: "failed", code: "unsafe code" },
    { outcome: "completed", duplicate: false, result: { assistantText: "missing essentials" } },
    { outcome: "unknown" }
  ]) {
    test(`rejects malformed 2xx without turning it into a retry: ${malformed.outcome}`, async () => {
      mock.method(globalThis, "fetch", async () => Response.json(malformed, { status: 200 }));
      const service = new InternalRuntimeAsyncContinuationClientService();
      await assert.rejects(
        service.execute({ requestId: "dispatch-1" } as never, { timeoutMs: 100 }),
        AsyncContinuationDispatchAmbiguousError
      );
    });
  }
});
