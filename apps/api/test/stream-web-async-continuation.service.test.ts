import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  AsyncContinuationDispatchAmbiguousError,
  AsyncContinuationInterruptedError
} from "../src/modules/workspace-management/application/internal-runtime-async-continuation.client.service";
import { StreamWebAsyncContinuationService } from "../src/modules/workspace-management/application/stream-web-async-continuation.service";

function baseContext(overrides?: { continuationClientTurnId?: string }) {
  return {
    handle: {
      id: "handle-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      chatId: "chat-1",
      channel: "web" as const,
      threadKey: "thread-1",
      continuationClientTurnId: overrides?.continuationClientTurnId ?? "async-cont:handle-1",
      sourceUserMessageId: "00000000-0000-4000-8000-000000000001",
      retryCount: 0
    },
    sourceUserMessage: { id: "00000000-0000-4000-8000-000000000001" }
  };
}

function baseCallbacks(callbackCalls: string[]) {
  return {
    persistOutputOnce: async () => {
      callbackCalls.push("persist");
      return { outcome: "persisted" as const, messageId: "assistant-msg-1" };
    },
    finalizeContinuationChildren: async (_ctx: unknown, outcome: string) => {
      callbackCalls.push(`finalize:${outcome}`);
    },
    deliverContinuationArtifactsOnce: async () => {
      callbackCalls.push("deliver");
    },
    failClaimVisibly: async (_claim: unknown, error: { errorCode: string }) => {
      callbackCalls.push(`fail:${error.errorCode}`);
    },
    requeueBusyNotStarted: async () => {
      callbackCalls.push("busy");
    },
    completeClaim: async () => {
      callbackCalls.push("complete");
      return true;
    },
    deliveryAttemptsSettled: async () => true,
    retryAt: () => new Date()
  };
}

describe("StreamWebAsyncContinuationService", () => {
  test("streams runtime events into the web turn registry and completes the attempt", async () => {
    const published: Array<{ event: string; payload: unknown }> = [];
    const attemptCalls: string[] = [];
    const callbackCalls: string[] = [];
    let registered = false;
    let released = false;
    let stopRegistered = false;
    let stopReleased = false;
    let markRunningUserMessageId: string | null | undefined = undefined;

    const service = new StreamWebAsyncContinuationService(
      {
        stream: async () => ({
          mode: "events",
          events: (async function* () {
            yield {
              type: "started",
              requestId: "req-1",
              sessionId: "session-1"
            };
            yield {
              type: "text_delta",
              requestId: "req-1",
              sessionId: "session-1",
              delta: "Hello",
              accumulatedText: "Hello",
              source: "assistant"
            };
            yield {
              type: "completed",
              result: {
                requestId: "req-1",
                sessionId: "session-1",
                assistantText: "Hello",
                answerText: "Hello",
                respondedAt: "2026-07-19T00:00:00.000Z",
                artifacts: [],
                usage: null
              }
            };
          })()
        })
      } as never,
      {
        claim: async () => {
          attemptCalls.push("claim");
          return "claimed";
        },
        markRunning: async (input: { userMessageId: string | null }) => {
          attemptCalls.push("markRunning");
          markRunningUserMessageId = input.userMessageId;
        },
        markCompleted: async () => {
          attemptCalls.push("markCompleted");
        },
        markFailed: async () => {
          attemptCalls.push("markFailed");
        },
        markInterrupted: async () => {
          attemptCalls.push("markInterrupted");
        },
        markCurrentActivity: async () => {
          attemptCalls.push("markCurrentActivity");
        },
        touchRunningAttempt: async () => {
          attemptCalls.push("touchRunningAttempt");
        },
        resetToAccepted: async () => {
          attemptCalls.push("resetToAccepted");
        }
      } as never,
      {
        register: () => {
          registered = true;
        },
        release: () => {
          released = true;
        },
        publish: (input: { event: string; payload: unknown }) => {
          published.push({ event: input.event, payload: input.payload });
        }
      } as never,
      {
        register: () => {
          stopRegistered = true;
        },
        release: () => {
          stopReleased = true;
        },
        wasUserStopped: () => false
      } as never
    );

    await service.processWebClaim({
      claim: { id: "handle-1", claimToken: "claim-1" },
      context: baseContext(),
      request: {
        requestId: "req-1",
        idempotencyKey: "async-cont:handle-1"
      } as never,
      timeoutMs: 30_000,
      callbacks: baseCallbacks(callbackCalls)
    });

    assert.equal(registered, true);
    assert.equal(released, true);
    assert.equal(stopRegistered, true);
    assert.equal(stopReleased, true);
    assert.equal(markRunningUserMessageId, null);
    assert.deepEqual(attemptCalls.slice(0, 3), ["claim", "markRunning", "markCompleted"]);
    assert.ok(published.some((row) => row.event === "delta"));
    assert.ok(published.some((row) => row.event === "completed"));
    assert.deepEqual(callbackCalls, ["persist", "finalize:persisted", "deliver", "complete"]);
  });

  test("typed busy outcome requeues without failed publish or markFailed", async () => {
    const callbackCalls: string[] = [];
    const attemptCalls: string[] = [];
    const published: string[] = [];
    const service = new StreamWebAsyncContinuationService(
      {
        stream: async () => ({
          mode: "outcome",
          result: { outcome: "busy" }
        })
      } as never,
      {
        claim: async () => "claimed",
        markRunning: async () => {
          attemptCalls.push("markRunning");
        },
        markFailed: async () => {
          attemptCalls.push("markFailed");
        },
        markCompleted: async () => {
          attemptCalls.push("markCompleted");
        },
        markInterrupted: async () => {
          attemptCalls.push("markInterrupted");
        },
        markCurrentActivity: async () => undefined,
        touchRunningAttempt: async () => undefined,
        resetToAccepted: async () => {
          attemptCalls.push("resetToAccepted");
        }
      } as never,
      {
        register: () => undefined,
        release: () => undefined,
        publish: (input: { event: string }) => {
          published.push(input.event);
        }
      } as never,
      {
        register: () => undefined,
        release: () => undefined,
        wasUserStopped: () => false
      } as never
    );

    await service.processWebClaim({
      claim: { id: "handle-busy", claimToken: "claim-busy" },
      context: baseContext({ continuationClientTurnId: "async-cont:busy" }),
      request: { requestId: "req-busy", idempotencyKey: "async-cont:busy" } as never,
      timeoutMs: 30_000,
      callbacks: baseCallbacks(callbackCalls)
    });

    assert.deepEqual(callbackCalls, ["busy"]);
    assert.ok(!attemptCalls.includes("markFailed"));
    assert.ok(attemptCalls.includes("resetToAccepted"));
    assert.ok(!published.includes("failed"));
  });

  test("Stop/abort takes interrupted path instead of leave-dispatched ambiguous", async () => {
    const callbackCalls: string[] = [];
    const attemptCalls: string[] = [];
    const published: string[] = [];
    const service = new StreamWebAsyncContinuationService(
      {
        stream: async (_req: unknown, options: { signal?: AbortSignal }) => {
          options.signal?.addEventListener("abort", () => undefined);
          throw new AsyncContinuationInterruptedError(
            "Runtime continuation stream aborted by caller."
          );
        }
      } as never,
      {
        claim: async () => "claimed",
        markRunning: async () => {
          attemptCalls.push("markRunning");
        },
        markFailed: async () => {
          attemptCalls.push("markFailed");
        },
        markInterrupted: async () => {
          attemptCalls.push("markInterrupted");
        },
        markCompleted: async () => undefined,
        markCurrentActivity: async () => undefined,
        touchRunningAttempt: async () => undefined,
        resetToAccepted: async () => undefined
      } as never,
      {
        register: () => undefined,
        release: () => undefined,
        publish: (input: { event: string }) => {
          published.push(input.event);
        }
      } as never,
      {
        register: () => undefined,
        release: () => undefined,
        wasUserStopped: () => true
      } as never
    );

    await service.processWebClaim({
      claim: { id: "handle-stop", claimToken: "claim-stop" },
      context: baseContext({ continuationClientTurnId: "async-cont:stop" }),
      request: { requestId: "req-stop", idempotencyKey: "async-cont:stop" } as never,
      timeoutMs: 30_000,
      callbacks: baseCallbacks(callbackCalls)
    });

    assert.ok(attemptCalls.includes("markInterrupted"));
    assert.ok(!attemptCalls.includes("markFailed"));
    assert.ok(published.includes("interrupted"));
    assert.ok(!published.includes("failed"));
    assert.deepEqual(callbackCalls, ["finalize:stopped", "fail:continuation_interrupted"]);
  });

  test("mid-stream throw terminalizes attempt before rethrow so reclaim is not stuck", async () => {
    const attemptCalls: string[] = [];
    const published: string[] = [];
    const service = new StreamWebAsyncContinuationService(
      {
        stream: async () => ({
          mode: "events",
          events: (async function* () {
            yield {
              type: "started",
              requestId: "req-throw",
              sessionId: "session-1"
            };
            throw new Error("provider exploded");
          })()
        })
      } as never,
      {
        claim: async () => "claimed",
        markRunning: async () => {
          attemptCalls.push("markRunning");
        },
        markFailed: async () => {
          attemptCalls.push("markFailed");
        },
        markInterrupted: async () => {
          attemptCalls.push("markInterrupted");
        },
        markCompleted: async () => undefined,
        markCurrentActivity: async () => undefined,
        touchRunningAttempt: async () => undefined,
        resetToAccepted: async () => undefined
      } as never,
      {
        register: () => undefined,
        release: () => undefined,
        publish: (input: { event: string }) => {
          published.push(input.event);
        }
      } as never,
      {
        register: () => undefined,
        release: () => undefined,
        wasUserStopped: () => false
      } as never
    );

    await assert.rejects(
      service.processWebClaim({
        claim: { id: "handle-throw", claimToken: "claim-throw" },
        context: baseContext({ continuationClientTurnId: "async-cont:throw" }),
        request: { requestId: "req-throw", idempotencyKey: "async-cont:throw" } as never,
        timeoutMs: 30_000,
        callbacks: baseCallbacks([])
      }),
      (error: unknown) => error instanceof Error && error.message === "provider exploded"
    );
    assert.ok(attemptCalls.includes("markFailed"));
    assert.ok(published.includes("failed"));
  });

  test("unterminated stream markFailed + publish failed + failClaimVisibly", async () => {
    const callbackCalls: string[] = [];
    const attemptCalls: string[] = [];
    const published: string[] = [];
    const service = new StreamWebAsyncContinuationService(
      {
        stream: async () => ({
          mode: "events",
          events: (async function* () {
            yield {
              type: "started",
              requestId: "req-unterminated",
              sessionId: "session-1"
            };
          })()
        })
      } as never,
      {
        claim: async () => "claimed",
        markRunning: async () => {
          attemptCalls.push("markRunning");
        },
        markFailed: async () => {
          attemptCalls.push("markFailed");
        },
        markInterrupted: async () => undefined,
        markCompleted: async () => undefined,
        markCurrentActivity: async () => undefined,
        touchRunningAttempt: async () => undefined,
        resetToAccepted: async () => undefined
      } as never,
      {
        register: () => undefined,
        release: () => undefined,
        publish: (input: { event: string }) => {
          published.push(input.event);
        }
      } as never,
      {
        register: () => undefined,
        release: () => undefined,
        wasUserStopped: () => false
      } as never
    );

    await service.processWebClaim({
      claim: { id: "handle-unterminated", claimToken: "claim-unterminated" },
      context: baseContext({ continuationClientTurnId: "async-cont:unterminated" }),
      request: {
        requestId: "req-unterminated",
        idempotencyKey: "async-cont:unterminated"
      } as never,
      timeoutMs: 30_000,
      callbacks: baseCallbacks(callbackCalls)
    });

    assert.ok(attemptCalls.includes("markFailed"));
    assert.ok(published.includes("failed"));
    assert.deepEqual(callbackCalls, ["fail:continuation_stream_unterminated"]);
  });

  test("true AmbiguousError leaves dispatched without interrupt finalize", async () => {
    const callbackCalls: string[] = [];
    const attemptCalls: string[] = [];
    const published: string[] = [];
    const service = new StreamWebAsyncContinuationService(
      {
        stream: async () => {
          throw new AsyncContinuationDispatchAmbiguousError(
            "Runtime continuation stream connection failed after acceptance became possible."
          );
        }
      } as never,
      {
        claim: async () => "claimed",
        markRunning: async () => {
          attemptCalls.push("markRunning");
        },
        markFailed: async () => {
          attemptCalls.push("markFailed");
        },
        markInterrupted: async () => {
          attemptCalls.push("markInterrupted");
        },
        markCompleted: async () => undefined,
        markCurrentActivity: async () => undefined,
        touchRunningAttempt: async () => undefined,
        resetToAccepted: async () => undefined
      } as never,
      {
        register: () => undefined,
        release: () => undefined,
        publish: (input: { event: string }) => {
          published.push(input.event);
        }
      } as never,
      {
        register: () => undefined,
        release: () => undefined,
        wasUserStopped: () => false
      } as never
    );

    await service.processWebClaim({
      claim: { id: "handle-ambig", claimToken: "claim-ambig" },
      context: baseContext({ continuationClientTurnId: "async-cont:ambig" }),
      request: { requestId: "req-ambig", idempotencyKey: "async-cont:ambig" } as never,
      timeoutMs: 30_000,
      callbacks: baseCallbacks(callbackCalls)
    });

    assert.ok(attemptCalls.includes("markFailed"));
    assert.ok(!attemptCalls.includes("markInterrupted"));
    assert.ok(published.includes("failed"));
    assert.deepEqual(callbackCalls, []);
  });
});
