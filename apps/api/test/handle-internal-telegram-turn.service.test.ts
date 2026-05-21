import assert from "node:assert/strict";
import { HandleInternalTelegramTurnService } from "../src/modules/workspace-management/application/handle-internal-telegram-turn.service";
import { createAssistantInboundConflict } from "../src/modules/workspace-management/application/assistant-inbound-error";

const noopRecordModelCostLedgerService = {
  async recordChatMainReplyEvents() {
    return 0;
  }
} as never;

type ClaimState = {
  telegramLastHandledUpdateId?: number;
  telegramLastHandledUpdateAt?: string;
  telegramActiveUpdateId?: number;
  telegramActiveUpdateClaimedAt?: string;
};

function createBindingRepository(
  initialState: ClaimState = {},
  options?: {
    completeThrows?: Error;
    releaseHook?: (updateId: number) => void;
  }
) {
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
      if (options?.completeThrows) {
        throw options.completeThrows;
      }
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
      options?.releaseHook?.(updateId);
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

function createChatRepositoryMock() {
  let messageCounter = 0;
  return {
    async findOrCreateChatBySurfaceThread() {
      return {
        id: "chat-1"
      };
    },
    async createMessage(input: { author: string; content: string }) {
      messageCounter += 1;
      return {
        id: `message-${messageCounter}`,
        author: input.author,
        content: input.content,
        createdAt: new Date("2026-04-06T00:00:00.000Z")
      };
    }
  };
}

function createAssistantMessageFailureChatRepository() {
  const base = createChatRepositoryMock();
  return {
    ...base,
    async createMessage(input: { author: string; content: string }) {
      if (input.author === "assistant") {
        throw new Error("assistant message insert failed");
      }
      return base.createMessage(input);
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
  const chatRepository = createChatRepositoryMock();
  const concurrentService = new HandleInternalTelegramTurnService(
    chatRepository as never,
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
    traceService as never,
    {
      async execute() {
        concurrentRuntimeCalls += 1;
        resolveFirstRuntime?.();
        await finishFirstRuntime;
        return {
          assistantMessage: "Telegram reply",
          respondedAt: "2026-04-06T00:00:00.000Z",
          media: []
        };
      }
    } as never,
    {
      async assertRuntimeReadable() {
        return undefined;
      }
    } as never,
    {
      async listOpenJobsForChatContext() {
        return [];
      },
      async attachAcknowledgementMessageId() {
        return 0;
      }
    } as never,
    noopRecordModelCostLedgerService
  );
  const first = concurrentService.execute({
    assistantId: "assistant-1",
    threadId: "chat-1",
    conversationMode: "direct",
    externalUserKey: "telegram-user-1",
    message: "hi",
    updateId: 77
  });
  await firstRuntimeStarted;

  const deduplicated = await concurrentService.execute({
    assistantId: "assistant-1",
    threadId: "chat-1",
    conversationMode: "direct",
    externalUserKey: "telegram-user-1",
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
  const releasedChatRepository = createChatRepositoryMock();
  const fixedReleaseService = new HandleInternalTelegramTurnService(
    releasedChatRepository as never,
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
    traceService as never,
    {
      async execute() {
        releaseRuntimeCalls += 1;
        if (releaseRuntimeCalls === 1) {
          throw new Error("temporary failure");
        }
        return {
          assistantMessage: "Recovered reply",
          respondedAt: "2026-04-06T00:00:01.000Z",
          media: []
        };
      }
    } as never,
    {
      async assertRuntimeReadable() {
        return undefined;
      }
    } as never,
    {
      async listOpenJobsForChatContext() {
        return [];
      },
      async attachAcknowledgementMessageId() {
        return 0;
      }
    } as never,
    noopRecordModelCostLedgerService
  );

  await assert.rejects(() =>
    fixedReleaseService.execute({
      assistantId: "assistant-1",
      threadId: "chat-1",
      conversationMode: "direct",
      externalUserKey: "telegram-user-1",
      message: "retry me",
      updateId: 88
    })
  );
  assert.equal(releasedBindingRepository.state.telegramActiveUpdateId, undefined);

  const recovered = await fixedReleaseService.execute({
    assistantId: "assistant-1",
    threadId: "chat-1",
    conversationMode: "direct",
    externalUserKey: "telegram-user-1",
    message: "retry me",
    updateId: 88
  });
  assert.equal(recovered.assistantMessage, "Recovered reply");
  assert.equal(releaseRuntimeCalls, 2);
  assert.equal(releasedBindingRepository.state.telegramLastHandledUpdateId, 88);
  assert.equal(releasedBindingRepository.state.telegramActiveUpdateId, undefined);

  const mediaBindingRepository = createBindingRepository();
  const mediaChatRepository = createChatRepositoryMock();
  const runtimeMedia = [
    {
      source: "persai_object_storage" as const,
      objectKey: "runtime-output/assistant-1/tool/image.png",
      type: "image" as const,
      mimeType: "image/png",
      filename: "tuz_virtual_assistant.png",
      sizeBytes: 123
    }
  ];
  const mediaRewriteService = new HandleInternalTelegramTurnService(
    mediaChatRepository as never,
    mediaBindingRepository as never,
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
    traceService as never,
    {
      async execute() {
        return {
          assistantMessage: "Image ready",
          respondedAt: "2026-04-06T00:00:02.000Z",
          media: runtimeMedia
        };
      }
    } as never,
    {
      async assertRuntimeReadable() {
        return undefined;
      }
    } as never,
    {
      async listOpenJobsForChatContext() {
        return [];
      },
      async attachAcknowledgementMessageId() {
        return 0;
      }
    } as never,
    noopRecordModelCostLedgerService
  );

  const rewrittenMedia = await mediaRewriteService.execute({
    assistantId: "assistant-1",
    threadId: "chat-1",
    conversationMode: "direct",
    externalUserKey: "telegram-user-1",
    message: "show me an image",
    updateId: 99
  });
  assert.deepEqual(rewrittenMedia.media, runtimeMedia);

  let runtimeUserMessage = "";
  const enrichedMessageService = new HandleInternalTelegramTurnService(
    createChatRepositoryMock() as never,
    createBindingRepository() as never,
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
      workspace: {
        async findUnique() {
          return { timezone: "UTC" };
        }
      }
    } as never,
    {
      async resolve() {
        return {
          attachments: [],
          enrichedMessage:
            '[Attachment processing notes:\n- "broken.png" was not uploaded.]\nUser sent attachments only.'
        };
      }
    } as never,
    traceService as never,
    {
      async execute(input: { userMessage: string }) {
        runtimeUserMessage = input.userMessage;
        return {
          assistantMessage: "I saw the attachment failure.",
          respondedAt: "2026-04-06T00:00:03.000Z",
          media: []
        };
      }
    } as never,
    {
      async assertRuntimeReadable() {
        return undefined;
      }
    } as never,
    {
      async listOpenJobsForChatContext() {
        return [];
      },
      async attachAcknowledgementMessageId() {
        return 0;
      }
    } as never,
    noopRecordModelCostLedgerService,
    { maybeCreateFollowUp: async () => null } as never
  );

  await enrichedMessageService.execute({
    assistantId: "assistant-1",
    threadId: "chat-1",
    conversationMode: "direct",
    externalUserKey: "telegram-user-1",
    message: "look at this",
    updateId: 100,
    hasAttachments: true,
    loadRawAttachments: async () => [
      {
        buffer: Buffer.from("broken"),
        mime: "image/png",
        originalFilename: "broken.png",
        source: "telegram_download"
      }
    ]
  });
  assert.match(runtimeUserMessage, /Attachment processing notes/);

  const persistenceFailureBindingRepository = createBindingRepository();
  let persistenceFailureUsageCalls = 0;
  const persistenceFailureService = new HandleInternalTelegramTurnService(
    createAssistantMessageFailureChatRepository() as never,
    persistenceFailureBindingRepository as never,
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
        persistenceFailureUsageCalls += 1;
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
    traceService as never,
    {
      async execute() {
        return {
          assistantMessage: "Completed despite persistence failure",
          respondedAt: "2026-04-06T00:00:03.000Z",
          media: runtimeMedia
        };
      }
    } as never,
    {
      async assertRuntimeReadable() {
        return undefined;
      }
    } as never,
    {
      async listOpenJobsForChatContext() {
        return [];
      },
      async attachAcknowledgementMessageId() {
        return 0;
      }
    } as never,
    noopRecordModelCostLedgerService
  );

  const recoveredAfterAssistantSaveFailure = await persistenceFailureService.execute({
    assistantId: "assistant-1",
    threadId: "chat-1",
    conversationMode: "direct",
    externalUserKey: "telegram-user-1",
    message: "show me another image",
    updateId: 111
  });
  assert.equal(
    recoveredAfterAssistantSaveFailure.assistantMessage,
    "Completed despite persistence failure"
  );
  assert.equal(recoveredAfterAssistantSaveFailure.assistantMessageId, "");
  assert.deepEqual(recoveredAfterAssistantSaveFailure.media, []);
  assert.equal(persistenceFailureUsageCalls, 0);
  assert.equal(persistenceFailureBindingRepository.state.telegramLastHandledUpdateId, undefined);
  assert.equal(persistenceFailureBindingRepository.state.telegramActiveUpdateId, 111);

  const quotaFailureBindingRepository = createBindingRepository();
  const quotaFailureChatRepository = createChatRepositoryMock();
  let quotaFailureUsageCalls = 0;
  const quotaFailureLedgerWrites: Array<Record<string, unknown>> = [];
  const quotaFailureService = new HandleInternalTelegramTurnService(
    quotaFailureChatRepository as never,
    quotaFailureBindingRepository as never,
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
        quotaFailureUsageCalls += 1;
        throw new Error("quota persistence failed");
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
    traceService as never,
    {
      async execute() {
        return {
          assistantMessage: "Completed despite quota failure",
          respondedAt: "2026-04-06T00:00:04.000Z",
          media: [],
          usageAccounting: {
            inputTokens: 132,
            cachedInputTokens: 20,
            outputTokens: 42,
            totalTokens: 174,
            entries: [
              {
                stepType: "turn_routing",
                modelRole: "system_tool",
                providerKey: "openai",
                modelKey: "gpt-5-mini",
                inputTokens: 12,
                cachedInputTokens: 0,
                outputTokens: 2,
                totalTokens: 14
              },
              {
                stepType: "main_turn",
                modelRole: "normal_reply",
                providerKey: "openai",
                modelKey: "gpt-5-mini",
                inputTokens: 120,
                cachedInputTokens: 20,
                outputTokens: 40,
                totalTokens: 160
              }
            ]
          }
        };
      }
    } as never,
    {
      async assertRuntimeReadable() {
        return undefined;
      }
    } as never,
    {
      async listOpenJobsForChatContext() {
        return [];
      },
      async attachAcknowledgementMessageId() {
        return 0;
      }
    } as never,
    {
      async recordChatMainReplyEvents(input: Record<string, unknown>) {
        quotaFailureLedgerWrites.push(input);
        return 2;
      }
    } as never,
    undefined,
    undefined,
    undefined
  );

  const recoveredAfterQuotaFailure = await quotaFailureService.execute({
    assistantId: "assistant-1",
    threadId: "chat-1",
    conversationMode: "direct",
    externalUserKey: "telegram-user-1",
    message: "plain text",
    updateId: 112
  });
  assert.equal(recoveredAfterQuotaFailure.assistantMessage, "Completed despite quota failure");
  assert.equal(recoveredAfterQuotaFailure.assistantMessageId, "message-2");
  assert.equal(quotaFailureUsageCalls, 1);
  assert.equal(quotaFailureLedgerWrites.length, 1);
  assert.equal(quotaFailureLedgerWrites[0]?.surface, "telegram");
  assert.equal(quotaFailureLedgerWrites[0]?.source, "telegram_turn_sync");
  assert.equal(quotaFailureLedgerWrites[0]?.sourceEventId, "message-2");
  assert.equal(quotaFailureLedgerWrites[0]?.occurredAt, "2026-04-06T00:00:04.000Z");
  assert.equal(quotaFailureBindingRepository.state.telegramLastHandledUpdateId, 112);
  assert.equal(quotaFailureBindingRepository.state.telegramActiveUpdateId, undefined);

  let releasedUpdateId: number | null = null;
  const completionFailureBindingRepository = createBindingRepository(
    {},
    {
      completeThrows: new Error("binding completion failed"),
      releaseHook(updateId) {
        releasedUpdateId = updateId;
      }
    }
  );
  const completionFailureService = new HandleInternalTelegramTurnService(
    createChatRepositoryMock() as never,
    completionFailureBindingRepository as never,
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
    traceService as never,
    {
      async execute() {
        return {
          assistantMessage: "Completed despite completion failure",
          respondedAt: "2026-04-06T00:00:05.000Z",
          media: []
        };
      }
    } as never,
    {
      async assertRuntimeReadable() {
        return undefined;
      }
    } as never,
    {
      async listOpenJobsForChatContext() {
        return [];
      },
      async attachAcknowledgementMessageId() {
        return 0;
      }
    } as never,
    noopRecordModelCostLedgerService
  );

  const recoveredAfterCompletionFailure = await completionFailureService.execute({
    assistantId: "assistant-1",
    threadId: "chat-1",
    conversationMode: "direct",
    externalUserKey: "telegram-user-1",
    message: "finish update anyway",
    updateId: 113
  });
  assert.equal(
    recoveredAfterCompletionFailure.assistantMessage,
    "Completed despite completion failure"
  );
  assert.equal(releasedUpdateId, 113);
  assert.equal(completionFailureBindingRepository.state.telegramLastHandledUpdateId, undefined);
  assert.equal(completionFailureBindingRepository.state.telegramActiveUpdateId, undefined);

  let retryingRuntimeCalls = 0;
  let waitedForCompaction = 0;
  const conflictRecoveryService = new HandleInternalTelegramTurnService(
    createChatRepositoryMock() as never,
    createBindingRepository() as never,
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
    traceService as never,
    {
      async execute() {
        retryingRuntimeCalls += 1;
        if (retryingRuntimeCalls === 1) {
          throw createAssistantInboundConflict(
            "native_runtime_conflict",
            "Session is already processing another turn."
          );
        }
        return {
          assistantMessage: "Recovered after compaction",
          respondedAt: "2026-04-06T00:00:06.000Z",
          media: []
        };
      }
    } as never,
    {
      async assertRuntimeReadable() {
        return undefined;
      }
    } as never,
    {
      async listOpenJobsForChatContext() {
        return [];
      },
      async attachAcknowledgementMessageId() {
        return 0;
      }
    } as never,
    noopRecordModelCostLedgerService,
    undefined,
    undefined,
    {
      async waitForActiveThreadCompaction() {
        waitedForCompaction += 1;
        return {
          waited: true,
          readyForRetry: true,
          noticeKind: waitedForCompaction === 1 ? null : ("compacted" as const)
        };
      }
    } as never
  );
  const recoveredAfterCompactionConflict = await conflictRecoveryService.execute({
    assistantId: "assistant-1",
    threadId: "chat-1",
    conversationMode: "direct",
    externalUserKey: "telegram-user-1",
    message: "retry after compaction",
    updateId: 114
  });
  assert.equal(retryingRuntimeCalls, 2);
  assert.equal(waitedForCompaction, 2);
  assert.equal(recoveredAfterCompactionConflict.assistantMessage, "Recovered after compaction");
  assert.equal(recoveredAfterCompactionConflict.compactionQueueNoticeKind, "compacted");
}

void run();
