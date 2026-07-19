import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AssistantAsyncJobContinuationSchedulerService } from "../src/modules/workspace-management/application/assistant-async-job-continuation-scheduler.service";
import { MAX_ASYNC_CONTINUATION_DEPTH } from "../src/modules/workspace-management/application/assistant-async-job-handle-state.service";
import {
  AsyncContinuationCoordinationLostError,
  AsyncContinuationDispatchAmbiguousError
} from "../src/modules/workspace-management/application/internal-runtime-async-continuation.client.service";

const ORIGINAL_ENV = process.env;

const wakeCoordinatorStub = {
  claimReadyCatchUps: async () => [],
  releaseCatchUp: async () => undefined,
  heartbeatCatchUp: async () => true,
  catchUpHeartbeatIntervalMs: () => 20_000,
  admitCatchUpAtBoundary: async () => ({ allowed: true as const })
};

function dispatchHarness(input: {
  execute: () => Promise<Record<string, unknown>>;
  inspect?: () => Promise<Record<string, unknown>>;
  handleState?: Record<string, unknown>;
  telegramOutbound?: Record<string, unknown>;
  prisma?: Record<string, unknown>;
}) {
  const service = new AssistantAsyncJobContinuationSchedulerService(
    (input.prisma ?? {}) as never,
    (input.handleState ?? {}) as never,
    wakeCoordinatorStub as never,
    {
      execute: input.execute,
      inspect:
        input.inspect ??
        (async () => ({
          proof: "ambiguous",
          receiptStatus: "absent",
          exactInFlight: false
        }))
    } as never,
    {} as never,
    {} as never,
    (input.telegramOutbound ?? {}) as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
  const internal = service as unknown as {
    loadAndValidateContext: () => Promise<Record<string, unknown>>;
    buildRequest: () => Promise<{ request: Record<string, unknown>; timeoutMs: number }>;
    processClaim: (claim: { id: string; claimToken: string }) => Promise<void>;
  };
  internal.loadAndValidateContext = async () => ({
    handle: { retryCount: 0, channel: "web" }
  });
  internal.buildRequest = async () => ({
    request: { requestId: "dispatch-1" },
    timeoutMs: 50
  });
  return { service, internal };
}

describe("AssistantAsyncJobContinuationSchedulerService", () => {
  for (const [handleDepth, requestDepth] of [
    [0, 1],
    [1, 2],
    [3, 4]
  ] as const) {
    test(`builds scheduler continuation depth ${requestDepth} from handle depth ${handleDepth}`, async () => {
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
      try {
        const service = new AssistantAsyncJobContinuationSchedulerService(
          {} as never,
          {} as never,
          wakeCoordinatorStub as never,
          {} as never,
          { resolveByAssistantId: async () => "paid_shared_restricted" } as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {
            findByPublishedVersionId: async () => ({
              id: "spec-1",
              assistantId: "assistant-1",
              createdAt: new Date("2026-07-18T00:00:00.000Z"),
              runtimeBundle: {},
              runtimeBundleDocument: "{}"
            })
          } as never
        );
        const built = await (
          service as unknown as {
            buildRequest: (context: Record<string, unknown>) => Promise<{
              request: { continuation?: { depth: number } };
            }>;
          }
        ).buildRequest({
          handle: {
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            channel: "web",
            threadKey: "thread-1",
            continuationClientTurnId: `async-cont:depth-${handleDepth}`,
            continuationDepth: handleDepth,
            assistant: { applyAppliedVersionId: "version-1" },
            chat: {
              chatMode: "normal",
              deepModeEnabled: false,
              skillDecisionState: null
            }
          },
          session: { externalUserKey: "user-1", mode: "direct" },
          sourceUserMessage: { id: "00000000-0000-4000-8000-000000000001" },
          facts: {
            kind: "media",
            status: "completed",
            errorCode: null,
            message: "Completed."
          }
        });
        assert.equal(built.request.continuation?.depth, requestDepth);
      } finally {
        process.env = ORIGINAL_ENV;
      }
    });
  }

  test("ADR-159 S3: buildRequest emits structured job_catchup wake markers in continuation.facts", async () => {
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
    try {
      const service = new AssistantAsyncJobContinuationSchedulerService(
        {} as never,
        {} as never,
        wakeCoordinatorStub as never,
        {} as never,
        { resolveByAssistantId: async () => "paid_shared_restricted" } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {
          findByPublishedVersionId: async () => ({
            id: "spec-1",
            assistantId: "assistant-1",
            createdAt: new Date("2026-07-18T00:00:00.000Z"),
            runtimeBundle: {},
            runtimeBundleDocument: "{}"
          })
        } as never
      );
      const built = await (
        service as unknown as {
          buildRequest: (context: Record<string, unknown>) => Promise<{
            request: {
              message: { text: string };
              continuation?: {
                sourceUserMessageId: string;
                facts: Record<string, unknown>;
              };
            };
          }>;
        }
      ).buildRequest({
        handle: {
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          channel: "telegram",
          threadKey: "telegram:1:session:main",
          continuationClientTurnId: "async-cont:s3-markers",
          continuationDepth: 0,
          assistant: { applyAppliedVersionId: "version-1" },
          chat: {
            chatMode: "normal",
            deepModeEnabled: false,
            skillDecisionState: null
          }
        },
        session: { externalUserKey: null, mode: "direct" },
        sourceUserMessage: { id: "00000000-0000-4000-8000-0000000000aa" },
        facts: {
          kind: "sandbox",
          status: "completed",
          errorCode: null,
          message: "Sandbox job completed.",
          jobRef: "job_sandbox_s3",
          wakeKind: "job_catchup",
          queueOrdinal: 1,
          queueTotal: 2,
          interleaved: true,
          originatingUserMessageId: "00000000-0000-4000-8000-0000000000aa",
          latestUserMessageId: "00000000-0000-4000-8000-0000000000bb",
          sandboxResult: {
            toolCode: "shell",
            exitCode: 0,
            stdout: "ok",
            stderr: null,
            paths: []
          }
        }
      });
      assert.equal(built.request.message.text, "[internal async completion]");
      assert.equal(
        built.request.continuation?.sourceUserMessageId,
        "00000000-0000-4000-8000-0000000000aa"
      );
      const facts = built.request.continuation?.facts;
      assert.ok(facts);
      assert.equal(facts.wakeKind, "job_catchup");
      assert.equal(facts.jobRef, "job_sandbox_s3");
      assert.equal(facts.queueOrdinal, 1);
      assert.equal(facts.queueTotal, 2);
      assert.equal(facts.interleaved, true);
      assert.equal(facts.originatingUserMessageId, "00000000-0000-4000-8000-0000000000aa");
      assert.equal(facts.latestUserMessageId, "00000000-0000-4000-8000-0000000000bb");
      assert.equal(facts.kind, "sandbox");
      assert.equal(facts.status, "completed");
      assert.deepEqual(facts.sandboxResult, {
        toolCode: "shell",
        exitCode: 0,
        stdout: "ok",
        stderr: null,
        paths: []
      });
    } finally {
      process.env = ORIGINAL_ENV;
    }
  });

  test("ADR-159: resolveCatchUpWakeMarkers prefers durable stamped ordinal/total", async () => {
    const readyAtB = new Date("2026-07-19T12:01:00.000Z");
    const sourceFinalizedAt = new Date("2026-07-19T11:59:00.000Z");
    const prisma = {
      assistantAsyncJobHandle: {
        findMany: async () => {
          throw new Error("must not fall back to ready-sibling count when stamped");
        }
      },
      assistantChatMessage: {
        findFirst: async (args: {
          where?: { createdAt?: { gt?: Date }; NOT?: { id?: string } };
          orderBy?: { createdAt?: "asc" | "desc" };
        }) => {
          if (args.where?.createdAt?.gt !== undefined) {
            return { id: "user-followup" };
          }
          if (args.orderBy?.createdAt === "desc") {
            return { id: "user-followup" };
          }
          return null;
        }
      }
    };
    const service = new AssistantAsyncJobContinuationSchedulerService(
      prisma as never,
      {} as never,
      wakeCoordinatorStub as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const markers = await (
      service as unknown as {
        resolveCatchUpWakeMarkers: (input: Record<string, unknown>) => Promise<{
          wakeKind: string;
          queueOrdinal: number;
          queueTotal: number;
          interleaved: boolean;
          originatingUserMessageId: string;
          latestUserMessageId?: string;
        }>;
      }
    ).resolveCatchUpWakeMarkers({
      handleId: "handle-b",
      chatId: "chat-1",
      assistantId: "assistant-1",
      readyAt: readyAtB,
      updatedAt: readyAtB,
      sourceFinalizedAt,
      catchUpOrdinal: 2,
      catchUpWaveTotal: 2,
      catchUpWaveId: "wave-1",
      originatingUserMessageId: "user-source",
      sourceUserMessageCreatedAt: new Date("2026-07-19T11:58:00.000Z")
    });
    assert.deepEqual(markers, {
      wakeKind: "job_catchup",
      queueOrdinal: 2,
      queueTotal: 2,
      interleaved: true,
      originatingUserMessageId: "user-source",
      latestUserMessageId: "user-followup"
    });
  });

  test("ADR-159: sequential two-handle dispatch keeps stable ordinal 1/2 then 2/2", async () => {
    const waveId = "00000000-0000-4000-8000-0000000000w1";
    const readyAtA = new Date("2026-07-19T12:00:00.000Z");
    const readyAtB = new Date("2026-07-19T12:01:00.000Z");
    const sourceFinalizedAt = new Date("2026-07-19T11:59:00.000Z");
    // Simulate durable stamps after both became ready (wave total already 2).
    const stamped = {
      "handle-a": { catchUpOrdinal: 1, catchUpWaveTotal: 2, catchUpWaveId: waveId },
      "handle-b": { catchUpOrdinal: 2, catchUpWaveTotal: 2, catchUpWaveId: waveId }
    };
    const service = new AssistantAsyncJobContinuationSchedulerService(
      {
        assistantAsyncJobHandle: {
          findMany: async () => {
            throw new Error("stamped path must not query siblings");
          }
        },
        assistantChatMessage: {
          findFirst: async () => null
        }
      } as never,
      {} as never,
      wakeCoordinatorStub as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const resolve = (
      service as unknown as {
        resolveCatchUpWakeMarkers: (input: Record<string, unknown>) => Promise<{
          queueOrdinal: number;
          queueTotal: number;
        }>;
      }
    ).resolveCatchUpWakeMarkers.bind(service);

    // Dispatch #1 — handle-a claimed; handle-b still ready. Remaining-ready
    // count would wrongly yield 1/1; durable stamps keep 1/2.
    const first = await resolve({
      handleId: "handle-a",
      chatId: "chat-1",
      assistantId: "assistant-1",
      readyAt: readyAtA,
      updatedAt: readyAtA,
      sourceFinalizedAt,
      ...stamped["handle-a"],
      originatingUserMessageId: "user-source",
      sourceUserMessageCreatedAt: new Date("2026-07-19T11:58:00.000Z")
    });
    assert.deepEqual(
      { queueOrdinal: first.queueOrdinal, queueTotal: first.queueTotal },
      { queueOrdinal: 1, queueTotal: 2 }
    );

    // Dispatch #2 — handle-a completed (gone from ready); stamps still 2/2.
    const second = await resolve({
      handleId: "handle-b",
      chatId: "chat-1",
      assistantId: "assistant-1",
      readyAt: readyAtB,
      updatedAt: readyAtB,
      sourceFinalizedAt,
      ...stamped["handle-b"],
      originatingUserMessageId: "user-source",
      sourceUserMessageCreatedAt: new Date("2026-07-19T11:58:00.000Z")
    });
    assert.deepEqual(
      { queueOrdinal: second.queueOrdinal, queueTotal: second.queueTotal },
      { queueOrdinal: 2, queueTotal: 2 }
    );
  });

  test("loadAndValidateContext rejects a handle at the shared MAX_ASYNC_CONTINUATION_DEPTH constant, not a private hardcoded literal", async () => {
    const prisma = {
      assistantAsyncJobHandle: {
        findUnique: async () => ({
          state: "claimed",
          threadKey: "thread-1",
          continuationClientTurnId: "async-cont:depth-max",
          sourceUserMessageId: "00000000-0000-4000-8000-000000000001",
          continuationDepth: MAX_ASYNC_CONTINUATION_DEPTH,
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          userId: "user-1",
          channel: "web",
          chat: {
            archivedAt: null,
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            userId: "user-1",
            surface: "web",
            surfaceThreadKey: "thread-1"
          },
          assistant: {
            workspaceId: "workspace-1",
            userId: "user-1",
            applyAppliedVersionId: "version-1"
          }
        })
      }
    };
    const service = new AssistantAsyncJobContinuationSchedulerService(
      prisma as never,
      {} as never,
      wakeCoordinatorStub as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const result = await (
      service as unknown as { loadAndValidateContext: (id: string) => Promise<unknown> }
    ).loadAndValidateContext("handle-depth-max");
    assert.equal(
      result,
      null,
      "a handle at the shared max continuation depth must be rejected before dispatch"
    );
  });

  for (const scenario of [
    {
      name: "accepts native web without a persisted binding",
      channel: "web",
      binding: null,
      expectedValid: true
    },
    {
      name: "rejects Telegram without a persisted binding",
      channel: "telegram",
      binding: null,
      expectedValid: false
    },
    {
      name: "rejects Telegram with an inactive binding",
      channel: "telegram",
      binding: { bindingState: "inactive" },
      expectedValid: false
    },
    {
      name: "accepts Telegram with an active binding",
      channel: "telegram",
      binding: { bindingState: "active" },
      expectedValid: true
    },
    {
      name: "rejects a foreign chat before channel validation",
      channel: "web",
      binding: null,
      chatUserId: "foreign-user",
      expectedValid: false
    },
    {
      name: "rejects a missing matching runtime session",
      channel: "web",
      binding: null,
      session: null,
      expectedValid: false
    },
    {
      name: "rejects a nonterminal canonical job",
      channel: "web",
      binding: null,
      canonicalStatus: "running",
      expectedValid: false
    },
    {
      name: "accepts delivery-visible completion_pending with attachment",
      channel: "web",
      binding: null,
      canonicalStatus: "completion_pending",
      completionAssistantMessageId: "msg-completion-1",
      attachmentPresent: true,
      expectedValid: true
    },
    {
      name: "accepts failed canonical with deliveredAt from failure notice",
      channel: "web",
      binding: null,
      canonicalStatus: "failed",
      deliveredAt: new Date("2026-07-18T12:00:00.000Z"),
      expectedValid: true
    }
  ] as const) {
    test(`loadAndValidateContext ${scenario.name}`, async () => {
      const channel = scenario.channel;
      const handle = {
        id: "handle-1",
        state: "claimed",
        threadKey: "thread-1",
        continuationClientTurnId: "async-cont:handle-1",
        sourceUserMessageId: "00000000-0000-4000-8000-000000000001",
        continuationDepth: 0,
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        userId: "user-1",
        chatId: "chat-1",
        channel,
        kind: "media" as const,
        jobRef: "jr-media-1",
        canonicalJobId: "job-1",
        runtimeSessionId: null,
        readyAt: new Date("2026-07-18T12:00:00.000Z"),
        updatedAt: new Date("2026-07-18T12:00:00.000Z"),
        sourceFinalizedAt: new Date("2026-07-18T11:59:00.000Z"),
        chat: {
          archivedAt: null,
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          userId: scenario.chatUserId ?? "user-1",
          surface: channel,
          surfaceThreadKey: "thread-1"
        },
        assistant: {
          workspaceId: "workspace-1",
          userId: "user-1",
          applyAppliedVersionId: "version-1"
        }
      };
      let bindingLookups = 0;
      const terminalForScenario = (() => {
        if (scenario.canonicalStatus === "running") {
          return { status: "pending" as const, errorCode: null, message: "", sandboxResult: null };
        }
        if (scenario.canonicalStatus === "failed") {
          return {
            status: "failed" as const,
            errorCode: "provider_error",
            message: "Job failed.",
            sandboxResult: null
          };
        }
        if (
          scenario.canonicalStatus === "completion_pending" &&
          "attachmentPresent" in scenario &&
          scenario.attachmentPresent
        ) {
          return {
            status: "completed" as const,
            errorCode: null,
            message: "Job completed and was delivered.",
            sandboxResult: null
          };
        }
        return {
          status: "completed" as const,
          errorCode: null,
          message: "Job completed and was delivered.",
          sandboxResult: null
        };
      })();
      const prisma = {
        assistantAsyncJobHandle: {
          findUnique: async () => handle,
          findMany: async () => [
            {
              id: handle.id,
              readyAt: handle.readyAt,
              updatedAt: handle.updatedAt
            }
          ]
        },
        assistantChannelSurfaceBinding: {
          findUnique: async () => {
            bindingLookups += 1;
            return scenario.binding;
          }
        },
        runtimeSession: {
          findFirst: async () =>
            scenario.session === null
              ? null
              : { id: "session-1", assistantId: "assistant-1", workspaceId: "workspace-1" }
        },
        assistantChatMessage: {
          findFirst: async (args: {
            where?: { createdAt?: { gt?: Date }; NOT?: unknown };
            orderBy?: { createdAt?: "asc" | "desc" };
          }) => {
            if (args.where?.createdAt?.gt !== undefined || args.orderBy?.createdAt === "desc") {
              return null;
            }
            return {
              id: "00000000-0000-4000-8000-000000000001",
              createdAt: new Date("2026-07-18T11:58:00.000Z")
            };
          }
        }
      };
      const service = new AssistantAsyncJobContinuationSchedulerService(
        prisma as never,
        {
          readCanonicalTerminal: async () => terminalForScenario
        } as never,
        wakeCoordinatorStub as never,
        {} as never,
        {} as never,
        { enforceInboundTurn: async () => undefined } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        { findById: async () => handle.assistant } as never,
        {} as never
      );
      const result = await (
        service as unknown as { loadAndValidateContext: (id: string) => Promise<unknown> }
      ).loadAndValidateContext(handle.id);

      assert.equal(result !== null, scenario.expectedValid);
      assert.equal(
        bindingLookups,
        channel === "telegram" && scenario.chatUserId === undefined ? 1 : 0
      );
    });
  }

  test("loadAndValidateContext forwards sandboxResult into continuation facts for notify wake", async () => {
    const sandboxResult = {
      toolCode: "shell" as const,
      exitCode: 0,
      stdout: "BTC/USD 64788\n",
      stderr: null,
      paths: ["btc-samples.txt"]
    };
    const handle = {
      id: "handle-sandbox-1",
      state: "claimed",
      threadKey: "thread-1",
      continuationClientTurnId: "async-cont:sandbox-1",
      sourceUserMessageId: "00000000-0000-4000-8000-000000000001",
      continuationDepth: 0,
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      chatId: "chat-1",
      channel: "web" as const,
      kind: "sandbox" as const,
      jobRef: "jr1.sandbox.opaque",
      canonicalJobId: "sandbox-job-1",
      runtimeSessionId: "session-1",
      readyAt: new Date("2026-07-19T12:00:00.000Z"),
      updatedAt: new Date("2026-07-19T12:00:00.000Z"),
      sourceFinalizedAt: new Date("2026-07-19T11:59:00.000Z"),
      chat: {
        archivedAt: null,
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        userId: "user-1",
        surface: "web",
        surfaceThreadKey: "thread-1"
      },
      assistant: {
        workspaceId: "workspace-1",
        userId: "user-1",
        applyAppliedVersionId: "version-1"
      }
    };
    const service = new AssistantAsyncJobContinuationSchedulerService(
      {
        assistantAsyncJobHandle: {
          findUnique: async () => handle,
          findMany: async () => [
            {
              id: handle.id,
              readyAt: handle.readyAt,
              updatedAt: handle.updatedAt
            }
          ]
        },
        runtimeSession: {
          findFirst: async () => ({
            id: "session-1",
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            externalUserKey: "user-1",
            mode: "direct"
          })
        },
        assistantChatMessage: {
          findFirst: async (args: {
            where?: { createdAt?: { gt?: Date } };
            orderBy?: { createdAt?: "asc" | "desc" };
          }) => {
            if (args.where?.createdAt?.gt !== undefined || args.orderBy?.createdAt === "desc") {
              return null;
            }
            return {
              id: "00000000-0000-4000-8000-000000000001",
              createdAt: new Date("2026-07-19T11:58:00.000Z")
            };
          }
        }
      } as never,
      {
        readCanonicalTerminal: async () => ({
          status: "completed",
          errorCode: null,
          message: "Sandbox job completed.",
          sandboxResult
        })
      } as never,
      wakeCoordinatorStub as never,
      {} as never,
      {} as never,
      { enforceInboundTurn: async () => undefined } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { findById: async () => handle.assistant } as never,
      {} as never
    );
    const context = await (
      service as unknown as {
        loadAndValidateContext: (id: string) => Promise<{
          facts: {
            kind: string;
            sandboxResult?: typeof sandboxResult;
            jobRef?: string;
            wakeKind?: string;
            queueOrdinal?: number;
            queueTotal?: number;
            interleaved?: boolean;
            originatingUserMessageId?: string;
            latestUserMessageId?: string;
          };
        } | null>;
      }
    ).loadAndValidateContext(handle.id);
    assert.ok(context !== null);
    assert.equal(context.facts.kind, "sandbox");
    assert.equal(context.facts.jobRef, "jr1.sandbox.opaque");
    assert.deepEqual(context.facts.sandboxResult, sandboxResult);
    assert.equal(context.facts.wakeKind, "job_catchup");
    assert.equal(context.facts.queueOrdinal, 1);
    assert.equal(context.facts.queueTotal, 1);
    assert.equal(context.facts.interleaved, false);
    assert.equal(context.facts.originatingUserMessageId, "00000000-0000-4000-8000-000000000001");
    assert.equal(context.facts.latestUserMessageId, undefined);
  });

  test("delivery-visible reconciler promotes subscribed media when attachment is visible", async () => {
    const completions: Array<Record<string, unknown>> = [];
    const service = new AssistantAsyncJobContinuationSchedulerService(
      {
        assistantAsyncJobHandle: {
          findMany: async (input: { where: Record<string, unknown> }) => {
            if (
              typeof input.where.kind === "object" &&
              input.where.kind !== null &&
              "in" in (input.where.kind as object)
            ) {
              return [
                {
                  kind: "media",
                  canonicalJobId: "job-media-1",
                  runtimeSessionId: null
                }
              ];
            }
            return [];
          }
        }
      } as never,
      {
        readCanonicalTerminal: async () => ({
          status: "completed",
          errorCode: null,
          message: "Job completed and was delivered.",
          sandboxResult: null
        }),
        recordCanonicalCompletion: async (input: Record<string, unknown>) => {
          completions.push(input);
          return { decision: "skip_legacy_frame", state: "ready" };
        }
      } as never,
      wakeCoordinatorStub as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    await (
      service as unknown as { processDueBatch: (limit?: number) => Promise<number> }
    ).processDueBatch(8);
    assert.equal(completions.length, 1);
    assert.equal(completions[0]?.kind, "media");
    assert.equal(completions[0]?.terminalStatus, "completed");
  });

  test("reconciler scans bounded old unfinalized handles without requiring terminal observation", async () => {
    let sourceWhere: Record<string, unknown> | null = null;
    const service = new AssistantAsyncJobContinuationSchedulerService(
      {
        assistantAsyncJobHandle: {
          findMany: async (input: { where: Record<string, unknown> }) => {
            if ("sourceFinalizedAt" in input.where) sourceWhere = input.where;
            return [];
          }
        }
      } as never,
      {} as never,
      wakeCoordinatorStub as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    await service.processDueBatch(4);
    assert.ok(sourceWhere !== null);
    assert.equal("terminalObservedAt" in sourceWhere, false);
    assert.equal("updatedAt" in sourceWhere, true);
  });

  test("lost child finalization is repaired from continuation message metadata", async () => {
    let queryValues: unknown[] = [];
    const finalized: Array<Record<string, unknown>> = [];
    const service = new AssistantAsyncJobContinuationSchedulerService(
      {
        assistantAsyncJobHandle: {
          findMany: async (input: { where: Record<string, unknown> }) =>
            "sourceFinalizedAt" in input.where
              ? [
                  {
                    assistantId: "assistant-1",
                    chatId: "chat-1",
                    sourceClientTurnId: "async-cont:parent-3",
                    sourceUserMessageId: "00000000-0000-4000-8000-000000000001",
                    createdAt: new Date(0)
                  }
                ]
              : []
        },
        $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
          queryValues = values;
          return [{ id: "assistant-message-3" }];
        }
      } as never,
      {
        finalizeSourceTurn: async (input: Record<string, unknown>) => {
          finalized.push(input);
        }
      } as never,
      wakeCoordinatorStub as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    await service.processDueBatch(4);
    assert.equal(queryValues.includes("asyncContinuationClientTurnId"), true);
    assert.equal(queryValues.includes("async-cont:parent-3"), true);
    assert.equal(finalized[0]?.outcome, "persisted");
    assert.equal(finalized[0]?.assistantMessageId, "assistant-message-3");
  });

  test("requeues an expired claimed row before claiming ready work", async () => {
    const calls: string[] = [];
    const requeues: Array<Record<string, unknown>> = [];
    const prisma = {
      assistantAsyncJobHandle: {
        async findMany(input: { where: Record<string, unknown> }) {
          if ("sourceFinalizedAt" in input.where) return [];
          return [
            {
              id: "handle-1",
              state: "claimed",
              claimToken: "claim-1",
              retryCount: 1,
              dispatchReceiptRequestId: null,
              continuationAssistantMessageId: null
            }
          ];
        },
        async findUnique() {
          return { retryCount: 1, state: "claimed" };
        }
      }
    };
    const handleState = {
      async requeueClaim(input: Record<string, unknown>) {
        calls.push("requeue");
        requeues.push(input);
        return "requeued";
      }
    };
    const coordinator = {
      async claimReadyCatchUps() {
        calls.push("claim");
        return [];
      },
      async releaseCatchUp() {},
      async heartbeatCatchUp() {
        return true;
      },
      catchUpHeartbeatIntervalMs() {
        return 20_000;
      },
      async admitCatchUpAtBoundary() {
        return { allowed: true as const };
      }
    };
    const service = new AssistantAsyncJobContinuationSchedulerService(
      prisma as never,
      handleState as never,
      coordinator as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    assert.equal(await service.processDueBatch(4), 0);
    assert.deepEqual(calls, ["requeue", "claim"]);
    assert.equal(requeues[0]?.errorCode, "continuation_claim_expired");
    assert.equal("dispatchedProof" in (requeues[0] ?? {}), false);
  });

  test("leaves an expired dispatched row ambiguous while a receipt exists", async () => {
    let requeued = false;
    const prisma = {
      assistantAsyncJobHandle: {
        async findMany(input: { where: Record<string, unknown> }) {
          if ("sourceFinalizedAt" in input.where) return [];
          return [
            {
              id: "handle-2",
              assistantId: "assistant-1",
              workspaceId: "workspace-1",
              chatId: "chat-1",
              channel: "web",
              state: "dispatched",
              claimToken: "claim-2",
              retryCount: 1,
              dispatchReceiptRequestId: "receipt-2",
              continuationAssistantMessageId: null
            }
          ];
        }
      },
      runtimeTurnReceipt: {
        async findUnique() {
          return { status: "accepted" };
        }
      }
    };
    const handleState = {
      async requeueClaim() {
        requeued = true;
        return "requeued";
      }
    };
    const service = new AssistantAsyncJobContinuationSchedulerService(
      prisma as never,
      handleState as never,
      wakeCoordinatorStub as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    await service.processDueBatch(4);
    assert.equal(requeued, false);
  });

  test("leaves an expired dispatch while the exact runtime turn is in flight", async () => {
    let requeued = false;
    const service = new AssistantAsyncJobContinuationSchedulerService(
      {
        assistantAsyncJobHandle: {
          findMany: async (input: { where: Record<string, unknown> }) =>
            "sourceFinalizedAt" in input.where
              ? []
              : [
                  {
                    id: "handle-live",
                    channel: "web",
                    state: "dispatched",
                    claimToken: "claim-live",
                    retryCount: 1,
                    dispatchReceiptRequestId: "dispatch-live",
                    continuationAssistantMessageId: null,
                    continuationArtifactsResult: null,
                    continuationExternalResult: null
                  }
                ]
        },
        runtimeTurnReceipt: { findUnique: async () => null }
      } as never,
      {
        requeueClaim: async () => {
          requeued = true;
        }
      } as never,
      wakeCoordinatorStub as never,
      {
        inspect: async () => ({
          proof: "proven",
          receiptStatus: "absent",
          exactInFlight: true
        })
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const internal = service as unknown as {
      loadAndValidateContext: () => Promise<Record<string, unknown>>;
      buildRequest: () => Promise<{ request: Record<string, unknown>; timeoutMs: number }>;
    };
    internal.loadAndValidateContext = async () => ({ session: { id: "session-1" } });
    internal.buildRequest = async () => ({
      request: { requestId: "new", idempotencyKey: "async-cont:live" },
      timeoutMs: 100
    });
    await service.processDueBatch(4);
    assert.equal(requeued, false);
  });

  test("ADR-159 S2 TOCTOU: TG pre-runtime gate denial releases claim without execute", async () => {
    let executeCalled = false;
    let markDispatchedCalled = false;
    const releases: Array<Record<string, unknown>> = [];
    const gateArgs: Array<Record<string, unknown>> = [];
    const service = new AssistantAsyncJobContinuationSchedulerService(
      {} as never,
      {
        markDispatched: async () => {
          markDispatchedCalled = true;
          return true;
        },
        releaseClaimToReady: async (value: Record<string, unknown>) => {
          releases.push(value);
          return "released";
        }
      } as never,
      {
        ...wakeCoordinatorStub,
        admitCatchUpAtBoundary: async (input: Record<string, unknown>) => {
          gateArgs.push(input);
          return { allowed: false as const, reason: "user_turn_active" as const };
        }
      } as never,
      {
        execute: async () => {
          executeCalled = true;
          return { outcome: "completed" };
        }
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const internal = service as unknown as {
      loadAndValidateContext: () => Promise<Record<string, unknown>>;
      buildRequest: () => Promise<{ request: Record<string, unknown>; timeoutMs: number }>;
      processClaim: (claim: { id: string; claimToken: string }) => Promise<void>;
    };
    internal.loadAndValidateContext = async () => ({
      handle: {
        id: "handle-tg-toctou",
        retryCount: 0,
        channel: "telegram",
        chatId: "chat-tg",
        assistantId: "assistant-1",
        userId: "user-1",
        threadKey: "telegram:1:session:main"
      },
      sourceUserMessage: { id: "user-msg-1" }
    });
    internal.buildRequest = async () => ({
      request: { requestId: "dispatch-tg-toctou" },
      timeoutMs: 50
    });
    await internal.processClaim({ id: "handle-tg-toctou", claimToken: "claim-tg" });
    assert.equal(executeCalled, false);
    assert.equal(markDispatchedCalled, false);
    assert.equal(releases.length, 1);
    assert.equal(releases[0]?.id, "handle-tg-toctou");
    assert.ok(releases[0]?.retryAt instanceof Date);
    assert.equal(gateArgs.length, 1);
    assert.equal(gateArgs[0]?.chatId, "chat-tg");
    assert.equal(gateArgs[0]?.surfaceThreadKey, "telegram:1:session:main");
  });

  test("typed busy releases claimed→ready without markDispatched or parked accepted", async () => {
    const calls: Array<Record<string, unknown>> = [];
    let markDispatchedCalled = false;
    const { internal } = dispatchHarness({
      execute: async () => ({ outcome: "busy" }),
      handleState: {
        markDispatched: async () => {
          markDispatchedCalled = true;
          return true;
        },
        releaseClaimToReady: async (value: Record<string, unknown>) => {
          calls.push(value);
          return "released";
        }
      }
    });
    await internal.processClaim({ id: "handle-1", claimToken: "claim-1" });
    assert.equal(markDispatchedCalled, false);
    assert.equal(calls.length, 1);
    assert.equal("receiptRequestId" in (calls[0] ?? {}), false);
    assert.ok(calls[0]?.retryAt instanceof Date);
  });

  test("ADR-159 runtime duplicate releases claimed→ready (not completeClaim)", async () => {
    const releaseCalls: Array<Record<string, unknown>> = [];
    let markDispatchedCalled = false;
    let completeClaimCalled = false;
    const { internal } = dispatchHarness({
      execute: async () => ({ outcome: "duplicate" }),
      handleState: {
        markDispatched: async () => {
          markDispatchedCalled = true;
          return true;
        },
        releaseClaimToReady: async (value: Record<string, unknown>) => {
          releaseCalls.push(value);
          return "released";
        },
        completeClaim: async () => {
          completeClaimCalled = true;
          return true;
        }
      }
    });
    await internal.processClaim({ id: "handle-rt-dup", claimToken: "claim-rt-dup" });
    assert.equal(markDispatchedCalled, false);
    assert.equal(completeClaimCalled, false);
    assert.equal(releaseCalls.length, 1);
    assert.equal(releaseCalls[0]?.id, "handle-rt-dup");
    assert.equal("receiptRequestId" in (releaseCalls[0] ?? {}), false);
    assert.ok(releaseCalls[0]?.retryAt instanceof Date);
  });

  test("busy-before-acceptance still releases claimed→ready when retryCount is already at max-1", async () => {
    const busyCalls: Array<Record<string, unknown>> = [];
    let failCalled = false;
    let requeueClaimCalled = false;
    let markDispatchedCalled = false;
    const { internal } = dispatchHarness({
      execute: async () => ({ outcome: "busy" }),
      handleState: {
        markDispatched: async () => {
          markDispatchedCalled = true;
          return true;
        },
        releaseClaimToReady: async (value: Record<string, unknown>) => {
          busyCalls.push(value);
          return "released";
        },
        requeueClaim: async () => {
          requeueClaimCalled = true;
          return "exhausted";
        },
        failClaim: async () => {
          failCalled = true;
          return { applied: true, observation: null };
        },
        getPermanentFailureObservation: async () => null
      }
    });
    internal.loadAndValidateContext = async () => ({
      handle: { retryCount: 7, channel: "telegram" }
    });
    await internal.processClaim({ id: "handle-busy-budget", claimToken: "claim-busy" });
    assert.equal(markDispatchedCalled, false);
    assert.equal(busyCalls.length, 1);
    assert.equal(failCalled, false);
    assert.equal(requeueClaimCalled, false);
  });

  test("timed-out dispatch remains dispatched for reconciliation", async () => {
    let requeued = false;
    const { internal } = dispatchHarness({
      execute: async () => {
        throw new AsyncContinuationDispatchAmbiguousError("timed out");
      },
      inspect: async () => ({
        proof: "proven",
        receiptStatus: "accepted",
        exactInFlight: true
      }),
      handleState: {
        markDispatched: async () => true,
        requeueClaim: async () => {
          requeued = true;
        },
        failClaim: async () => {
          requeued = true;
          return { applied: true, observation: null };
        },
        getPermanentFailureObservation: async () => null
      }
    });
    internal.loadAndValidateContext = async () => ({
      handle: { retryCount: 0, channel: "telegram" },
      session: { id: "session-1" }
    });
    await internal.processClaim({ id: "handle-2", claimToken: "claim-2" });
    assert.equal(requeued, false);
  });

  test("durable continuation output immediately finalizes only its child source turn", async () => {
    const calls: string[] = [];
    const finalized: Array<Record<string, unknown>> = [];
    const { internal } = dispatchHarness({
      execute: async () => ({
        outcome: "completed",
        duplicate: false,
        result: {
          requestId: "runtime-1",
          sessionId: "session-1",
          assistantText: "Done.",
          answerText: "Done.",
          artifacts: [],
          respondedAt: "2026-07-18T00:00:00.000Z",
          usage: null
        }
      }),
      prisma: {
        $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            $queryRaw: async () => [{ messageId: null }],
            assistantChatMessage: {
              create: async () => {
                calls.push("persist");
                return { id: "assistant-message-1" };
              }
            },
            assistantAsyncJobHandle: { updateMany: async () => ({ count: 1 }) }
          }),
        assistantAsyncJobHandle: {
          findFirst: async () => ({
            continuationArtifactsResult: "not_needed",
            continuationExternalResult: null
          })
        }
      },
      handleState: {
        markDispatched: async () => true,
        finalizeSourceTurn: async (input: Record<string, unknown>) => {
          calls.push("finalize");
          finalized.push(input);
        },
        claimDeliveryAttempt: async () => "claimed",
        recordDeliveryAttemptResult: async () => true,
        completeClaim: async () => true
      }
    });
    internal.loadAndValidateContext = async () => ({
      handle: {
        retryCount: 0,
        channel: "web",
        assistantId: "assistant-1",
        chatId: "chat-1",
        continuationClientTurnId: "async-cont:parent-1"
      }
    });
    await internal.processClaim({ id: "handle-1", claimToken: "claim-1" });
    assert.deepEqual(calls.slice(0, 2), ["persist", "finalize"]);
    assert.deepEqual(finalized, [
      {
        assistantId: "assistant-1",
        chatId: "chat-1",
        sourceClientTurnId: "async-cont:parent-1",
        outcome: "persisted",
        assistantMessageId: "assistant-message-1"
      }
    ]);
  });

  test("interrupted continuation receipt releases child source turns as stopped", async () => {
    const finalized: Array<Record<string, unknown>> = [];
    let failed = false;
    const service = new AssistantAsyncJobContinuationSchedulerService(
      {
        assistantAsyncJobHandle: {
          findMany: async (input: { where: Record<string, unknown> }) =>
            "sourceFinalizedAt" in input.where
              ? []
              : [
                  {
                    id: "handle-interrupted",
                    state: "dispatched",
                    claimToken: "claim-interrupted",
                    dispatchReceiptRequestId: "dispatch-interrupted",
                    continuationArtifactsResult: null,
                    continuationExternalResult: null
                  }
                ]
        },
        runtimeTurnReceipt: {
          findUnique: async () => ({ status: "interrupted" })
        }
      } as never,
      {
        finalizeSourceTurn: async (input: Record<string, unknown>) => {
          finalized.push(input);
        },
        failClaim: async () => {
          failed = true;
          return { applied: true, observation: null };
        },
        getPermanentFailureObservation: async () => null
      } as never,
      wakeCoordinatorStub as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    (
      service as unknown as {
        loadAndValidateContext: () => Promise<Record<string, unknown>>;
      }
    ).loadAndValidateContext = async () => ({
      handle: {
        assistantId: "assistant-1",
        chatId: "chat-1",
        continuationClientTurnId: "async-cont:parent-2"
      }
    });
    await service.processDueBatch(4);
    assert.equal(failed, true);
    assert.equal(finalized[0]?.outcome, "stopped");
    assert.equal(finalized[0]?.sourceClientTurnId, "async-cont:parent-2");
  });

  test("invalid context permanently fails with visible observation path", async () => {
    const failCalls: Array<Record<string, unknown>> = [];
    const { internal } = dispatchHarness({
      execute: async () => ({ outcome: "completed" }),
      handleState: {
        failClaim: async (input: Record<string, unknown>) => {
          failCalls.push(input);
          return {
            applied: true,
            observation: {
              handleId: "handle-invalid",
              assistantMessageId: "failure-message-1",
              channel: "web",
              assistantId: "assistant-1",
              workspaceId: "workspace-1",
              chatId: "chat-1"
            }
          };
        },
        getPermanentFailureObservation: async () => null,
        claimFailedHandleExternalNotice: async () => false
      }
    });
    internal.loadAndValidateContext = async () => null;
    await internal.processClaim({ id: "handle-invalid", claimToken: "claim-invalid" });
    assert.equal(failCalls.length, 1);
    assert.equal(failCalls[0]?.errorCode, "continuation_context_invalid");
  });

  test("expired dispatched completed receipt with invalid context failClaims instead of sticking", async () => {
    const failCalls: Array<Record<string, unknown>> = [];
    const service = new AssistantAsyncJobContinuationSchedulerService(
      {
        assistantAsyncJobHandle: {
          findMany: async (input: { where: Record<string, unknown> }) =>
            "sourceFinalizedAt" in input.where
              ? []
              : [
                  {
                    id: "handle-stuck",
                    state: "dispatched",
                    claimToken: "claim-stuck",
                    dispatchReceiptRequestId: "dispatch-stuck",
                    continuationArtifactsResult: null,
                    continuationExternalResult: null,
                    continuationAssistantMessageId: null,
                    channel: "web",
                    retryCount: 0
                  }
                ]
        },
        runtimeTurnReceipt: {
          findUnique: async () => ({
            status: "completed",
            resultPayload: {
              requestId: "runtime-stuck",
              sessionId: "session-1",
              assistantText: "Late.",
              answerText: "Late.",
              artifacts: [],
              respondedAt: "2026-07-18T00:00:00.000Z",
              usage: null
            }
          })
        }
      } as never,
      {
        failClaim: async (input: Record<string, unknown>) => {
          failCalls.push(input);
          return { applied: true, observation: null };
        },
        getPermanentFailureObservation: async () => null
      } as never,
      wakeCoordinatorStub as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    (
      service as unknown as {
        loadAndValidateContext: () => Promise<null>;
      }
    ).loadAndValidateContext = async () => null;
    await service.processDueBatch(4);
    assert.equal(failCalls.length, 1);
    assert.equal(failCalls[0]?.id, "handle-stuck");
    assert.equal(failCalls[0]?.errorCode, "continuation_context_invalid");
  });

  test("telegram permanent failure notice is claimed once", async () => {
    let claimCount = 0;
    let outboundCount = 0;
    const { service } = dispatchHarness({
      execute: async () => ({ outcome: "failed" }),
      handleState: {
        failClaim: async () => ({
          applied: true,
          observation: {
            handleId: "handle-tg",
            assistantMessageId: "failure-message-tg",
            channel: "telegram",
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            chatId: "chat-1"
          }
        }),
        getPermanentFailureObservation: async () => null,
        claimFailedHandleExternalNotice: async () => {
          claimCount += 1;
          return claimCount === 1;
        },
        recordFailedHandleExternalNoticeResult: async () => true
      },
      telegramOutbound: {
        deliverPersistedAssistantMessageBestEffort: async () => {
          outboundCount += 1;
          return { status: "delivered" };
        }
      }
    });
    const failVisibly = (
      service as unknown as {
        failClaimVisibly: (
          claim: { id: string; claimToken: string },
          error: { errorCode: string; errorMessage: string }
        ) => Promise<void>;
      }
    ).failClaimVisibly.bind(service);
    await failVisibly(
      { id: "handle-tg", claimToken: "claim-tg" },
      { errorCode: "continuation_context_invalid", errorMessage: "invalid" }
    );
    await failVisibly(
      { id: "handle-tg", claimToken: "claim-tg" },
      { errorCode: "continuation_context_invalid", errorMessage: "invalid" }
    );
    assert.equal(claimCount, 2);
    assert.equal(outboundCount, 1);
  });

  test("late old token cannot persist a message", async () => {
    let created = false;
    const { service } = dispatchHarness({
      execute: async () => ({ outcome: "completed" }),
      prisma: {
        $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            $queryRaw: async () => [],
            assistantChatMessage: {
              create: async () => {
                created = true;
              }
            }
          })
      }
    });
    const result = await (
      service as unknown as {
        persistOutputOnce: (
          claim: Record<string, unknown>,
          context: Record<string, unknown>,
          result: Record<string, unknown>
        ) => Promise<Record<string, unknown>>;
      }
    ).persistOutputOnce({ id: "handle-3", claimToken: "old-token" }, {}, {});
    assert.deepEqual(result, { outcome: "lost" });
    assert.equal(created, false);
  });

  test("Telegram external delivery is claimed once before the outbound call", async () => {
    let attemptCount = 0;
    let outboundCount = 0;
    const { service } = dispatchHarness({
      execute: async () => ({ outcome: "completed" }),
      handleState: {
        claimDeliveryAttempt: async () => (attemptCount++ === 0 ? "claimed" : "already_attempted"),
        recordDeliveryAttemptResult: async () => true
      },
      telegramOutbound: {
        deliverPersistedAssistantMessageBestEffort: async () => {
          outboundCount += 1;
          return { status: "delivered" };
        }
      }
    });
    const deliver = (
      service as unknown as {
        deliverTelegramOnce: (
          claim: Record<string, unknown>,
          context: Record<string, unknown>,
          messageId: string,
          result: Record<string, unknown>
        ) => Promise<void>;
      }
    ).deliverTelegramOnce.bind(service);
    const context = {
      handle: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        chatId: "chat-1"
      }
    };
    const result = { assistantText: "Done.", artifacts: [] };
    await deliver({ id: "handle-4", claimToken: "claim-4" }, context, "message-1", result);
    await deliver({ id: "handle-4", claimToken: "claim-4" }, context, "message-1", result);
    assert.equal(outboundCount, 1);
  });

  test("coordination abort during paused Telegram execute releases only a proven-absent claim", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    let lockHeld = true;
    let executeStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      executeStarted = resolve;
    });
    const { internal } = dispatchHarness({
      execute: async (_request: unknown, options?: { signal?: AbortSignal }) => {
        executeStarted();
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
            once: true
          });
        });
        throw new Error("unreachable");
      },
      inspect: async () => ({
        proof: "proven",
        receiptStatus: "absent",
        exactInFlight: false
      }),
      handleState: {
        releaseClaimToReady: async () => {
          calls.push("release");
          return "released";
        },
        markDispatched: async () => {
          calls.push("mark");
          return true;
        }
      }
    });
    internal.loadAndValidateContext = async () => ({
      handle: { retryCount: 0, channel: "telegram" },
      session: { id: "session-1" }
    });
    const dispatch = (
      internal as unknown as {
        processClaim: (
          claim: { id: string; claimToken: string },
          held: () => boolean,
          signal: AbortSignal
        ) => Promise<void>;
      }
    ).processClaim(
      { id: "handle-lock-loss", claimToken: "claim-lock-loss" },
      () => lockHeld,
      controller.signal
    );
    await started;
    lockHeld = false;
    controller.abort(new AsyncContinuationCoordinationLostError());
    await dispatch;
    assert.deepEqual(calls, ["release"]);
  });
});
