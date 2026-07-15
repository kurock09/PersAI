import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { loadApiConfig } from "@persai/config";
import { AssistantRuntimeError } from "../src/modules/workspace-management/application/assistant-runtime.facade";
import { toAssistantInboundFailurePayload } from "../src/modules/workspace-management/application/assistant-inbound-error";
import { resolveNativeRuntimeTurnTimeoutMs } from "../src/modules/workspace-management/application/native-runtime-turn-timeout";
import {
  createRuntimeStreamTurnDeadline,
  resolveRuntimeTurnStreamDeadlineConfig
} from "../src/modules/workspace-management/application/runtime-turn-deadline";
import { WebRuntimeStreamClientService } from "../src/modules/workspace-management/application/web-runtime-stream-client.service";
import type { AssistantMaterializedSpecRepository } from "../src/modules/workspace-management/domain/assistant-materialized-spec.repository";

const ORIGINAL_ENV = process.env;
const RUNTIME_TIER = "paid_shared_restricted" as const;

const VIDEO_WORKER_BUNDLE = {
  runtime: {
    workerTools: {
      tools: [
        { toolCode: "image_generate", timeoutMs: 180_000 },
        { toolCode: "video_generate", timeoutMs: 600_000 }
      ]
    }
  }
};

function setApiEnv(overrides?: Record<string, string | undefined>): void {
  process.env = {
    ...ORIGINAL_ENV,
    APP_ENV: "local",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public",
    CLERK_SECRET_KEY: "clerk-secret",
    PERSAI_INTERNAL_API_TOKEN: "persai-internal-token",
    PERSAI_RUNTIME_BASE_URL: "http://runtime.local",
    PERSAI_RUNTIME_TURN_WALL_CLOCK_MS: "1800000",
    PERSAI_RUNTIME_TURN_IDLE_STALL_MS: "300000",
    ...overrides
  };
}

function createMaterializedSpec(runtimeBundle: unknown = VIDEO_WORKER_BUNDLE) {
  return {
    id: "spec-1",
    assistantId: "assistant-1",
    publishedVersionId: "version-1",
    sourceAction: "publish" as const,
    algorithmVersion: 72,
    materializedAtConfigGeneration: 1,
    layers: {},
    runtimeBundle,
    assistantConfig: {},
    assistantWorkspace: {},
    layersDocument: "{}",
    runtimeBundleDocument: "{}",
    runtimeBundleHash: "bundle-hash-1",
    assistantConfigDocument: "{}",
    assistantWorkspaceDocument: "{}",
    contentHash: "content-hash-1",
    createdAt: new Date("2026-07-15T12:00:00.000Z")
  };
}

function createStreamService(
  materializedSpec = createMaterializedSpec()
): WebRuntimeStreamClientService {
  const repository: AssistantMaterializedSpecRepository = {
    findByPublishedVersionId: async () => materializedSpec,
    findLatestByAssistantId: async () => materializedSpec,
    create: async () => materializedSpec
  };
  return new WebRuntimeStreamClientService(repository);
}

function encodeNdjsonLines(lines: string[]): Uint8Array {
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
  mock.timers.reset();
});

describe("ADR-149 turn deadline split", () => {
  test("resolveNativeRuntimeTurnTimeoutMs uses wall clock only, not worker timeouts", () => {
    assert.equal(resolveNativeRuntimeTurnTimeoutMs(VIDEO_WORKER_BUNDLE, 1_800_000), 1_800_000);
    assert.equal(resolveNativeRuntimeTurnTimeoutMs(VIDEO_WORKER_BUNDLE, 90_000), 90_000);
    assert.notEqual(resolveNativeRuntimeTurnTimeoutMs(VIDEO_WORKER_BUNDLE, 90_000), 615_000);
  });

  test("resolveRuntimeTurnStreamDeadlineConfig reads ADR-149 env defaults", () => {
    setApiEnv({
      PERSAI_RUNTIME_TURN_WALL_CLOCK_MS: "1200000",
      PERSAI_RUNTIME_TURN_IDLE_STALL_MS: "240000"
    });
    const config = loadApiConfig(process.env);
    assert.deepEqual(resolveRuntimeTurnStreamDeadlineConfig(config), {
      wallClockMs: 1_200_000,
      idleStallMs: 240_000
    });
  });

  test("tool-loop progress resets survive beyond the legacy 615s cap with mock timers", () => {
    mock.timers.enable({ apis: ["setTimeout"] });

    const deadline = createRuntimeStreamTurnDeadline({
      wallClockMs: 900_000,
      idleStallMs: 120_000
    });

    const toolIterations = 24;
    const progressIntervalMs = 30_000;
    const totalSimulatedMs = toolIterations * progressIntervalMs;

    for (let iteration = 0; iteration < toolIterations; iteration += 1) {
      mock.timers.tick(progressIntervalMs);
      deadline.recordProgress();
      assert.equal(deadline.signal.aborted, false);
    }

    assert.ok(totalSimulatedMs > 615_000);
    deadline.dispose();
  });

  test("idle_stall and runtime_timeout map to distinct public codes", () => {
    assert.equal(
      toAssistantInboundFailurePayload(new AssistantRuntimeError("idle_stall", "no progress")).code,
      "turn_idle_stall"
    );
    assert.equal(
      toAssistantInboundFailurePayload(new AssistantRuntimeError("timeout", "wall clock")).code,
      "runtime_timeout"
    );
  });

  test("true stall without progress maps to public turn_idle_stall", async () => {
    setApiEnv({
      PERSAI_RUNTIME_TURN_WALL_CLOCK_MS: "600000",
      PERSAI_RUNTIME_TURN_IDLE_STALL_MS: "100"
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encodeNdjsonLines([
              JSON.stringify({
                type: "started",
                requestId: "runtime-request-1",
                sessionId: "runtime-session-1"
              }),
              JSON.stringify({
                type: "text_delta",
                requestId: "runtime-request-1",
                sessionId: "runtime-session-1",
                delta: "partial",
                accumulatedText: "partial"
              })
            ])
          );
        }
      });
      return new Response(stream, { status: 200 });
    }) as typeof fetch;

    const service = createStreamService();
    await assert.rejects(
      async () => {
        for await (const _chunk of service.execute({
          assistantId: "assistant-1",
          publishedVersionId: "version-1",
          runtimeTier: RUNTIME_TIER,
          surfaceThreadKey: "thread-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          userMessageId: "message-1",
          userMessage: "stall me",
          attachments: [],
          chatId: "chat-1"
        })) {
          // drain
        }
      },
      (error: unknown) => {
        assert.ok(error instanceof AssistantRuntimeError);
        assert.equal(error.code, "idle_stall");
        assert.equal(toAssistantInboundFailurePayload(error).code, "turn_idle_stall");
        return true;
      }
    );

    globalThis.fetch = originalFetch;
  });

  test("wall clock exceeded maps to runtime_timeout, not turn_idle_stall", async () => {
    setApiEnv({
      PERSAI_RUNTIME_TURN_WALL_CLOCK_MS: "100",
      PERSAI_RUNTIME_TURN_IDLE_STALL_MS: "60000"
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }) as typeof fetch;

    const service = createStreamService();
    await assert.rejects(
      async () => {
        for await (const _chunk of service.execute({
          assistantId: "assistant-1",
          publishedVersionId: "version-1",
          runtimeTier: RUNTIME_TIER,
          surfaceThreadKey: "thread-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          userMessageId: "message-1",
          userMessage: "wall clock",
          attachments: [],
          chatId: "chat-1"
        })) {
          // drain
        }
      },
      (error: unknown) => {
        assert.ok(error instanceof AssistantRuntimeError);
        assert.equal(error.code, "timeout");
        assert.equal(toAssistantInboundFailurePayload(error).code, "runtime_timeout");
        return true;
      }
    );

    globalThis.fetch = originalFetch;
  });
});

describe("createRuntimeStreamTurnDeadline with fake timers", () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] });
  });

  test("fires idle_stall when progress stops", () => {
    const deadline = createRuntimeStreamTurnDeadline({
      wallClockMs: 600_000,
      idleStallMs: 5_000
    });

    mock.timers.tick(5_001);

    assert.equal(deadline.signal.aborted, true);
    assert.equal(deadline.getAbortReason(), "idle_stall");
    deadline.dispose();
  });

  test("fires wall_clock when the hard ceiling is reached", () => {
    const deadline = createRuntimeStreamTurnDeadline({
      wallClockMs: 10_000,
      idleStallMs: 60_000
    });

    deadline.recordProgress();
    mock.timers.tick(10_001);

    assert.equal(deadline.signal.aborted, true);
    assert.equal(deadline.getAbortReason(), "wall_clock");
    deadline.dispose();
  });
});
