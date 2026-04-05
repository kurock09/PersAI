import { describe, expect, test } from "vitest";
import { StreamWebChatTurnService } from "../src/modules/workspace-management/application/stream-web-chat-turn.service";

describe("StreamWebChatTurnService", () => {
  test("completes media-only runtime turns without leaking placeholder text", async () => {
    const createdMessages: Array<Record<string, unknown>> = [];
    const memoryWrites: Array<Record<string, unknown>> = [];
    const quotaWrites: Array<Record<string, unknown>> = [];

    const service = new StreamWebChatTurnService(
      {
        createMessage: async (input: Record<string, unknown>) => {
          createdMessages.push(input);
          return {
            id: "assistant-msg-1",
            chatId: input.chatId,
            assistantId: input.assistantId,
            author: input.author,
            content: input.content,
            createdAt: new Date("2026-04-05T12:00:00.000Z")
          };
        },
        findChatById: async (chatId: string) => ({
          id: chatId,
          assistantId: "assistant-1",
          surface: "web_chat",
          surfaceThreadKey: "thread-1",
          title: "Chat",
          archivedAt: null,
          lastMessageAt: new Date("2026-04-05T12:00:00.000Z"),
          createdAt: new Date("2026-04-05T12:00:00.000Z"),
          updatedAt: new Date("2026-04-05T12:00:00.000Z")
        })
      } as never,
      {
        streamWebChatTurn: async function* () {
          yield {
            type: "media",
            media: [{ url: "/tmp/reply.ogg", type: "audio", audioAsVoice: true }]
          };
          yield { type: "done", respondedAt: "2026-04-05T12:00:01.000Z" };
        },
        consumeBootstrapWorkspace: async () => undefined
      } as never,
      {
        execute: async () => {
          throw new Error("prepare should not be called in this test");
        }
      } as never,
      {
        execute: async (input: Record<string, unknown>) => {
          memoryWrites.push(input);
        }
      } as never,
      {
        recordWebChatTurnUsage: async (input: Record<string, unknown>) => {
          quotaWrites.push(input);
        }
      } as never,
      {
        buildContextForCurrentMessageAttachments: async () => null
      } as never,
      {
        deliver: async () => ({
          attachments: [
            {
              id: "att-1",
              attachmentType: "audio",
              originalFilename: "reply.ogg",
              mimeType: "audio/ogg",
              sizeBytes: 1234,
              processingStatus: "ready",
              createdAt: "2026-04-05T12:00:00.000Z"
            }
          ]
        })
      } as never
    );

    const outcome = await service.streamToCompletion(
      {
        chat: {
          id: "chat-1",
          assistantId: "assistant-1",
          surface: "web_chat",
          surfaceThreadKey: "thread-1",
          title: "Chat",
          archivedAt: null,
          lastMessageAt: null,
          createdAt: "2026-04-05T12:00:00.000Z",
          updatedAt: "2026-04-05T12:00:00.000Z"
        },
        userMessage: {
          id: "user-msg-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "hello",
          attachments: [],
          createdAt: "2026-04-05T12:00:00.000Z"
        },
        assistant: {
          id: "assistant-1",
          workspaceId: "workspace-1"
        },
        assistantId: "assistant-1",
        publishedVersionId: "pub-1",
        runtimeTier: "paid_shared",
        quotaDegradeModelOverride: null,
        quotaDegradeReason: null,
        userId: "user-1",
        workspaceId: "workspace-1",
        workspaceTimezone: "UTC"
      } as never,
      {
        isClientAborted: () => false,
        onDelta: () => undefined,
        onThinking: () => undefined,
        onDone: () => undefined
      }
    );

    expect(outcome.status).toBe("completed");
    expect(createdMessages).toHaveLength(1);
    expect(createdMessages[0]?.content).toBe("");
    expect(memoryWrites).toHaveLength(1);
    expect(memoryWrites[0]?.assistantContent).toBe("");
    expect(quotaWrites).toHaveLength(1);
    expect(quotaWrites[0]?.assistantContent).toBe("");
    expect(
      (outcome as { transport: { assistantMessage: { content: string; attachments: unknown[] } } })
        .transport.assistantMessage
    ).toMatchObject({
      content: "",
      attachments: [
        {
          id: "att-1",
          attachmentType: "audio",
          originalFilename: "reply.ogg"
        }
      ]
    });
  });
});
