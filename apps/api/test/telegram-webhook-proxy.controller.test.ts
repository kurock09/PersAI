import assert from "node:assert/strict";
import { AssistantRuntimeError } from "../src/modules/workspace-management/application/assistant-runtime.facade";
import { TelegramChannelAdapterService } from "../src/modules/workspace-management/application/telegram-channel-adapter.service";

async function run(): Promise<void> {
  let sendReplyCalls = 0;
  let executeTurnCalls = 0;
  let syncedTargets = 0;
  let syncedGroups = 0;

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
      async sendAssistantTurnReply() {
        sendReplyCalls += 1;
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
          media: []
        };
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
    {
      renderError(_surface: string, code: string, fallback: string) {
        return { code, text: fallback };
      }
    } as never,
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

  const unauthorized = await service.handleWebhook({
    assistantId: "assistant-1",
    secretToken: "wrong-secret",
    payload: {}
  });
  assert.deepEqual(unauthorized, { statusCode: 401, body: { ok: false, error: "unauthorized" } });

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
      async sendPlainText() {
        return undefined;
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
        throw new AssistantRuntimeError("timeout", "timed out");
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
      renderError(_surface: string, code: string, fallback: string) {
        return { code, text: fallback };
      }
    } as never,
    {
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
    statusCode: 504,
    body: { ok: false, error: "runtime_timeout" }
  });
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
