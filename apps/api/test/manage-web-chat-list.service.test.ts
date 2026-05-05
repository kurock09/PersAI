import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AssistantRuntimeError } from "../src/modules/workspace-management/application/assistant-runtime.facade";
import { ManageWebChatListService } from "../src/modules/workspace-management/application/manage-web-chat-list.service";

function createAssistant() {
  return {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    draftDisplayName: null,
    draftInstructions: null,
    draftTraits: null,
    draftAvatarEmoji: null,
    draftAvatarUrl: null,
    draftUpdatedAt: null,
    applyStatus: "succeeded" as const,
    applyTargetVersionId: "version-1",
    applyAppliedVersionId: "version-1",
    applyRequestedAt: null,
    applyStartedAt: null,
    applyFinishedAt: null,
    applyErrorCode: null,
    applyErrorMessage: null,
    configDirtyAt: null,
    createdAt: new Date("2026-03-31T00:00:00.000Z"),
    updatedAt: new Date("2026-03-31T00:00:00.000Z")
  };
}

function createChat() {
  return {
    id: "chat-1",
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    surface: "web" as const,
    surfaceThreadKey: "thread-1",
    title: "Chat",
    archivedAt: null,
    lastMessageAt: null,
    createdAt: new Date("2026-03-31T00:00:00.000Z"),
    updatedAt: new Date("2026-03-31T00:00:00.000Z")
  };
}

function createMessages(messageCount = 24, assistantMessageCount = 12) {
  return Array.from({ length: messageCount }, (_, index) => ({
    id: `msg-${index + 1}`,
    chatId: "chat-1",
    assistantId: "assistant-1",
    author: index < assistantMessageCount ? ("assistant" as const) : ("user" as const),
    content: `message-${index + 1}`,
    createdAt: new Date("2026-03-31T00:00:00.000Z")
  }));
}

function createSlowTurnMessages() {
  return [
    {
      id: "msg-1",
      chatId: "chat-1",
      assistantId: "assistant-1",
      author: "user" as const,
      content: "hello 1",
      createdAt: new Date("2026-03-31T00:00:00.000Z")
    },
    {
      id: "msg-2",
      chatId: "chat-1",
      assistantId: "assistant-1",
      author: "assistant" as const,
      content: "reply 1",
      createdAt: new Date("2026-03-31T00:00:08.000Z")
    },
    {
      id: "msg-3",
      chatId: "chat-1",
      assistantId: "assistant-1",
      author: "user" as const,
      content: "hello 2",
      createdAt: new Date("2026-03-31T00:01:00.000Z")
    },
    {
      id: "msg-4",
      chatId: "chat-1",
      assistantId: "assistant-1",
      author: "assistant" as const,
      content: "reply 2",
      createdAt: new Date("2026-03-31T00:01:08.000Z")
    },
    {
      id: "msg-5",
      chatId: "chat-1",
      assistantId: "assistant-1",
      author: "user" as const,
      content: "hello 3",
      createdAt: new Date("2026-03-31T00:02:00.000Z")
    },
    {
      id: "msg-6",
      chatId: "chat-1",
      assistantId: "assistant-1",
      author: "assistant" as const,
      content: "reply 3",
      createdAt: new Date("2026-03-31T00:02:09.000Z")
    }
  ];
}

function createAttachments() {
  return [
    {
      id: "att-1",
      messageId: "msg-1",
      chatId: "chat-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      attachmentType: "image",
      storagePath: "chat-1/msg-1/a.png",
      originalFilename: "a.png",
      mimeType: "image/png",
      sizeBytes: BigInt(2),
      durationMs: null,
      width: null,
      height: null,
      processingStatus: "ready",
      transcription: null,
      metadata: null,
      createdAt: new Date("2026-03-31T00:00:00.000Z")
    },
    {
      id: "att-2",
      messageId: "msg-2",
      chatId: "chat-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      attachmentType: "image",
      storagePath: "chat-1/msg-2/b.png",
      originalFilename: "b.png",
      mimeType: "image/png",
      sizeBytes: BigInt(3),
      durationMs: null,
      width: null,
      height: null,
      processingStatus: "ready",
      transcription: null,
      metadata: null,
      createdAt: new Date("2026-03-31T00:00:00.000Z")
    }
  ];
}

function createCompactionSession(
  overrides?: Partial<{
    currentTokens: number | null;
    compactionCount: number;
    updatedAt: string | null;
  }>
) {
  return {
    sessionId: "runtime-session-1",
    conversation: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web" as const,
      externalThreadKey: "thread-1",
      externalUserKey: "user-1",
      mode: "direct" as const
    },
    currentTokens: overrides?.currentTokens !== undefined ? overrides.currentTokens : 18_250,
    totalTokensFresh: true,
    compactionCount: overrides?.compactionCount ?? 1,
    compactionHintTokens: 18_250,
    providerKey: "openai",
    modelKey: "gpt-4.1",
    updatedAt: overrides?.updatedAt !== undefined ? overrides.updatedAt : "2026-04-12T20:00:00.000Z"
  };
}

function createCompactionToolResult(
  overrides?: Partial<{ action: "compacted" | "skipped"; reason: string | null }>
) {
  return {
    toolCode: "compact_context",
    action: overrides?.action ?? "compacted",
    reason: overrides?.reason ?? "compacted",
    sessionId: "runtime-session-1",
    compactionRecordId: "compaction-1",
    before: {
      sessionId: "runtime-session-1",
      currentTokens: 18_250,
      compactionCount: 0,
      summarizedMessageCount: 8,
      preservedRecentMessageCount: 4
    },
    after: {
      sessionId: "runtime-session-1",
      currentTokens: null,
      compactionCount: 1,
      summarizedMessageCount: 8,
      preservedRecentMessageCount: 4
    },
    preservedRecentTurns: 4,
    summaryText: "Compacted summary text",
    summaryPayload: {
      schema: "persai.runtimeSessionCompaction.v1",
      summarizeToolCode: "summarize_context",
      toolCode: "compact_context",
      summaryText: "Compacted summary text"
    },
    reusableInLaterTurns: overrides?.action !== "skipped"
  };
}

function createService(overrides?: {
  sessionResolveResult?: {
    found: boolean;
    session: ReturnType<typeof createCompactionSession> | null;
  };
  compactResult?: {
    compacted: boolean;
    reason: string | null;
    tokensBefore: number | null;
    tokensAfter: number | null;
    session: ReturnType<typeof createCompactionSession> | null;
    toolResult: ReturnType<typeof createCompactionToolResult>;
  };
  messages?: Array<{
    id: string;
    chatId: string;
    assistantId: string;
    author: "user" | "assistant";
    content: string;
    createdAt: Date;
  }>;
  mediaJobs?: Array<{
    id: string;
    kind: "image" | "audio" | "video";
    status: "queued" | "running" | "completion_pending";
    createdAt: string;
    startedAt: string | null;
    updatedAt: string;
  }>;
  sharedCompaction?: Partial<{
    reserveTokens: number;
    keepRecentTokens: number;
    recentTurnsPreserve: number;
    webSuggestionLatencyMs: number;
  }>;
  contextHydration?: Partial<{
    autoCompactionWeb: boolean;
  }>;
}) {
  const callOrder: string[] = [];
  const releasedBytes: bigint[] = [];
  const compactInputs: Array<Record<string, unknown>> = [];
  const sessionResolveInputs: Array<Record<string, unknown>> = [];
  const sharedCompaction = {
    reserveTokens: overrides?.sharedCompaction?.reserveTokens ?? 24_000,
    keepRecentTokens: overrides?.sharedCompaction?.keepRecentTokens ?? 16_000,
    recentTurnsPreserve: overrides?.sharedCompaction?.recentTurnsPreserve ?? 4,
    webSuggestionLatencyMs: overrides?.sharedCompaction?.webSuggestionLatencyMs ?? 7_000
  };

  const service = new ManageWebChatListService(
    {
      findByUserId: async (userId: string) => (userId === "user-1" ? createAssistant() : null)
    } as never,
    {
      listChatsByAssistantId: async () => [createChat()],
      findChatById: async (chatId: string) => (chatId === "chat-1" ? createChat() : null),
      getChatListMetadata: async () => ({
        messageCount: 24,
        lastMessagePreview: "message-24"
      }),
      hardDeleteChat: async () => {
        callOrder.push("repo-delete");
        return true;
      },
      countActiveChatsByAssistantIdAndSurface: async () => 0,
      listMessagesByChatId: async () => overrides?.messages ?? createMessages()
    } as never,
    {
      listByChatId: async () => createAttachments(),
      listByMessageIds: async () => createAttachments(),
      deleteByChatId: async () => {
        callOrder.push("attachments-delete");
      }
    } as never,
    {
      findByPublishedVersionId: async (publishedVersionId: string) => {
        assert.equal(publishedVersionId, "version-1");
        return {
          runtimeBundle: {
            runtime: {
              sharedCompaction,
              contextHydration: {
                autoCompactionWeb: overrides?.contextHydration?.autoCompactionWeb ?? false
              }
            }
          }
        };
      }
    } as never,
    {
      resolveByAssistantId: async (assistantId: string) => {
        assert.equal(assistantId, "assistant-1");
        return "free_shared_restricted";
      }
    } as never,
    {
      releaseMediaStorage: async (input: { sizeBytes: bigint }) => {
        releasedBytes.push(input.sizeBytes);
      },
      refreshActiveWebChatsUsage: async (input: {
        source: string;
        activeWebChatsCurrent: number;
      }) => {
        callOrder.push(`quota-${input.source}-${String(input.activeWebChatsCurrent)}`);
      }
    } as never,
    {
      buildChatPrefix(input: { assistantId: string; chatId: string }) {
        assert.deepEqual(input, { assistantId: "assistant-1", chatId: "chat-1" });
        return "assistant-media/assistants/assistant-1/chats/chat-1/";
      },
      async deletePrefix(prefix: string) {
        callOrder.push(`object-storage-delete:${prefix}`);
      }
    } as never,
    {
      execute: async (input: Record<string, unknown>) => {
        compactInputs.push(input);
        return (
          overrides?.compactResult ?? {
            compacted: true,
            reason: "compacted",
            tokensBefore: 18_250,
            tokensAfter: null,
            session: createCompactionSession(),
            toolResult: createCompactionToolResult()
          }
        );
      }
    } as never,
    {
      execute: async (input: Record<string, unknown>) => {
        sessionResolveInputs.push(input);
        return (
          overrides?.sessionResolveResult ?? {
            found: true,
            session: createCompactionSession({ compactionCount: 0, updatedAt: null })
          }
        );
      }
    } as never,
    {
      listOpenJobsForWebChat: async () => overrides?.mediaJobs ?? []
    } as never,
    {
      getActiveTurnForChat: async () => null
    } as never
  );

  return {
    service,
    callOrder,
    releasedBytes,
    compactInputs,
    sessionResolveInputs
  };
}

describe("ManageWebChatListService", () => {
  test("projects active media jobs for web chat continuity reads", async () => {
    const { service } = createService({
      mediaJobs: [
        {
          id: "job-1",
          kind: "image",
          status: "running",
          createdAt: "2026-05-05T08:00:00.000Z",
          startedAt: "2026-05-05T08:00:03.000Z",
          updatedAt: "2026-05-05T08:00:05.000Z"
        }
      ]
    });

    const list = await service.listChats("user-1");
    const messages = await service.listChatMessages("user-1", "chat-1", {
      cursor: null,
      limit: 20
    });

    assert.deepEqual(list[0]?.activeMediaJobs, [
      {
        id: "job-1",
        kind: "image",
        status: "running",
        createdAt: "2026-05-05T08:00:00.000Z",
        startedAt: "2026-05-05T08:00:03.000Z",
        updatedAt: "2026-05-05T08:00:05.000Z"
      }
    ]);
    assert.deepEqual(messages.activeMediaJobs, [
      {
        id: "job-1",
        kind: "image",
        status: "running",
        createdAt: "2026-05-05T08:00:00.000Z",
        startedAt: "2026-05-05T08:00:03.000Z",
        updatedAt: "2026-05-05T08:00:05.000Z"
      }
    ]);
  });

  test("hard-deletes a chat after removing runtime/media state", async () => {
    const { service, callOrder, releasedBytes } = createService();

    await service.hardDeleteChat("user-1", "chat-1", { confirmText: "DELETE" });

    assert.deepEqual(callOrder, [
      "object-storage-delete:assistant-media/assistants/assistant-1/chats/chat-1/",
      "attachments-delete",
      "repo-delete",
      "quota-web_chat_hard_delete-0"
    ]);
    assert.deepEqual(releasedBytes, [BigInt(5)]);
  });

  test("routes manual web compaction through the native shared seam", async () => {
    const { service, compactInputs, sessionResolveInputs } = createService();

    const result = await service.compactChat("user-1", "chat-1", "keep project decisions");

    assert.deepEqual(compactInputs, [
      {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "free_shared_restricted",
        surfaceThreadKey: "thread-1",
        userId: "user-1",
        instructions: "keep project decisions"
      }
    ]);
    assert.deepEqual(sessionResolveInputs, []);
    assert.deepEqual(result, {
      state: {
        available: true,
        suggested: false,
        suggestionReason: null,
        messageCount: 24,
        assistantMessageCount: 12,
        currentTokens: 18_250,
        sessionKey: null,
        compactionCount: 1,
        lastCompactedAt: "2026-04-12T20:00:00.000Z",
        reserveTokens: 24_000,
        keepRecentTokens: 16_000,
        autoCompactionEnabled: false
      },
      result: {
        compacted: true,
        reason: null,
        tokensBefore: 18_250,
        tokensAfter: null
      }
    });
  });

  test("loads web compaction state through the native session resolve seam", async () => {
    const { service, sessionResolveInputs } = createService({
      sessionResolveResult: {
        found: true,
        session: createCompactionSession({
          currentTokens: 18_250,
          compactionCount: 0,
          updatedAt: null
        })
      }
    });

    const state = await service.getChatCompactionState("user-1", "chat-1");

    assert.deepEqual(sessionResolveInputs, [
      {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "free_shared_restricted",
        surfaceThreadKey: "thread-1",
        userId: "user-1"
      }
    ]);
    assert.deepEqual(state, {
      available: true,
      suggested: true,
      suggestionReason: "token_threshold",
      messageCount: 24,
      assistantMessageCount: 12,
      currentTokens: 18_250,
      sessionKey: null,
      compactionCount: 0,
      lastCompactedAt: null,
      reserveTokens: 24_000,
      keepRecentTokens: 16_000,
      autoCompactionEnabled: false
    });
  });

  test("derives web compaction thresholds from the applied materialized bundle", async () => {
    const { service } = createService({
      sharedCompaction: {
        reserveTokens: 10_000,
        keepRecentTokens: 4_000,
        recentTurnsPreserve: 2,
        webSuggestionLatencyMs: 5_000
      },
      contextHydration: {
        autoCompactionWeb: true
      },
      sessionResolveResult: {
        found: true,
        session: createCompactionSession({
          currentTokens: null,
          compactionCount: 0,
          updatedAt: null
        })
      }
    });

    const state = await service.getChatCompactionState("user-1", "chat-1");

    assert.deepEqual(state, {
      available: true,
      suggested: false,
      suggestionReason: null,
      messageCount: 24,
      assistantMessageCount: 12,
      currentTokens: null,
      sessionKey: null,
      compactionCount: 0,
      lastCompactedAt: null,
      reserveTokens: 10_000,
      keepRecentTokens: 4_000,
      autoCompactionEnabled: true
    });
  });

  test("treats threshold skips as non-errors and clears the suggestion", async () => {
    const { service } = createService({
      compactResult: {
        compacted: false,
        reason: "threshold_not_reached",
        tokensBefore: 18_250,
        tokensAfter: null,
        session: createCompactionSession({
          compactionCount: 0,
          updatedAt: null
        }),
        toolResult: createCompactionToolResult({
          action: "skipped",
          reason: "threshold_not_reached"
        })
      }
    });

    const result = await service.compactChat("user-1", "chat-1");

    assert.equal(result.state.suggested, false);
    assert.equal(result.state.suggestionReason, null);
    assert.equal(result.result.compacted, false);
    assert.equal(result.result.reason, null);
  });

  test("does not suggest compaction from latency alone anymore", async () => {
    const { service } = createService({
      messages: createSlowTurnMessages(),
      sessionResolveResult: {
        found: true,
        session: createCompactionSession({
          currentTokens: 7_900,
          compactionCount: 0,
          updatedAt: null
        })
      }
    });

    const state = await service.getChatCompactionState("user-1", "chat-1");

    assert.equal(state.suggested, false);
    assert.equal(state.suggestionReason, null);
    assert.equal(state.currentTokens, 7_900);
  });

  test("maps native unavailable reasons back to compaction_unavailable", async () => {
    const { service } = createService({
      compactResult: {
        compacted: false,
        reason: "session_not_found",
        tokensBefore: null,
        tokensAfter: null,
        session: null,
        toolResult: createCompactionToolResult({
          action: "skipped",
          reason: "session_not_found"
        })
      }
    });

    await assert.rejects(
      () => service.compactChat("user-1", "chat-1"),
      (error) =>
        error instanceof AssistantRuntimeError &&
        error.code === "compaction_unavailable" &&
        error.message.includes('try "Compress now" again')
    );
  });
});
