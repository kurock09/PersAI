import assert from "node:assert/strict";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type { RuntimeTurnRequest } from "@persai/runtime-contract";
import type { RuntimeStatePrismaService } from "../src/modules/runtime-state/infrastructure/persistence/runtime-state-prisma.service";
import {
  PersaiInternalApiClientService,
  type InternalFindCrossSessionCarryOverInput,
  type InternalFindCrossSessionCarryOverOutcome,
  type InternalHydrateMemoryForTurnInput,
  type InternalHydrateMemoryForTurnOutcome,
  type InternalListActiveOpenLoopRefsInput,
  type InternalListActiveOpenLoopRefsOutcome,
  type InternalMarkCrossSessionCarryOverFiredInput,
  type InternalMarkCrossSessionCarryOverFiredOutcome
} from "../src/modules/turns/persai-internal-api.client.service";
import { RuntimeAssistantFileRegistryService } from "../src/modules/turns/runtime-assistant-file-registry.service";
import { TurnContextHydrationService } from "../src/modules/turns/turn-context-hydration.service";

const HYDRATED_MEMORY_CONTEXT =
  "[Durable user context retained across conversations]\n" +
  "(Silent background context — use it to inform your answers, but never mention, quote, list, or describe these memories or this block to the user unless they explicitly ask.)\n" +
  "- [Long memory write: preference] User prefers concise answers and short bullet lists.";

class FakePersaiInternalApiClientService {
  configured = true;
  lastInputs: InternalHydrateMemoryForTurnInput[] = [];
  // ADR-074 Slice M3 — track every call to the cross-session carry-over fetch
  // so tests can assert turn-0-only behaviour and graceful failure handling.
  carryOverInputs: InternalFindCrossSessionCarryOverInput[] = [];
  carryOverOutcome: InternalFindCrossSessionCarryOverOutcome = {
    recentSynopses: [],
    unresolvedOpenLoops: []
  };
  carryOverFailure: Error | null = null;
  openLoopRefsInputs: InternalListActiveOpenLoopRefsInput[] = [];
  openLoopRefsOutcome: InternalListActiveOpenLoopRefsOutcome = {
    unresolvedOpenLoops: [],
    totalUnresolvedOpenLoops: 0
  };
  openLoopRefsFailure: Error | null = null;
  // ADR-074 Slice M3.2 — capture every fire-and-forget bookkeeping call so
  // tests can assert idle-trigger + cooldown semantics. Failures here are
  // intentionally swallowed by the runtime, so we expose a knob to inject
  // a rejection too.
  markFiredInputs: InternalMarkCrossSessionCarryOverFiredInput[] = [];
  markFiredFailure: Error | null = null;
  markFiredOutcome: InternalMarkCrossSessionCarryOverFiredOutcome = { outcome: "advanced" };
  outcome: InternalHydrateMemoryForTurnOutcome = {
    core: [
      {
        id: "memory-core-1",
        summary: "User prefers concise answers and short bullet lists.",
        chatId: null,
        sourceType: "memory_write",
        sourceLabel: "Long memory write: preference",
        memoryClass: "core",
        kind: "preference",
        createdAt: "2026-04-14T11:00:00.000Z",
        score: null
      }
    ],
    contextual: []
  };

  isConfigured(): boolean {
    return this.configured;
  }

  async hydrateMemoryForTurn(
    input: InternalHydrateMemoryForTurnInput
  ): Promise<InternalHydrateMemoryForTurnOutcome> {
    this.lastInputs.push(input);
    return this.outcome;
  }

  async findCrossSessionCarryOver(
    input: InternalFindCrossSessionCarryOverInput
  ): Promise<InternalFindCrossSessionCarryOverOutcome> {
    this.carryOverInputs.push(input);
    if (this.carryOverFailure !== null) {
      throw this.carryOverFailure;
    }
    return this.carryOverOutcome;
  }

  async listActiveOpenLoopRefs(
    input: InternalListActiveOpenLoopRefsInput
  ): Promise<InternalListActiveOpenLoopRefsOutcome> {
    this.openLoopRefsInputs.push(input);
    if (this.openLoopRefsFailure !== null) {
      throw this.openLoopRefsFailure;
    }
    return this.openLoopRefsOutcome;
  }

  async markCrossSessionCarryOverFired(
    input: InternalMarkCrossSessionCarryOverFiredInput
  ): Promise<InternalMarkCrossSessionCarryOverFiredOutcome> {
    this.markFiredInputs.push(input);
    if (this.markFiredFailure !== null) {
      throw this.markFiredFailure;
    }
    return this.markFiredOutcome;
  }
}

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
        crossSessionCarryOverTtlDays: 7,
        crossSessionCarryOverIdleHours: 4,
        crossSessionCarryOverCooldownHours: 12,
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
  // ADR-074 Slice M3.2 — the chat row now also carries
  // `lastMessageAt` and `lastCrossSessionCarryOverAt`, used by the long-idle
  // re-trigger predicate and per-thread cooldown gate. Defaults are `null`
  // to preserve the prior turn-0-only behaviour for tests that don't opt in.
  chat: {
    id: string;
    lastMessageAt?: Date | null;
    lastCrossSessionCarryOverAt?: Date | null;
  } | null = {
    id: "chat-1",
    lastMessageAt: null,
    lastCrossSessionCarryOverAt: null
  };
  lastFindFirstArgs: unknown = null;
  messages: Array<{
    id: string;
    author: "user" | "assistant" | "system";
    content: string;
    createdAt?: Date | null;
    /** ADR-100 Piece 2 — optional message-level metadata, may carry discoveredFileRefIds. */
    metadata?: Record<string, unknown> | null;
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
      sourceLabel: "Long memory write: preference",
      createdAt: new Date("2026-04-14T11:00:00.000Z")
    },
    {
      summary: "Customer previously asked about annual billing and quota separation.",
      sourceType: "web_chat",
      sourceLabel: "Web chat memory",
      createdAt: new Date("2026-04-14T10:30:00.000Z")
    }
  ];
  assistantFiles = new Map<
    string,
    {
      id: string;
      assistantId: string;
      workspaceId: string;
      sandboxJobId: null;
      origin: "uploaded_attachment" | "runtime_output";
      sourceToolCode: null;
      objectKey: string;
      relativePath: string;
      displayName: string | null;
      mimeType: string;
      sizeBytes: bigint;
      logicalSizeBytes: bigint;
      sha256: string | null;
      /** ADR-100 Piece 2 — broadened to allow semanticSummary alongside attachmentId. */
      metadata: Record<string, unknown>;
      createdAt: Date;
    }
  >();

  assistantChat = {
    findFirst: async (args: unknown) => {
      this.lastFindFirstArgs = args;
      if (this.chat === null) {
        return null;
      }
      return {
        id: this.chat.id,
        lastMessageAt: this.chat.lastMessageAt ?? null,
        lastCrossSessionCarryOverAt: this.chat.lastCrossSessionCarryOverAt ?? null
      };
    }
  };

  assistantChatMessage = {
    findMany: async () => this.messages
  };

  assistantMemoryRegistryItem = {
    findMany: async () => this.memoryRows
  };

  assistantFile = {
    findFirst: async (args: {
      where: {
        id?: string;
        assistantId?: string;
        workspaceId?: string;
        relativePath?: string;
      };
      orderBy?: Array<{ createdAt?: "asc" | "desc"; id?: "asc" | "desc" }>;
    }) => {
      const rows = [...this.assistantFiles.values()].filter((entry) => {
        if (args.where.id !== undefined && entry.id !== args.where.id) {
          return false;
        }
        if (args.where.assistantId !== undefined && entry.assistantId !== args.where.assistantId) {
          return false;
        }
        if (args.where.workspaceId !== undefined && entry.workspaceId !== args.where.workspaceId) {
          return false;
        }
        if (
          args.where.relativePath !== undefined &&
          entry.relativePath !== args.where.relativePath
        ) {
          return false;
        }
        return true;
      });
      rows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      return rows[0] ?? null;
    },
    findMany: async (args: {
      where?: {
        id?: { in: string[] };
        assistantId?: string;
        workspaceId?: string;
      };
      orderBy?: Array<
        { relativePath?: "asc" | "desc" } | { createdAt?: "asc" | "desc" } | { id?: "asc" | "desc" }
      >;
      take?: number;
    }) => {
      const requestedIds = args.where?.id?.in;
      const rows = [...this.assistantFiles.values()].filter((entry) => {
        if (requestedIds !== undefined && !requestedIds.includes(entry.id)) {
          return false;
        }
        if (args.where?.assistantId !== undefined && entry.assistantId !== args.where.assistantId) {
          return false;
        }
        if (args.where?.workspaceId !== undefined && entry.workspaceId !== args.where.workspaceId) {
          return false;
        }
        return true;
      });
      rows.sort((left, right) => {
        if (left.relativePath !== right.relativePath) {
          return left.relativePath.localeCompare(right.relativePath);
        }
        if (left.createdAt.getTime() !== right.createdAt.getTime()) {
          return right.createdAt.getTime() - left.createdAt.getTime();
        }
        return right.id.localeCompare(left.id);
      });
      return typeof args.take === "number" ? rows.slice(0, args.take) : rows;
    },
    upsert: async (args: {
      where: {
        assistantId_workspaceId_origin_objectKey: {
          assistantId: string;
          workspaceId: string;
          origin: "uploaded_attachment" | "runtime_output";
          objectKey: string;
        };
      };
      update: {
        relativePath: string;
        displayName: string | null;
        mimeType: string;
        sizeBytes: bigint;
        logicalSizeBytes: bigint;
        sha256?: string;
        metadata: Record<string, unknown>;
      };
      create: {
        assistantId: string;
        workspaceId: string;
        sandboxJobId: null;
        origin: "uploaded_attachment" | "runtime_output";
        sourceToolCode: null;
        objectKey: string;
        relativePath: string;
        displayName: string | null;
        mimeType: string;
        sizeBytes: bigint;
        logicalSizeBytes: bigint;
        sha256: string | null;
        metadata: Record<string, unknown>;
      };
    }) => {
      const existing = [...this.assistantFiles.values()].find(
        (entry) =>
          entry.assistantId === args.where.assistantId_workspaceId_origin_objectKey.assistantId &&
          entry.workspaceId === args.where.assistantId_workspaceId_origin_objectKey.workspaceId &&
          entry.origin === args.where.assistantId_workspaceId_origin_objectKey.origin &&
          entry.objectKey === args.where.assistantId_workspaceId_origin_objectKey.objectKey
      );
      if (existing !== undefined) {
        const updated = {
          ...existing,
          ...args.update
        };
        this.assistantFiles.set(updated.id, updated);
        return updated;
      }
      const attachmentId =
        typeof args.create.metadata?.attachmentId === "string" &&
        args.create.metadata.attachmentId.length > 0
          ? args.create.metadata.attachmentId
          : String(this.assistantFiles.size + 1);
      const created = {
        id: `file-ref-${attachmentId}`,
        assistantId: args.create.assistantId,
        workspaceId: args.create.workspaceId,
        sandboxJobId: args.create.sandboxJobId,
        origin: args.create.origin,
        sourceToolCode: args.create.sourceToolCode,
        objectKey: args.create.objectKey,
        relativePath: args.create.relativePath,
        displayName: args.create.displayName,
        mimeType: args.create.mimeType,
        sizeBytes: args.create.sizeBytes,
        logicalSizeBytes: args.create.logicalSizeBytes,
        sha256: args.create.sha256,
        metadata: args.create.metadata,
        createdAt: new Date("2026-04-19T12:00:00.000Z")
      };
      this.assistantFiles.set(created.id, created);
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
  const mediaObjectStorage = {
    async downloadObject(objectKey: string) {
      downloadedObjectKeys.push(objectKey);
      if (objectKey.includes("notes.txt")) {
        return Buffer.from("notes-text-bytes");
      }
      if (objectKey.includes("reply.png")) {
        return Buffer.from("reply-png-bytes");
      }
      if (objectKey.includes("voice-note-yandex.ogg")) {
        return Buffer.from("voice-note-bytes");
      }
      if (objectKey.includes("voice.mp3")) {
        return Buffer.from("voice-mp3-bytes");
      }
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
  };
  const persaiInternalApiClient = new FakePersaiInternalApiClientService();
  const service = new TurnContextHydrationService(
    prisma as unknown as RuntimeStatePrismaService,
    runtimeStatePostgres as never,
    runtimeStateKeyspace as never,
    mediaObjectStorage as never,
    new RuntimeAssistantFileRegistryService(
      prisma as unknown as RuntimeStatePrismaService,
      mediaObjectStorage as never
    ),
    persaiInternalApiClient as unknown as PersaiInternalApiClientService
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
        },
        {
          id: "attachment-deleted-1",
          attachmentType: "document",
          originalFilename: "deleted.pdf",
          mimeType: "application/pdf",
          storagePath: "assistant-media/chat-1/deleted.pdf",
          sizeBytes: 32,
          transcription: null,
          metadata: { fileDeleted: true, deletedFileRef: "file-ref-deleted-1" }
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
  assert.equal(hydrated[0]?.role, "assistant");
  assert.equal(hydrated[0]?.content, HYDRATED_MEMORY_CONTEXT);
  assert.equal(hydrated[1]?.role, "user");
  assert.equal(hydrated[1]?.content, "first user");
  assert.equal(hydrated[2]?.role, "assistant");
  assert.equal(hydrated[2]?.content, "first assistant");
  assert.equal(hydrated[3]?.role, "assistant");
  assert.equal(hydrated[3]?.content, "");
  assert.equal(Array.isArray(hydrated[4]?.content), true);
  const currentUserBlocks = hydrated[4]?.content as Array<{ type: string; text?: string }>;
  assert.equal(currentUserBlocks[0]?.type, "text");
  assert.equal(currentUserBlocks[0]?.text, "current enriched user message");
  for (const message of hydrated) {
    const content =
      typeof message.content === "string"
        ? message.content
        : message.content
            .map((block) => ("text" in block && typeof block.text === "string" ? block.text : ""))
            .join("\n");
    assert.doesNotMatch(content, /fileRef/i);
    assert.doesNotMatch(content, /Assistant sent an attachment/i);
    assert.doesNotMatch(content, /Working files from user attachments/i);
  }

  persaiInternalApiClient.outcome = {
    core: [],
    contextual: [
      {
        id: "memory-current-chat",
        summary: "User is testing Telegram voice behavior.",
        chatId: "chat-1",
        sourceType: "memory_write",
        sourceLabel: "Short memory write: fact",
        memoryClass: "contextual",
        kind: "fact",
        createdAt: "2026-04-14T12:00:00.000Z",
        score: null
      },
      {
        id: "memory-past-chat",
        summary: "User previously compared memory source markers.",
        chatId: "chat-past-1",
        sourceType: "memory_write",
        sourceLabel: "Short memory write: preference",
        memoryClass: "contextual",
        kind: "preference",
        createdAt: "2026-04-14T11:59:00.000Z",
        score: null
      },
      {
        id: "memory-open-loop",
        summary: "User wants to follow up on stale open-loop noise.",
        chatId: "chat-1",
        sourceType: "memory_write",
        sourceLabel: "Short memory write: open loop",
        memoryClass: "contextual",
        kind: "open_loop",
        createdAt: "2026-04-14T11:58:00.000Z",
        score: null
      }
    ]
  };
  const memorySourceMarked = await service.buildMessages(request, runtimeBundle);
  const memorySourceContent = String(memorySourceMarked[0]?.content ?? "");
  assert.match(
    memorySourceContent,
    /\[this chat · Short memory write: fact\] User is testing Telegram voice behavior\./
  );
  assert.match(
    memorySourceContent,
    /\[past chat · Short memory write: preference\] User previously compared memory source markers\./
  );
  assert.doesNotMatch(memorySourceContent, /stale open-loop noise/);
  assert.match(memorySourceContent, /Items marked "past chat" came from another conversation\./);
  persaiInternalApiClient.outcome = {
    core: [
      {
        id: "memory-core-1",
        summary: "User prefers concise answers and short bullet lists.",
        chatId: null,
        sourceType: "memory_write",
        sourceLabel: "Long memory write: preference",
        memoryClass: "core",
        kind: "preference",
        createdAt: "2026-04-14T11:00:00.000Z",
        score: null
      }
    ],
    contextual: []
  };

  const requestWithOpenMediaJobs = createRuntimeTurnRequest();
  requestWithOpenMediaJobs.openMediaJobs = [
    {
      jobId: "job-1",
      kind: "image",
      toolCode: "image_generate",
      status: "running",
      sourceSummary: "сделай сову",
      requestedCount: 1,
      expectedResultCount: 1,
      createdAt: "2026-04-11T11:55:00.000Z",
      startedAt: "2026-04-11T11:56:00.000Z",
      updatedAt: "2026-04-11T11:59:00.000Z"
    }
  ];
  const hydratedWithOpenMediaJobs = await service.buildMessages(
    requestWithOpenMediaJobs,
    runtimeBundle
  );
  assert.equal(
    hydratedWithOpenMediaJobs.some(
      (message) =>
        message.role === "assistant" &&
        typeof message.content === "string" &&
        message.content.includes("# Open Async Media Jobs")
    ),
    false,
    "open async media jobs should no longer be injected as assistant history"
  );
  assert.ok(downloadedObjectKeys.includes("assistant-media/chat-1/diagram.png"));
  assert.ok(downloadedObjectKeys.includes("assistant-media/chat-1/manual.pdf"));
  assert.ok(
    [...prisma.assistantFiles.values()].every((file) => typeof file.sha256 === "string"),
    "attachment-backed assistant files should store a sha256 for durable workspace diffing"
  );
  const availableWorkingFileRefs = await service.listAvailableWorkingFileRefs({
    conversation: request.conversation,
    currentAttachments: []
  });
  assert.deepEqual(
    availableWorkingFileRefs.map((file) => file.displayName).sort(),
    ["diagram.png", "manual.pdf", "notes.txt", "reply.png"],
    "historical audio/voice attachments should not stay in the Working Files prompt"
  );
  assert.equal(
    availableWorkingFileRefs.some((file) =>
      ["voice-note-yandex.ogg", "voice.mp3"].includes(file.displayName ?? "")
    ),
    false,
    "historical audio/voice attachments should not stay in the Working Files prompt"
  );
  const availableImageToolAttachments = await service.listAvailableImageToolAttachments({
    conversation: request.conversation,
    currentAttachments: [
      {
        attachmentId: "attachment-4",
        kind: "image",
        objectKey: "assistant-media/chat-1/diagram.png",
        mimeType: "image/png",
        filename: "diagram.png",
        sizeBytes: 128,
        fileRef: "file-ref-attachment-4"
      }
    ]
  });
  assert.deepEqual(
    availableImageToolAttachments.map((attachment) => ({
      attachmentId: attachment.attachmentId,
      aliases: attachment.aliases ?? []
    })),
    [
      {
        attachmentId: "attachment-4",
        aliases: ["image #1", "file #1"]
      },
      {
        attachmentId: "attachment-2",
        aliases: ["image #2", "file #2"]
      }
    ]
  );

  prisma.chat = null;
  downloadedObjectKeys.length = 0;
  const fallback = await service.buildMessages(request, runtimeBundle);
  assert.equal(fallback[0]?.role, "assistant");
  assert.equal(fallback[0]?.content, HYDRATED_MEMORY_CONTEXT);
  assert.equal(Array.isArray(fallback[1]?.content), true);
  const fallbackBlocks = fallback[1]?.content as Array<{ type: string; text?: string }>;
  assert.equal(fallbackBlocks[0]?.text, "current enriched user message");
  assert.doesNotMatch(
    fallbackBlocks[0]?.text ?? "",
    /fileRef|Working files from user attachments/i
  );
  assert.ok(
    downloadedObjectKeys.includes(
      "assistant-media/assistants/assistant-1/chats/chat-1/messages/message-current/file-small.pdf"
    )
  );
  assert.equal(
    downloadedObjectKeys.includes(
      "assistant-media/assistants/assistant-1/chats/chat-1/messages/message-current/file-large.pdf"
    ),
    false,
    "oversized direct provider attachments should be skipped"
  );

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
  assert.equal(multiImage[0]?.content, HYDRATED_MEMORY_CONTEXT);
  assert.equal(Array.isArray(multiImage[1]?.content), true);
  const multiImageBlocks = multiImage[1]?.content as Array<{ type: string; text?: string }>;
  assert.equal(multiImageBlocks[0]?.text, "edit both images");
  assert.doesNotMatch(
    multiImageBlocks[0]?.text ?? "",
    /fileRef|Working files from user attachments/i
  );
  assert.ok(
    downloadedObjectKeys.includes(
      "assistant-media/assistants/assistant-1/chats/chat-1/messages/message-current/yard.png"
    )
  );
  assert.ok(
    downloadedObjectKeys.includes(
      "assistant-media/assistants/assistant-1/chats/chat-1/messages/message-current/car.png"
    )
  );

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
      metadata: {
        schema: "persai.chatMessage.telegramMetadata.v1",
        telegram: {
          fromUserId: "888",
          fromUsername: "sam",
          fromDisplayName: "Sam Lee"
        }
      },
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
      content: "Telegram sender: Sam Lee (@sam)\nearlier telegram user"
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
    // ADR-074 Slice M3.2 — `loadAssistantChatRowMeta` is the LAST findFirst
    // call in the hydration pipeline (it runs right after the canonical
    // message-row fetch so the long-idle / cooldown gates can use the
    // chat-row metadata) and selects three columns.
    select: {
      id: true,
      lastMessageAt: true,
      lastCrossSessionCarryOverAt: true
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
      "[Rolling session synopsis — what we have established so far in this conversation]\nStable facts:\n- Durable summary of older context."
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

  runtimeStatePostgres.latestCompaction = {
    summaryPayload: {
      schema: "persai.runtimeSessionCompaction.v2",
      toolCode: "compact_context",
      preservedRecentMessageCount: 8,
      sections: {
        stableFacts: ["Stale summary from a longer message sequence."],
        userPreferences: [],
        assistantCommitments: [],
        openThreads: [],
        importantReferences: []
      },
      summarizedMessageCount: 245
    }
  };
  const ignoredStaleSummary = await service.buildMessages(
    {
      ...request,
      idempotencyKey: "message-21",
      message: {
        ...request.message,
        text: "current turn with stale compaction",
        attachments: []
      }
    },
    runtimeBundle
  );
  assert.equal(ignoredStaleSummary.length, 23);
  assert.deepEqual(ignoredStaleSummary.at(0), {
    role: "assistant",
    content: HYDRATED_MEMORY_CONTEXT
  });
  assert.deepEqual(ignoredStaleSummary.at(1), {
    role: "user",
    content: "message-1"
  });
  assert.ok(
    !ignoredStaleSummary.some(
      (message) =>
        typeof message.content === "string" &&
        message.content.includes("Stale summary from a longer message sequence.")
    ),
    "stale compaction summaries must not replace current canonical chat history"
  );
  assert.deepEqual(ignoredStaleSummary.at(-2), {
    role: "user",
    content: "current turn with stale compaction"
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

  await runOpenLoopRefsDeveloperBlockAcceptance();
  await runCrossSessionCarryOverM3Acceptance();
}

async function runOpenLoopRefsDeveloperBlockAcceptance(): Promise<void> {
  const prisma = new FakeRuntimeStatePrismaService();
  const runtimeStatePostgres = new FakeRuntimeStatePostgresService();
  const runtimeStateKeyspace = new FakeRuntimeStateKeyspaceService();
  const mediaObjectStorage = {
    async downloadObject() {
      return null;
    }
  };
  const persaiInternalApiClient = new FakePersaiInternalApiClientService();
  const service = new TurnContextHydrationService(
    prisma as unknown as RuntimeStatePrismaService,
    runtimeStatePostgres as never,
    runtimeStateKeyspace as never,
    mediaObjectStorage as never,
    new RuntimeAssistantFileRegistryService(
      prisma as unknown as RuntimeStatePrismaService,
      mediaObjectStorage as never
    ),
    persaiInternalApiClient as unknown as PersaiInternalApiClientService
  );
  const request = createRuntimeTurnRequest();
  request.message.text = "please close the yearly billing migration checklist loop";
  persaiInternalApiClient.openLoopRefsOutcome = {
    unresolvedOpenLoops: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        summary: "Recent infra follow-up",
        createdAt: "2026-05-11T00:10:00.000Z"
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        summary: "Another recent infra follow-up",
        createdAt: "2026-05-11T00:09:00.000Z"
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        summary: "Sandbox warmup issue",
        createdAt: "2026-05-11T00:08:00.000Z"
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        summary: "Team sync notes",
        createdAt: "2026-05-11T00:07:00.000Z"
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        summary: "Provider retry tuning",
        createdAt: "2026-05-11T00:06:00.000Z"
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        summary: "Debug upload timeout",
        createdAt: "2026-05-11T00:05:00.000Z"
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        summary: "Quarterly roadmap cleanup",
        createdAt: "2026-05-11T00:04:00.000Z"
      },
      {
        id: "88888888-8888-4888-8888-888888888888",
        summary: "Yearly billing migration checklist",
        createdAt: "2025-01-01T00:00:00.000Z"
      }
    ],
    totalUnresolvedOpenLoops: 42
  };

  const block = await service.computeOpenLoopRefsDeveloperBlock(request);
  assert.ok(block !== null);
  assert.match(
    block ?? "",
    /88888888-8888-4888-8888-888888888888 \| Yearly billing migration checklist/
  );
  assert.match(block ?? "", /\.\.\. 37 more unresolved loops omitted\./);

  const pruned = service.pruneClosedOpenLoopRefsDeveloperBlock(block, [
    "88888888-8888-4888-8888-888888888888"
  ]);
  assert.ok(
    !(pruned ?? "").includes("88888888-8888-4888-8888-888888888888"),
    "closed refs must be removed from the same-turn developer block"
  );
}

// ADR-074 Slice M3 — turn-0-only invariant + render order + graceful failure.
async function runCrossSessionCarryOverM3Acceptance(): Promise<void> {
  function buildHarness(): {
    service: TurnContextHydrationService;
    prisma: FakeRuntimeStatePrismaService;
    runtimeStatePostgres: FakeRuntimeStatePostgresService;
    persaiInternalApiClient: FakePersaiInternalApiClientService;
  } {
    const prisma = new FakeRuntimeStatePrismaService();
    const runtimeStatePostgres = new FakeRuntimeStatePostgresService();
    const runtimeStateKeyspace = new FakeRuntimeStateKeyspaceService();
    const mediaObjectStorage = {
      async downloadObject() {
        return null;
      }
    };
    const persaiInternalApiClient = new FakePersaiInternalApiClientService();
    const service = new TurnContextHydrationService(
      prisma as unknown as RuntimeStatePrismaService,
      runtimeStatePostgres as never,
      runtimeStateKeyspace as never,
      mediaObjectStorage as never,
      new RuntimeAssistantFileRegistryService(
        prisma as unknown as RuntimeStatePrismaService,
        mediaObjectStorage as never
      ),
      persaiInternalApiClient as unknown as PersaiInternalApiClientService
    );
    return { service, prisma, runtimeStatePostgres, persaiInternalApiClient };
  }

  function buildSimpleRequest(): RuntimeTurnRequest {
    return {
      requestId: "request-m3",
      idempotencyKey: "message-current-m3",
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
        externalThreadKey: "thread-m3",
        externalUserKey: "user-1",
        mode: "direct"
      },
      message: {
        text: "hi again, brand new thread",
        attachments: [],
        locale: "en",
        timezone: "UTC",
        receivedAt: "2026-04-22T12:00:00.000Z"
      }
    };
  }

  // Scenario A — turn 0 (no prior chat at all) + non-empty carry-over →
  // M3 block prepended right after the durable_memory_core block, with the
  // canonical "[Continuity from earlier conversations…]" stable header.
  {
    const harness = buildHarness();
    harness.prisma.chat = null;
    harness.persaiInternalApiClient.carryOverOutcome = {
      recentSynopses: [
        {
          runtimeSessionId: "session-1",
          channel: "web",
          synopsisUpdatedAt: "2026-04-21T09:00:00.000Z",
          summaryPayload: {
            schema: "persai.runtimeSessionCompaction.v2",
            toolCode: "compact_context",
            preservedRecentMessageCount: 4,
            summarizedMessageCount: 6,
            sections: {
              stableFacts: ["Decided on Atlas project review focus."],
              userPreferences: [],
              assistantCommitments: [],
              openThreads: [],
              importantReferences: []
            }
          }
        }
      ],
      unresolvedOpenLoops: [
        {
          id: "loop-1",
          summary: "Need to confirm Barcelona retreat venue.",
          createdAt: "2026-04-20T10:00:00.000Z"
        }
      ]
    };
    const result = await harness.service.buildMessages(buildSimpleRequest(), createRuntimeBundle());
    assert.equal(
      harness.persaiInternalApiClient.carryOverInputs.length,
      1,
      "turn 0 must call findCrossSessionCarryOver exactly once"
    );
    const call = harness.persaiInternalApiClient.carryOverInputs[0]!;
    assert.equal(call.assistantId, "assistant-1");
    assert.equal(call.ttlDays, 7, "ttlDays must come from the bundle's contextHydration policy");
    assert.equal(call.excludeRuntimeSessionId, null);
    assert.equal(call.requestId, "request-m3");
    assert.equal(result.length, 3, "core block + carry-over block + current user message");
    assert.equal(result[0]?.role, "assistant");
    assert.ok(
      typeof result[0]?.content === "string" &&
        result[0].content.startsWith("[Durable user context retained across conversations]")
    );
    const carryOverMessage = result[1];
    assert.equal(carryOverMessage?.role, "assistant");
    assert.ok(typeof carryOverMessage?.content === "string");
    const carryOverContent = carryOverMessage.content as string;
    assert.ok(
      carryOverContent.startsWith(
        "[Continuity from earlier conversations — surfaced on the first turn of a new thread]"
      ),
      `carry-over block must use the M3 stable header; got: ${carryOverContent.slice(0, 80)}`
    );
    assert.ok(carryOverContent.includes("Need to confirm Barcelona retreat venue."));
    assert.equal(result[2]?.role, "user");
    assert.equal(result[2]?.content, "hi again, brand new thread");
  }

  // Scenario B — non-turn-0 (existing thread has prior hydratable messages)
  // → findCrossSessionCarryOver MUST NOT be called even with a configured
  // client, because the in-thread context already covers what M3 would
  // duplicate.
  {
    const harness = buildHarness();
    harness.prisma.chat = { id: "chat-existing" };
    harness.prisma.messages = [
      {
        id: "earlier-1",
        author: "user",
        content: "an earlier user turn",
        attachments: []
      },
      {
        id: "earlier-2",
        author: "assistant",
        content: "an earlier assistant turn",
        attachments: []
      },
      {
        id: "message-current-m3",
        author: "user",
        content: "hi again, brand new thread",
        attachments: []
      }
    ];
    await harness.service.buildMessages(buildSimpleRequest(), createRuntimeBundle());
    assert.equal(
      harness.persaiInternalApiClient.carryOverInputs.length,
      0,
      "non-turn-0 path must NOT call findCrossSessionCarryOver"
    );
  }

  // Scenario C — fetch failure must be swallowed and the turn must still
  // build successfully (the M3 block is simply omitted). This is the
  // "humanity-degrades-gracefully" guarantee from ADR-074.
  {
    const harness = buildHarness();
    harness.prisma.chat = null;
    harness.persaiInternalApiClient.carryOverFailure = new Error("internal API down");
    const result = await harness.service.buildMessages(buildSimpleRequest(), createRuntimeBundle());
    assert.equal(harness.persaiInternalApiClient.carryOverInputs.length, 1);
    assert.equal(
      result.length,
      2,
      "carry-over fetch failure → only durable_memory_core + current user message"
    );
    assert.ok(
      typeof result[0]?.content === "string" &&
        (result[0].content as string).startsWith(
          "[Durable user context retained across conversations]"
        )
    );
    assert.equal(result[1]?.role, "user");
    assert.equal(result[1]?.content, "hi again, brand new thread");
  }

  // Scenario D — TTL=0 in policy short-circuits the network call entirely
  // (admin can disable M3 by setting crossSessionCarryOverTtlDays<=0
  // through the bundle; defensive code path).
  {
    const harness = buildHarness();
    harness.prisma.chat = null;
    harness.persaiInternalApiClient.carryOverOutcome = {
      recentSynopses: [
        {
          runtimeSessionId: "session-x",
          channel: "web",
          synopsisUpdatedAt: "2026-04-21T09:00:00.000Z",
          summaryPayload: {
            schema: "persai.runtimeSessionCompaction.v2",
            toolCode: "compact_context",
            preservedRecentMessageCount: 4,
            summarizedMessageCount: 6,
            sections: {
              stableFacts: ["Should not appear because TTL=0."],
              userPreferences: [],
              assistantCommitments: [],
              openThreads: [],
              importantReferences: []
            }
          }
        }
      ],
      unresolvedOpenLoops: []
    };
    await harness.service.buildMessages(
      buildSimpleRequest(),
      createRuntimeBundle({ crossSessionCarryOverTtlDays: 0 })
    );
    assert.equal(
      harness.persaiInternalApiClient.carryOverInputs.length,
      0,
      "ttlDays<=0 must short-circuit before the internal API is called"
    );
  }

  await runCrossSessionCarryOverM3_2LongIdleAcceptance();
}

// ADR-074 Slice M3.2 — long-idle re-trigger + per-thread cooldown +
// fire-and-forget bookkeeping bump. Post-compaction sub-trigger is
// intentionally OUT OF SCOPE (founder 2026-04-22) and therefore not
// covered here.
async function runCrossSessionCarryOverM3_2LongIdleAcceptance(): Promise<void> {
  function buildHarness(): {
    service: TurnContextHydrationService;
    prisma: FakeRuntimeStatePrismaService;
    persaiInternalApiClient: FakePersaiInternalApiClientService;
  } {
    const prisma = new FakeRuntimeStatePrismaService();
    const runtimeStatePostgres = new FakeRuntimeStatePostgresService();
    const runtimeStateKeyspace = new FakeRuntimeStateKeyspaceService();
    const mediaObjectStorage = {
      async downloadObject() {
        return null;
      }
    };
    const persaiInternalApiClient = new FakePersaiInternalApiClientService();
    const service = new TurnContextHydrationService(
      prisma as unknown as RuntimeStatePrismaService,
      runtimeStatePostgres as never,
      runtimeStateKeyspace as never,
      mediaObjectStorage as never,
      new RuntimeAssistantFileRegistryService(
        prisma as unknown as RuntimeStatePrismaService,
        mediaObjectStorage as never
      ),
      persaiInternalApiClient as unknown as PersaiInternalApiClientService
    );
    return { service, prisma, persaiInternalApiClient };
  }

  function buildExistingThreadRequest(): RuntimeTurnRequest {
    return {
      requestId: "request-m32",
      idempotencyKey: "message-current-m32",
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
        externalThreadKey: "thread-m32",
        externalUserKey: "user-1",
        mode: "direct"
      },
      message: {
        text: "hi again — coming back after a long break",
        attachments: [],
        locale: "en",
        timezone: "UTC",
        receivedAt: new Date().toISOString()
      }
    };
  }

  function seedExistingThread(prisma: FakeRuntimeStatePrismaService): void {
    prisma.messages = [
      {
        id: "earlier-1",
        author: "user",
        content: "the previous user turn from a few hours ago",
        attachments: []
      },
      {
        id: "earlier-2",
        author: "assistant",
        content: "the previous assistant reply",
        attachments: []
      },
      {
        id: "message-current-m32",
        author: "user",
        content: "hi again — coming back after a long break",
        attachments: []
      }
    ];
  }

  function nonEmptyCarryOver(): InternalFindCrossSessionCarryOverOutcome {
    return {
      recentSynopses: [
        {
          runtimeSessionId: "session-prev",
          channel: "web",
          synopsisUpdatedAt: "2026-04-21T09:00:00.000Z",
          summaryPayload: {
            schema: "persai.runtimeSessionCompaction.v2",
            toolCode: "compact_context",
            preservedRecentMessageCount: 4,
            summarizedMessageCount: 6,
            sections: {
              stableFacts: ["Decided on Atlas project review focus."],
              userPreferences: [],
              assistantCommitments: [],
              openThreads: [],
              importantReferences: []
            }
          }
        }
      ],
      unresolvedOpenLoops: []
    };
  }

  // Scenario M3.2-A — existing thread + idle ≥ idleHours + no prior fire →
  // long-idle sub-trigger fires AND the bookkeeping cell is bumped via the
  // fire-and-forget path. The `assistant_chats` row exists but has no prior
  // `lastCrossSessionCarryOverAt` value, so the cooldown is vacuously
  // satisfied.
  {
    const harness = buildHarness();
    const now = Date.now();
    harness.prisma.chat = {
      id: "chat-existing-idle",
      // 5h ago, > default 4h idle threshold
      lastMessageAt: new Date(now - 5 * 60 * 60 * 1000),
      lastCrossSessionCarryOverAt: null
    };
    seedExistingThread(harness.prisma);
    harness.persaiInternalApiClient.carryOverOutcome = nonEmptyCarryOver();
    await harness.service.buildMessages(buildExistingThreadRequest(), createRuntimeBundle());
    assert.equal(
      harness.persaiInternalApiClient.carryOverInputs.length,
      1,
      "long-idle existing thread MUST fire findCrossSessionCarryOver exactly once"
    );
    // wait one tick for the fire-and-forget mark to flush
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      harness.persaiInternalApiClient.markFiredInputs.length,
      1,
      "non-empty carry-over MUST trigger exactly one mark-fired bookkeeping bump"
    );
    const markCall = harness.persaiInternalApiClient.markFiredInputs[0]!;
    assert.equal(markCall.assistantChatId, "chat-existing-idle");
    assert.equal(markCall.requestId, "request-m32");
    assert.ok(typeof markCall.firedAt === "string" && markCall.firedAt.length > 0);
  }

  // Scenario M3.2-A2 — the API may already have persisted the current inbound
  // user message and advanced `assistant_chats.lastMessageAt` before runtime
  // hydration begins. Long-idle must compare against the previous user message,
  // excluding the current `idempotencyKey`, or the trigger is always suppressed.
  {
    const harness = buildHarness();
    const now = Date.now();
    harness.prisma.chat = {
      id: "chat-existing-current-already-persisted",
      lastMessageAt: new Date(now),
      lastCrossSessionCarryOverAt: null
    };
    harness.prisma.messages = [
      {
        id: "earlier-1",
        author: "user",
        content: "the previous user turn from a few hours ago",
        createdAt: new Date(now - 5 * 60 * 60 * 1000),
        attachments: []
      },
      {
        id: "earlier-2",
        author: "assistant",
        content: "the previous assistant reply",
        createdAt: new Date(now - 5 * 60 * 60 * 1000 + 30_000),
        attachments: []
      },
      {
        id: "message-current-m32",
        author: "user",
        content: "hi again — coming back after a long break",
        createdAt: new Date(now),
        attachments: []
      }
    ];
    harness.persaiInternalApiClient.carryOverOutcome = nonEmptyCarryOver();
    await harness.service.buildMessages(buildExistingThreadRequest(), createRuntimeBundle());
    assert.equal(
      harness.persaiInternalApiClient.carryOverInputs.length,
      1,
      "current-message lastMessageAt must not suppress the long-idle sub-trigger"
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.persaiInternalApiClient.markFiredInputs.length, 1);
  }

  // Scenario M3.2-B — existing thread + idle ≥ idleHours + last fire WITHIN
  // cooldown → MUST NOT fire. The cooldown gate protects against the
  // assistant repeatedly "remembering" the same continuity block within a
  // short window.
  {
    const harness = buildHarness();
    const now = Date.now();
    harness.prisma.chat = {
      id: "chat-existing-cooldown",
      lastMessageAt: new Date(now - 5 * 60 * 60 * 1000),
      // last fired 6h ago, < default 12h cooldown
      lastCrossSessionCarryOverAt: new Date(now - 6 * 60 * 60 * 1000)
    };
    seedExistingThread(harness.prisma);
    harness.persaiInternalApiClient.carryOverOutcome = nonEmptyCarryOver();
    await harness.service.buildMessages(buildExistingThreadRequest(), createRuntimeBundle());
    assert.equal(
      harness.persaiInternalApiClient.carryOverInputs.length,
      0,
      "cooldown gate MUST suppress the long-idle sub-trigger entirely"
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      harness.persaiInternalApiClient.markFiredInputs.length,
      0,
      "no fetch ⇒ no bookkeeping bump"
    );
  }

  // Scenario M3.2-C — existing thread + idle ≥ idleHours + last fire OLDER
  // than cooldown → fires again and bookkeeping is bumped. This is the
  // "next day, same thread" path.
  {
    const harness = buildHarness();
    const now = Date.now();
    harness.prisma.chat = {
      id: "chat-existing-cooldown-elapsed",
      lastMessageAt: new Date(now - 5 * 60 * 60 * 1000),
      // last fired 25h ago, > default 12h cooldown
      lastCrossSessionCarryOverAt: new Date(now - 25 * 60 * 60 * 1000)
    };
    seedExistingThread(harness.prisma);
    harness.persaiInternalApiClient.carryOverOutcome = nonEmptyCarryOver();
    await harness.service.buildMessages(buildExistingThreadRequest(), createRuntimeBundle());
    assert.equal(harness.persaiInternalApiClient.carryOverInputs.length, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.persaiInternalApiClient.markFiredInputs.length, 1);
  }

  // Scenario M3.2-D — existing thread + idle BELOW threshold → MUST NOT
  // fire (this is the same-day "I was just chatting two minutes ago" case).
  {
    const harness = buildHarness();
    const now = Date.now();
    harness.prisma.chat = {
      id: "chat-existing-fresh",
      // 1h ago, < default 4h idle threshold
      lastMessageAt: new Date(now - 60 * 60 * 1000),
      lastCrossSessionCarryOverAt: null
    };
    seedExistingThread(harness.prisma);
    harness.persaiInternalApiClient.carryOverOutcome = nonEmptyCarryOver();
    await harness.service.buildMessages(buildExistingThreadRequest(), createRuntimeBundle());
    assert.equal(harness.persaiInternalApiClient.carryOverInputs.length, 0);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.persaiInternalApiClient.markFiredInputs.length, 0);
  }

  // Scenario M3.2-E — turn 0 of a brand-new thread → fire AND bookkeeping
  // bump (regression: M3 already fires here, M3.2 just adds the bump).
  {
    const harness = buildHarness();
    harness.prisma.chat = {
      id: "chat-brand-new",
      lastMessageAt: null,
      lastCrossSessionCarryOverAt: null
    };
    harness.persaiInternalApiClient.carryOverOutcome = nonEmptyCarryOver();
    await harness.service.buildMessages(buildExistingThreadRequest(), createRuntimeBundle());
    assert.equal(harness.persaiInternalApiClient.carryOverInputs.length, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      harness.persaiInternalApiClient.markFiredInputs.length,
      1,
      "brand-new thread must also bump the cooldown cell so the next idle re-fire respects it"
    );
  }

  // Scenario M3.2-F — long-idle path but the carry-over fetch returns
  // an EMPTY block → no bookkeeping bump (the cooldown gate intentionally
  // tracks *user-visible* fires only, so an empty render doesn't burn the
  // cooldown window).
  {
    const harness = buildHarness();
    const now = Date.now();
    harness.prisma.chat = {
      id: "chat-existing-empty-render",
      lastMessageAt: new Date(now - 5 * 60 * 60 * 1000),
      lastCrossSessionCarryOverAt: null
    };
    seedExistingThread(harness.prisma);
    harness.persaiInternalApiClient.carryOverOutcome = {
      recentSynopses: [],
      unresolvedOpenLoops: []
    };
    await harness.service.buildMessages(buildExistingThreadRequest(), createRuntimeBundle());
    assert.equal(
      harness.persaiInternalApiClient.carryOverInputs.length,
      1,
      "the trigger predicate fires even when the fetched block ends up empty"
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      harness.persaiInternalApiClient.markFiredInputs.length,
      0,
      "empty render ⇒ no bookkeeping bump (cooldown tracks user-visible fires)"
    );
  }

  // Scenario M3.2-G — bookkeeping bump failure is swallowed and the turn
  // still completes successfully (humanity-degrades-gracefully).
  {
    const harness = buildHarness();
    const now = Date.now();
    harness.prisma.chat = {
      id: "chat-existing-mark-fail",
      lastMessageAt: new Date(now - 5 * 60 * 60 * 1000),
      lastCrossSessionCarryOverAt: null
    };
    seedExistingThread(harness.prisma);
    harness.persaiInternalApiClient.carryOverOutcome = nonEmptyCarryOver();
    harness.persaiInternalApiClient.markFiredFailure = new Error("mark-fired API down");
    const result = await harness.service.buildMessages(
      buildExistingThreadRequest(),
      createRuntimeBundle()
    );
    assert.ok(
      result.length >= 2,
      "turn must complete successfully even if the bookkeeping bump rejects"
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.persaiInternalApiClient.markFiredInputs.length, 1);
  }
}

// ADR-100 Piece 2 — recent discovered file refs hydration acceptance tests.
export async function runRecentDiscoveredFileRefsHydrationTest(): Promise<void> {
  function buildHarness(): {
    service: TurnContextHydrationService;
    prisma: FakeRuntimeStatePrismaService;
  } {
    const prisma = new FakeRuntimeStatePrismaService();
    const runtimeStatePostgres = new FakeRuntimeStatePostgresService();
    const runtimeStateKeyspace = new FakeRuntimeStateKeyspaceService();
    const mediaObjectStorage = {
      async downloadObject() {
        return null;
      }
    };
    const persaiInternalApiClient = new FakePersaiInternalApiClientService();
    const service = new TurnContextHydrationService(
      prisma as unknown as RuntimeStatePrismaService,
      runtimeStatePostgres as never,
      runtimeStateKeyspace as never,
      mediaObjectStorage as never,
      new RuntimeAssistantFileRegistryService(
        prisma as unknown as RuntimeStatePrismaService,
        mediaObjectStorage as never
      ),
      persaiInternalApiClient as unknown as PersaiInternalApiClientService
    );
    return { service, prisma };
  }

  function buildConversation(): RuntimeTurnRequest["conversation"] {
    return {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-recent",
      externalUserKey: "user-1",
      mode: "direct"
    };
  }

  function makeFileRow(
    id: string,
    relativePath: string,
    semanticSummary?: string
  ): FakeRuntimeStatePrismaService["assistantFiles"] extends Map<string, infer V> ? V : never {
    return {
      id,
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      sandboxJobId: null,
      origin: "runtime_output",
      sourceToolCode: null,
      objectKey: `assistant-media/${relativePath}`,
      relativePath,
      displayName: relativePath.split("/").pop() ?? null,
      mimeType: "image/png",
      sizeBytes: BigInt(1024),
      logicalSizeBytes: BigInt(1024),
      sha256: null,
      metadata: semanticSummary !== undefined ? { semanticSummary } : {},
      createdAt: new Date("2026-05-01T12:00:00.000Z")
    };
  }

  // Scenario 1 — last 5 assistant messages contain 3 distinct discovered ids.
  // All 3 appear in Working Files with sticky `file #N` labels and semanticSummaryHint.
  {
    const { service, prisma } = buildHarness();
    prisma.chat = { id: "chat-recent-1" };
    prisma.assistantFiles.set(
      "file-a",
      makeFileRow("file-a", "discoveries/viking.png", "A photo of a viking")
    );
    prisma.assistantFiles.set(
      "file-b",
      makeFileRow("file-b", "discoveries/revenue.xlsx", "Q2 revenue spreadsheet")
    );
    prisma.assistantFiles.set(
      "file-c",
      makeFileRow("file-c", "discoveries/logo.svg", "Company logo design")
    );
    prisma.messages = [
      { id: "u-1", author: "user", content: "user turn 1", attachments: [] },
      {
        id: "a-1",
        author: "assistant",
        content: "assistant turn 1",
        attachments: [],
        metadata: { discoveredFileRefIds: ["file-a", "file-b"] }
      },
      { id: "u-2", author: "user", content: "user turn 2", attachments: [] },
      {
        id: "a-2",
        author: "assistant",
        content: "assistant turn 2",
        attachments: [],
        metadata: { discoveredFileRefIds: ["file-c"] }
      }
    ];
    const refs = await service.listAvailableWorkingFileRefs({
      conversation: buildConversation(),
      currentAttachments: []
    });
    assert.equal(refs.length, 3, "scenario 1: 3 discovered files expected");
    const fileAliases = refs.flatMap((r) => (r.aliases ?? []).filter((a) => /^file #\d+$/.test(a)));
    assert.ok(fileAliases.includes("file #1"), "scenario 1: file #1 missing");
    assert.ok(fileAliases.includes("file #2"), "scenario 1: file #2 missing");
    assert.ok(fileAliases.includes("file #3"), "scenario 1: file #3 missing");
    for (const ref of refs) {
      assert.ok(
        typeof ref.semanticSummaryHint === "string" && ref.semanticSummaryHint.length > 0,
        `scenario 1: semanticSummaryHint missing for ${String(ref.aliases?.[0])}`
      );
    }
  }

  // Scenario 2 — 7 distinct ids across the window → only top 6 most-recent appear; 7th dropped.
  {
    const { service, prisma } = buildHarness();
    prisma.chat = { id: "chat-recent-2" };
    for (let i = 1; i <= 7; i += 1) {
      prisma.assistantFiles.set(
        `file-${String(i)}`,
        makeFileRow(`file-${String(i)}`, `f${String(i)}.png`)
      );
    }
    // Most-recent assistant message lists file-1..file-4, older one lists file-5..file-7.
    // After scanning in reverse order: candidateIds = [file-1, file-2, file-3, file-4, file-5, file-6, file-7]
    // Cap at 6 → file-7 is dropped.
    prisma.messages = [
      {
        id: "a-old",
        author: "assistant",
        content: "older",
        attachments: [],
        metadata: { discoveredFileRefIds: ["file-5", "file-6", "file-7"] }
      },
      {
        id: "a-new",
        author: "assistant",
        content: "newer",
        attachments: [],
        metadata: { discoveredFileRefIds: ["file-1", "file-2", "file-3", "file-4"] }
      }
    ];
    const refs = await service.listAvailableWorkingFileRefs({
      conversation: buildConversation(),
      currentAttachments: []
    });
    assert.equal(refs.length, 6, "scenario 2: exactly 6 discovered files expected");
    assert.ok(
      !refs.some((r) => r.fileRef === "file-7"),
      "scenario 2: file-7 must be dropped (7th distinct id over cap)"
    );
  }

  // Scenario 3 — one discovered id refers to an AssistantFile row that has since been deleted.
  // Silently dropped; no error; other refs still appear.
  {
    const { service, prisma } = buildHarness();
    prisma.chat = { id: "chat-recent-3" };
    prisma.assistantFiles.set(
      "file-alive",
      makeFileRow("file-alive", "alive.png", "Surviving file")
    );
    // "file-deleted" is intentionally NOT in the map — simulates a deleted row.
    prisma.messages = [
      {
        id: "a-1",
        author: "assistant",
        content: "assistant",
        attachments: [],
        metadata: { discoveredFileRefIds: ["file-deleted", "file-alive"] }
      }
    ];
    let refs: Awaited<ReturnType<typeof service.listAvailableWorkingFileRefs>>;
    try {
      refs = await service.listAvailableWorkingFileRefs({
        conversation: buildConversation(),
        currentAttachments: []
      });
    } catch (error) {
      assert.fail(`scenario 3: must not throw; got: ${String(error)}`);
    }
    assert.equal(refs.length, 1, "scenario 3: only the alive file must appear");
    assert.equal(refs[0]?.fileRef, "file-alive", "scenario 3: alive file must be file-alive");
    assert.ok((refs[0]?.aliases ?? []).includes("file #1"));
  }

  // Scenario 4 — one discovered id is also in current attachments.
  // The standard sticky alias wins; no legacy discovery alias is added.
  {
    const { service, prisma } = buildHarness();
    prisma.chat = { id: "chat-recent-4" };
    prisma.assistantFiles.set(
      "file-ref-att-1",
      makeFileRow("file-ref-att-1", "shared/photo.png", "The shared photo")
    );
    prisma.assistantFiles.set("file-other", makeFileRow("file-other", "other.png", "Other file"));
    prisma.messages = [
      {
        id: "a-1",
        author: "assistant",
        content: "assistant",
        attachments: [],
        metadata: { discoveredFileRefIds: ["file-ref-att-1", "file-other"] }
      }
    ];
    const refs = await service.listAvailableWorkingFileRefs({
      conversation: buildConversation(),
      currentAttachments: [
        {
          attachmentId: "att-1",
          kind: "image",
          objectKey: "assistant-media/shared/photo.png",
          mimeType: "image/png",
          filename: "photo.png",
          sizeBytes: 1024,
          fileRef: "file-ref-att-1"
        }
      ]
    });
    const attachedRef = refs.find((r) => r.fileRef === "file-ref-att-1");
    assert.ok(attachedRef !== undefined, "scenario 4: file-ref-att-1 must be present");
    const attachedAliases = attachedRef?.aliases ?? [];
    const hasStickyImageAlias = attachedAliases.some((a) => /^image #/.test(a));
    const hasStickyFileAlias = attachedAliases.some((a) => /^file #/.test(a));
    assert.ok(
      hasStickyImageAlias && hasStickyFileAlias,
      "scenario 4: file-ref-att-1 must have sticky image and file aliases"
    );
    assert.ok(
      !attachedAliases.some((a) => /^recent file #/i.test(a)),
      "scenario 4: file-ref-att-1 must NOT carry a legacy recent alias"
    );
    // The other file not in current attachments still gets a sticky file alias.
    const otherRef = refs.find((r) => r.fileRef === "file-other");
    assert.ok(otherRef !== undefined, "scenario 4: file-other must be present");
    assert.ok(
      (otherRef?.aliases ?? []).some((a) => /^file #/i.test(a)),
      "scenario 4: file-other must have a sticky file alias"
    );
  }

  // Scenario 5 — empty discovery history → no sticky-discovered entries; Working Files unchanged.
  {
    const { service, prisma } = buildHarness();
    prisma.chat = { id: "chat-recent-5" };
    prisma.messages = [
      { id: "u-1", author: "user", content: "hello", attachments: [] },
      {
        id: "a-1",
        author: "assistant",
        content: "hi",
        attachments: []
        // no metadata / no discoveredFileRefIds
      }
    ];
    const refs = await service.listAvailableWorkingFileRefs({
      conversation: buildConversation(),
      currentAttachments: []
    });
    assert.equal(
      refs.length,
      0,
      "scenario 5: no working files expected when discovery history is empty"
    );
  }
}
