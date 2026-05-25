import assert from "node:assert/strict";
import { persistAssistantMessage } from "../src/modules/workspace-management/application/persist-assistant-message";

async function run(): Promise<void> {
  {
    const createdMessages: Array<Record<string, unknown>> = [];
    const ackCalls: Array<Record<string, unknown>> = [];
    const assistantMessage = await persistAssistantMessage({
      chatRepository: {
        async createMessage(input) {
          createdMessages.push(input as unknown as Record<string, unknown>);
          return {
            id: "assistant-message-1",
            chatId: input.chatId,
            assistantId: input.assistantId,
            author: input.author,
            content: input.content,
            metadata: input.metadata ?? null,
            createdAt: new Date("2026-05-25T18:00:00.000Z")
          };
        }
      },
      assistantMediaJobService: {
        async attachAcknowledgementMessageId(input) {
          ackCalls.push(input as unknown as Record<string, unknown>);
          return 1;
        }
      },
      chatId: "chat-1",
      assistantId: "assistant-1",
      content: "Done.",
      discoveredFileRefIds: ["file-1", "file-2"],
      deferredMediaJobCount: 2,
      sourceUserMessageId: "user-message-1"
    });

    assert.equal(assistantMessage.id, "assistant-message-1");
    assert.deepEqual(createdMessages, [
      {
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "assistant",
        content: "Done.",
        metadata: {
          discoveredFileRefIds: ["file-1", "file-2"]
        }
      }
    ]);
    assert.deepEqual(ackCalls, [
      {
        assistantId: "assistant-1",
        sourceUserMessageId: "user-message-1",
        assistantAcknowledgementMessageId: "assistant-message-1"
      }
    ]);
  }

  {
    const createdMessages: Array<Record<string, unknown>> = [];
    let ackCalled = false;
    await persistAssistantMessage({
      chatRepository: {
        async createMessage(input) {
          createdMessages.push(input as unknown as Record<string, unknown>);
          return {
            id: "assistant-message-2",
            chatId: input.chatId,
            assistantId: input.assistantId,
            author: input.author,
            content: input.content,
            metadata: input.metadata ?? null,
            createdAt: new Date("2026-05-25T18:00:01.000Z")
          };
        }
      },
      assistantMediaJobService: {
        async attachAcknowledgementMessageId() {
          ackCalled = true;
          return 0;
        }
      },
      chatId: "chat-2",
      assistantId: "assistant-2",
      content: "No files here.",
      discoveredFileRefIds: [],
      deferredMediaJobCount: 0,
      sourceUserMessageId: "user-message-2"
    });

    assert.deepEqual(createdMessages, [
      {
        chatId: "chat-2",
        assistantId: "assistant-2",
        author: "assistant",
        content: "No files here."
      }
    ]);
    assert.equal(ackCalled, false);
  }
}

void run();
