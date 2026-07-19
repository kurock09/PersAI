import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  AsyncContinuationCoordinationLostError,
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
    sourceUserMessage: { id: "00000000-0000-4000-8000-000000000001" },
    sessionId: "session-1"
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
    markDispatched: async () => {
      callbackCalls.push("markDispatched");
      return true;
    },
    releasePreDispatchBusy: async () => {
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

function streamRegistryMock(options?: {
  onRegister?: () => void;
  onRelease?: () => void;
  onPublish?: (input: { event: string; payload?: unknown }) => void;
}) {
  return {
    register: () => {
      options?.onRegister?.();
    },
    releaseAsync: async () => {
      options?.onRelease?.();
    },
    touch: async () => undefined,
    publish: (input: { event: string; payload?: unknown }) => {
      options?.onPublish?.(input);
    }
  } as never;
}

function stopDispatchMock(options?: {
  onRegister?: () => void;
  onRelease?: () => void;
  wasUserStopped?: () => boolean;
}) {
  return {
    register: () => {
      options?.onRegister?.();
    },
    release: () => {
      options?.onRelease?.();
    },
    wasUserStopped: () => options?.wasUserStopped?.() ?? false
  } as never;
}

function attemptMock(attemptCalls: string[], extras?: Record<string, unknown>) {
  return {
    claim: async () => {
      attemptCalls.push("claim");
      return "claimed";
    },
    markRunning: async (input?: { userMessageId: string | null }) => {
      attemptCalls.push("markRunning");
      if (input !== undefined) {
        (attemptMock as { lastUserMessageId?: string | null }).lastUserMessageId =
          input.userMessageId;
      }
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
    abandonPreAcceptanceAttempt: async () => {
      attemptCalls.push("abandonPreAcceptanceAttempt");
    },
    ...extras
  } as never;
}

describe("StreamWebAsyncContinuationService", () => {
  test("coordination abort during a paused web stream releases registry without narration", async () => {
    const coordination = new AbortController();
    const callbackCalls: string[] = [];
    const attemptCalls: string[] = [];
    const published: string[] = [];
    let released = false;
    let lockHeld = true;
    let started!: () => void;
    const streamStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const service = new StreamWebAsyncContinuationService(
      {
        stream: async (_request: unknown, options: { signal?: AbortSignal }) => {
          started();
          await new Promise<void>((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
              once: true
            });
          });
          throw new Error("unreachable");
        },
        inspect: async () => ({
          proof: "proven",
          receiptStatus: "absent",
          exactInFlight: false
        })
      } as never,
      attemptMock(attemptCalls),
      streamRegistryMock({
        onRelease: () => {
          released = true;
        },
        onPublish: (event) => published.push(event.event)
      }),
      stopDispatchMock(),
      undefined
    );
    const run = service.processWebClaim({
      claim: { id: "handle-lock-loss", claimToken: "claim-lock-loss" },
      context: baseContext(),
      request: { requestId: "request-lock-loss" } as never,
      timeoutMs: 1_000,
      coordinationSignal: coordination.signal,
      isCatchUpLockHeld: () => lockHeld,
      callbacks: baseCallbacks(callbackCalls)
    });
    await streamStarted;
    lockHeld = false;
    coordination.abort(new AsyncContinuationCoordinationLostError());
    await run;
    assert.equal(released, true);
    assert.deepEqual(published, []);
    assert.equal(callbackCalls.includes("persist"), false);
    assert.equal(callbackCalls.includes("deliver"), false);
    assert.equal(callbackCalls.includes("complete"), false);
    assert.ok(attemptCalls.includes("abandonPreAcceptanceAttempt"));
    assert.ok(callbackCalls.includes("busy"));
  });

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
        abandonPreAcceptanceAttempt: async () => {
          attemptCalls.push("abandonPreAcceptanceAttempt");
        }
      } as never,
      streamRegistryMock({
        onRegister: () => {
          registered = true;
        },
        onRelease: () => {
          released = true;
        },
        onPublish: (input) => {
          published.push({ event: input.event, payload: input.payload });
        }
      }),
      stopDispatchMock({
        onRegister: () => {
          stopRegistered = true;
        },
        onRelease: () => {
          stopReleased = true;
        }
      })
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
    assert.ok(callbackCalls.includes("markDispatched"));
    assert.deepEqual(
      callbackCalls.filter((c) => c !== "markDispatched"),
      ["persist", "finalize:persisted", "deliver", "complete"]
    );
  });

  test("ADR-159 duplicate_handled completes claim immediately (no claimed stall)", async () => {
    const callbackCalls: string[] = [];
    const attemptCalls: string[] = [];
    const service = new StreamWebAsyncContinuationService(
      {
        stream: async () => {
          throw new Error("must not stream after duplicate_handled");
        }
      } as never,
      {
        ...attemptMock(attemptCalls),
        claim: async () => {
          attemptCalls.push("claim");
          return "duplicate_handled";
        }
      } as never,
      streamRegistryMock(),
      stopDispatchMock()
    );

    await service.processWebClaim({
      claim: { id: "handle-dup", claimToken: "claim-dup" },
      context: baseContext({ continuationClientTurnId: "async-cont:dup" }),
      request: { requestId: "req-dup", idempotencyKey: "async-cont:dup" } as never,
      timeoutMs: 30_000,
      callbacks: baseCallbacks(callbackCalls)
    });

    assert.deepEqual(callbackCalls, ["complete"]);
    assert.deepEqual(attemptCalls, ["claim"]);
    assert.ok(!callbackCalls.includes("markDispatched"));
    assert.ok(!callbackCalls.includes("busy"));
    assert.ok(!attemptCalls.includes("markRunning"));
  });

  test("typed busy outcome releases claim without markDispatched or resetToAccepted", async () => {
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
      attemptMock(attemptCalls),
      streamRegistryMock({
        onPublish: (input) => {
          published.push(input.event);
        }
      }),
      stopDispatchMock()
    );

    await service.processWebClaim({
      claim: { id: "handle-busy", claimToken: "claim-busy" },
      context: baseContext({ continuationClientTurnId: "async-cont:busy" }),
      request: { requestId: "req-busy", idempotencyKey: "async-cont:busy" } as never,
      timeoutMs: 30_000,
      callbacks: baseCallbacks(callbackCalls)
    });

    assert.deepEqual(callbackCalls, ["busy"]);
    assert.ok(!callbackCalls.includes("markDispatched"));
    assert.ok(!attemptCalls.includes("markFailed"));
    assert.ok(attemptCalls.includes("abandonPreAcceptanceAttempt"));
    assert.ok(!attemptCalls.includes("resetToAccepted"));
    assert.ok(!published.includes("failed"));
  });

  test("ADR-159 runtime duplicate releases claim like busy (not completeClaim)", async () => {
    const callbackCalls: string[] = [];
    const attemptCalls: string[] = [];
    const published: string[] = [];
    const service = new StreamWebAsyncContinuationService(
      {
        stream: async () => ({
          mode: "outcome",
          result: { outcome: "duplicate" }
        }),
        inspect: async () => ({
          proof: "proven",
          receiptStatus: "absent",
          exactInFlight: false,
          logicalReceiptStatus: "absent",
          logicalReceiptRequestId: null,
          logicalEverAccepted: false,
          logicalOrphanReconciled: false
        })
      } as never,
      attemptMock(attemptCalls),
      streamRegistryMock({
        onPublish: (input) => {
          published.push(input.event);
        }
      }),
      stopDispatchMock()
    );

    await service.processWebClaim({
      claim: { id: "handle-rt-dup", claimToken: "claim-rt-dup" },
      context: baseContext({ continuationClientTurnId: "async-cont:rt-dup" }),
      request: { requestId: "req-rt-dup", idempotencyKey: "async-cont:rt-dup" } as never,
      timeoutMs: 30_000,
      callbacks: baseCallbacks(callbackCalls)
    });

    assert.deepEqual(callbackCalls, ["busy"]);
    assert.ok(!callbackCalls.includes("complete"));
    assert.ok(!callbackCalls.includes("markDispatched"));
    assert.ok(attemptCalls.includes("markRunning"));
    assert.ok(attemptCalls.includes("abandonPreAcceptanceAttempt"));
    assert.ok(!attemptCalls.includes("markFailed"));
    assert.ok(!attemptCalls.includes("markCompleted"));
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
      attemptMock(attemptCalls),
      streamRegistryMock({
        onPublish: (input) => {
          published.push(input.event);
        }
      }),
      stopDispatchMock({ wasUserStopped: () => true })
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
    const callbackCalls: string[] = [];
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
      attemptMock(attemptCalls),
      streamRegistryMock({
        onPublish: (input) => {
          published.push(input.event);
        }
      }),
      stopDispatchMock()
    );

    await assert.rejects(
      service.processWebClaim({
        claim: { id: "handle-throw", claimToken: "claim-throw" },
        context: baseContext({ continuationClientTurnId: "async-cont:throw" }),
        request: { requestId: "req-throw", idempotencyKey: "async-cont:throw" } as never,
        timeoutMs: 30_000,
        callbacks: baseCallbacks(callbackCalls)
      }),
      (error: unknown) => error instanceof Error && error.message === "provider exploded"
    );
    assert.ok(callbackCalls.includes("markDispatched"));
    assert.ok(attemptCalls.includes("markFailed"));
    assert.ok(published.includes("failed"));
    assert.ok(!attemptCalls.includes("abandonPreAcceptanceAttempt"));
    assert.ok(!callbackCalls.includes("busy"));
  });

  test("mid-stream throw after accept with second markDispatched false does not abandon", async () => {
    const attemptCalls: string[] = [];
    const published: string[] = [];
    const callbackCalls: string[] = [];
    let markDispatchedCalls = 0;
    const service = new StreamWebAsyncContinuationService(
      {
        stream: async () => ({
          mode: "events",
          events: (async function* () {
            yield {
              type: "started",
              requestId: "req-second-false",
              sessionId: "session-1"
            };
            throw new Error("mid-stream after accept");
          })()
        })
      } as never,
      attemptMock(attemptCalls),
      streamRegistryMock({
        onPublish: (input) => {
          published.push(input.event);
        }
      }),
      stopDispatchMock()
    );

    const callbacks = {
      ...baseCallbacks(callbackCalls),
      markDispatched: async () => {
        markDispatchedCalls += 1;
        callbackCalls.push("markDispatched");
        // First call (ensureDispatched) succeeds; any later call is already-dispatched.
        return markDispatchedCalls === 1;
      }
    };

    await assert.rejects(
      service.processWebClaim({
        claim: { id: "handle-second-false", claimToken: "claim-second-false" },
        context: baseContext({ continuationClientTurnId: "async-cont:second-false" }),
        request: {
          requestId: "req-second-false",
          idempotencyKey: "async-cont:second-false"
        } as never,
        timeoutMs: 30_000,
        callbacks
      }),
      (error: unknown) => error instanceof Error && error.message === "mid-stream after accept"
    );

    assert.equal(markDispatchedCalls, 1);
    assert.ok(attemptCalls.includes("markFailed"));
    assert.ok(published.includes("failed"));
    assert.ok(!attemptCalls.includes("abandonPreAcceptanceAttempt"));
    assert.ok(!callbackCalls.includes("busy"));
  });

  test("stream accept (events mode) occurs before first markDispatched", async () => {
    const order: string[] = [];
    const callbackCalls: string[] = [];
    const service = new StreamWebAsyncContinuationService(
      {
        stream: async () => {
          order.push("stream_accept");
          return {
            mode: "events",
            events: (async function* () {
              order.push("first_event");
              yield {
                type: "started",
                requestId: "req-order",
                sessionId: "session-1"
              };
              yield {
                type: "completed",
                result: {
                  requestId: "req-order",
                  sessionId: "session-1",
                  assistantText: "ok",
                  answerText: "ok",
                  respondedAt: "2026-07-19T00:00:00.000Z",
                  artifacts: [],
                  usage: null
                }
              };
            })()
          };
        }
      } as never,
      attemptMock([]),
      streamRegistryMock(),
      stopDispatchMock()
    );

    await service.processWebClaim({
      claim: { id: "handle-order", claimToken: "claim-order" },
      context: baseContext({ continuationClientTurnId: "async-cont:order" }),
      request: { requestId: "req-order", idempotencyKey: "async-cont:order" } as never,
      timeoutMs: 30_000,
      callbacks: {
        ...baseCallbacks(callbackCalls),
        markDispatched: async () => {
          order.push("markDispatched");
          callbackCalls.push("markDispatched");
          return true;
        }
      }
    });

    // Runtime events-mode accept proves the lease before parking dispatched.
    assert.deepEqual(order.slice(0, 3), ["stream_accept", "markDispatched", "first_event"]);
  });

  test("pre-accept clear error releases busy without markDispatched", async () => {
    const attemptCalls: string[] = [];
    const callbackCalls: string[] = [];
    const published: string[] = [];
    const service = new StreamWebAsyncContinuationService(
      {
        stream: async () => {
          throw new Error("runtime continuation client is not configured");
        }
      } as never,
      attemptMock(attemptCalls),
      streamRegistryMock({
        onPublish: (input) => {
          published.push(input.event);
        }
      }),
      stopDispatchMock()
    );

    await assert.rejects(
      service.processWebClaim({
        claim: { id: "handle-preaccept", claimToken: "claim-preaccept" },
        context: baseContext({ continuationClientTurnId: "async-cont:preaccept" }),
        request: {
          requestId: "req-preaccept",
          idempotencyKey: "async-cont:preaccept"
        } as never,
        timeoutMs: 30_000,
        callbacks: baseCallbacks(callbackCalls)
      }),
      (error: unknown) =>
        error instanceof Error && error.message === "runtime continuation client is not configured"
    );

    assert.ok(!callbackCalls.includes("markDispatched"));
    assert.ok(attemptCalls.includes("abandonPreAcceptanceAttempt"));
    assert.ok(callbackCalls.includes("busy"));
    assert.ok(!attemptCalls.includes("markFailed"));
    assert.ok(!published.includes("failed"));
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
      attemptMock(attemptCalls),
      streamRegistryMock({
        onPublish: (input) => {
          published.push(input.event);
        }
      }),
      stopDispatchMock()
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
    assert.ok(callbackCalls.includes("markDispatched"));
    assert.ok(callbackCalls.includes("fail:continuation_stream_unterminated"));
  });

  test("logical acceptance after ambiguity terminalizes visibly without redispatch", async () => {
    const callbackCalls: string[] = [];
    const attemptCalls: string[] = [];
    const published: string[] = [];
    const service = new StreamWebAsyncContinuationService(
      {
        stream: async () => {
          throw new AsyncContinuationDispatchAmbiguousError(
            "Runtime continuation stream connection failed after acceptance became possible."
          );
        },
        inspect: async () => ({
          proof: "proven",
          receiptStatus: "absent",
          exactInFlight: false,
          logicalReceiptStatus: "failed",
          logicalReceiptRequestId: "prior-request",
          logicalEverAccepted: true,
          logicalOrphanReconciled: true
        })
      } as never,
      attemptMock(attemptCalls),
      streamRegistryMock({
        onPublish: (input) => {
          published.push(input.event);
        }
      }),
      stopDispatchMock()
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
    assert.ok(!callbackCalls.includes("markDispatched"));
    assert.deepEqual(callbackCalls, ["finalize:failed", "fail:continuation_dispatch_ambiguous"]);
  });

  test("proven fresh pre-accept absence releases ready without marking dispatched", async () => {
    const callbackCalls: string[] = [];
    const attemptCalls: string[] = [];
    const service = new StreamWebAsyncContinuationService(
      {
        stream: async () => {
          throw new AsyncContinuationDispatchAmbiguousError(
            "fresh API response was non-authoritative"
          );
        },
        inspect: async () => ({
          proof: "proven",
          receiptStatus: "absent",
          exactInFlight: false,
          logicalReceiptStatus: "absent",
          logicalReceiptRequestId: null,
          logicalEverAccepted: false,
          logicalOrphanReconciled: false
        })
      } as never,
      attemptMock(attemptCalls),
      streamRegistryMock(),
      stopDispatchMock()
    );

    await service.processWebClaim({
      claim: { id: "handle-fresh-absence", claimToken: "claim-fresh-absence" },
      context: baseContext({ continuationClientTurnId: "async-cont:fresh-absence" }),
      request: {
        requestId: "request-fresh-absence",
        idempotencyKey: "async-cont:fresh-absence"
      } as never,
      timeoutMs: 30_000,
      callbacks: baseCallbacks(callbackCalls)
    });

    assert.ok(attemptCalls.includes("abandonPreAcceptanceAttempt"));
    assert.deepEqual(callbackCalls, ["busy"]);
    assert.ok(!attemptCalls.includes("markFailed"));
    assert.ok(!callbackCalls.includes("markDispatched"));
  });

  test("unknown ambiguity terminalizes the attempt and releases the FIFO head visibly", async () => {
    const callbackCalls: string[] = [];
    const attemptCalls: string[] = [];
    const service = new StreamWebAsyncContinuationService(
      {
        stream: async () => {
          throw new AsyncContinuationDispatchAmbiguousError("status unavailable");
        },
        inspect: async () => ({
          proof: "ambiguous",
          receiptStatus: "absent",
          exactInFlight: false,
          logicalReceiptStatus: "absent",
          logicalReceiptRequestId: null,
          logicalEverAccepted: false,
          logicalOrphanReconciled: false
        })
      } as never,
      attemptMock(attemptCalls),
      streamRegistryMock(),
      stopDispatchMock()
    );

    await service.processWebClaim({
      claim: { id: "handle-unknown", claimToken: "claim-unknown" },
      context: baseContext({ continuationClientTurnId: "async-cont:unknown" }),
      request: { requestId: "request-unknown", idempotencyKey: "async-cont:unknown" } as never,
      timeoutMs: 30_000,
      callbacks: baseCallbacks(callbackCalls)
    });

    assert.ok(attemptCalls.includes("markFailed"));
    assert.deepEqual(callbackCalls, ["finalize:failed", "fail:continuation_dispatch_ambiguous"]);
    assert.ok(!callbackCalls.includes("markDispatched"));
  });

  test("ADR-159 admission boundary denial releases busy without stream", async () => {
    const callbackCalls: string[] = [];
    const attemptCalls: string[] = [];
    let streamed = false;
    const service = new StreamWebAsyncContinuationService(
      {
        stream: async () => {
          streamed = true;
          throw new Error("must not stream when gate denies");
        }
      } as never,
      attemptMock(attemptCalls),
      streamRegistryMock(),
      stopDispatchMock(),
      {
        admitCatchUpAtBoundary: async () => ({ allowed: false, reason: "idle_pause" })
      } as never
    );

    await service.processWebClaim({
      claim: { id: "handle-gate", claimToken: "claim-gate" },
      context: baseContext({ continuationClientTurnId: "async-cont:gate" }),
      request: { requestId: "req-gate", idempotencyKey: "async-cont:gate" } as never,
      timeoutMs: 30_000,
      callbacks: baseCallbacks(callbackCalls)
    });

    assert.equal(streamed, false);
    assert.ok(attemptCalls.includes("abandonPreAcceptanceAttempt"));
    assert.ok(callbackCalls.includes("busy"));
    assert.ok(!callbackCalls.includes("markDispatched"));
  });
});
