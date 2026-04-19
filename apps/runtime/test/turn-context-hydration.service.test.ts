import assert from "node:assert/strict";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type { RuntimeTurnRequest } from "@persai/runtime-contract";
import type { RuntimeStatePrismaService } from "../src/modules/runtime-state/infrastructure/persistence/runtime-state-prisma.service";
import { TurnContextHydrationService } from "../src/modules/turns/turn-context-hydration.service";

const HYDRATED_MEMORY_CONTEXT =
  "[Durable user context retained across conversations]\n" +
  "- [Memory write: preference] User prefers concise answers and short bullet lists.\n" +
  "- [Web chat memory] Customer previously asked about annual billing and quota separation.";

function createRuntimeBundle(
  overrides?: Partial<AssistantRuntimeBundle["runtime"]["contextHydration"]>
): AssistantRuntimeBundle {
  return {
    runtime: {
      contextHydration: {
        preset: "balanced",
        targetContextBudget: 24_000,
        compactionTriggerThreshold: 8_000,
        keepRecentMinimum: 4,
        knowledgeHydrationBudget: 2_400,
        autoCompactionWeb: false,
        autoCompactionTelegram: true,
        ...overrides
      }
    }
  } as AssistantRuntimeBundle;
}

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
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/message-current/file-small.pdf",
          mimeType: "application/pdf",
          filename: "runtime-fallback.pdf",
          sizeBytes: 123
        },
        {
          attachmentId: "runtime-attachment-2",
          kind: "file",
          objectKey:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/message-current/file-large.pdf",
          mimeType: "application/pdf",
          filename: "runtime-large.pdf",
          sizeBytes: 20_000_000
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
  lastFindFirstArgs: unknown = null;
  messages: Array<{
    id: string;
    author: "user" | "assistant" | "system";
    content: string;
    attachments: Array<{
      id: string;
      attachmentType: "image" | "audio" | "voice" | "video" | "document" | "tool_output";
      originalFilename: string | null;
      mimeType: string;
      storagePath: string;
      sizeBytes: number;
      transcription: string | null;
      metadata: Record<string, unknown> | null;
    }>;
  }> = [];
  memoryRows: Array<{
    summary: string;
    sourceType: "web_chat" | "memory_write";
    sourceLabel: string | null;
    createdAt: Date;
  }> = [
    {
      summary: "User prefers concise answers and short bullet lists.",
      sourceType: "memory_write",
      sourceLabel: "Memory write: preference",
      createdAt: new Date("2026-04-14T11:00:00.000Z")
    },
    {
      summary: "Customer previously asked about annual billing and quota separation.",
      sourceType: "web_chat",
      sourceLabel: "Web chat memory",
      createdAt: new Date("2026-04-14T10:30:00.000Z")
    }
  ];
  sandboxFileRefs = new Map<
    string,
    {
      id: string;
      assistantId: string;
      workspaceId: string;
      origin: "uploaded_attachment" | "runtime_output";
      objectKey: string;
    }
  >();

  assistantChat = {
    findFirst: async (args: unknown) => {
      this.lastFindFirstArgs = args;
      return this.chat;
    }
  };

  assistantChatMessage = {
    findMany: async () => this.messages
  };

  assistantMemoryRegistryItem = {
    findMany: async () => this.memoryRows
  };

  sandboxFileRef = {
    findFirst: async (args: {
      where: {
        assistantId: string;
        workspaceId: string;
        origin: "uploaded_attachment" | "runtime_output";
        objectKey: string;
      };
    }) => {
      return (
        [...this.sandboxFileRefs.values()].find(
          (entry) =>
            entry.assistantId === args.where.assistantId &&
            entry.workspaceId === args.where.workspaceId &&
            entry.origin === args.where.origin &&
            entry.objectKey === args.where.objectKey
        ) ?? null
      );
    },
    create: async (args: {
      data: {
        assistantId: string;
        workspaceId: string;
        origin: "uploaded_attachment" | "runtime_output";
        objectKey: string;
        metadata: { attachmentId?: string };
      };
    }) => {
      const attachmentId =
        typeof args.data.metadata?.attachmentId === "string" && args.data.metadata.attachmentId.length > 0
          ? args.data.metadata.attachmentId
          : String(this.sandboxFileRefs.size + 1);
      const created = {
        id: `file-ref-${attachmentId}`,
        assistantId: args.data.assistantId,
        workspaceId: args.data.workspaceId,
        origin: args.data.origin,
        objectKey: args.data.objectKey
      };
      this.sandboxFileRefs.set(created.id, created);
      return created;
    }
  };
}

class FakeRuntimeStatePostgresService {
  session: { id: string } | null = null;
  latestCompaction: { summaryPayload: unknown } | null = null;

  async findSessionByConversationKey() {
    return this.session;
  }

  async findLatestSessionCompaction() {
    return this.latestCompaction;
  }
}

class FakeRuntimeStateKeyspaceService {
  createConversationKey(conversation: RuntimeTurnRequest["conversation"]): string {
    return `conversation:${conversation.channel}:${conversation.externalThreadKey}`;
  }
}

export async function runTurnContextHydrationServiceTest(): Promise<void> {
  const prisma = new FakeRuntimeStatePrismaService();
  const runtimeStatePostgres = new FakeRuntimeStatePostgresService();
  const runtimeStateKeyspace = new FakeRuntimeStateKeyspaceService();
  const downloadedObjectKeys: string[] = [];
  const service = new TurnContextHydrationService(
    prisma as unknown as RuntimeStatePrismaService,
    runtimeStatePostgres as never,
    runtimeStateKeyspace as never,
    {
      async downloadObject(objectKey: string) {
        downloadedObjectKeys.push(objectKey);
        if (objectKey.includes("diagram.png")) {
          return Buffer.from("png-bytes");
        }
        if (objectKey.includes("yard.png")) {
          return Buffer.from("yard-png-bytes");
        }
        if (objectKey.includes("car.png")) {
          return Buffer.from("car-png-bytes");
        }
        if (objectKey.includes("manual.pdf") || objectKey.includes("file-small.pdf")) {
          return Buffer.from("pdf-bytes");
        }
        if (objectKey.includes("file-large.pdf")) {
          return Buffer.from("large-pdf-bytes");
        }
        return null;
      }
    } as never
  );
  const request = createRuntimeTurnRequest();
  const runtimeBundle = createRuntimeBundle();

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
          storagePath: "assistant-media/chat-1/notes.txt",
          sizeBytes: 32,
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
          storagePath: "assistant-media/chat-1/reply.png",
          sizeBytes: 64,
          transcription: null,
          metadata: null
        }
      ]
    },
    {
      id: "message-2b",
      author: "assistant",
      content: "  ",
      attachments: [
        {
          id: "attachment-2b",
          attachmentType: "voice",
          originalFilename: "voice-note-yandex.ogg",
          mimeType: "audio/ogg",
          storagePath: "assistant-media/chat-1/voice-note-yandex.ogg",
          sizeBytes: 48,
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
          storagePath: "assistant-media/chat-1/voice.mp3",
          sizeBytes: 48,
          transcription: "hello from attachment",
          metadata: null
        },
        {
          id: "attachment-4",
          attachmentType: "image",
          originalFilename: "diagram.png",
          mimeType: "image/png",
          storagePath: "assistant-media/chat-1/diagram.png",
          sizeBytes: 64,
          transcription: null,
          metadata: null
        },
        {
          id: "attachment-5",
          attachmentType: "document",
          originalFilename: "manual.pdf",
          mimeType: "application/pdf",
          storagePath: "assistant-media/chat-1/manual.pdf",
          sizeBytes: 256,
          transcription: null,
          metadata: { contentPreview: "manual preview should stay out of the prompt" }
        }
      ]
    }
  ];

  const hydrated = await service.buildMessages(request, runtimeBundle);
  assert.deepEqual(hydrated, [
    {
      role: "assistant",
      content: HYDRATED_MEMORY_CONTEXT
    },
    {
      role: "user",
      content:
        '[Files attached by user:\n- attachment (document "notes.txt", fileRef: "file-ref-attachment-1", content preview: "first note preview")\nWhen you need to resend or operate on an existing attachment, prefer its fileRef instead of guessing from the filename alone.\nUse the attachment metadata, transcription, and content preview when available.]\nfirst user'
    },
    {
      role: "assistant",
      content:
        'first assistant\n\nAssistant sent an attachment: image "reply.png", fileRef: "file-ref-attachment-2".'
    },
    {
      role: "assistant",
      content:
        'Assistant sent an attachment: voice "voice-note-yandex.ogg", fileRef: "file-ref-attachment-2b".'
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: '[Files attached by user:\n- attachment (audio "voice.mp3", transcription: "hello from attachment", fileRef: "file-ref-attachment-3")\n- attachment (image #1 "diagram.png", fileRef: "file-ref-attachment-4")\n- attachment (document "manual.pdf", fileRef: "file-ref-attachment-5")\nImage attachments are included as direct model image input. Use the visible contents plus any attachment metadata and message text.\nPDF attachments are included as direct model document input. Use the document contents plus any attachment metadata and message text.\nWhen you need to resend or operate on an existing attachment, prefer its fileRef instead of guessing from the filename alone.\nUse the attachment metadata, transcription, and content preview when available.]\ncurrent enriched user message'
        },
        {
          type: "image",
          mimeType: "image/png",
          dataBase64: Buffer.from("png-bytes").toString("base64"),
          filename: "diagram.png"
        },
        {
          type: "pdf",
          mimeType: "application/pdf",
          dataBase64: Buffer.from("pdf-bytes").toString("base64"),
          filename: "manual.pdf"
        }
      ]
    }
  ]);
  assert.deepEqual(downloadedObjectKeys, [
    "assistant-media/chat-1/diagram.png",
    "assistant-media/chat-1/manual.pdf"
  ]);

  prisma.chat = null;
  downloadedObjectKeys.length = 0;
  const fallback = await service.buildMessages(request, runtimeBundle);
  assert.deepEqual(fallback, [
    {
      role: "assistant",
      content: HYDRATED_MEMORY_CONTEXT
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: '[Files attached by user:\n- attachment (file "runtime-fallback.pdf", fileRef: "file-ref-runtime-attachment-1")\n- attachment (file "runtime-large.pdf", fileRef: "file-ref-runtime-attachment-2")\nSome PDF attachments are included as direct model document input when within the request-size budget. For any others, rely on attachment metadata and content preview when available.\nWhen you need to resend or operate on an existing attachment, prefer its fileRef instead of guessing from the filename alone.\nUse the attachment metadata, transcription, and content preview when available.]\ncurrent enriched user message'
        },
        {
          type: "pdf",
          mimeType: "application/pdf",
          dataBase64: Buffer.from("pdf-bytes").toString("base64"),
          filename: "runtime-fallback.pdf"
        }
      ]
    }
  ]);
  assert.deepEqual(downloadedObjectKeys, [
    "assistant-media/assistants/assistant-1/chats/chat-1/messages/message-current/file-small.pdf"
  ]);

  prisma.chat = null;
  downloadedObjectKeys.length = 0;
  const multiImageRequest: RuntimeTurnRequest = {
    ...request,
    message: {
      ...request.message,
      text: "edit both images",
      attachments: [
        {
          attachmentId: "runtime-image-1",
          kind: "image",
          objectKey:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/message-current/yard.png",
          mimeType: "image/png",
          filename: "yard.png",
          sizeBytes: 32
        },
        {
          attachmentId: "runtime-image-2",
          kind: "image",
          objectKey:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/message-current/car.png",
          mimeType: "image/png",
          filename: "car.png",
          sizeBytes: 32
        }
      ]
    }
  };
  const multiImage = await service.buildMessages(multiImageRequest, runtimeBundle);
  assert.deepEqual(multiImage, [
    {
      role: "assistant",
      content: HYDRATED_MEMORY_CONTEXT
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: '[Files attached by user:\n- attachment (image #1 "yard.png", fileRef: "file-ref-runtime-image-1")\n- attachment (image #2 "car.png", fileRef: "file-ref-runtime-image-2")\nCurrent-turn image attachments are numbered image #1, image #2, and so on in this list. Use those numbers when a tool needs an explicit source or reference image.\nImage attachments are included as direct model image input. Use the visible contents plus any attachment metadata and message text.\nWhen you need to resend or operate on an existing attachment, prefer its fileRef instead of guessing from the filename alone.\nUse the attachment metadata, transcription, and content preview when available.]\nedit both images'
        },
        {
          type: "image",
          mimeType: "image/png",
          dataBase64: Buffer.from("yard-png-bytes").toString("base64"),
          filename: "yard.png"
        },
        {
          type: "image",
          mimeType: "image/png",
          dataBase64: Buffer.from("car-png-bytes").toString("base64"),
          filename: "car.png"
        }
      ]
    }
  ]);
  assert.deepEqual(downloadedObjectKeys, [
    "assistant-media/assistants/assistant-1/chats/chat-1/messages/message-current/yard.png",
    "assistant-media/assistants/assistant-1/chats/chat-1/messages/message-current/car.png"
  ]);

  const telegramRequest: RuntimeTurnRequest = {
    ...request,
    conversation: {
      ...request.conversation,
      channel: "telegram",
      externalThreadKey: "telegram-chat-1",
      externalUserKey: null,
      mode: "group"
    },
    message: {
      ...request.message,
      text: "@bot current telegram message",
      attachments: []
    }
  };
  prisma.chat = { id: "chat-telegram-1" };
  prisma.messages = [
    {
      id: "telegram-message-1",
      author: "user",
      content: "earlier telegram user",
      attachments: []
    },
    {
      id: "message-current",
      author: "assistant",
      content: "older assistant should stay",
      attachments: []
    },
    {
      id: "telegram-message-2",
      author: "user",
      content: "stored telegram current",
      attachments: []
    }
  ];

  const telegramHydrated = await service.buildMessages(
    {
      ...telegramRequest,
      idempotencyKey: "telegram-message-2"
    },
    runtimeBundle
  );
  assert.deepEqual(telegramHydrated, [
    {
      role: "assistant",
      content: HYDRATED_MEMORY_CONTEXT
    },
    {
      role: "user",
      content: "earlier telegram user"
    },
    {
      role: "assistant",
      content: "older assistant should stay"
    },
    {
      role: "user",
      content: "@bot current telegram message"
    }
  ]);
  assert.deepEqual(prisma.lastFindFirstArgs, {
    where: {
      assistantId: "assistant-1",
      surface: "telegram",
      surfaceThreadKey: "telegram-chat-1"
    },
    select: {
      id: true
    }
  });

  prisma.chat = { id: "chat-1" };
  prisma.messages = Array.from({ length: 22 }, (_, index) => ({
    id: `message-${index + 1}`,
    author: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `message-${index + 1}`,
    attachments: []
  }));

  const capped = await service.buildMessages(request, runtimeBundle);
  assert.equal(capped.length, 24);
  assert.deepEqual(capped.at(0), {
    role: "assistant",
    content: HYDRATED_MEMORY_CONTEXT
  });
  assert.deepEqual(capped.at(1), {
    role: "user",
    content: "message-1"
  });
  assert.deepEqual(capped.at(-1), {
    role: "user",
    content: fallback[1]?.content
  });

  runtimeStatePostgres.session = { id: "runtime-session-1" };
  runtimeStatePostgres.latestCompaction = {
    summaryPayload: {
      schema: "persai.runtimeSessionCompaction.v1",
      summaryText: "Sure, here's a quick summary for you.",
      summarizedMessageCount: 1
    }
  };
  const ignoredInvalidSummary = await service.buildMessages(
    {
      ...request,
      idempotencyKey: "message-21",
      message: {
        ...request.message,
        text: "current turn after invalid compaction",
        attachments: []
      }
    },
    runtimeBundle
  );
  assert.equal(ignoredInvalidSummary.length, 23);
  assert.deepEqual(ignoredInvalidSummary.at(0), {
    role: "assistant",
    content: HYDRATED_MEMORY_CONTEXT
  });
  assert.deepEqual(ignoredInvalidSummary.at(1), {
    role: "user",
    content: "message-1"
  });
  assert.deepEqual(ignoredInvalidSummary.at(-2), {
    role: "user",
    content: "current turn after invalid compaction"
  });

  runtimeStatePostgres.latestCompaction = {
    summaryPayload: {
      schema: "persai.runtimeSessionCompaction.v2",
      toolCode: "compact_context",
      preservedRecentMessageCount: 21,
      sections: {
        stableFacts: ["Durable summary of older context."],
        userPreferences: [],
        assistantCommitments: [],
        openThreads: [],
        importantReferences: []
      },
      summarizedMessageCount: 1
    }
  };
  const reusedSummary = await service.buildMessages(
    {
      ...request,
      idempotencyKey: "message-21",
      message: {
        ...request.message,
        text: "current turn after compaction",
        attachments: []
      }
    },
    runtimeBundle
  );
  assert.equal(reusedSummary.length, 23);
  assert.deepEqual(reusedSummary.at(0), {
    role: "assistant",
    content: HYDRATED_MEMORY_CONTEXT
  });
  assert.deepEqual(reusedSummary.at(1), {
    role: "assistant",
    content:
      "[Earlier conversation summary retained by shared compaction]\nStable facts:\n- Durable summary of older context."
  });
  assert.deepEqual(reusedSummary.at(2), {
    role: "assistant",
    content: "message-2"
  });
  assert.deepEqual(reusedSummary.at(-2), {
    role: "user",
    content: "current turn after compaction"
  });
  assert.deepEqual(reusedSummary.at(-1), {
    role: "assistant",
    content: "message-22"
  });

  const compactionSource = await service.buildCompactionMessages({
    conversation: request.conversation,
    keepRecentMessageCount: 4
  });
  assert.equal(compactionSource.messages.length, 18);
  assert.equal(compactionSource.summarizedMessageCount, 18);
  assert.equal(compactionSource.preservedRecentMessageCount, 4);
  assert.deepEqual(compactionSource.messages.at(0), {
    role: "user",
    content: "message-1"
  });
  assert.deepEqual(compactionSource.messages.at(-1), {
    role: "assistant",
    content: "message-18"
  });
}
