import assert from "node:assert/strict";
import test from "node:test";
import {
  TelegramChannelAdapterService,
  buildTelegramRuntimeThreadKey,
  extractTelegramWebhookEvent,
  isTelegramNewSessionRequest,
  normalizeTelegramTextIntent
} from "../src/modules/workspace-management/application/telegram-channel-adapter.service";

const defaultAlbumCollectorStub = {
  async appendPart() {
    return "appended" as const;
  }
};

const defaultInboundContextStub = {
  async resolveByAssistantId() {
    return {
      assistantId: "assistant-1",
      userId: "user-1",
      workspaceId: "workspace-1"
    };
  }
};
import {
  resolveTelegramBindingMetadataState,
  rotateTelegramSessionMetadata
} from "../src/modules/workspace-management/application/telegram-integration.metadata";

test("normalizes explicit telegram new-session intents", () => {
  assert.equal(normalizeTelegramTextIntent("/new@TestBot"), "/new");
  assert.equal(normalizeTelegramTextIntent("  Начни   новый чат! "), "начни новый чат");
  assert.equal(normalizeTelegramTextIntent("start a new chat."), "start a new chat");
});

test("detects private text requests for a fresh telegram session", () => {
  assert.equal(
    isTelegramNewSessionRequest({
      event: {
        kind: "message",
        updateId: 1,
        chatId: "chat-1",
        chatType: "private",
        chatTitle: null,
        telegramUserId: 1,
        telegramUsername: "alex",
        mediaGroupId: null,
        incomingText: "/new",
        replyToUserId: null,
        turnKind: "text",
        userMessage: "/new",
        attachment: null
      }
    }),
    true
  );
  assert.equal(
    isTelegramNewSessionRequest({
      event: {
        kind: "message",
        updateId: 1,
        chatId: "chat-1",
        chatType: "private",
        chatTitle: null,
        telegramUserId: 1,
        telegramUsername: "alex",
        mediaGroupId: null,
        incomingText: "новый чат",
        replyToUserId: null,
        turnKind: "text",
        userMessage: "новый чат",
        attachment: null
      }
    }),
    true
  );
  assert.equal(
    isTelegramNewSessionRequest({
      event: {
        kind: "message",
        updateId: 1,
        chatId: "chat-1",
        chatType: "group",
        chatTitle: "Group",
        telegramUserId: 1,
        telegramUsername: "alex",
        mediaGroupId: null,
        incomingText: "/new",
        replyToUserId: null,
        turnKind: "text",
        userMessage: "/new",
        attachment: null
      }
    }),
    false
  );
});

test("keeps legacy telegram thread key until a session key exists", () => {
  assert.equal(buildTelegramRuntimeThreadKey("12345", "default_session"), "12345");
  assert.match(
    buildTelegramRuntimeThreadKey("12345", "session-key-1"),
    /^telegram:12345:session:session-key-1$/
  );
});

test("rotates telegram session metadata without losing existing identity", () => {
  const rotated = resolveTelegramBindingMetadataState(
    rotateTelegramSessionMetadata({
      telegramOwnerTelegramChatId: "12345",
      telegramOwnerTelegramUserId: 777,
      telegramSessionThreadKey: "default_session"
    })
  );
  assert.equal(rotated.telegramOwnerTelegramChatId, "12345");
  assert.equal(rotated.telegramOwnerTelegramUserId, 777);
  assert.notEqual(rotated.telegramSessionThreadKey, "default_session");
  assert.equal(typeof rotated.telegramSessionRotatedAt, "string");
});

test("deduplicates /new webhook delivery and rotates telegram session only once", async () => {
  let currentMetadata: Record<string, unknown> = {
    telegramOwnerClaimStatus: "claimed",
    telegramOwnerTelegramUserId: 777,
    telegramOwnerTelegramChatId: "12345",
    telegramSessionThreadKey: "default_session"
  };
  let activeUpdateId: number | null = null;
  let lastHandledUpdateId: number | null = null;
  let patchCalls = 0;
  let sendCalls = 0;
  let completeCalls = 0;

  const service = new TelegramChannelAdapterService(
    {
      async resolveByAssistantId() {
        return {
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          locale: "ru",
          botToken: "bot-token",
          botUserId: 555,
          botUsername: "test_bot",
          inbound: true,
          outbound: true,
          groupReplyMode: "mention_reply",
          parseMode: "plain_text",
          defaultDeepModeEnabled: false,
          accessMode: "owner_only",
          ownerClaimStatus: "claimed",
          ownerClaimCode: null,
          ownerClaimCodeExpiresAt: null,
          ownerTelegramUserId: 777,
          ownerTelegramUsername: "alex",
          ownerTelegramChatId: "12345",
          sessionThreadKey:
            typeof currentMetadata.telegramSessionThreadKey === "string"
              ? currentMetadata.telegramSessionThreadKey
              : "default_session",
          runtimeHealth: "ok",
          webhookSecret: "secret-1"
        };
      }
    } as never,
    {
      async sendPlainText() {
        sendCalls += 1;
      }
    } as never,
    {
      async execute() {
        throw new Error("runtime turn should not execute for /new");
      }
    } as never,
    {
      async markUndeliveredArtifactsReconciliationRequired() {
        return undefined;
      },
      async deliver() {
        throw new Error("media delivery should not run for /new");
      }
    } as never,
    {
      async execute() {
        return undefined;
      }
    } as never,
    {
      async execute() {
        return undefined;
      }
    } as never,
    {
      renderError() {
        return { text: "error" };
      }
    } as never,
    {
      async deliverIntentNow() {
        throw new Error("notification delivery should not run for /new");
      }
    } as never,
    defaultAlbumCollectorStub as never,
    defaultInboundContextStub as never,
    {
      async listChatsByAssistantId() {
        return [];
      }
    } as never,
    {
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
          metadata: { ...currentMetadata },
          connectedAt: null,
          disconnectedAt: null,
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
          updatedAt: new Date("2026-05-01T00:00:00.000Z")
        };
      },
      async claimTelegramUpdateProcessing(
        _assistantId: string,
        _providerKey: string,
        _surfaceType: string,
        updateId: number
      ) {
        if (lastHandledUpdateId !== null && updateId <= lastHandledUpdateId) {
          return "duplicate_handled" as const;
        }
        if (activeUpdateId === updateId) {
          return "duplicate_inflight" as const;
        }
        activeUpdateId = updateId;
        return "claimed" as const;
      },
      async completeTelegramUpdateProcessing(
        _assistantId: string,
        _providerKey: string,
        _surfaceType: string,
        updateId: number
      ) {
        completeCalls += 1;
        lastHandledUpdateId = updateId;
        activeUpdateId = null;
      },
      async releaseTelegramUpdateProcessing() {
        activeUpdateId = null;
      },
      async patchMetadata(
        _assistantId: string,
        _providerKey: string,
        _surfaceType: string,
        patch: Record<string, unknown>
      ) {
        patchCalls += 1;
        currentMetadata = { ...patch };
      },
      async hasActiveBindingForProvider() {
        return true;
      }
    } as never
  );

  const payload = {
    update_id: 101,
    message: {
      text: "/new",
      chat: { id: 12345, type: "private" },
      from: { id: 777, username: "alex" }
    }
  };

  const first = await service.handleWebhook({
    assistantId: "assistant-1",
    secretToken: "secret-1",
    payload
  });
  const second = await service.handleWebhook({
    assistantId: "assistant-1",
    secretToken: "secret-1",
    payload
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(patchCalls, 1);
  assert.equal(sendCalls, 1);
  assert.equal(completeCalls, 1);
  assert.notEqual(currentMetadata.telegramSessionThreadKey, "default_session");
});

test("uses rotated telegram session key for the next inbound turn after /new", async () => {
  let currentMetadata: Record<string, unknown> = {
    telegramOwnerClaimStatus: "claimed",
    telegramOwnerTelegramUserId: 777,
    telegramOwnerTelegramChatId: "12345",
    telegramSessionThreadKey: "default_session"
  };
  let activeUpdateId: number | null = null;
  let lastHandledUpdateId: number | null = null;
  const runtimeThreadIds: string[] = [];

  const service = new TelegramChannelAdapterService(
    {
      async resolveByAssistantId() {
        return {
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          locale: "ru",
          botToken: "bot-token",
          botUserId: 555,
          botUsername: "test_bot",
          inbound: true,
          outbound: true,
          groupReplyMode: "mention_reply",
          parseMode: "plain_text",
          defaultDeepModeEnabled: false,
          accessMode: "owner_only",
          ownerClaimStatus: "claimed",
          ownerClaimCode: null,
          ownerClaimCodeExpiresAt: null,
          ownerTelegramUserId: 777,
          ownerTelegramUsername: "alex",
          ownerTelegramChatId: "12345",
          sessionThreadKey:
            typeof currentMetadata.telegramSessionThreadKey === "string"
              ? currentMetadata.telegramSessionThreadKey
              : "default_session",
          runtimeHealth: "ok",
          webhookSecret: "secret-1"
        };
      }
    } as never,
    {
      async sendPlainText() {
        return undefined;
      },
      async sendAssistantTurnReply() {
        return undefined;
      }
    } as never,
    {
      async execute(input: { threadId: string }) {
        runtimeThreadIds.push(input.threadId);
        return {
          assistantMessage: "reply",
          respondedAt: "2026-05-11T10:00:00.000Z",
          media: [],
          assistantMessageId: "assistant-msg-1",
          chatId: "chat-1",
          workspaceId: "workspace-1",
          quotaAdvisoryFollowUpIntentId: null,
          compactionAdvisoryFollowUpIntentId: null
        };
      }
    } as never,
    {
      async markUndeliveredArtifactsReconciliationRequired() {
        return undefined;
      },
      async deliver() {
        throw new Error("media delivery should not run in this test");
      }
    } as never,
    {
      async execute() {
        return undefined;
      }
    } as never,
    {
      async execute() {
        return undefined;
      }
    } as never,
    {
      renderError() {
        return { text: "error" };
      }
    } as never,
    {
      async deliverIntentNow() {
        throw new Error("notification delivery should not run in this test");
      }
    } as never,
    defaultAlbumCollectorStub as never,
    defaultInboundContextStub as never,
    {
      async listChatsByAssistantId() {
        return [];
      }
    } as never,
    {
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
          metadata: { ...currentMetadata },
          connectedAt: null,
          disconnectedAt: null,
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
          updatedAt: new Date("2026-05-01T00:00:00.000Z")
        };
      },
      async claimTelegramUpdateProcessing(
        _assistantId: string,
        _providerKey: string,
        _surfaceType: string,
        updateId: number
      ) {
        if (lastHandledUpdateId !== null && updateId <= lastHandledUpdateId) {
          return "duplicate_handled" as const;
        }
        if (activeUpdateId === updateId) {
          return "duplicate_inflight" as const;
        }
        activeUpdateId = updateId;
        return "claimed" as const;
      },
      async completeTelegramUpdateProcessing(
        _assistantId: string,
        _providerKey: string,
        _surfaceType: string,
        updateId: number
      ) {
        lastHandledUpdateId = updateId;
        activeUpdateId = null;
      },
      async releaseTelegramUpdateProcessing() {
        activeUpdateId = null;
      },
      async patchMetadata(
        _assistantId: string,
        _providerKey: string,
        _surfaceType: string,
        patch: Record<string, unknown>
      ) {
        currentMetadata = { ...patch };
      },
      async hasActiveBindingForProvider() {
        return true;
      }
    } as never
  );

  await service.handleWebhook({
    assistantId: "assistant-1",
    secretToken: "secret-1",
    payload: {
      update_id: 201,
      message: {
        text: "/new",
        chat: { id: 12345, type: "private" },
        from: { id: 777, username: "alex" }
      }
    }
  });

  const rotatedSessionKey = String(currentMetadata.telegramSessionThreadKey);

  await service.handleWebhook({
    assistantId: "assistant-1",
    secretToken: "secret-1",
    payload: {
      update_id: 202,
      message: {
        text: "hello after reset",
        chat: { id: 12345, type: "private" },
        from: { id: 777, username: "alex" }
      }
    }
  });

  assert.equal(runtimeThreadIds.length, 1);
  assert.equal(runtimeThreadIds[0], `telegram:12345:session:${rotatedSessionKey}`);
});

test("passes compaction queue notice as a post-reply notice instead of sending a separate pre-reply text", async () => {
  let sendPlainTextCalls = 0;
  let capturedPostReplyNotices: string[] | null = null;

  const service = new TelegramChannelAdapterService(
    {
      async resolveByAssistantId() {
        return {
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          locale: "ru",
          botToken: "bot-token",
          botUserId: 555,
          botUsername: "test_bot",
          inbound: true,
          outbound: true,
          groupReplyMode: "mention_reply",
          parseMode: "plain_text",
          defaultDeepModeEnabled: false,
          accessMode: "owner_only",
          ownerClaimStatus: "claimed",
          ownerClaimCode: null,
          ownerClaimCodeExpiresAt: null,
          ownerTelegramUserId: 777,
          ownerTelegramUsername: "alex",
          ownerTelegramChatId: "12345",
          sessionThreadKey: "default_session",
          runtimeHealth: "ok",
          webhookSecret: "secret-1"
        };
      }
    } as never,
    {
      async sendPlainText() {
        sendPlainTextCalls += 1;
      },
      async sendAssistantTurnReply(params: { postReplyNotices?: string[] }) {
        capturedPostReplyNotices = params.postReplyNotices ?? [];
      }
    } as never,
    {
      async execute() {
        return {
          assistantMessage: "reply",
          respondedAt: "2026-05-11T10:00:00.000Z",
          media: [],
          assistantMessageId: "assistant-msg-1",
          chatId: "chat-1",
          workspaceId: "workspace-1",
          quotaAdvisoryFollowUpIntentId: null,
          compactionAdvisoryFollowUpIntentId: null,
          compactionQueueNoticeKind: "compacted" as const
        };
      }
    } as never,
    {
      async markUndeliveredArtifactsReconciliationRequired() {
        return undefined;
      },
      async deliver() {
        return undefined;
      }
    } as never,
    {
      async execute() {
        return undefined;
      }
    } as never,
    {
      async execute() {
        return undefined;
      }
    } as never,
    {
      renderError() {
        return { text: "error" };
      }
    } as never,
    {
      async deliverIntentNow() {
        return undefined;
      }
    } as never,
    defaultAlbumCollectorStub as never,
    defaultInboundContextStub as never,
    {
      async listChatsByAssistantId() {
        return [];
      },
      async updateMessageContent() {
        return null;
      }
    } as never,
    {
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
          metadata: {
            telegramOwnerClaimStatus: "claimed",
            telegramOwnerTelegramUserId: 777,
            telegramOwnerTelegramChatId: "12345",
            telegramSessionThreadKey: "default_session"
          },
          connectedAt: null,
          disconnectedAt: null,
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
          updatedAt: new Date("2026-05-01T00:00:00.000Z")
        };
      },
      async claimTelegramUpdateProcessing() {
        return "claimed" as const;
      },
      async completeTelegramUpdateProcessing() {
        return undefined;
      },
      async releaseTelegramUpdateProcessing() {
        return undefined;
      },
      async patchMetadata() {
        return undefined;
      },
      async hasActiveBindingForProvider() {
        return true;
      }
    } as never
  );

  await service.handleWebhook({
    assistantId: "assistant-1",
    secretToken: "secret-1",
    payload: {
      update_id: 301,
      message: {
        text: "hello",
        chat: { id: 12345, type: "private" },
        from: { id: 777, username: "alex" }
      }
    }
  });

  assert.equal(sendPlainTextCalls, 0);
  assert.deepEqual(capturedPostReplyNotices, ["Готово, контекст сжал. Продолжаем."]);
});

test("extractTelegramWebhookEvent surfaces media_group_id for album parts", () => {
  const event = extractTelegramWebhookEvent("assistant-1", {
    update_id: 11,
    message: {
      media_group_id: "album-1",
      caption: "task text",
      chat: { id: 12345, type: "private" },
      from: { id: 777, username: "alex" },
      photo: [{ file_id: "small" }, { file_id: "large-photo" }]
    }
  });
  assert.equal(event.kind, "message");
  if (event.kind !== "message") {
    return;
  }
  assert.equal(event.mediaGroupId, "album-1");
  assert.equal(event.incomingText, "task text");
  assert.equal(event.attachment?.fileId, "large-photo");
});

test("album webhook parts are collected without starting a runtime turn", async () => {
  let appendCalls = 0;
  let executeTurnCalls = 0;

  const service = new TelegramChannelAdapterService(
    {
      async resolveByAssistantId() {
        return {
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          locale: "en",
          botToken: "bot-token",
          botUserId: 555,
          botUsername: "test_bot",
          inbound: true,
          outbound: true,
          groupReplyMode: "mention_reply",
          parseMode: "plain_text",
          defaultDeepModeEnabled: false,
          accessMode: "owner_only",
          ownerClaimStatus: "claimed",
          ownerClaimCode: null,
          ownerClaimCodeExpiresAt: null,
          ownerTelegramUserId: 777,
          ownerTelegramUsername: "alex",
          ownerTelegramChatId: "12345",
          sessionThreadKey: "default_session",
          runtimeHealth: "ok",
          webhookSecret: "secret-1"
        };
      }
    } as never,
    {
      async sendPlainText() {
        return undefined;
      },
      async sendAssistantTurnReply() {
        throw new Error("album parts should not send a reply from webhook");
      }
    } as never,
    {
      async execute() {
        executeTurnCalls += 1;
        throw new Error("runtime turn should not execute for album parts");
      }
    } as never,
    {
      async markUndeliveredArtifactsReconciliationRequired() {
        return undefined;
      },
      async deliver() {
        throw new Error("media delivery should not run for album parts");
      }
    } as never,
    {
      async execute() {
        return undefined;
      }
    } as never,
    {
      async execute() {
        return undefined;
      }
    } as never,
    {
      renderError() {
        return { text: "error" };
      }
    } as never,
    {
      async deliverIntentNow() {
        return undefined;
      }
    } as never,
    {
      async appendPart() {
        appendCalls += 1;
        return "appended" as const;
      }
    } as never,
    defaultInboundContextStub as never,
    {
      async findOrCreateChatBySurfaceThread() {
        return {
          id: "chat-1",
          assistantId: "assistant-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          surface: "telegram",
          surfaceThreadKey: "12345",
          title: null,
          deepModeEnabled: false,
          skillDecisionState: null,
          skillCadenceState: null,
          skillRetrievalState: null,
          archivedAt: null,
          lastMessageAt: null,
          lastCrossSessionCarryOverAt: null,
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
          updatedAt: new Date("2026-05-01T00:00:00.000Z")
        };
      }
    } as never,
    {
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
          metadata: {
            telegramOwnerClaimStatus: "claimed",
            telegramOwnerTelegramUserId: 777,
            telegramOwnerTelegramChatId: "12345",
            telegramSessionThreadKey: "default_session"
          },
          connectedAt: null,
          disconnectedAt: null,
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
          updatedAt: new Date("2026-05-01T00:00:00.000Z")
        };
      },
      async claimTelegramUpdateProcessing() {
        return "claimed" as const;
      },
      async completeTelegramUpdateProcessing() {
        return undefined;
      },
      async releaseTelegramUpdateProcessing() {
        return undefined;
      },
      async patchMetadata() {
        return undefined;
      },
      async hasActiveBindingForProvider() {
        return true;
      }
    } as never
  );

  const albumPayload = {
    update_id: 401,
    message: {
      media_group_id: "album-42",
      caption: "compare these",
      chat: { id: 12345, type: "private" },
      from: { id: 777, username: "alex" },
      photo: [{ file_id: "photo-a" }, { file_id: "photo-b" }]
    }
  };

  const first = await service.handleWebhook({
    assistantId: "assistant-1",
    secretToken: "secret-1",
    payload: albumPayload
  });
  const second = await service.handleWebhook({
    assistantId: "assistant-1",
    secretToken: "secret-1",
    payload: {
      ...albumPayload,
      update_id: 402,
      message: { ...albumPayload.message, photo: [{ file_id: "photo-c" }] }
    }
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(appendCalls, 2);
  assert.equal(executeTurnCalls, 0);
});

test("single photo with caption still starts a runtime turn when media_group_id is absent", async () => {
  let executeTurnCalls = 0;
  let appendCalls = 0;

  const service = new TelegramChannelAdapterService(
    {
      async resolveByAssistantId() {
        return {
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          locale: "en",
          botToken: "bot-token",
          botUserId: 555,
          botUsername: "test_bot",
          inbound: true,
          outbound: true,
          groupReplyMode: "mention_reply",
          parseMode: "plain_text",
          defaultDeepModeEnabled: false,
          accessMode: "owner_only",
          ownerClaimStatus: "claimed",
          ownerClaimCode: null,
          ownerClaimCodeExpiresAt: null,
          ownerTelegramUserId: 777,
          ownerTelegramUsername: "alex",
          ownerTelegramChatId: "12345",
          sessionThreadKey: "default_session",
          runtimeHealth: "ok",
          webhookSecret: "secret-1"
        };
      }
    } as never,
    {
      async sendPlainText() {
        return undefined;
      },
      async sendAssistantTurnReply() {
        return undefined;
      },
      async downloadInboundFile() {
        return {
          buffer: Buffer.from("image"),
          filePath: "photos/photo.jpg"
        };
      }
    } as never,
    {
      async execute() {
        executeTurnCalls += 1;
        return {
          assistantMessage: "reply",
          respondedAt: "2026-05-11T10:00:00.000Z",
          media: [],
          assistantMessageId: "assistant-msg-1",
          chatId: "chat-1",
          workspaceId: "workspace-1",
          quotaAdvisoryFollowUpIntentId: null,
          compactionAdvisoryFollowUpIntentId: null
        };
      }
    } as never,
    {
      async markUndeliveredArtifactsReconciliationRequired() {
        return undefined;
      },
      async deliver() {
        return { attachments: [] };
      }
    } as never,
    {
      async execute() {
        return undefined;
      }
    } as never,
    {
      async execute() {
        return undefined;
      }
    } as never,
    {
      renderError() {
        return { text: "error" };
      }
    } as never,
    {
      async deliverIntentNow() {
        return undefined;
      }
    } as never,
    {
      async appendPart() {
        appendCalls += 1;
        return "appended" as const;
      }
    } as never,
    defaultInboundContextStub as never,
    {
      async findOrCreateChatBySurfaceThread() {
        return {
          id: "chat-1",
          assistantId: "assistant-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          surface: "telegram",
          surfaceThreadKey: "12345",
          title: null,
          deepModeEnabled: false,
          skillDecisionState: null,
          skillCadenceState: null,
          skillRetrievalState: null,
          archivedAt: null,
          lastMessageAt: null,
          lastCrossSessionCarryOverAt: null,
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
          updatedAt: new Date("2026-05-01T00:00:00.000Z")
        };
      }
    } as never,
    {
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
          metadata: {
            telegramOwnerClaimStatus: "claimed",
            telegramOwnerTelegramUserId: 777,
            telegramOwnerTelegramChatId: "12345",
            telegramSessionThreadKey: "default_session"
          },
          connectedAt: null,
          disconnectedAt: null,
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
          updatedAt: new Date("2026-05-01T00:00:00.000Z")
        };
      },
      async claimTelegramUpdateProcessing() {
        return "claimed" as const;
      },
      async completeTelegramUpdateProcessing() {
        return undefined;
      },
      async releaseTelegramUpdateProcessing() {
        return undefined;
      },
      async patchMetadata() {
        return undefined;
      },
      async hasActiveBindingForProvider() {
        return true;
      }
    } as never
  );

  await service.handleWebhook({
    assistantId: "assistant-1",
    secretToken: "secret-1",
    payload: {
      update_id: 501,
      message: {
        caption: "one photo task",
        chat: { id: 12345, type: "private" },
        from: { id: 777, username: "alex" },
        photo: [{ file_id: "solo-photo" }]
      }
    }
  });

  assert.equal(appendCalls, 0);
  assert.equal(executeTurnCalls, 1);
});
