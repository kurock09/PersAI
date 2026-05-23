import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TelegramBotClientService } from "../src/modules/workspace-management/application/telegram-bot.client.service";

function createJsonOkResponse(): Response {
  return new Response(JSON.stringify({ ok: true, result: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

describe("TelegramBotClientService", () => {
  test("skips duplicate plain-text reply when delivered media already carries a caption", async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return createJsonOkResponse();
    };

    try {
      const service = new TelegramBotClientService({
        async downloadObject() {
          return null;
        }
      } as never);

      await service.sendAssistantTurnReply({
        botToken: "bot-token",
        chatId: "chat-1",
        assistantId: "assistant-1",
        parseMode: "markdown",
        turnResult: {
          assistantMessage: "Here is your program",
          respondedAt: "2026-04-20T00:00:00.000Z",
          media: [
            {
              source: "persai_object_storage",
              objectKey: "assistant-media/runtime/program.cpp",
              type: "document",
              mimeType: "text/plain",
              filename: "program.cpp",
              sizeBytes: 64,
              caption: "Here is your program"
            }
          ]
        } as never,
        mediaAlreadyDelivered: true
      });

      assert.deepEqual(calls, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps plain-text reply when delivered media has no caption", async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return createJsonOkResponse();
    };

    try {
      const service = new TelegramBotClientService({
        async downloadObject() {
          return null;
        }
      } as never);

      await service.sendAssistantTurnReply({
        botToken: "bot-token",
        chatId: "chat-1",
        assistantId: "assistant-1",
        parseMode: "plain_text",
        turnResult: {
          assistantMessage: "The file is ready.",
          respondedAt: "2026-04-20T00:00:00.000Z",
          media: [
            {
              source: "persai_object_storage",
              objectKey: "assistant-media/runtime/program.cpp",
              type: "document",
              mimeType: "text/plain",
              filename: "program.cpp",
              sizeBytes: 64,
              caption: null
            }
          ]
        } as never,
        mediaAlreadyDelivered: true
      });

      assert.equal(calls.length, 1);
      assert.match(calls[0] ?? "", /sendMessage$/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps final text when delivered media caption is different", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      });
      return createJsonOkResponse();
    };

    try {
      const service = new TelegramBotClientService({
        async downloadObject() {
          return null;
        }
      } as never);

      await service.sendAssistantTurnReply({
        botToken: "bot-token",
        chatId: "chat-1",
        assistantId: "assistant-1",
        parseMode: "plain_text",
        turnResult: {
          assistantMessage: "Done. I made the poster warmer and more cinematic.",
          respondedAt: "2026-04-20T00:00:00.000Z",
          media: [
            {
              source: "persai_object_storage",
              objectKey: "assistant-media/runtime/poster.png",
              type: "image",
              mimeType: "image/png",
              filename: "poster.png",
              sizeBytes: 64,
              caption: "poster.png"
            }
          ]
        } as never,
        mediaAlreadyDelivered: true
      });

      assert.equal(calls.length, 1);
      assert.match(calls[0]?.url ?? "", /sendMessage$/);
      assert.equal(calls[0]?.body.text, "Done. I made the poster warmer and more cinematic.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
