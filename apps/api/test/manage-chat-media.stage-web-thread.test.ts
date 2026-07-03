import assert from "node:assert/strict";
import { NotFoundException } from "@nestjs/common";
import { PlatformHttpMetricsService } from "../src/modules/platform-core/application/platform-http-metrics.service";

const noopRecordModelCostLedgerService = {
  async recordPersistedBillingFactsEvent() {
    return 0;
  }
} as never;

// ADR-126 v3 amendment (2026-06-25): manage-chat-media now plumbs uploaded
// inbound bytes into the running pod via the sandbox control plane. The hop
// is best-effort and never throws, so the tests stub it out with a no-op
// "deferred" response (matches the "sandbox not configured" production path).
const noopSandboxControlPlaneClient = {
  isConfigured() {
    return false;
  },
  async pushWorkspaceFileBytes() {
    return { mode: "deferred" as const, reason: "not_configured" as const };
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
  handle: "assistant-1",
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

let lastRegisterChatAttachmentInput: Record<string, unknown> | null = null;
const fakeRegisterChatAttachmentService = {
  async execute(input: Record<string, unknown>) {
    lastRegisterChatAttachmentInput = input;
    return { attachmentId: `att-${String(input.messageId ?? "unknown")}` };
  }
};
const fakeWorkspaceFileMetadataService = {
  async get() {
    return null;
  },
  async upsert() {
    return undefined;
  }
};

function buildAttachmentFromRegisterInput(
  attachmentId: string,
  overrides: Record<string, unknown> = {}
) {
  const input = lastRegisterChatAttachmentInput ?? {};
  return {
    id: attachmentId,
    messageId: input.messageId ?? "msg-direct-1",
    chatId: input.chatId ?? "chat-1",
    assistantId: input.assistantId ?? assistant.id,
    workspaceId: input.workspaceId ?? assistant.workspaceId,
    attachmentType: input.attachmentType ?? "document",
    storagePath: input.storagePath ?? "/workspace/assistants/assistant-1/sessions/chat-1/note.txt",
    originalFilename: input.originalFilename ?? "note.txt",
    mimeType: input.mimeType ?? "text/plain",
    sizeBytes: BigInt(Number(input.sizeBytes ?? 0)),
    durationMs: input.durationMs ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    processingStatus: "ready",
    transcription: input.transcription ?? null,
    metadata: input.metadata ?? null,
    clientTurnId: null,
    clientAttachmentId: null,
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    ...overrides
  };
}

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-api-token";
  process.env.WEB_ACTIVE_CHATS_CAP = "20";
  process.env.QUOTA_TOKEN_BUDGET_DEFAULT = "100";
  process.env.QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT = "3";

  let videoUploadCreateInput: Record<string, unknown> | null = null;
  lastRegisterChatAttachmentInput = null;
  const directUploadService = new ManageChatMediaService(
    {
      async execute({ userId }: { userId: string }) {
        if (userId !== "user-1") {
          throw new Error("assistant not found");
        }
        return { assistantId: assistant.id, assistant };
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
      async findById(id: string) {
        return buildAttachmentFromRegisterInput(id);
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
      buildWorkspaceObjectKey(input: { workspaceId: string; workspaceRelPath: string }) {
        return `workspaces/${input.workspaceId}${input.workspaceRelPath}`;
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
    fakeRegisterChatAttachmentService as never,
    fakeWorkspaceFileMetadataService as never,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService,
    noopSandboxControlPlaneClient,
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

  assert.equal(directUpload.mimeType, "text/plain");
  assert.equal(directUpload.storagePath, lastRegisterChatAttachmentInput?.storagePath);
  assert.equal(
    directUpload.storagePath,
    "/workspace/assistants/assistant-1/sessions/chat-1/note.txt"
  );
  assert.deepEqual(lastRegisterChatAttachmentInput?.metadata, {
    source: "chat_upload",
    contentPreview: "line one line two",
    semanticSummary: "line one line two",
    semanticSummarySource: "text_extract"
  });
  assert.deepEqual(lastRegisterChatAttachmentInput?.shortDescription, "line one line two");
  assert.deepEqual(lastRegisterChatAttachmentInput?.billingFacts, {
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

  const videoUploadService = new ManageChatMediaService(
    {
      async execute({ userId }: { userId: string }) {
        if (userId !== "user-1") {
          throw new Error("assistant not found");
        }
        return { assistantId: assistant.id, assistant };
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
      async findById(id: string) {
        videoUploadCreateInput = lastRegisterChatAttachmentInput;
        return buildAttachmentFromRegisterInput(id, {
          messageId: "msg-video-1",
          attachmentType: "video"
        });
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
      buildWorkspaceObjectKey(input: { workspaceId: string; workspaceRelPath: string }) {
        return `workspaces/${input.workspaceId}${input.workspaceRelPath}`;
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
    fakeRegisterChatAttachmentService as never,
    fakeWorkspaceFileMetadataService as never,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService,
    noopSandboxControlPlaneClient,
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
  assert.deepEqual(lastRegisterChatAttachmentInput?.shortDescription, "hello from video");

  const metrics = new PlatformHttpMetricsService();
  const deletedStagingMessageIds: string[] = [];
  const deletedStoragePaths: string[] = [];
  const releasedBytes: bigint[] = [];
  const hotPushInputs: Array<Record<string, unknown>> = [];
  const spySandboxControlPlaneClient = {
    isConfigured() {
      return true;
    },
    async pushWorkspaceFileBytes(input: Record<string, unknown>) {
      hotPushInputs.push(input);
      return { mode: "written" as const, reason: null };
    }
  } as never;
  const service = new ManageChatMediaService(
    {
      async execute({ userId }: { userId: string }) {
        if (userId !== "user-1") {
          throw new Error("assistant not found");
        }
        return { assistantId: assistant.id, assistant };
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
      async findById(id: string) {
        return buildAttachmentFromRegisterInput(id, {
          messageId: "msg-1",
          attachmentType: "image",
          width: 100,
          height: 100
        });
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
      buildWorkspaceObjectKey(input: { workspaceId: string; workspaceRelPath: string }) {
        return `workspaces/${input.workspaceId}${input.workspaceRelPath}`;
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
    fakeRegisterChatAttachmentService as never,
    fakeWorkspaceFileMetadataService as never,
    metrics,
    noopRecordModelCostLedgerService,
    spySandboxControlPlaneClient,
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
  assert.equal(staged.attachment.storagePath, lastRegisterChatAttachmentInput?.storagePath);
  assert.equal(
    staged.attachment.storagePath,
    "/workspace/assistants/assistant-1/sessions/chat-1/image.png"
  );
  assert.equal(hotPushInputs.length, 1);
  assert.equal(hotPushInputs[0]?.storagePath, staged.attachment.storagePath);
  assert.equal(hotPushInputs[0]?.basename, "image.png");
  assert.equal(Object.hasOwn(hotPushInputs[0] ?? {}, "contents"), false);
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

  const existingProjectStageService = new ManageChatMediaService(
    {
      async execute() {
        return { assistantId: assistant.id, assistant };
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
      async findById(id: string) {
        return buildAttachmentFromRegisterInput(id, {
          messageId: "msg-project-1",
          chatId: "chat-project-1",
          attachmentType: "document"
        });
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
      buildWorkspaceObjectKey(input: { workspaceId: string; workspaceRelPath: string }) {
        return `workspaces/${input.workspaceId}${input.workspaceRelPath}`;
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
    fakeRegisterChatAttachmentService as never,
    fakeWorkspaceFileMetadataService as never,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService,
    noopSandboxControlPlaneClient,
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
  assert.equal(stagedProject.attachment.storagePath, lastRegisterChatAttachmentInput?.storagePath);
  assert.equal(
    stagedProject.attachment.storagePath,
    "/workspace/assistants/assistant-1/sessions/chat-project-1/spec.txt"
  );

  const failureMetrics = new PlatformHttpMetricsService();
  const cappedDeletes: string[] = [];
  const cappedReleases: bigint[] = [];
  const cappedDeletedMessages: string[] = [];
  const failingService = new ManageChatMediaService(
    {
      async execute() {
        return { assistantId: assistant.id, assistant };
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
      buildWorkspaceObjectKey(input: { workspaceId: string; workspaceRelPath: string }) {
        return `workspaces/${input.workspaceId}${input.workspaceRelPath}`;
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
    fakeRegisterChatAttachmentService as never,
    fakeWorkspaceFileMetadataService as never,
    failureMetrics,
    noopRecordModelCostLedgerService,
    noopSandboxControlPlaneClient,
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
      async execute() {
        return { assistantId: assistant.id, assistant };
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
      buildWorkspaceObjectKey(input: { workspaceId: string; workspaceRelPath: string }) {
        return `workspaces/${input.workspaceId}${input.workspaceRelPath}`;
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
    fakeRegisterChatAttachmentService as never,
    fakeWorkspaceFileMetadataService as never,
    storageFailureMetrics,
    noopRecordModelCostLedgerService,
    noopSandboxControlPlaneClient,
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
          async execute() {
            return { assistantId: assistant.id, assistant };
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
        fakeRegisterChatAttachmentService as never,
        fakeWorkspaceFileMetadataService as never,
        new PlatformHttpMetricsService(),
        noopRecordModelCostLedgerService,
        noopSandboxControlPlaneClient,
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

  await assert.rejects(
    () =>
      new ManageChatMediaService(
        {
          async execute() {
            return { assistantId: assistant.id, assistant };
          }
        } as never,
        {
          async findChatById() {
            return {
              id: "chat-b",
              assistantId: "assistant-b",
              userId: assistant.userId,
              workspaceId: assistant.workspaceId,
              surface: "web",
              surfaceThreadKey: "thread-b",
              title: null,
              archivedAt: null,
              lastMessageAt: null,
              createdAt: new Date("2026-04-06T00:00:00.000Z"),
              updatedAt: new Date("2026-04-06T00:00:00.000Z")
            };
          }
        } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        fakeRegisterChatAttachmentService as never,
        fakeWorkspaceFileMetadataService as never,
        new PlatformHttpMetricsService(),
        noopRecordModelCostLedgerService,
        noopSandboxControlPlaneClient,
        noopPrisma
      ).uploadAttachment({
        userId: "user-1",
        chatId: "chat-b",
        messageId: "msg-b",
        file: {
          buffer: Buffer.from("cross-assistant"),
          mimetype: "text/plain",
          originalname: "cross.txt"
        }
      }),
    (error) =>
      error instanceof NotFoundException &&
      error.message === "Chat does not exist for this assistant."
  );
}

void run();
