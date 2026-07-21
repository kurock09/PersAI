import assert from "node:assert/strict";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type { ProviderGatewayToolExchange, RuntimeTurnRequest } from "@persai/runtime-contract";
import type { RuntimeStatePrismaService } from "../src/modules/runtime-state/infrastructure/persistence/runtime-state-prisma.service";
import {
  PersaiInternalApiClientService,
  type InternalFindCrossSessionCarryOverInput,
  type InternalFindCrossSessionCarryOverOutcome,
  type InternalHydrateMemoryForTurnInput,
  type InternalHydrateMemoryForTurnOutcome,
  type InternalListActiveOpenLoopRefsInput,
  type InternalListActiveOpenLoopRefsOutcome
} from "../src/modules/turns/persai-internal-api.client.service";
import {
  TurnContextHydrationService,
  renderChatPlanBlock
} from "../src/modules/turns/turn-context-hydration.service";
import { estimateProviderGatewayMessageTokens } from "../src/modules/turns/runtime-context-hydration-policy";
import type { RuntimeTodoItem } from "@persai/runtime-contract";

const HYDRATED_MEMORY_CONTEXT =
  "[Durable user context retained across conversations]\n" +
  "(Silent background context — use it to inform your answers, but never mention, quote, list, or describe these memories or this block to the user unless they explicitly ask.)\n" +
  "- [Long memory write: preference] User prefers concise answers and short bullet lists.";

class FakePersaiInternalApiClientService {
  configured = true;
  lastInputs: InternalHydrateMemoryForTurnInput[] = [];
  // Track initialization calls; a durable snapshot must suppress later fetches.
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
  carryOverSnapshotInputs: Array<{ assistantChatId: string; snapshot: string }> = [];
  carryOverSnapshotFailure: Error | null = null;
  readonly carryOverSnapshots = new Map<string, string>();
  shortDescriptionsByPath = new Map<string, string | null>();
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
        score: null,
        provenance: "legacy"
      }
    ]
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

  async resolveCrossSessionCarryOverSnapshot(input: {
    assistantChatId: string;
    snapshot: string;
  }): Promise<string> {
    this.carryOverSnapshotInputs.push(input);
    if (this.carryOverSnapshotFailure !== null) {
      throw this.carryOverSnapshotFailure;
    }
    const existing = this.carryOverSnapshots.get(input.assistantChatId);
    if (existing !== undefined) {
      return existing;
    }
    this.carryOverSnapshots.set(input.assistantChatId, input.snapshot);
    return input.snapshot;
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

  async listWorkspaceFileShortDescriptions(input: {
    workspaceId: string;
    paths: readonly string[];
  }): Promise<
    Array<{
      path: string;
      shortDescription: string | null;
      documentVersionNumber: number | null;
    }>
  > {
    return input.paths
      .filter((path) => this.shortDescriptionsByPath.has(path))
      .map((path) => ({
        path,
        shortDescription: this.shortDescriptionsByPath.get(path) ?? null,
        documentVersionNumber: null
      }));
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
  } as unknown as AssistantRuntimeBundle;
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
          storagePath:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/message-current/file-small.pdf",
          mimeType: "application/pdf",
          displayName: "runtime-fallback.pdf",
          sizeBytes: 123
        },
        {
          attachmentId: "runtime-attachment-2",
          kind: "file",
          storagePath:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/message-current/file-large.pdf",
          mimeType: "application/pdf",
          displayName: "runtime-large.pdf",
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
  chat: {
    id: string;
    crossSessionCarryOverSnapshot?: string | null;
  } | null = {
    id: "chat-1",
    crossSessionCarryOverSnapshot: null
  };
  lastFindFirstArgs: unknown = null;
  messages: Array<{
    id: string;
    author: "user" | "assistant" | "system";
    content: string;
    createdAt?: Date | null;
    toolExchanges?: ProviderGatewayToolExchange[] | null;
    /** ADR-100 Piece 2 — optional message-level metadata, may carry discoveredFilePaths. */
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
      storagePath: string;
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
        crossSessionCarryOverSnapshot: this.chat.crossSessionCarryOverSnapshot ?? null
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
          storagePath: string;
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
        storagePath: string;
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
          entry.storagePath === args.where.assistantId_workspaceId_origin_objectKey.storagePath
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
        storagePath: args.create.storagePath,
        relativePath: args.create.relativePath,
        displayName: args.create.displayName,
        mimeType: args.create.mimeType,
        sizeBytes: args.create.sizeBytes,
        logicalSizeBytes: args.create.sizeBytes,
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
    async downloadObject(storagePath: string) {
      downloadedObjectKeys.push(storagePath);
      if (storagePath.includes("notes.txt")) {
        return Buffer.from("notes-text-bytes");
      }
      if (storagePath.includes("reply.png")) {
        return Buffer.from("reply-png-bytes");
      }
      if (storagePath.includes("voice-note-yandex.ogg")) {
        return Buffer.from("voice-note-bytes");
      }
      if (storagePath.includes("voice.mp3")) {
        return Buffer.from("voice-mp3-bytes");
      }
      if (storagePath.includes("diagram.png")) {
        return Buffer.from("png-bytes");
      }
      if (storagePath.includes("yard.png")) {
        return Buffer.from("yard-png-bytes");
      }
      if (storagePath.includes("car.png")) {
        return Buffer.from("car-png-bytes");
      }
      if (storagePath.includes("manual.pdf") || storagePath.includes("file-small.pdf")) {
        return Buffer.from("pdf-bytes");
      }
      if (storagePath.includes("file-large.pdf")) {
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
    persaiInternalApiClient as unknown as PersaiInternalApiClientService
  );
  const request = createRuntimeTurnRequest();
  const runtimeBundle = createRuntimeBundle();

  const requestWithoutChannelContext: RuntimeTurnRequest = {
    ...request,
    conversation: {
      ...request.conversation,
      externalThreadKey: "web-1782153682653"
    }
  };
  assert.equal(await service.resolveCanonicalChatId(requestWithoutChannelContext), "chat-1");

  const requestWithExplicitCanonicalChatId: RuntimeTurnRequest = {
    ...request,
    channelContext: {
      chatId: "chat-top-level-1",
      web: {
        chatId: "chat-web-1"
      },
      telegram: {
        schema: "persai.runtime.telegramContext.v1",
        chatId: "chat-telegram-1",
        chat: {
          id: "telegram-thread-1",
          type: "private",
          title: null
        },
        sender: {
          telegramUserId: "telegram-user-1",
          username: null,
          firstName: null,
          lastName: null,
          displayName: null
        },
        accessMode: "owner_only"
      }
    }
  };
  assert.equal(
    await service.resolveCanonicalChatId(requestWithExplicitCanonicalChatId),
    "chat-top-level-1"
  );

  const syntheticRequest: RuntimeTurnRequest = {
    ...request,
    conversation: {
      ...request.conversation,
      externalThreadKey: "system:background-task:task-1"
    }
  };
  assert.equal(await service.resolveCanonicalChatId(syntheticRequest), null);

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

  // ADR-120 Slice 1 — the always-on pushed contextual short-memory block was
  // retired. Even when the hydration API only had contextual rows to offer
  // (now never returned to the runtime), the runtime must NOT push any
  // `<persai_memory>` / volatile-context memory block. Hydration returns core
  // only; a turn with an EMPTY core leg must therefore produce no durable
  // memory prefix at all (no contextual leakage by construction).
  persaiInternalApiClient.outcome = {
    core: []
  };
  const noCoreMessages = await service.buildMessages(request, runtimeBundle);
  const noCoreText = noCoreMessages
    .map((message) => (typeof message.content === "string" ? message.content : ""))
    .join("\n");
  assert.doesNotMatch(noCoreText, /<persai_memory>/);
  assert.doesNotMatch(noCoreText, /<entry /);
  assert.doesNotMatch(noCoreText, /Recent short-term context/);
  assert.equal(
    noCoreMessages.some(
      (message) =>
        message.cacheRole === "volatile_context" &&
        // `"memory"` was removed from the volatileKind union in ADR-120 Slice 1; the
        // string cast asserts at runtime that no retired contextual-memory volatile
        // message can ever be pushed again (compile-time the kind is impossible too).
        (message.volatileKind as string | undefined) === "memory"
    ),
    false,
    "ADR-120 Slice 1: no volatile contextual-memory message may be pushed"
  );
  assert.equal(
    persaiInternalApiClient.lastInputs.every(
      (input) => !Object.prototype.hasOwnProperty.call(input, "contextualLimit")
    ),
    true,
    "ADR-120 Slice 1: hydration must no longer request a contextualLimit"
  );

  // A cross-chat fact must never be pushed into another chat. With only a
  // global durable core leg surviving, a chat-scoped contextual fact (chat-past-1)
  // is never injected into the current chat's prompt — bleeding is eliminated by
  // construction because there is no contextual push at all.
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
        score: null,
        provenance: "legacy"
      }
    ]
  };
  const coreOnlyMessages = await service.buildMessages(request, runtimeBundle);
  const coreOnlyText = coreOnlyMessages
    .map((message) => (typeof message.content === "string" ? message.content : ""))
    .join("\n");
  assert.doesNotMatch(coreOnlyText, /<persai_memory>/);
  assert.doesNotMatch(coreOnlyText, /chat-past-1/);
  assert.match(coreOnlyText, /User prefers concise answers/);

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
  const availableWorkingFileRefs = await service.listAvailableWorkingFileHandles({
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
          storagePath:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/message-current/yard.png",
          mimeType: "image/png",
          displayName: "yard.png",
          sizeBytes: 32
        },
        {
          attachmentId: "runtime-image-2",
          kind: "image",
          storagePath:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/message-current/car.png",
          mimeType: "image/png",
          displayName: "car.png",
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
  assert.match(multiImageBlocks[1]?.text ?? "", /Current message attachment 1 of 2/i);
  assert.equal(multiImageBlocks[2]?.type, "image");
  assert.match(multiImageBlocks[3]?.text ?? "", /Current message attachment 2 of 2/i);
  assert.equal(multiImageBlocks[4]?.type, "image");
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
    select: {
      id: true,
      crossSessionCarryOverSnapshot: true
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
  await runAttachmentShortDescriptionBatchJoinTest();
}

async function runAttachmentShortDescriptionBatchJoinTest(): Promise<void> {
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
    persaiInternalApiClient as unknown as PersaiInternalApiClientService
  );

  const storagePath =
    "/workspace/assistants/assistant-1/sessions/session-1/uploads/client-brief.docx";
  persaiInternalApiClient.shortDescriptionsByPath.set(
    storagePath,
    "Uploaded client brief for the branded PDF."
  );
  prisma.chat = { id: "chat-attach-1" };
  prisma.messages = [
    {
      id: "message-user-1",
      author: "user",
      content: "here is the brief",
      createdAt: new Date("2026-06-01T09:30:00.000Z"),
      attachments: [
        {
          id: "attachment-brief",
          attachmentType: "document",
          originalFilename: "client-brief.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          storagePath,
          sizeBytes: 512,
          transcription: null,
          metadata: null
        }
      ]
    },
    {
      id: "message-model-1",
      author: "assistant",
      content: "delivered pdf",
      createdAt: new Date("2026-06-01T10:15:00.000Z"),
      attachments: [
        {
          id: "attachment-pdf",
          attachmentType: "document",
          originalFilename: "client-brief.pdf",
          mimeType: "application/pdf",
          storagePath:
            "/workspace/assistants/assistant-1/sessions/session-1/outputs/client-brief.pdf",
          sizeBytes: 1024,
          transcription: null,
          metadata: null
        }
      ]
    }
  ];
  persaiInternalApiClient.shortDescriptionsByPath.set(
    "/workspace/assistants/assistant-1/sessions/session-1/outputs/client-brief.pdf",
    "Delivered branded PDF output."
  );

  const refs = await service.listAvailableWorkingFileHandles({
    conversation: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-attach",
      externalUserKey: "user-1",
      mode: "direct"
    },
    currentAttachments: []
  });

  const userBrief = refs.find((ref) => ref.storagePath === storagePath);
  const modelPdf = refs.find(
    (ref) =>
      ref.storagePath ===
      "/workspace/assistants/assistant-1/sessions/session-1/outputs/client-brief.pdf"
  );
  assert.ok(userBrief, "user attachment must appear in working files");
  assert.ok(modelPdf, "model attachment must appear in working files");
  assert.equal(userBrief?.authorLabel, "user");
  assert.equal(modelPdf?.authorLabel, "model");
  assert.equal(userBrief?.createdAt, "2026-06-01T09:30:00.000Z");
  assert.equal(modelPdf?.createdAt, "2026-06-01T10:15:00.000Z");
  assert.equal(userBrief?.semanticSummaryHint, "Uploaded client brief for the branded PDF.");
  assert.equal(modelPdf?.semanticSummaryHint, "Delivered branded PDF output.");
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

  // ADR-120 Slice 2 — the open-loop-refs request must carry the current
  // canonical chat id so the API can scope the list to this chat only.
  assert.equal(persaiInternalApiClient.openLoopRefsInputs.length, 1);
  assert.equal(persaiInternalApiClient.openLoopRefsInputs[0]?.chatId, "chat-1");

  const pruned = service.pruneClosedOpenLoopRefsDeveloperBlock(block, [
    "88888888-8888-4888-8888-888888888888"
  ]);
  assert.ok(
    !(pruned ?? "").includes("88888888-8888-4888-8888-888888888888"),
    "closed refs must be removed from the same-turn developer block"
  );

  // ADR-120 Slice 2 — with no current canonical chat row, there is no chat to
  // scope to: the block is omitted entirely and the API is never called (a
  // loop from another chat must never leak into this prompt).
  prisma.chat = null;
  persaiInternalApiClient.openLoopRefsInputs.length = 0;
  const noChatBlock = await service.computeOpenLoopRefsDeveloperBlock(request);
  assert.equal(noChatBlock, null, "no current chat ⇒ open-loop refs block omitted");
  assert.equal(
    persaiInternalApiClient.openLoopRefsInputs.length,
    0,
    "no current chat ⇒ open-loop-refs API must not be called"
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

  // Scenario B — an existing thread without a durable snapshot initializes
  // one and retains the exact persisted bytes on later turns.
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
      1,
      "a legacy thread without a snapshot must initialize one"
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

  await runCrossSessionCarryOverSnapshotAcceptance();
}

async function runCrossSessionCarryOverSnapshotAcceptance(): Promise<void> {
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

  {
    const harness = buildHarness();
    harness.prisma.chat = {
      id: "chat-snapshot",
      crossSessionCarryOverSnapshot: null
    };
    seedExistingThread(harness.prisma);
    harness.persaiInternalApiClient.carryOverOutcome = nonEmptyCarryOver();

    const initialized = await harness.service.buildMessages(
      buildExistingThreadRequest(),
      createRuntimeBundle()
    );
    assert.equal(harness.persaiInternalApiClient.carryOverInputs.length, 1);
    assert.equal(harness.persaiInternalApiClient.carryOverSnapshotInputs.length, 1);
    const snapshot = harness.persaiInternalApiClient.carryOverSnapshotInputs[0]?.snapshot;
    assert.ok(snapshot);
    assert.ok(snapshot.includes("Atlas project review focus."));
    assert.ok(initialized.some((message) => message.content === snapshot));

    harness.prisma.chat = {
      id: "chat-snapshot",
      crossSessionCarryOverSnapshot: snapshot
    };
    harness.persaiInternalApiClient.carryOverOutcome = {
      recentSynopses: [],
      unresolvedOpenLoops: []
    };
    const reused = await harness.service.buildMessages(
      buildExistingThreadRequest(),
      createRuntimeBundle()
    );
    assert.equal(
      harness.persaiInternalApiClient.carryOverInputs.length,
      1,
      "later turns must not recompute a durable carry-over snapshot"
    );
    assert.ok(reused.some((message) => message.content === snapshot));
  }

  {
    const harness = buildHarness();
    harness.prisma.chat = {
      id: "chat-empty-snapshot",
      crossSessionCarryOverSnapshot: null
    };
    seedExistingThread(harness.prisma);
    harness.persaiInternalApiClient.carryOverOutcome = {
      recentSynopses: [],
      unresolvedOpenLoops: []
    };
    const initialized = await harness.service.buildMessages(
      buildExistingThreadRequest(),
      createRuntimeBundle()
    );
    assert.equal(harness.persaiInternalApiClient.carryOverSnapshotInputs[0]?.snapshot, "");
    assert.equal(
      initialized.some(
        (message) =>
          typeof message.content === "string" &&
          message.content.includes("Continuity from earlier conversations")
      ),
      false
    );

    harness.prisma.chat = {
      id: "chat-empty-snapshot",
      crossSessionCarryOverSnapshot: ""
    };
    harness.persaiInternalApiClient.carryOverOutcome = nonEmptyCarryOver();
    await harness.service.buildMessages(buildExistingThreadRequest(), createRuntimeBundle());
    assert.equal(
      harness.persaiInternalApiClient.carryOverInputs.length,
      1,
      "an initialized empty snapshot must remain empty for the thread lifetime"
    );
  }

  {
    const harness = buildHarness();
    harness.prisma.chat = {
      id: "chat-snapshot-failure",
      crossSessionCarryOverSnapshot: null
    };
    seedExistingThread(harness.prisma);
    harness.persaiInternalApiClient.carryOverOutcome = nonEmptyCarryOver();
    harness.persaiInternalApiClient.carryOverSnapshotFailure = new Error("snapshot API down");
    const result = await harness.service.buildMessages(
      buildExistingThreadRequest(),
      createRuntimeBundle()
    );
    assert.equal(
      result.some(
        (message) =>
          typeof message.content === "string" &&
          message.content.includes("Atlas project review focus.")
      ),
      false,
      "unpersisted carry-over bytes must not enter a provider request"
    );
  }

  // ADR-122 Slice 3 — truncation marker hydration guard.
  // Tests are scoped to a minimal harness that avoids cross-session memory I/O.
  {
    const TRUNCATION_MARKER = "[Note: the previous answer was interrupted before completion.]";

    const buildMinimalHarness = () => {
      const prisma = new FakeRuntimeStatePrismaService();
      prisma.memoryRows = [];
      const runtimeStatePostgres = new FakeRuntimeStatePostgresService();
      const runtimeStateKeyspace = new FakeRuntimeStateKeyspaceService();
      const mediaObjectStorage = {
        async downloadObject() {
          return null;
        }
      };
      const persaiInternalApiClient = new FakePersaiInternalApiClientService();
      persaiInternalApiClient.configured = false;
      const svc = new TurnContextHydrationService(
        prisma as unknown as RuntimeStatePrismaService,
        runtimeStatePostgres as never,
        runtimeStateKeyspace as never,
        mediaObjectStorage as never,
        persaiInternalApiClient as unknown as PersaiInternalApiClientService
      );
      prisma.chat = { id: "chat-truncation-test" };
      return { svc, prisma };
    };

    const buildMinimalRequest = (idempotencyKey: string): RuntimeTurnRequest => {
      return {
        requestId: "req-trunc",
        idempotencyKey,
        runtimeTier: "paid_shared_restricted",
        bundle: {
          bundleId: "b-1",
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          publishedVersionId: "v-1",
          bundleHash: "hash-1",
          compiledAt: "2026-04-14T11:00:00.000Z"
        },
        conversation: {
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          channel: "web",
          externalThreadKey: "thread-t",
          externalUserKey: "user-t",
          mode: "direct"
        },
        message: {
          text: "continue",
          attachments: [],
          locale: "en",
          timezone: "UTC",
          receivedAt: "2026-04-14T12:00:00.000Z"
        }
      };
    };

    // Test 1: prior assistant message with status="truncated" gets the marker.
    {
      const { svc, prisma } = buildMinimalHarness();
      prisma.messages = [
        { id: "u-1", author: "user", content: "write a long essay", attachments: [] },
        {
          id: "a-1",
          author: "assistant",
          content: "This essay begins here...",
          attachments: [],
          metadata: { status: "truncated" }
        },
        { id: "u-2", author: "user", content: "continue", attachments: [] }
      ];
      const msgs = await svc.buildMessages(buildMinimalRequest("u-2"), createRuntimeBundle());
      const assistantMsg = msgs.find(
        (m) =>
          m.role === "assistant" &&
          typeof m.content === "string" &&
          (m.content as string).includes("This essay begins here")
      );
      assert.ok(assistantMsg !== undefined, "truncation test 1: assistant message must be present");
      assert.ok(
        typeof assistantMsg.content === "string" &&
          assistantMsg.content.includes(TRUNCATION_MARKER),
        "truncation test 1: metadata.status=truncated must append the marker"
      );
    }

    // Test 2: prior assistant message with status="partial" (abort) gets the marker.
    {
      const { svc, prisma } = buildMinimalHarness();
      prisma.messages = [
        { id: "u-1", author: "user", content: "tell me a story", attachments: [] },
        {
          id: "a-1",
          author: "assistant",
          content: "Once upon a time",
          attachments: [],
          metadata: { status: "partial" }
        },
        { id: "u-2", author: "user", content: "go on", attachments: [] }
      ];
      const msgs = await svc.buildMessages(buildMinimalRequest("u-2"), createRuntimeBundle());
      const assistantMsg = msgs.find(
        (m) =>
          m.role === "assistant" &&
          typeof m.content === "string" &&
          (m.content as string).includes("Once upon a time")
      );
      assert.ok(assistantMsg !== undefined, "truncation test 2: assistant message must be present");
      assert.ok(
        typeof assistantMsg.content === "string" &&
          assistantMsg.content.includes(TRUNCATION_MARKER),
        "truncation test 2: metadata.status=partial must append the marker"
      );
    }

    // Test 3: clean assistant message (no status) does NOT get the marker.
    {
      const { svc, prisma } = buildMinimalHarness();
      prisma.messages = [
        { id: "u-1", author: "user", content: "hello", attachments: [] },
        {
          id: "a-1",
          author: "assistant",
          content: "Hi there!",
          attachments: [],
          metadata: null
        },
        { id: "u-2", author: "user", content: "how are you", attachments: [] }
      ];
      const msgs = await svc.buildMessages(buildMinimalRequest("u-2"), createRuntimeBundle());
      const assistantMsg = msgs.find(
        (m) =>
          m.role === "assistant" &&
          typeof m.content === "string" &&
          (m.content as string).includes("Hi there!")
      );
      assert.ok(assistantMsg !== undefined, "truncation test 3: assistant message must be present");
      assert.ok(
        typeof assistantMsg.content === "string" &&
          !assistantMsg.content.includes(TRUNCATION_MARKER),
        "truncation test 3: clean assistant message must NOT have the marker"
      );
    }

    // Test 4: idempotency — marker text already in content (from a hypothetical double-call)
    // does not get doubled, because the stored content never contains the marker and
    // the helper checks for it before appending.
    {
      const { svc, prisma } = buildMinimalHarness();
      const contentWithMarker =
        "Partial reply\n\n[Note: the previous answer was interrupted before completion.]";
      prisma.messages = [
        { id: "u-1", author: "user", content: "question", attachments: [] },
        {
          id: "a-1",
          author: "assistant",
          content: contentWithMarker,
          attachments: [],
          metadata: { status: "truncated" }
        },
        { id: "u-2", author: "user", content: "next", attachments: [] }
      ];
      const msgs = await svc.buildMessages(buildMinimalRequest("u-2"), createRuntimeBundle());
      const assistantMsg = msgs.find(
        (m) =>
          m.role === "assistant" &&
          typeof m.content === "string" &&
          (m.content as string).includes("Partial reply")
      );
      assert.ok(
        assistantMsg !== undefined,
        "truncation test 4 (idempotency): assistant message must be present"
      );
      const content = assistantMsg.content as string;
      const markerCount = content.split(TRUNCATION_MARKER).length - 1;
      assert.equal(
        markerCount,
        1,
        "truncation test 4 (idempotency): marker must appear exactly once, not doubled"
      );
    }

    const makeExchange = (input: {
      id: string;
      name?: string;
      arguments?: Record<string, unknown>;
      content: string;
      isError?: boolean;
    }): ProviderGatewayToolExchange => ({
      toolCall: {
        id: input.id,
        name: input.name ?? "knowledge_search",
        arguments: input.arguments ?? { query: input.id }
      },
      toolResult: {
        toolCallId: input.id,
        name: input.name ?? "knowledge_search",
        content: input.content,
        isError: input.isError ?? false
      }
    });

    const findHydratedMessage = (
      messages: Awaited<ReturnType<TurnContextHydrationService["buildMessages"]>>,
      role: "user" | "assistant",
      snippet: string
    ) =>
      messages.find(
        (message) =>
          message.role === role &&
          typeof message.content === "string" &&
          message.content.includes(snippet)
      );

    // Test 5: every retained canonical assistant tool turn receives one
    // deterministic full projection. Appending a later turn must only grow
    // the replay map; it must not rewrite or evict earlier protocol pairs.
    {
      const { svc, prisma } = buildMinimalHarness();
      prisma.messages = [
        { id: "u-1", author: "user", content: "first question", attachments: [] },
        {
          id: "a-1",
          author: "assistant",
          content: "assistant one",
          attachments: [],
          toolExchanges: [makeExchange({ id: "call-1", content: "result-1" })]
        },
        { id: "u-2", author: "user", content: "second question", attachments: [] },
        {
          id: "a-2",
          author: "assistant",
          content: "assistant two",
          attachments: [],
          toolExchanges: [makeExchange({ id: "call-2", content: "result-2" })]
        },
        { id: "u-3", author: "user", content: "third question", attachments: [] },
        {
          id: "a-3",
          author: "assistant",
          content: "assistant three",
          attachments: [],
          toolExchanges: [makeExchange({ id: "call-3", content: "result-3" })]
        },
        { id: "u-4", author: "user", content: "fourth question", attachments: [] },
        {
          id: "a-4",
          author: "assistant",
          content: "assistant four",
          attachments: [],
          toolExchanges: [makeExchange({ id: "call-4", content: "result-4" })]
        },
        { id: "u-5", author: "user", content: "continue", attachments: [] }
      ];
      const firstPass = await svc.buildMessages(buildMinimalRequest("u-5"), createRuntimeBundle());
      const secondPass = await svc.buildMessages(buildMinimalRequest("u-5"), createRuntimeBundle());
      assert.deepEqual(
        firstPass,
        secondPass,
        "replay hydration must be byte-stable for identical stored tool state"
      );

      const assistantOne = findHydratedMessage(firstPass, "assistant", "assistant one");
      const assistantTwo = findHydratedMessage(firstPass, "assistant", "assistant two");
      const assistantThree = findHydratedMessage(firstPass, "assistant", "assistant three");
      const assistantFour = findHydratedMessage(firstPass, "assistant", "assistant four");
      const currentUser = findHydratedMessage(firstPass, "user", "continue");
      assert.ok(assistantOne, "replay test 5: oldest assistant message must be present");
      assert.ok(assistantTwo, "replay test 5: second assistant message must be present");
      assert.ok(assistantThree, "replay test 5: third assistant message must be present");
      assert.ok(assistantFour, "replay test 5: fourth assistant message must be present");
      assert.ok(currentUser, "replay test 5: current inbound user message must be present");
      assert.equal(assistantOne?.priorToolExchanges?.[0]?.toolCall.id, "call-1");
      assert.equal(assistantTwo?.priorToolExchanges?.[0]?.toolCall.id, "call-2");
      assert.equal(assistantThree?.priorToolExchanges?.[0]?.toolCall.id, "call-3");
      assert.equal(assistantFour?.priorToolExchanges?.[0]?.toolCall.id, "call-4");
      assert.ok(
        [assistantOne, assistantTwo, assistantThree, assistantFour].every(
          (message) =>
            JSON.parse(message?.priorToolExchanges?.[0]?.toolResult.content ?? "{}")
              ._observationTier === "full"
        ),
        "replay test 5: every retained turn must have its deterministic full projection"
      );
      assert.equal(
        "priorToolExchanges" in (currentUser ?? {}),
        false,
        "replay test 5: current inbound user message must never receive replay attachments"
      );

      const earlierReplayByContent = new Map(
        [assistantOne, assistantTwo, assistantThree, assistantFour].map((message) => [
          String(message?.content),
          message?.priorToolExchanges
        ])
      );
      prisma.messages.push(
        {
          id: "a-5",
          author: "assistant",
          content: "assistant five",
          attachments: [],
          toolExchanges: [makeExchange({ id: "call-5", content: "result-5" })]
        },
        { id: "u-6", author: "user", content: "continue again", attachments: [] }
      );
      const appendedPass = await svc.buildMessages(
        buildMinimalRequest("u-6"),
        createRuntimeBundle()
      );
      const appendedAssistants = [
        "assistant one",
        "assistant two",
        "assistant three",
        "assistant four"
      ].map((content) => findHydratedMessage(appendedPass, "assistant", content));
      for (const assistant of appendedAssistants) {
        assert.deepEqual(
          assistant?.priorToolExchanges,
          earlierReplayByContent.get(String(assistant?.content)),
          "replay test 5: later turns must not rewrite an already-emitted replay projection"
        );
      }
      const assistantFive = findHydratedMessage(appendedPass, "assistant", "assistant five");
      assert.equal(
        assistantFive?.priorToolExchanges?.[0]?.toolCall.id,
        "call-5",
        "replay test 5: appended canonical history must add its replay projection"
      );
    }

    // Test 6: ADR-161 A1 prior replay uses full projections per retained turn
    // (A2 will later placeholder older results). Argument caps and binary
    // safety remain. Errors remain informative.
    {
      const { svc, prisma } = buildMinimalHarness();
      const oversizedResult = "A".repeat(5_000);
      const oversizedArguments = { payload: "x".repeat(2_000) };
      const browserPageContent = "DOM-".repeat(400);
      const browserElements = Array.from({ length: 12 }, (_, index) => ({
        index,
        tag: "button",
        role: "button",
        name: `Control ${String(index)}`,
        text: `Buy item ${String(index)}`,
        selector: `#el-${String(index)}`,
        bounds: { x: index, y: index, width: 40, height: 20 }
      }));
      const makeBrowserPayload = (action: string): string =>
        JSON.stringify({
          toolCode: "browser",
          executionMode: "worker",
          provider: "local_bridge",
          requestedAction: action,
          page: {
            initialUrl: "https://shop.example/catalog",
            finalUrl: "https://shop.example/catalog",
            title: "Catalog",
            content: browserPageContent,
            truncated: false,
            elements: browserElements,
            extracted: [{ kind: "text", value: "extracted-body".repeat(40) }],
            observedAt: "2026-07-11T00:00:00.000Z",
            tookMs: 120,
            warning: null
          },
          action,
          reason: null,
          warning: null
        });
      prisma.messages = [
        { id: "u-1", author: "user", content: "q1", attachments: [] },
        {
          id: "a-1",
          author: "assistant",
          content: "assistant heavy",
          attachments: [],
          toolExchanges: [
            makeExchange({ id: "heavy-1", content: oversizedResult }),
            makeExchange({ id: "heavy-2", content: oversizedResult }),
            makeExchange({ id: "heavy-3", content: oversizedResult }),
            makeExchange({ id: "heavy-4", content: oversizedResult })
          ]
        },
        { id: "u-2", author: "user", content: "q2", attachments: [] },
        {
          id: "a-2",
          author: "assistant",
          content: "assistant browser",
          attachments: [],
          toolExchanges: [
            makeExchange({
              id: "browser-old",
              name: "browser",
              arguments: oversizedArguments,
              content: makeBrowserPayload("snapshot")
            }),
            makeExchange({
              id: "browser-new",
              name: "browser",
              arguments: { action: "snapshot" },
              content: makeBrowserPayload("snapshot")
            })
          ]
        },
        { id: "u-3", author: "user", content: "q3", attachments: [] },
        {
          id: "a-3",
          author: "assistant",
          content: "assistant binary",
          attachments: [],
          toolExchanges: [
            makeExchange({ id: "binary-1", content: `%PDF-${"B".repeat(4_000)}` }),
            makeExchange({
              id: "error-1",
              content: JSON.stringify({ reason: "permission denied", detail: "EACCES" }),
              isError: true
            })
          ]
        },
        { id: "u-4", author: "user", content: "continue", attachments: [] }
      ];
      const messages = await svc.buildMessages(buildMinimalRequest("u-4"), createRuntimeBundle());
      const assistantHeavy = findHydratedMessage(messages, "assistant", "assistant heavy");
      const assistantBrowser = findHydratedMessage(messages, "assistant", "assistant browser");
      const assistantBinary = findHydratedMessage(messages, "assistant", "assistant binary");
      assert.ok(assistantHeavy, "replay test 6: heavy assistant message must be present");
      assert.ok(assistantBrowser, "replay test 6: browser assistant message must be present");
      assert.ok(assistantBinary, "replay test 6: binary assistant message must be present");
      assert.ok(
        estimateProviderGatewayMessageTokens(assistantHeavy!) >
          estimateProviderGatewayMessageTokens({
            role: assistantHeavy!.role,
            content: assistantHeavy!.content
          }),
        "replay test 6: canonical hydration budget must include full replay tokens"
      );
      assert.equal(assistantHeavy?.priorToolExchanges?.length, 4);
      assert.ok(
        (assistantHeavy?.priorToolExchanges ?? []).every((exchange) => {
          const parsed = JSON.parse(exchange.toolResult.content) as {
            _observationTier?: string;
            content?: string;
          };
          return parsed._observationTier === "full" && parsed.content === oversizedResult;
        }),
        "replay test 6: every oversized retained exchange must use full projection"
      );

      const browserExchanges = assistantBrowser?.priorToolExchanges ?? [];
      assert.equal(
        browserExchanges.length,
        2,
        "replay test 6: browser assistant turn must retain projected replay"
      );
      const olderBrowser = JSON.parse(browserExchanges[0]!.toolResult.content) as Record<
        string,
        unknown
      >;
      const newerBrowser = JSON.parse(browserExchanges[1]!.toolResult.content) as Record<
        string,
        unknown
      >;
      assert.equal(
        olderBrowser._observationTier,
        "full",
        "replay test 6: older browser exchange in a replayed turn must be full"
      );
      assert.equal(olderBrowser.toolCode, "browser");
      assert.ok(
        "page" in olderBrowser,
        "replay test 6: A1 full prior replay retains browser page payload"
      );
      assert.equal(
        newerBrowser._observationTier,
        "full",
        "replay test 6: each replayed browser exchange stays full"
      );
      assert.ok(
        "page" in newerBrowser,
        "replay test 6: A1 full prior replay retains browser page payload"
      );

      const serializedArguments = JSON.stringify(browserExchanges[0]!.toolCall.arguments);
      assert.ok(
        serializedArguments.length <= 600,
        "replay test 6: replayed tool arguments must stay within the serialized cap"
      );
      assert.ok(
        serializedArguments.includes("tool arguments truncated"),
        "replay test 6: oversized tool arguments must carry the truncation marker"
      );

      const binaryProjected = JSON.parse(
        assistantBinary?.priorToolExchanges?.[0]?.toolResult.content ?? "{}"
      ) as Record<string, unknown>;
      assert.equal(
        binaryProjected._observationTier,
        "full",
        "replay test 6: binary tool_result content must use full projection safety wrap"
      );
      assert.equal(binaryProjected.content, "[binary content omitted]");
      const errorProjected = JSON.parse(
        assistantBinary?.priorToolExchanges?.[1]?.toolResult.content ?? "{}"
      ) as Record<string, unknown>;
      assert.equal(errorProjected._observationTier, "full");
      assert.equal(assistantBinary?.priorToolExchanges?.[1]?.toolResult.isError, true);
      assert.equal(errorProjected.reason, "permission denied");
    }
  }
}

// ADR-100 Piece 2 — recent discovered file refs hydration acceptance tests.
export async function runRecentdiscoveredFileHandlesHydrationTest(): Promise<void> {
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
      persaiInternalApiClient as unknown as PersaiInternalApiClientService
    );
    return { service, prisma, persaiInternalApiClient };
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

  function registerPath(
    persaiInternalApiClient: FakePersaiInternalApiClientService,
    storagePath: string,
    shortDescription?: string
  ): void {
    persaiInternalApiClient.shortDescriptionsByPath.set(storagePath, shortDescription ?? null);
  }

  function wp(relativePath: string): string {
    return `/workspace/assistants/assistant-handle/sessions/session-id/${relativePath.replace(/^\/+/, "")}`;
  }

  const pathA = wp("discoveries/viking.png");
  const pathB = wp("discoveries/revenue.xlsx");
  const pathC = wp("discoveries/logo.svg");

  // Scenario 1 — last 5 assistant messages contain 3 distinct discovered paths.
  // All 3 appear in Working Files with sticky `file #N` labels and semanticSummaryHint.
  {
    const { service, prisma, persaiInternalApiClient } = buildHarness();
    prisma.chat = { id: "chat-recent-1" };
    registerPath(persaiInternalApiClient, pathA, "A photo of a viking");
    registerPath(persaiInternalApiClient, pathB, "Q2 revenue spreadsheet");
    registerPath(persaiInternalApiClient, pathC, "Company logo design");
    prisma.messages = [
      { id: "u-1", author: "user", content: "user turn 1", attachments: [] },
      {
        id: "a-1",
        author: "assistant",
        content: "assistant turn 1",
        attachments: [],
        metadata: { discoveredFilePaths: [pathA, pathB] }
      },
      { id: "u-2", author: "user", content: "user turn 2", attachments: [] },
      {
        id: "a-2",
        author: "assistant",
        content: "assistant turn 2",
        attachments: [],
        metadata: { discoveredFilePaths: [pathC] }
      }
    ];
    const refs = await service.listAvailableWorkingFileHandles({
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

  // Scenario 2 — 7 distinct paths across the window → only top 6 most-recent appear; 7th dropped.
  {
    const { service, prisma, persaiInternalApiClient } = buildHarness();
    prisma.chat = { id: "chat-recent-2" };
    const paths = Array.from({ length: 7 }, (_, index) => wp(`f${String(index + 1)}.png`));
    for (const storagePath of paths) {
      registerPath(persaiInternalApiClient, storagePath);
    }
    prisma.messages = [
      {
        id: "a-old",
        author: "assistant",
        content: "older",
        attachments: [],
        metadata: { discoveredFilePaths: [paths[4]!, paths[5]!, paths[6]!] }
      },
      {
        id: "a-new",
        author: "assistant",
        content: "newer",
        attachments: [],
        metadata: { discoveredFilePaths: [paths[0]!, paths[1]!, paths[2]!, paths[3]!] }
      }
    ];
    const refs = await service.listAvailableWorkingFileHandles({
      conversation: buildConversation(),
      currentAttachments: []
    });
    assert.equal(refs.length, 6, "scenario 2: exactly 6 discovered files expected");
    assert.ok(
      !refs.some((r) => r.storagePath === paths[6]),
      "scenario 2: 7th path must be dropped over cap"
    );
  }

  // Scenario 3 — one discovered path has no workspace_file_metadata row (deleted).
  // Silently dropped; no error; other paths still appear.
  {
    const { service, prisma, persaiInternalApiClient } = buildHarness();
    prisma.chat = { id: "chat-recent-3" };
    const alivePath = wp("alive.png");
    const deletedPath = wp("deleted.png");
    registerPath(persaiInternalApiClient, alivePath, "Surviving file");
    prisma.messages = [
      {
        id: "a-1",
        author: "assistant",
        content: "assistant",
        attachments: [],
        metadata: { discoveredFilePaths: [deletedPath, alivePath] }
      }
    ];
    let refs: Awaited<ReturnType<typeof service.listAvailableWorkingFileHandles>>;
    try {
      refs = await service.listAvailableWorkingFileHandles({
        conversation: buildConversation(),
        currentAttachments: []
      });
    } catch (error) {
      assert.fail(`scenario 3: must not throw; got: ${String(error)}`);
    }
    assert.equal(refs.length, 1, "scenario 3: only the alive file must appear");
    assert.equal(refs[0]?.storagePath, alivePath, "scenario 3: alive path must remain");
    assert.ok((refs[0]?.aliases ?? []).includes("file #1"));
  }

  // Scenario 4 — one discovered path is also in current attachments.
  // The standard sticky alias wins; no legacy discovery alias is added.
  {
    const { service, prisma, persaiInternalApiClient } = buildHarness();
    prisma.chat = { id: "chat-recent-4" };
    const sharedPhotoPath = wp("photo.png");
    const otherPath = wp("other.png");
    registerPath(persaiInternalApiClient, sharedPhotoPath, "The shared photo");
    registerPath(persaiInternalApiClient, otherPath, "Other file");
    prisma.messages = [
      {
        id: "a-1",
        author: "assistant",
        content: "assistant",
        attachments: [],
        metadata: { discoveredFilePaths: [sharedPhotoPath, otherPath] }
      }
    ];
    const refs = await service.listAvailableWorkingFileHandles({
      conversation: buildConversation(),
      currentAttachments: [
        {
          attachmentId: "att-1",
          kind: "image",
          storagePath: sharedPhotoPath,
          mimeType: "image/png",
          displayName: "photo.png",
          sizeBytes: 1024
        }
      ]
    });
    const attachedRef = refs.find((r) => r.storagePath === sharedPhotoPath);
    assert.ok(attachedRef !== undefined, "scenario 4: shared photo path must be present");
    const attachedAliases = attachedRef?.aliases ?? [];
    const hasStickyImageAlias = attachedAliases.some((a) => /^image #/.test(a));
    const hasStickyFileAlias = attachedAliases.some((a) => /^file #/.test(a));
    assert.ok(
      hasStickyImageAlias && hasStickyFileAlias,
      "scenario 4: shared photo must have sticky image and file aliases"
    );
    assert.ok(
      !attachedAliases.some((a) => /^recent file #/i.test(a)),
      "scenario 4: shared photo must NOT carry a legacy recent alias"
    );
    // The other file not in current attachments still gets a sticky file alias.
    const otherRef = refs.find((r) => r.storagePath === otherPath);
    assert.ok(otherRef !== undefined, "scenario 4: other path must be present");
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
        // no metadata / no discoveredFilePaths
      }
    ];
    const refs = await service.listAvailableWorkingFileHandles({
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

/**
 * ADR-125 — covers the windowed chat-plan renderer used by the
 * `<persai_chat_plan>` volatile block. Asserts:
 *   - empty input → null (block omitted entirely)
 *   - parent + child rendering keeps the child indented under its parent
 *   - status badges and the `+ N more` tail
 *   - rendering refuses to accept more than the window cap
 *
 * ADR-125 follow-up — the block is now origin-agnostic: the model owns the
 * entire plan lifecycle including scenario intake (via `todo_write` after
 * `skill.engage` returns scenario steps), so no `scenario_seeded` hint is
 * needed.
 */
export async function runChatPlanBlockTest(): Promise<void> {
  assert.equal(renderChatPlanBlock([], 0), null);

  const todos: RuntimeTodoItem[] = [
    {
      id: "todo-1",
      parentId: null,
      content: "Research pricing tiers",
      status: "in_progress"
    },
    {
      id: "todo-2",
      parentId: "todo-1",
      content: "Compile sources",
      status: "pending"
    },
    {
      id: "todo-3",
      parentId: null,
      content: "Draft the proposal",
      status: "completed"
    }
  ];
  const rendered = renderChatPlanBlock(todos, 4);
  assert.ok(rendered !== null);
  const lines = rendered.split("\n");
  // 3 rows + truncation tail
  assert.equal(lines.length, 4);
  assert.match(lines[0] ?? "", /^- \[~\] Research pricing tiers/);
  assert.match(lines[1] ?? "", /^ {2}- \[ \] Compile sources/);
  assert.match(lines[2] ?? "", /^- \[x\] Draft the proposal/);
  assert.match(lines[3] ?? "", /^\+ 4 more$/);
  assert.match(lines[0] ?? "", /— by id todo-1$/);

  const overSizedInput: RuntimeTodoItem[] = Array.from({ length: 13 }, (_, index) => ({
    id: `todo-${String(index)}`,
    parentId: null,
    content: `Item ${String(index)}`,
    status: "pending"
  }));
  assert.throws(() => renderChatPlanBlock(overSizedInput, 0), /window cap/);
}
