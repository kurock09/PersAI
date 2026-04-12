import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RuntimeSessionResolveInput } from "@persai/runtime-contract";
import { TurnsController } from "../src/modules/turns/interface/http/turns.controller";
import type { SessionStoreService } from "../src/modules/sessions/session-store.service";
import type { SessionCompactionService } from "../src/modules/turns/session-compaction.service";
import type { TurnExecutionService } from "../src/modules/turns/turn-execution.service";

describe("TurnsController", () => {
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
        providerKey: "openai",
        modelKey: "gpt-4.1",
        updatedAt: "2026-04-12T22:00:00.000Z"
      }
    });
  });
});
