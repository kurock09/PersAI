import assert from "node:assert/strict";
import type { RuntimeTurnRequest } from "@persai/runtime-contract";
import type { RuntimeStatePrismaService } from "../src/modules/runtime-state/infrastructure/persistence/runtime-state-prisma.service";
import { TurnContextHydrationService } from "../src/modules/turns/turn-context-hydration.service";

function createRuntimeTurnRequest(): RuntimeTurnRequest {
  return {
    requestId: "request-1",
    idempotencyKey: "message-current",
    runtimeTier: "paid_shared_restricted",
    bundle: {
      bundleId: "bundle-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "version-1",
      bundleHash: "1111111111111111111111111111111111111111111111111111111111111111",
      compiledAt: "2026-04-11T12:00:00.000Z"
    },
    conversation: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-1",
      externalUserKey: "user-1",
      mode: "direct"
    },
    message: {
      text: "current enriched user message",
      attachments: [
        {
          attachmentId: "runtime-attachment-1",
          kind: "file",
          objectKey:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/message-current/file.pdf",
          mimeType: "application/pdf",
          filename: "runtime-fallback.pdf",
          sizeBytes: 123
        }
      ],
      locale: "en",
      timezone: "UTC",
      receivedAt: "2026-04-11T12:00:00.000Z"
    }
  };
}

class FakeRuntimeStatePrismaService {
  chat: { id: string } | null = {
    id: "chat-1"
  };
  messages: Array<{
    id: string;
    author: "user" | "assistant" | "system";
    content: string;
    attachments: Array<{
      id: string;
      attachmentType: "image" | "audio" | "voice" | "video" | "document" | "tool_output";
      originalFilename: string | null;
      mimeType: string;
      transcription: string | null;
      metadata: Record<string, unknown> | null;
    }>;
  }> = [];

  assistantChat = {
    findFirst: async () => this.chat
  };

  assistantChatMessage = {
    findMany: async () => this.messages
  };
}

export async function runTurnContextHydrationServiceTest(): Promise<void> {
  const prisma = new FakeRuntimeStatePrismaService();
  const service = new TurnContextHydrationService(prisma as unknown as RuntimeStatePrismaService);
  const request = createRuntimeTurnRequest();

  prisma.messages = [
    {
      id: "message-1",
      author: "user",
      content: "first user",
      attachments: [
        {
          id: "attachment-1",
          attachmentType: "document",
          originalFilename: "notes.txt",
          mimeType: "text/plain",
          transcription: null,
          metadata: { contentPreview: "first note preview" }
        }
      ]
    },
    {
      id: "message-2",
      author: "assistant",
      content: "first assistant",
      attachments: [
        {
          id: "attachment-2",
          attachmentType: "image",
          originalFilename: "reply.png",
          mimeType: "image/png",
          transcription: null,
          metadata: null
        }
      ]
    },
    {
      id: "message-3",
      author: "system",
      content: "ignore this system marker",
      attachments: []
    },
    {
      id: "message-empty",
      author: "user",
      content: "   ",
      attachments: []
    },
    {
      id: "message-current",
      author: "user",
      content: "raw persisted user message",
      attachments: [
        {
          id: "attachment-3",
          attachmentType: "audio",
          originalFilename: "voice.mp3",
          mimeType: "audio/mpeg",
          transcription: "hello from attachment",
          metadata: null
        }
      ]
    }
  ];

  const hydrated = await service.buildMessages(request);
  assert.deepEqual(hydrated, [
    {
      role: "user",
      content:
        '[Files attached by user:\n- attachment (document "notes.txt", content preview: "first note preview")\nUse the attachment metadata, transcription, and content preview when available.]\nfirst user'
    },
    {
      role: "assistant",
      content:
        '[Assistant attachments:\n- attachment (image "reply.png")\nImage attachments are present. Do not guess visual details that are not described in the attachment metadata or message text.\nUse the attachment metadata, transcription, and content preview when available.]\nfirst assistant'
    },
    {
      role: "user",
      content:
        '[Files attached by user:\n- attachment (audio "voice.mp3", transcription: "hello from attachment")\nUse the attachment metadata, transcription, and content preview when available.]\ncurrent enriched user message'
    }
  ]);

  prisma.chat = null;
  const fallback = await service.buildMessages(request);
  assert.deepEqual(fallback, [
    {
      role: "user",
      content:
        '[Files attached by user:\n- attachment (file "runtime-fallback.pdf")\nUse the attachment metadata, transcription, and content preview when available.]\ncurrent enriched user message'
    }
  ]);

  prisma.chat = { id: "chat-1" };
  prisma.messages = Array.from({ length: 22 }, (_, index) => ({
    id: `message-${index + 1}`,
    author: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `message-${index + 1}`,
    attachments: []
  }));

  const capped = await service.buildMessages(request);
  assert.equal(capped.length, 20);
  assert.deepEqual(capped.at(0), {
    role: "assistant",
    content: "message-4"
  });
  assert.deepEqual(capped.at(-1), {
    role: "user",
    content:
      '[Files attached by user:\n- attachment (file "runtime-fallback.pdf")\nUse the attachment metadata, transcription, and content preview when available.]\ncurrent enriched user message'
  });
}
