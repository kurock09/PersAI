import assert from "node:assert/strict";
import { PlatformHttpMetricsService } from "../src/modules/platform-core/application/platform-http-metrics.service";

const noopRecordModelCostLedgerService = {
  async recordPersistedBillingFactsEvent() {
    return 0;
  }
} as never;

const noopPrisma = {
  assistantVoiceTranscriptionEvent: {
    async create() {
      return {
        id: "voice-event-1",
        assistantId: "assistant-1",
        userId: "user-1",
        workspaceId: "workspace-1",
        surface: "voice_http",
        occurredAt: new Date()
      };
    }
  }
} as never;
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { ManageChatMediaService } from "../src/modules/workspace-management/application/manage-chat-media.service";
import type { Assistant } from "../src/modules/workspace-management/domain/assistant.entity";

const assistant: Assistant = {
  id: "assistant-1",
  userId: "user-1",
  workspaceId: "workspace-1",
  draftDisplayName: null,
  draftInstructions: null,
  draftTraits: null,
  draftAvatarEmoji: null,
  draftAvatarUrl: null,
  draftAssistantGender: null,
  draftUpdatedAt: null,
  applyStatus: "succeeded",
  applyTargetVersionId: null,
  applyAppliedVersionId: null,
  applyRequestedAt: null,
  applyStartedAt: null,
  applyFinishedAt: null,
  applyErrorCode: null,
  applyErrorMessage: null,
  configDirtyAt: null,
  createdAt: new Date("2026-04-06T00:00:00.000Z"),
  updatedAt: new Date("2026-04-06T00:00:00.000Z")
};

let lastEnsureAttachmentFileInput: Record<string, unknown> | null = null;
const fakeAssistantFileRegistry = {
  async ensureAttachmentFile(input: Record<string, unknown>) {
    lastEnsureAttachmentFileInput = input;
    return { fileRef: `file-${String(input.sourceAttachmentId)}` };
  }
};

const noopUploadMicroDescriptionJobService = {
  async enqueueIfNeeded() {
    return { accepted: false, reason: "noop" };
  }
} as never;

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-api-token";
  process.env.WEB_ACTIVE_CHATS_CAP = "20";
  process.env.QUOTA_TOKEN_BUDGET_DEFAULT = "100";
  process.env.QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT = "3";

  let directUploadCreateInput: Record<string, unknown> | null = null;
  const directUploadService = new ManageChatMediaService(
    {
      async findByUserId(userId: string) {
        return userId === "user-1" ? assistant : null;
      }
    } as never,
    {
      async findChatById(chatId: string) {
        return {
          id: chatId,
          assistantId: assistant.id,
          userId: assistant.userId,
          workspaceId: assistant.workspaceId,
          surface: "web",
          surfaceThreadKey: "thread-1",
          title: null,
          archivedAt: null,
          lastMessageAt: null,
          createdAt: new Date("2026-04-06T00:00:00.000Z"),
          updatedAt: new Date("2026-04-06T00:00:00.000Z")
        };
      },
      async findMessageByIdForAssistant(messageId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId: assistant.id,
          author: "user",
          content: "upload here",
          createdAt: new Date("2026-04-06T00:00:00.000Z"),
          updatedAt: new Date("2026-04-06T00:00:00.000Z")
        };
      }
    } as never,
    {
      async create(input: Record<string, unknown>) {
        directUploadCreateInput = input;
        return {
          id: "att-direct-1",
          messageId: "msg-direct-1",
          chatId: "chat-1",
          assistantId: assistant.id,
          workspaceId: assistant.workspaceId,
          attachmentType: "document",
          storagePath: input.storagePath,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          durationMs: input.durationMs,
          width: input.width,
          height: input.height,
          processingStatus: "ready",
          transcription: input.transcription,
          metadata: input.metadata,
          createdAt: new Date("2026-04-06T00:00:00.000Z")
        };
      }
    } as never,
    {
      async process(buffer: Buffer) {
        return {
          normalizedBuffer: buffer,
          normalizedMime: "text/plain",
          normalizedExtension: "txt",
          transcription: null,
          billingFacts: {
            providerKey: "openai",
            modelKey: "gpt-4o-mini-transcribe",
            capability: "speech_to_text",
            occurredAt: "2026-05-05T09:00:00.000Z",
            metering: {
              meteringKind: "time_metered",
              durationMs: 2300,
              durationSeconds: 2.3
            }
          },
          textExtract: "line one\nline two",
          durationMs: null,
          width: null,
          height: null
        };
      }
    } as never,
    {} as never,
    {
      buildChatMessageObjectKey() {
        return "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-direct-1/note.txt";
      },
      async saveObject(input: { objectKey: string; buffer: Buffer; mimeType: string }) {
        return {
          objectKey: input.objectKey,
          sizeBytes: input.buffer.length,
          mimeType: input.mimeType
        };
      }
    } as never,
    {
      async resolveActiveWebChatsLimit() {
        return 20;
      },
      async checkMediaStorageQuota() {
        return { allowed: true };
      },
      async recordMediaUpload(input: { sizeBytes: bigint }) {
        return {
          appliedDelta: input.sizeBytes,
          capped: false,
          state: {
            id: "state-direct-1",
            workspaceId: assistant.workspaceId,
            tokenBudgetUsed: BigInt(0),
            tokenBudgetLimit: null,
            costOrTokenDrivingToolClassUnitsUsed: 0,
            costOrTokenDrivingToolClassUnitsLimit: null,
            activeWebChatsCurrent: 0,
            activeWebChatsLimit: null,
            mediaStorageBytesUsed: input.sizeBytes,
            mediaStorageBytesLimit: BigInt(1000),
            lastComputedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      }
    } as never,
    fakeAssistantFileRegistry as never,
    noopUploadMicroDescriptionJobService,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService,
    noopPrisma
  );

  const directUpload = await directUploadService.uploadAttachment({
    userId: "user-1",
    chatId: "chat-1",
    messageId: "msg-direct-1",
    file: {
      buffer: Buffer.from("line one\nline two"),
      mimetype: "text/plain",
      originalname: "note.txt"
    }
  });

  assert.equal((directUploadCreateInput?.mimeType as string) ?? null, "text/plain");
  assert.equal(directUpload.assistantFileId, "file-att-direct-1");
  assert.deepEqual(directUploadCreateInput?.metadata, {
    source: "chat_upload",
    contentPreview: "line one line two",
    semanticSummary: "line one line two",
    semanticSummarySource: "text_extract"
  });
  assert.deepEqual(lastEnsureAttachmentFileInput?.semanticSummary, "line one line two");
  assert.equal(lastEnsureAttachmentFileInput?.semanticSummarySource, "text_extract");
  assert.deepEqual(directUploadCreateInput?.billingFacts, {
    providerKey: "openai",
    modelKey: "gpt-4o-mini-transcribe",
    capability: "speech_to_text",
    occurredAt: "2026-05-05T09:00:00.000Z",
    metering: {
      meteringKind: "time_metered",
      durationMs: 2300,
      durationSeconds: 2.3
    }
  });

  let videoUploadCreateInput: Record<string, unknown> | null = null;
  const videoUploadService = new ManageChatMediaService(
    {
      async findByUserId(userId: string) {
        return userId === "user-1" ? assistant : null;
      }
    } as never,
    {
      async findChatById(chatId: string) {
        return {
          id: chatId,
          assistantId: assistant.id,
          userId: assistant.userId,
          workspaceId: assistant.workspaceId,
          surface: "web",
          surfaceThreadKey: "thread-1",
          title: null,
          archivedAt: null,
          lastMessageAt: null,
          createdAt: new Date("2026-04-06T00:00:00.000Z"),
          updatedAt: new Date("2026-04-06T00:00:00.000Z")
        };
      },
      async findMessageByIdForAssistant(messageId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId: assistant.id,
          author: "user",
          content: "upload video here",
          createdAt: new Date("2026-04-06T00:00:00.000Z"),
          updatedAt: new Date("2026-04-06T00:00:00.000Z")
        };
      }
    } as never,
    {
      async create(input: Record<string, unknown>) {
        videoUploadCreateInput = input;
        return {
          id: "att-video-1",
          messageId: "msg-video-1",
          chatId: "chat-1",
          assistantId: assistant.id,
          workspaceId: assistant.workspaceId,
          attachmentType: "video",
          storagePath: input.storagePath,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          durationMs: input.durationMs,
          width: input.width,
          height: input.height,
          processingStatus: "ready",
          transcription: input.transcription,
          metadata: input.metadata,
          createdAt: new Date("2026-04-06T00:00:00.000Z")
        };
      }
    } as never,
    {
      async process(buffer: Buffer) {
        return {
          normalizedBuffer: buffer,
          normalizedMime: "video/mp4",
          normalizedExtension: "mp4",
          transcription: "hello from video",
          billingFacts: {
            providerKey: "openai",
            modelKey: "gpt-4o-mini-transcribe",
            capability: "speech_to_text",
            occurredAt: "2026-05-05T09:05:00.000Z",
            metering: {
              meteringKind: "time_metered",
              durationMs: 5400,
              durationSeconds: 5.4
            }
          },
          textExtract: null,
          durationMs: null,
          width: null,
          height: null
        };
      }
    } as never,
    {} as never,
    {
      buildChatMessageObjectKey() {
        return "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-video-1/clip.mp4";
      },
      async saveObject(input: { objectKey: string; buffer: Buffer; mimeType: string }) {
        return {
          objectKey: input.objectKey,
          sizeBytes: input.buffer.length,
          mimeType: input.mimeType
        };
      }
    } as never,
    {
      async resolveActiveWebChatsLimit() {
        return 20;
      },
      async checkMediaStorageQuota() {
        return { allowed: true };
      },
      async recordMediaUpload(input: { sizeBytes: bigint }) {
        return {
          appliedDelta: input.sizeBytes,
          capped: false,
          state: {
            id: "state-video-1",
            workspaceId: assistant.workspaceId,
            tokenBudgetUsed: BigInt(0),
            tokenBudgetLimit: null,
            costOrTokenDrivingToolClassUnitsUsed: 0,
            costOrTokenDrivingToolClassUnitsLimit: null,
            activeWebChatsCurrent: 0,
            activeWebChatsLimit: null,
            mediaStorageBytesUsed: input.sizeBytes,
            mediaStorageBytesLimit: BigInt(1000),
            lastComputedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      }
    } as never,
    fakeAssistantFileRegistry as never,
    noopUploadMicroDescriptionJobService,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService,
    noopPrisma
  );

  await videoUploadService.uploadAttachment({
    userId: "user-1",
    chatId: "chat-1",
    messageId: "msg-video-1",
    file: {
      buffer: Buffer.from("fake-video-binary"),
      mimetype: "video/mp4",
      originalname: "clip.mp4"
    }
  });

  assert.deepEqual(videoUploadCreateInput?.billingFacts, {
    providerKey: "openai",
    modelKey: "gpt-4o-mini-transcribe",
    capability: "speech_to_text",
    occurredAt: "2026-05-05T09:05:00.000Z",
    metering: {
      meteringKind: "time_metered",
      durationMs: 5400,
      durationSeconds: 5.4
    }
  });
  assert.equal(videoUploadCreateInput?.transcription, "hello from video");
  assert.deepEqual(videoUploadCreateInput?.metadata, {
    source: "chat_upload",
    semanticSummary: "hello from video",
    semanticSummarySource: "transcription"
  });
  assert.deepEqual(lastEnsureAttachmentFileInput?.semanticSummary, "hello from video");
  assert.equal(lastEnsureAttachmentFileInput?.semanticSummarySource, "transcription");

  const metrics = new PlatformHttpMetricsService();
  const deletedStagingMessageIds: string[] = [];
  const deletedStoragePaths: string[] = [];
  const releasedBytes: bigint[] = [];
  const service = new ManageChatMediaService(
    {
      async findByUserId(userId: string) {
        return userId === "user-1" ? assistant : null;
      }
    } as never,
    {
      async getOrCreateWebChatBySurfaceThreadUnderCap() {
        return {
          outcome: "created" as const,
          chat: {
            id: "chat-1",
            assistantId: assistant.id,
            userId: assistant.userId,
            workspaceId: assistant.workspaceId,
            surface: "web",
            surfaceThreadKey: "thread-1",
            title: null,
            archivedAt: null,
            lastMessageAt: null,
            createdAt: new Date("2026-04-06T00:00:00.000Z"),
            updatedAt: new Date("2026-04-06T00:00:00.000Z")
          }
        };
      },
      async createMessage() {
        return {
          id: "msg-1",
          chatId: "chat-1",
          assistantId: assistant.id,
          author: "user",
          content: "",
          createdAt: new Date("2026-04-06T00:00:00.000Z"),
          updatedAt: new Date("2026-04-06T00:00:00.000Z")
        };
      },
      async deleteMessage(messageId: string) {
        deletedStagingMessageIds.push(messageId);
        return true;
      }
    } as never,
    {
      async create(input: {
        storagePath: string;
        mimeType: string;
        sizeBytes: bigint;
        originalFilename: string | null;
        transcription: string | null;
        metadata: Record<string, unknown> | null;
      }) {
        return {
          id: "att-1",
          messageId: "msg-1",
          chatId: "chat-1",
          assistantId: assistant.id,
          workspaceId: assistant.workspaceId,
          attachmentType: "image",
          storagePath: input.storagePath,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          durationMs: null,
          width: 100,
          height: 100,
          processingStatus: "ready",
          transcription: input.transcription,
          metadata: input.metadata,
          createdAt: new Date("2026-04-06T00:00:00.000Z")
        };
      }
    } as never,
    {
      async process(buffer: Buffer, mime: string) {
        return {
          normalizedBuffer: buffer,
          normalizedMime: mime,
          normalizedExtension: "png",
          transcription: null,
          billingFacts: null,
          textExtract: null,
          durationMs: null,
          width: 100,
          height: 100
        };
      }
    } as never,
    {} as never,
    {
      buildChatMessageObjectKey() {
        return "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/image.png";
      },
      async saveObject(input: { objectKey: string; buffer: Buffer; mimeType: string }) {
        return {
          objectKey: input.objectKey,
          sizeBytes: input.buffer.length,
          mimeType: input.mimeType
        };
      },
      async deleteObject(objectKey: string) {
        deletedStoragePaths.push(objectKey);
      }
    } as never,
    {
      async resolveActiveWebChatsLimit() {
        return 20;
      },
      async checkMediaStorageQuota() {
        return { allowed: true };
      },
      async recordMediaUpload(input: { sizeBytes: bigint }) {
        return {
          appliedDelta: input.sizeBytes,
          capped: false,
          state: {
            id: "state-1",
            workspaceId: assistant.workspaceId,
            tokenBudgetUsed: BigInt(0),
            tokenBudgetLimit: null,
            costOrTokenDrivingToolClassUnitsUsed: 0,
            costOrTokenDrivingToolClassUnitsLimit: null,
            activeWebChatsCurrent: 0,
            activeWebChatsLimit: null,
            mediaStorageBytesUsed: input.sizeBytes,
            mediaStorageBytesLimit: BigInt(1000),
            lastComputedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      },
      async releaseMediaStorage(input: { sizeBytes: bigint }) {
        releasedBytes.push(input.sizeBytes);
        return {
          releasedDelta: input.sizeBytes,
          state: {
            id: "state-1",
            workspaceId: assistant.workspaceId,
            tokenBudgetUsed: BigInt(0),
            tokenBudgetLimit: null,
            costOrTokenDrivingToolClassUnitsUsed: 0,
            costOrTokenDrivingToolClassUnitsLimit: null,
            activeWebChatsCurrent: 0,
            activeWebChatsLimit: null,
            mediaStorageBytesUsed: BigInt(0),
            mediaStorageBytesLimit: BigInt(1000),
            lastComputedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      }
    } as never,
    fakeAssistantFileRegistry as never,
    noopUploadMicroDescriptionJobService,
    metrics,
    noopRecordModelCostLedgerService,
    noopPrisma
  );

  const staged = await service.stageForWebThread({
    userId: "user-1",
    surfaceThreadKey: "thread-1",
    file: {
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      mimetype: "image/png",
      originalname: "image.png"
    }
  });

  assert.equal(staged.chatId, "chat-1");
  assert.equal(staged.messageId, "msg-1");
  assert.equal(staged.attachment.assistantFileId, "file-att-1");
  assert.deepEqual(deletedStagingMessageIds, []);
  assert.deepEqual(deletedStoragePaths, []);
  assert.deepEqual(releasedBytes, []);
  const successSeries = metrics
    .getSnapshot()
    .mediaStageSeries.find(
      (series) =>
        series.key.stage === "web_stage_attachment" &&
        series.key.channel === "web" &&
        series.key.outcome === "success"
    );
  assert.equal(successSeries?.count, 1);

  const stageEnqueueCalls: Array<Record<string, unknown>> = [];
  const existingProjectStageService = new ManageChatMediaService(
    {
      async findByUserId() {
        return assistant;
      }
    } as never,
    {
      async getOrCreateWebChatBySurfaceThreadUnderCap() {
        return {
          outcome: "existing" as const,
          chat: {
            id: "chat-project-1",
            assistantId: assistant.id,
            userId: assistant.userId,
            workspaceId: assistant.workspaceId,
            surface: "web",
            surfaceThreadKey: "thread-project-1",
            title: null,
            chatMode: "project",
            deepModeEnabled: true,
            skillDecisionState: null,
            skillCadenceState: null,
            archivedAt: null,
            lastMessageAt: null,
            createdAt: new Date("2026-04-06T00:00:00.000Z"),
            updatedAt: new Date("2026-04-06T00:00:00.000Z")
          }
        };
      },
      async createMessage() {
        return {
          id: "msg-project-1",
          chatId: "chat-project-1",
          assistantId: assistant.id,
          author: "user",
          content: "",
          createdAt: new Date("2026-04-06T00:00:00.000Z"),
          updatedAt: new Date("2026-04-06T00:00:00.000Z")
        };
      }
    } as never,
    {
      async create(input: Record<string, unknown>) {
        return {
          id: "att-project-1",
          messageId: "msg-project-1",
          chatId: "chat-project-1",
          assistantId: assistant.id,
          workspaceId: assistant.workspaceId,
          attachmentType: "document",
          storagePath: input.storagePath,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          durationMs: input.durationMs,
          width: input.width,
          height: input.height,
          processingStatus: "ready",
          transcription: input.transcription,
          metadata: input.metadata,
          createdAt: new Date("2026-04-06T00:00:00.000Z")
        };
      }
    } as never,
    {
      async process(buffer: Buffer) {
        return {
          normalizedBuffer: buffer,
          normalizedMime: "text/plain",
          normalizedExtension: "txt",
          transcription: null,
          billingFacts: null,
          textExtract: null,
          durationMs: null,
          width: null,
          height: null
        };
      }
    } as never,
    {} as never,
    {
      buildChatMessageObjectKey() {
        return "assistant-media/assistants/assistant-1/chats/chat-project-1/messages/msg-project-1/spec.txt";
      },
      async saveObject(input: { objectKey: string; buffer: Buffer; mimeType: string }) {
        return {
          objectKey: input.objectKey,
          sizeBytes: input.buffer.length,
          mimeType: input.mimeType
        };
      }
    } as never,
    {
      async resolveActiveWebChatsLimit() {
        return 20;
      },
      async checkMediaStorageQuota() {
        return { allowed: true };
      },
      async recordMediaUpload(input: { sizeBytes: bigint }) {
        return {
          appliedDelta: input.sizeBytes,
          capped: false,
          state: {
            id: "state-project-1",
            workspaceId: assistant.workspaceId,
            tokenBudgetUsed: BigInt(0),
            tokenBudgetLimit: null,
            costOrTokenDrivingToolClassUnitsUsed: 0,
            costOrTokenDrivingToolClassUnitsLimit: null,
            activeWebChatsCurrent: 0,
            activeWebChatsLimit: null,
            mediaStorageBytesUsed: input.sizeBytes,
            mediaStorageBytesLimit: BigInt(1000),
            lastComputedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      }
    } as never,
    fakeAssistantFileRegistry as never,
    {
      async enqueueIfNeeded(input: Record<string, unknown>) {
        stageEnqueueCalls.push(input);
        return { accepted: true, reason: "queued" };
      }
    } as never,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService,
    noopPrisma
  );

  const stagedProject = await existingProjectStageService.stageForWebThread({
    userId: "user-1",
    surfaceThreadKey: "thread-project-1",
    file: {
      buffer: Buffer.from("project brief"),
      mimetype: "text/plain",
      originalname: "spec.txt"
    }
  });
  assert.equal(stagedProject.attachment.assistantFileId, "file-att-project-1");
  assert.deepEqual(stageEnqueueCalls, [
    {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatMode: "project",
      attachmentId: "att-project-1",
      assistantFileId: "file-att-project-1"
    }
  ]);

  const failureMetrics = new PlatformHttpMetricsService();
  const cappedDeletes: string[] = [];
  const cappedReleases: bigint[] = [];
  const cappedDeletedMessages: string[] = [];
  const failingService = new ManageChatMediaService(
    {
      async findByUserId() {
        return assistant;
      }
    } as never,
    {
      async getOrCreateWebChatBySurfaceThreadUnderCap() {
        return {
          outcome: "created" as const,
          chat: {
            id: "chat-1",
            assistantId: assistant.id,
            userId: assistant.userId,
            workspaceId: assistant.workspaceId,
            surface: "web",
            surfaceThreadKey: "thread-1",
            title: null,
            archivedAt: null,
            lastMessageAt: null,
            createdAt: new Date("2026-04-06T00:00:00.000Z"),
            updatedAt: new Date("2026-04-06T00:00:00.000Z")
          }
        };
      },
      async createMessage() {
        return {
          id: "msg-1",
          chatId: "chat-1",
          assistantId: assistant.id,
          author: "user",
          content: "",
          createdAt: new Date("2026-04-06T00:00:00.000Z"),
          updatedAt: new Date("2026-04-06T00:00:00.000Z")
        };
      },
      async deleteMessage(messageId: string) {
        cappedDeletedMessages.push(messageId);
        return true;
      }
    } as never,
    {
      async create() {
        throw new Error("attachment must not be created when quota caps the upload");
      }
    } as never,
    {
      async process(buffer: Buffer, mime: string) {
        return {
          normalizedBuffer: buffer,
          normalizedMime: mime,
          normalizedExtension: "png",
          transcription: null,
          billingFacts: null,
          textExtract: null,
          durationMs: null,
          width: 100,
          height: 100
        };
      }
    } as never,
    {} as never,
    {
      buildChatMessageObjectKey() {
        return "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/image.png";
      },
      async saveObject() {
        return {
          objectKey: "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/image.png",
          sizeBytes: 12,
          mimeType: "image/png"
        };
      },
      async deleteObject(objectKey: string) {
        cappedDeletes.push(objectKey);
      }
    } as never,
    {
      async resolveActiveWebChatsLimit() {
        return 20;
      },
      async checkMediaStorageQuota() {
        return { allowed: true };
      },
      async recordMediaUpload() {
        return {
          appliedDelta: BigInt(5),
          capped: true,
          state: {
            id: "state-1",
            workspaceId: assistant.workspaceId,
            tokenBudgetUsed: BigInt(0),
            tokenBudgetLimit: null,
            costOrTokenDrivingToolClassUnitsUsed: 0,
            costOrTokenDrivingToolClassUnitsLimit: null,
            activeWebChatsCurrent: 0,
            activeWebChatsLimit: null,
            mediaStorageBytesUsed: BigInt(100),
            mediaStorageBytesLimit: BigInt(100),
            lastComputedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      },
      async releaseMediaStorage(input: { sizeBytes: bigint }) {
        cappedReleases.push(input.sizeBytes);
        return {
          releasedDelta: input.sizeBytes,
          state: {
            id: "state-1",
            workspaceId: assistant.workspaceId,
            tokenBudgetUsed: BigInt(0),
            tokenBudgetLimit: null,
            costOrTokenDrivingToolClassUnitsUsed: 0,
            costOrTokenDrivingToolClassUnitsLimit: null,
            activeWebChatsCurrent: 0,
            activeWebChatsLimit: null,
            mediaStorageBytesUsed: BigInt(95),
            mediaStorageBytesLimit: BigInt(100),
            lastComputedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      }
    } as never,
    fakeAssistantFileRegistry as never,
    noopUploadMicroDescriptionJobService,
    failureMetrics,
    noopRecordModelCostLedgerService,
    noopPrisma
  );

  await assert.rejects(
    () =>
      failingService.stageForWebThread({
        userId: "user-1",
        surfaceThreadKey: "thread-1",
        file: {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
          mimetype: "image/png",
          originalname: "image.png"
        }
      }),
    (error) =>
      error instanceof ApiErrorHttpException &&
      error.errorObject.code === "media_storage_quota_exceeded"
  );
  assert.deepEqual(cappedDeletes, [
    "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/image.png"
  ]);
  assert.deepEqual(cappedReleases, [BigInt(5)]);
  assert.deepEqual(cappedDeletedMessages, ["msg-1"]);
  const failureSeries = failureMetrics
    .getSnapshot()
    .mediaStageSeries.find(
      (series) =>
        series.key.stage === "web_stage_attachment" &&
        series.key.channel === "web" &&
        series.key.outcome === "failure"
    );
  assert.equal(failureSeries?.count, 1);

  const storageFailureMetrics = new PlatformHttpMetricsService();
  const storageFailureDeletes: string[] = [];
  const storageFailureReleases: bigint[] = [];
  const storageFailureDeletedMessages: string[] = [];
  const storageFailureService = new ManageChatMediaService(
    {
      async findByUserId() {
        return assistant;
      }
    } as never,
    {
      async getOrCreateWebChatBySurfaceThreadUnderCap() {
        return {
          outcome: "created" as const,
          chat: {
            id: "chat-1",
            assistantId: assistant.id,
            userId: assistant.userId,
            workspaceId: assistant.workspaceId,
            surface: "web",
            surfaceThreadKey: "thread-1",
            title: null,
            archivedAt: null,
            lastMessageAt: null,
            createdAt: new Date("2026-04-06T00:00:00.000Z"),
            updatedAt: new Date("2026-04-06T00:00:00.000Z")
          }
        };
      },
      async createMessage() {
        return {
          id: "msg-1",
          chatId: "chat-1",
          assistantId: assistant.id,
          author: "user",
          content: "",
          createdAt: new Date("2026-04-06T00:00:00.000Z"),
          updatedAt: new Date("2026-04-06T00:00:00.000Z")
        };
      },
      async deleteMessage(messageId: string) {
        storageFailureDeletedMessages.push(messageId);
        return true;
      }
    } as never,
    {
      async create() {
        throw new Error("attachment must not be created when storage save fails");
      }
    } as never,
    {
      async process(buffer: Buffer, mime: string) {
        return {
          normalizedBuffer: buffer,
          normalizedMime: mime,
          normalizedExtension: "png",
          transcription: null,
          billingFacts: null,
          textExtract: null,
          durationMs: null,
          width: 100,
          height: 100
        };
      }
    } as never,
    {} as never,
    {
      buildChatMessageObjectKey() {
        return "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/image.png";
      },
      async saveObject() {
        throw new Error("storage.objects.create denied");
      },
      async deleteObject(objectKey: string) {
        storageFailureDeletes.push(objectKey);
      }
    } as never,
    {
      async resolveActiveWebChatsLimit() {
        return 20;
      },
      async checkMediaStorageQuota() {
        return { allowed: true };
      },
      async recordMediaUpload() {
        throw new Error("quota usage must not be recorded when storage save fails");
      },
      async releaseMediaStorage(input: { sizeBytes: bigint }) {
        storageFailureReleases.push(input.sizeBytes);
        return {
          releasedDelta: input.sizeBytes,
          state: {
            id: "state-1",
            workspaceId: assistant.workspaceId,
            tokenBudgetUsed: BigInt(0),
            tokenBudgetLimit: null,
            costOrTokenDrivingToolClassUnitsUsed: 0,
            costOrTokenDrivingToolClassUnitsLimit: null,
            activeWebChatsCurrent: 0,
            activeWebChatsLimit: null,
            mediaStorageBytesUsed: BigInt(0),
            mediaStorageBytesLimit: BigInt(1000),
            lastComputedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      }
    } as never,
    fakeAssistantFileRegistry as never,
    noopUploadMicroDescriptionJobService,
    storageFailureMetrics,
    noopRecordModelCostLedgerService,
    noopPrisma
  );

  await assert.rejects(
    () =>
      storageFailureService.stageForWebThread({
        userId: "user-1",
        surfaceThreadKey: "thread-1",
        file: {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
          mimetype: "image/png",
          originalname: "image.png"
        }
      }),
    (error) => error instanceof Error && error.message === "storage.objects.create denied"
  );
  assert.deepEqual(storageFailureDeletes, []);
  assert.deepEqual(storageFailureReleases, []);
  assert.deepEqual(storageFailureDeletedMessages, ["msg-1"]);
  const storageFailureSeries = storageFailureMetrics
    .getSnapshot()
    .mediaStageSeries.find(
      (series) =>
        series.key.stage === "web_stage_attachment" &&
        series.key.channel === "web" &&
        series.key.outcome === "failure"
    );
  assert.equal(storageFailureSeries?.count, 1);

  await assert.rejects(
    () =>
      new ManageChatMediaService(
        {
          async findByUserId() {
            return assistant;
          }
        } as never,
        {
          async getOrCreateWebChatBySurfaceThreadUnderCap() {
            return {
              outcome: "cap_reached" as const,
              activeCount: 20,
              limit: 20
            };
          }
        } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {
          async resolveActiveWebChatsLimit() {
            return 20;
          }
        } as never,
        fakeAssistantFileRegistry as never,
        noopUploadMicroDescriptionJobService,
        new PlatformHttpMetricsService(),
        noopRecordModelCostLedgerService,
        noopPrisma
      ).stageForWebThread({
        userId: "user-1",
        surfaceThreadKey: "thread-cap",
        file: {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
          mimetype: "image/png",
          originalname: "image.png"
        }
      }),
    (error: unknown) =>
      error instanceof Error &&
      "errorObject" in error &&
      typeof error.errorObject === "object" &&
      error.errorObject !== null &&
      "code" in error.errorObject &&
      error.errorObject.code === "active_chat_cap_reached"
  );
}

void run();
