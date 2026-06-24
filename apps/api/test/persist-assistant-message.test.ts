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
      discoveredFilePaths: [
        "/shared/workspace-1/outbound/self/file-1.md",
        "/shared/workspace-1/outbound/self/file-2.md"
      ],
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
          discoveredFilePaths: [
            "/shared/workspace-1/outbound/self/file-1.md",
            "/shared/workspace-1/outbound/self/file-2.md"
          ]
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
      discoveredFilePaths: [],
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

  {
    const createdMessages: Array<Record<string, unknown>> = [];
    await persistAssistantMessage({
      chatRepository: {
        async createMessage(input) {
          createdMessages.push(input as unknown as Record<string, unknown>);
          return {
            id: "assistant-message-3",
            chatId: input.chatId,
            assistantId: input.assistantId,
            author: input.author,
            content: input.content,
            metadata: input.metadata ?? null,
            createdAt: new Date("2026-06-23T00:00:00.000Z")
          };
        }
      },
      chatId: "chat-3",
      assistantId: "assistant-3",
      content: "Found it.",
      toolInvocations: [{ name: "knowledge_search", iteration: 0, ok: true, toolCallId: "tool-1" }]
    });

    assert.deepEqual((createdMessages[0]?.metadata as Record<string, unknown>)?.toolInvocations, [
      { name: "knowledge_search", iteration: 0, ok: true, toolCallId: "tool-1" }
    ]);
  }

  {
    const createdMessages: Array<Record<string, unknown>> = [];
    await persistAssistantMessage({
      chatRepository: {
        async createMessage(input) {
          createdMessages.push(input as unknown as Record<string, unknown>);
          return {
            id: "assistant-message-4",
            chatId: input.chatId,
            assistantId: input.assistantId,
            author: input.author,
            content: input.content,
            metadata: input.metadata ?? null,
            createdAt: new Date("2026-06-23T00:00:01.000Z")
          };
        }
      },
      chatId: "chat-4",
      assistantId: "assistant-4",
      content: "No tools.",
      toolInvocations: []
    });

    assert.equal(createdMessages[0]?.metadata, undefined);
  }

  {
    const createdMessages: Array<Record<string, unknown>> = [];
    await persistAssistantMessage({
      chatRepository: {
        async createMessage(input) {
          createdMessages.push(input as unknown as Record<string, unknown>);
          return {
            id: "assistant-message-5",
            chatId: input.chatId,
            assistantId: input.assistantId,
            author: input.author,
            content: input.content,
            metadata: input.metadata ?? null,
            createdAt: new Date("2026-06-23T00:00:02.000Z")
          };
        }
      },
      chatId: "chat-5",
      assistantId: "assistant-5",
      content: "Already stripped.",
      toolInvocations: [
        {
          name: "web_search",
          iteration: 0,
          ok: true,
          billingFacts: { provider: "test" }
        } as never
      ]
    });

    assert.deepEqual((createdMessages[0]?.metadata as Record<string, unknown>)?.toolInvocations, [
      { name: "web_search", iteration: 0, ok: true }
    ]);
  }
}

void run();
