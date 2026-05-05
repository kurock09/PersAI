import assert from "node:assert/strict";
import { AssistantRuntimeError } from "../src/modules/workspace-management/application/assistant-runtime.facade";
import { RenderAssistantInboundSurfaceMessageService } from "../src/modules/workspace-management/application/render-assistant-inbound-surface-message.service";
import { TelegramChannelAdapterService } from "../src/modules/workspace-management/application/telegram-channel-adapter.service";

async function run(): Promise<void> {
  let sendReplyCalls = 0;
  let executeTurnCalls = 0;
  let syncedTargets = 0;
  let syncedGroups = 0;
  const mediaDeliveryCalls: Array<Record<string, unknown>> = [];
  const sendReplyPayloads: Array<Record<string, unknown>> = [];

  const service = new TelegramChannelAdapterService(
    {
      async resolveByAssistantId() {
        return {
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          locale: "en",
          botToken: "bot-token",
          botUserId: 777,
          botUsername: "persai_bot",
          inbound: true,
          outbound: true,
          groupReplyMode: "mention_reply",
          parseMode: "plain_text",
          accessMode: "owner_only",
          ownerClaimStatus: "claimed",
          ownerClaimCode: null,
          ownerClaimCodeExpiresAt: null,
          ownerTelegramUserId: 42,
          ownerTelegramUsername: "alex",
          ownerTelegramChatId: "42",
          runtimeHealth: "ok",
          webhookSecret: "tg-secret"
        };
      }
    } as never,
    {
      async sendPlainText() {
        return undefined;
      },
      async sendAssistantTurnReply(params: Record<string, unknown>) {
        sendReplyCalls += 1;
        sendReplyPayloads.push(params);
      },
      async downloadInboundFile() {
        throw new Error("not expected");
      }
    } as never,
    {
      async execute() {
        executeTurnCalls += 1;
        return {
          assistantMessage: "native reply",
          respondedAt: "2026-04-12T10:00:00.000Z",
          media: [
            {
              source: "persai_object_storage",
              objectKey: "assistant-media/sandbox/jobs/job-1/program.cpp",
              type: "document",
              mimeType: "text/plain",
              filename: "program.cpp",
              sizeBytes: 64,
              caption: "Here is your program"
            }
          ],
          assistantMessageId: "assistant-msg-1",
          chatId: "chat-1",
          workspaceId: "workspace-1"
        };
      }
    } as never,
    {
      async deliver(input: Record<string, unknown>) {
        mediaDeliveryCalls.push(input);
        return { attachments: [] };
      }
    } as never,
    {
      async execute() {
        syncedTargets += 1;
      }
    } as never,
    {
      async execute() {
        syncedGroups += 1;
      }
    } as never,
    new RenderAssistantInboundSurfaceMessageService() as never,
    {
      async patchMetadata() {
        return undefined;
      }
    } as never
  );

  const success = await service.handleWebhook({
    assistantId: "assistant-1",
    secretToken: "tg-secret",
    payload: {
      update_id: 123,
      message: {
        text: "hello",
        chat: { id: 42, type: "private" },
        from: { id: 42, username: "alex" }
      }
    }
  });
  assert.deepEqual(success, { statusCode: 200, body: { ok: true } });
  assert.equal(executeTurnCalls, 1);
  assert.equal(sendReplyCalls, 1);
  assert.equal(syncedTargets, 1);
  assert.equal(syncedGroups, 0);
  assert.deepEqual(mediaDeliveryCalls, [
    {
      artifacts: [
        {
          source: "persai_object_storage",
          objectKey: "assistant-media/sandbox/jobs/job-1/program.cpp",
          type: "document",
          mimeType: "text/plain",
          filename: "program.cpp",
          sizeBytes: 64,
          caption: "Here is your program"
        }
      ],
      channel: "telegram",
      assistantId: "assistant-1",
      chatId: "chat-1",
      messageId: "assistant-msg-1",
      workspaceId: "workspace-1",
      channelTarget: {
        channel: "telegram",
        chatId: "42",
        metadata: {
          botToken: "bot-token"
        }
      }
    }
  ]);
  assert.equal(sendReplyPayloads[0]?.mediaAlreadyDelivered, false);
  assert.deepEqual(
    (sendReplyPayloads[0]?.turnResult as { media?: unknown[] } | undefined)?.media,
    []
  );
  assert.equal(
    (sendReplyPayloads[0]?.turnResult as { assistantMessage?: string } | undefined)
      ?.assistantMessage,
    "native reply\n\nCorrection: no file was actually delivered in this reply."
  );

  const unauthorized = await service.handleWebhook({
    assistantId: "assistant-1",
    secretToken: "wrong-secret",
    payload: {}
  });
  assert.deepEqual(unauthorized, { statusCode: 401, body: { ok: false, error: "unauthorized" } });

  const claimSyncCalls: Array<Record<string, unknown>> = [];
  const claimReplies: string[] = [];
  const claimService = new TelegramChannelAdapterService(
    {
      async resolveByAssistantId() {
        return {
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          locale: "en",
          botToken: "bot-token",
          botUserId: 777,
          botUsername: "persai_bot",
          inbound: true,
          outbound: true,
          groupReplyMode: "mention_reply",
          parseMode: "plain_text",
          accessMode: "owner_only",
          ownerClaimStatus: "pending",
          ownerClaimCode: "300077",
          ownerClaimCodeExpiresAt: "2999-01-01T00:00:00.000Z",
          ownerTelegramUserId: null,
          ownerTelegramUsername: null,
          ownerTelegramChatId: null,
          runtimeHealth: "ok",
          webhookSecret: "tg-secret"
        };
      }
    } as never,
    {
      async sendPlainText(_botToken: string, _chatId: string, text: string) {
        claimReplies.push(text);
      },
      async sendAssistantTurnReply() {
        throw new Error("not expected");
      },
      async downloadInboundFile() {
        throw new Error("not expected");
      }
    } as never,
    {
      async execute() {
        throw new Error("not expected");
      }
    } as never,
    {
      async deliver() {
        throw new Error("not expected");
      }
    } as never,
    {
      async execute(input: Record<string, unknown>) {
        claimSyncCalls.push(input);
      }
    } as never,
    {
      async execute() {
        throw new Error("not expected");
      }
    } as never,
    new RenderAssistantInboundSurfaceMessageService() as never,
    {
      async patchMetadata() {
        return undefined;
      }
    } as never
  );

  const claimResult = await claimService.handleWebhook({
    assistantId: "assistant-1",
    secretToken: "tg-secret",
    payload: {
      update_id: 125,
      message: {
        text: "3 0 0 0 7 7",
        chat: { id: 42, type: "private" },
        from: { id: 42, username: "alex" }
      }
    }
  });
  assert.deepEqual(claimResult, { statusCode: 200, body: { ok: true } });
  assert.equal(claimSyncCalls[0]?.claimOwner, true);
  assert.equal(claimSyncCalls[1]?.claimOwner, false);
  assert.deepEqual(claimReplies, [
    "Telegram is connected. This is the owner's private chat. I'm here now, and you can continue right in this conversation."
  ]);

  const retryPlainTexts: string[] = [];
  let lastHandledUpdateId: number | null = null;
  let retryExecuteCalls = 0;
  const retryable = new TelegramChannelAdapterService(
    {
      async resolveByAssistantId() {
        return {
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          locale: "en",
          botToken: "bot-token",
          botUserId: 777,
          botUsername: "persai_bot",
          inbound: true,
          outbound: true,
          groupReplyMode: "mention_reply",
          parseMode: "plain_text",
          accessMode: "owner_only",
          ownerClaimStatus: "claimed",
          ownerClaimCode: null,
          ownerClaimCodeExpiresAt: null,
          ownerTelegramUserId: 42,
          ownerTelegramUsername: "alex",
          ownerTelegramChatId: "42",
          runtimeHealth: "ok",
          webhookSecret: "tg-secret"
        };
      }
    } as never,
    {
      async sendPlainText(_botToken: string, _chatId: string, text: string) {
        retryPlainTexts.push(text);
        return undefined;
      },
      async sendAssistantTurnReply(params: { turnResult: { deduplicated?: boolean } }) {
        if (params.turnResult.deduplicated === true) {
          return undefined;
        }
        throw new Error("not expected");
      },
      async downloadInboundFile() {
        throw new Error("not expected");
      }
    } as never,
    {
      async execute() {
        retryExecuteCalls += 1;
        if (lastHandledUpdateId === 124) {
          return {
            assistantMessage: "",
            respondedAt: "2026-04-12T10:00:01.000Z",
            media: [],
            deduplicated: true
          };
        }
        throw new AssistantRuntimeError("timeout", "timed out");
      }
    } as never,
    {
      async deliver() {
        throw new Error("not expected");
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
    new RenderAssistantInboundSurfaceMessageService() as never,
    {
      async completeTelegramUpdateProcessing(
        _assistantId: string,
        _providerKey: string,
        _surfaceType: string,
        updateId: number
      ) {
        lastHandledUpdateId = updateId;
      },
      async patchMetadata() {
        return undefined;
      }
    } as never
  );

  const retryResult = await retryable.handleWebhook({
    assistantId: "assistant-1",
    secretToken: "tg-secret",
    payload: {
      update_id: 124,
      message: {
        text: "hello again",
        chat: { id: 42, type: "private" },
        from: { id: 42, username: "alex" }
      }
    }
  });
  assert.deepEqual(retryResult, {
    statusCode: 200,
    body: { ok: false, error: "runtime_timeout" }
  });
  assert.deepEqual(retryPlainTexts, ["The assistant took too long to respond. Please try again."]);
  assert.equal(lastHandledUpdateId, 124);
  assert.equal(retryExecuteCalls, 1);

  const duplicateRetryResult = await retryable.handleWebhook({
    assistantId: "assistant-1",
    secretToken: "tg-secret",
    payload: {
      update_id: 124,
      message: {
        text: "hello again",
        chat: { id: 42, type: "private" },
        from: { id: 42, username: "alex" }
      }
    }
  });
  assert.deepEqual(duplicateRetryResult, {
    statusCode: 200,
    body: { ok: true }
  });
  assert.equal(retryExecuteCalls, 2);
  assert.deepEqual(retryPlainTexts, ["The assistant took too long to respond. Please try again."]);
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
