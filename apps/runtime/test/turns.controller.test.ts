import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, test } from "node:test";
import type { RuntimeSessionResolveInput, RuntimeTurnRequest } from "@persai/runtime-contract";
import { TurnsController } from "../src/modules/turns/interface/http/turns.controller";
import type { SessionStoreService } from "../src/modules/sessions/session-store.service";
import type { SessionCompactionService } from "../src/modules/turns/session-compaction.service";
import type { TurnExecutionService } from "../src/modules/turns/turn-execution.service";

class FakeRequest extends EventEmitter {
  headers: Record<string, string | string[] | undefined> = {};
}

class FakeResponse extends EventEmitter {
  headers = new Map<string, string>();
  writes: string[] = [];
  flushCount = 0;
  writableEnded = false;

  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return true;
  }

  flush(): void {
    this.flushCount += 1;
  }

  end(): void {
    this.writableEnded = true;
  }
}

describe("TurnsController", () => {
  test("coalesces flushes for rapid runtime text deltas", async () => {
    const controller = new TurnsController(
      {
        streamTurn: async function* () {
          yield {
            type: "started",
            requestId: "request-1",
            sessionId: "session-1"
          };
          yield {
            type: "text_delta",
            requestId: "request-1",
            sessionId: "session-1",
            delta: "Hel",
            accumulatedText: "Hel",
            source: "provider_text_delta"
          };
          yield {
            type: "text_delta",
            requestId: "request-1",
            sessionId: "session-1",
            delta: "lo",
            accumulatedText: "Hello",
            source: "provider_text_delta"
          };
          yield {
            type: "completed",
            result: {
              requestId: "request-1",
              sessionId: "session-1",
              assistantText: "Hello",
              respondedAt: "2026-05-11T12:00:00.000Z",
              toolCalls: [],
              outputArtifacts: [],
              usageAccounting: null,
              trace: null
            }
          };
        }
      } as unknown as TurnExecutionService,
      {} as SessionCompactionService,
      {} as SessionStoreService
    );
    const request: RuntimeTurnRequest = {
      requestId: "request-1",
      runtimeTier: "paid_shared_restricted",
      conversation: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        channel: "web",
        externalThreadKey: "thread-1",
        externalUserKey: "user-1",
        mode: "direct"
      },
      runtimeBundle: null,
      input: {
        messages: []
      }
    } as unknown as RuntimeTurnRequest;
    const res = new FakeResponse();

    await controller.streamTurn(new FakeRequest() as never, res as never, request);

    assert.equal(res.writes.length, 4);
    assert.equal(res.flushCount, 2);
    assert.equal(res.writableEnded, true);
  });

  test("maps session resolve requests to the native session store", async () => {
    const capturedInputs: RuntimeSessionResolveInput[] = [];
    const controller = new TurnsController(
      {} as TurnExecutionService,
      {} as SessionCompactionService,
      {
        resolveSession: async (input: RuntimeSessionResolveInput) => {
          capturedInputs.push(input);
          return {
            conversationKey: "conversation-key-1",
            found: true,
            session: {
              sessionId: "runtime-session-1",
              conversation: input.conversation,
              currentTokens: 18_250,
              totalTokensFresh: true,
              compactionCount: 1,
              compactionHintTokens: 18_250,
              priorToolMicroClearActive: false,
              priorToolMicroClearNextArmPercent: 50,
              priorToolMicroClearPendingEval: false,
              priorToolMicroClearLastArmPercent: null,
              providerKey: "openai",
              modelKey: "gpt-4.1",
              updatedAt: "2026-04-12T22:00:00.000Z"
            }
          };
        }
      } as unknown as SessionStoreService
    );

    const request: RuntimeSessionResolveInput = {
      runtimeTier: "paid_shared_restricted",
      conversation: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        channel: "web",
        externalThreadKey: "thread-1",
        externalUserKey: "user-1",
        mode: "direct"
      }
    };

    const result = await controller.resolveSession(request);

    assert.deepEqual(capturedInputs, [request]);
    assert.deepEqual(result, {
      found: true,
      session: {
        sessionId: "runtime-session-1",
        conversation: request.conversation,
        currentTokens: 18_250,
        totalTokensFresh: true,
        compactionCount: 1,
        compactionHintTokens: 18_250,
        priorToolMicroClearActive: false,
        priorToolMicroClearNextArmPercent: 50,
        priorToolMicroClearPendingEval: false,
        priorToolMicroClearLastArmPercent: null,
        providerKey: "openai",
        modelKey: "gpt-4.1",
        updatedAt: "2026-04-12T22:00:00.000Z"
      }
    });
  });
});
