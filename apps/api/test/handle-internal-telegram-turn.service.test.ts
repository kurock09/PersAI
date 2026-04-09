import assert from "node:assert/strict";
import { HandleInternalTelegramTurnService } from "../src/modules/workspace-management/application/handle-internal-telegram-turn.service";

type ClaimState = {
  telegramLastHandledUpdateId?: number;
  telegramLastHandledUpdateAt?: string;
  telegramActiveUpdateId?: number;
  telegramActiveUpdateClaimedAt?: string;
};

function createBindingRepository(initialState: ClaimState = {}) {
  const state: ClaimState = { ...initialState };
  return {
    state,
    async findByAssistantProviderSurface() {
      return {
        id: "binding-1",
        assistantId: "assistant-1",
        providerKey: "telegram",
        surfaceType: "telegram_bot",
        bindingState: "active",
        tokenFingerprint: null,
        tokenLastFour: null,
        policy: null,
        config: null,
        metadata: { ...state },
        connectedAt: null,
        disconnectedAt: null,
        createdAt: new Date("2026-04-06T00:00:00.000Z"),
        updatedAt: new Date("2026-04-06T00:00:00.000Z")
      };
    },
    async upsert() {
      throw new Error("not used");
    },
    async claimTelegramUpdateProcessing(
      _assistantId: string,
      _providerKey: string,
      _surfaceType: string,
      updateId: number,
      claimedAt: Date,
      staleAfterMs: number
    ) {
      if (
        typeof state.telegramLastHandledUpdateId === "number" &&
        updateId <= state.telegramLastHandledUpdateId
      ) {
        return "duplicate_handled" as const;
      }
      const activeClaimIsFresh =
        state.telegramActiveUpdateId === updateId &&
        typeof state.telegramActiveUpdateClaimedAt === "string" &&
        claimedAt.getTime() - new Date(state.telegramActiveUpdateClaimedAt).getTime() <
          staleAfterMs;
      if (activeClaimIsFresh) {
        return "duplicate_inflight" as const;
      }
      state.telegramActiveUpdateId = updateId;
      state.telegramActiveUpdateClaimedAt = claimedAt.toISOString();
      return "claimed" as const;
    },
    async completeTelegramUpdateProcessing(
      _assistantId: string,
      _providerKey: string,
      _surfaceType: string,
      updateId: number,
      completedAt: Date
    ) {
      state.telegramLastHandledUpdateId = updateId;
      state.telegramLastHandledUpdateAt = completedAt.toISOString();
      if (state.telegramActiveUpdateId === updateId) {
        delete state.telegramActiveUpdateId;
        delete state.telegramActiveUpdateClaimedAt;
      }
    },
    async releaseTelegramUpdateProcessing(
      _assistantId: string,
      _providerKey: string,
      _surfaceType: string,
      updateId: number
    ) {
      if (state.telegramActiveUpdateId === updateId) {
        delete state.telegramActiveUpdateId;
        delete state.telegramActiveUpdateClaimedAt;
      }
    },
    async patchMetadata() {
      throw new Error("not used");
    },
    async hasActiveBindingForProvider() {
      return true;
    }
  };
}

function createResolvedAssistant() {
  return {
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    publishedVersionId: "pub-1",
    runtimeTier: "free_shared_restricted",
    quotaDegradeModelOverride: null,
    assistant: {
      id: "assistant-1",
      userId: "user-1",
      workspaceId: "workspace-1"
    }
  };
}

function createOverviewLatencyTraceServiceMock() {
  return {
    start() {
      return {
        stage() {
          return undefined;
        },
        isEnabled() {
          return false;
        },
        getTraceId() {
          return "trace-test";
        },
        attachExternalTrace() {
          return undefined;
        },
        finish() {
          return undefined;
        }
      };
    }
  };
}

async function run(): Promise<void> {
  let resolveFirstRuntime: (() => void) | null = null;
  const firstRuntimeStarted = new Promise<void>((resolve) => {
    resolveFirstRuntime = resolve;
  });
  let allowFirstRuntimeFinish: (() => void) | null = null;
  const finishFirstRuntime = new Promise<void>((resolve) => {
    allowFirstRuntimeFinish = resolve;
  });

  const concurrentBindingRepository = createBindingRepository();
  let concurrentRuntimeCalls = 0;
  let concurrentUsageCalls = 0;
  const traceService = createOverviewLatencyTraceServiceMock();
  const concurrentService = new HandleInternalTelegramTurnService(
    {
      async sendChannelTurn() {
        concurrentRuntimeCalls += 1;
        resolveFirstRuntime?.();
        await finishFirstRuntime;
        return {
          assistantMessage: "Telegram reply",
          respondedAt: "2026-04-06T00:00:00.000Z",
          media: []
        };
      },
      async downloadChatMedia() {
        return null;
      },
      async getChannelSessionState() {
        return {
          sessionKey: "agent:assistant-1:telegram:chat-1",
          found: false,
          currentTokens: null,
          totalTokensFresh: true,
          compactionCount: 0,
          compactionHintTokens: null,
          updatedAt: null,
          provider: null,
          model: null
        };
      },
      async markChannelCompactionHintShown() {
        return undefined;
      },
      async consumeBootstrapWorkspace() {
        return undefined;
      }
    } as never,
    {} as never,
    concurrentBindingRepository as never,
    {
      async enforceInboundTurn() {
        return { mode: "allow" };
      }
    } as never,
    {
      async enforceAndRegisterAttempt() {
        return undefined;
      }
    } as never,
    {
      async resolveByAssistantId() {
        return createResolvedAssistant();
      }
    } as never,
    {
      async recordInboundTurnUsage() {
        concurrentUsageCalls += 1;
      }
    } as never,
    {
      async execute() {
        return {
          optimizationPolicy: {
            compaction: {
              reserveTokens: 24000,
              keepRecentTokens: 16000
            }
          }
        };
      }
    } as never,
    {
      workspace: {
        async findUnique() {
          return { timezone: "UTC" };
        }
      }
    } as never,
    {
      async resolve() {
        throw new Error("attachments not expected");
      }
    } as never,
    traceService as never
  );
  const first = concurrentService.execute({
    assistantId: "assistant-1",
    threadId: "chat-1",
    message: "hi",
    updateId: 77
  });
  await firstRuntimeStarted;

  const deduplicated = await concurrentService.execute({
    assistantId: "assistant-1",
    threadId: "chat-1",
    message: "hi",
    updateId: 77
  });
  assert.equal(deduplicated.deduplicated, true);
  assert.equal(concurrentRuntimeCalls, 1);

  allowFirstRuntimeFinish?.();
  const completed = await first;
  assert.equal(completed.assistantMessage, "Telegram reply");
  assert.equal(concurrentRuntimeCalls, 1);
  assert.equal(concurrentUsageCalls, 1);
  assert.equal(concurrentBindingRepository.state.telegramLastHandledUpdateId, 77);
  assert.equal(concurrentBindingRepository.state.telegramActiveUpdateId, undefined);

  const releasedBindingRepository = createBindingRepository();
  let releaseRuntimeCalls = 0;
  const fixedReleaseService = new HandleInternalTelegramTurnService(
    {
      async sendChannelTurn() {
        releaseRuntimeCalls += 1;
        if (releaseRuntimeCalls === 1) {
          throw new Error("temporary failure");
        }
        return {
          assistantMessage: "Recovered reply",
          respondedAt: "2026-04-06T00:00:01.000Z",
          media: []
        };
      },
      async downloadChatMedia() {
        return null;
      },
      async getChannelSessionState() {
        return {
          sessionKey: "agent:assistant-1:telegram:chat-1",
          found: false,
          currentTokens: null,
          totalTokensFresh: true,
          compactionCount: 0,
          compactionHintTokens: null,
          updatedAt: null,
          provider: null,
          model: null
        };
      },
      async markChannelCompactionHintShown() {
        return undefined;
      },
      async consumeBootstrapWorkspace() {
        return undefined;
      }
    } as never,
    {} as never,
    releasedBindingRepository as never,
    {
      async enforceInboundTurn() {
        return { mode: "allow" };
      }
    } as never,
    {
      async enforceAndRegisterAttempt() {
        return undefined;
      }
    } as never,
    {
      async resolveByAssistantId() {
        return createResolvedAssistant();
      }
    } as never,
    {
      async recordInboundTurnUsage() {
        return undefined;
      }
    } as never,
    {
      async execute() {
        return {
          optimizationPolicy: {
            compaction: {
              reserveTokens: 24000,
              keepRecentTokens: 16000
            }
          }
        };
      }
    } as never,
    {
      workspace: {
        async findUnique() {
          return { timezone: "UTC" };
        }
      }
    } as never,
    {
      async resolve() {
        throw new Error("attachments not expected");
      }
    } as never,
    traceService as never
  );

  await assert.rejects(() =>
    fixedReleaseService.execute({
      assistantId: "assistant-1",
      threadId: "chat-1",
      message: "retry me",
      updateId: 88
    })
  );
  assert.equal(releasedBindingRepository.state.telegramActiveUpdateId, undefined);

  const recovered = await fixedReleaseService.execute({
    assistantId: "assistant-1",
    threadId: "chat-1",
    message: "retry me",
    updateId: 88
  });
  assert.equal(recovered.assistantMessage, "Recovered reply");
  assert.equal(releaseRuntimeCalls, 2);
  assert.equal(releasedBindingRepository.state.telegramLastHandledUpdateId, 88);
}

void run();
