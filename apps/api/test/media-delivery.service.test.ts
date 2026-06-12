import assert from "node:assert/strict";
import { PlatformHttpMetricsService } from "../src/modules/platform-core/application/platform-http-metrics.service";

const noopRecordModelCostLedgerService = {
  async recordPersistedBillingFactsEvent() {
    return 0;
  }
} as never;
import { MediaDeliveryService } from "../src/modules/workspace-management/application/media/media-delivery.service";
import type { AssistantChatMessageAttachment } from "../src/modules/workspace-management/domain/assistant-chat-message-attachment.entity";

function createAttachment(
  overrides: Partial<AssistantChatMessageAttachment>
): AssistantChatMessageAttachment {
  return {
    id: "att-1",
    messageId: "msg-1",
    chatId: "chat-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    assistantFileId: null,
    attachmentType: "document",
    storagePath: "chat/out.bin",
    originalFilename: "out.bin",
    mimeType: "application/octet-stream",
    sizeBytes: BigInt(1),
    durationMs: null,
    width: null,
    height: null,
    processingStatus: "ready",
    transcription: null,
    billingFacts: null,
    metadata: null,
    createdAt: new Date("2026-04-04T00:00:00.000Z"),
    ...overrides
  };
}

const fakeAssistantFileRegistry = {
  async ensureAttachmentFile(input: { sourceAttachmentId: string }) {
    return { fileRef: `file-${input.sourceAttachmentId}` };
  },
  async linkAttachmentToExistingFile() {
    return undefined;
  },
  async ensureMediaDerivativeTracking() {
    return undefined;
  }
};

const enqueuedGeneratedSummaryJobs: Array<{
  assistantId: string;
  workspaceId: string;
  assistantFileId: string | null | undefined;
  attachmentId: string | null | undefined;
}> = [];

const fakeUploadMicroDescriptionJobService = {
  async enqueueGeneratedFileIfNeeded(input: {
    assistantId: string;
    workspaceId: string;
    assistantFileId: string | null | undefined;
    attachmentId: string | null | undefined;
  }) {
    enqueuedGeneratedSummaryJobs.push(input);
    return { accepted: true, reason: "queued" };
  }
};

const noopAssistantRepository = {
  async findById() {
    return null;
  }
};

const noopQuotaUsageService = {
  async settleAssistantMonthlyMediaQuota() {},
  async markAssistantMonthlyMediaQuotaReconciliationRequired() {}
};

async function run(): Promise<void> {
  const originalFetch = globalThis.fetch;
  let uploadCalls = 0;
  let createCalls = 0;
  const blockedMetrics = new PlatformHttpMetricsService();

  const blockedService = new MediaDeliveryService(
    {
      async create() {
        createCalls += 1;
        return createAttachment({});
      }
    } as never,
    noopAssistantRepository as never,
    [],
    {
      buildChatMessageObjectKey() {
        return "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/blocked.js";
      },
      async saveObject() {
        uploadCalls += 1;
        return {
          objectKey:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/blocked.js",
          sizeBytes: 19,
          mimeType: "text/javascript"
        };
      }
    } as never,
    fakeAssistantFileRegistry as never,
    fakeUploadMicroDescriptionJobService as never,
    noopQuotaUsageService as never,
    blockedMetrics,
    noopRecordModelCostLedgerService
  );

  globalThis.fetch = async () =>
    new Response(Buffer.from("console.log('x');"), {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" }
    });
  const blocked = await blockedService.deliver({
    artifacts: [
      {
        source: "runtime_url",
        url: "https://media.example/reports/payload.js",
        type: "document"
      }
    ],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });

  assert.deepEqual(blocked.attachments, []);
  assert.equal(uploadCalls, 0);
  assert.equal(createCalls, 0);
  const blockedSeries = blockedMetrics
    .getSnapshot()
    .mediaStageSeries.find(
      (series) =>
        series.key.stage === "delivery_persist" &&
        series.key.channel === "web" &&
        series.key.outcome === "failure"
    );
  assert.equal(blockedSeries?.count, 1);

  let uploadedMime: string | null = null;
  const safeMetrics = new PlatformHttpMetricsService();
  const safeService = new MediaDeliveryService(
    {
      async create(input: {
        storagePath: string;
        originalFilename: string | null;
        mimeType: string;
        sizeBytes: bigint;
      }) {
        return createAttachment({
          storagePath: input.storagePath,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes
        });
      }
    } as never,
    noopAssistantRepository as never,
    [],
    {
      buildChatMessageObjectKey() {
        return "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/render.png";
      },
      async saveObject(input: { mimeType: string; buffer: Buffer }) {
        uploadedMime = input.mimeType;
        return {
          objectKey:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/render.png",
          sizeBytes: input.buffer.length,
          mimeType: input.mimeType
        };
      }
    } as never,
    fakeAssistantFileRegistry as never,
    fakeUploadMicroDescriptionJobService as never,
    noopQuotaUsageService as never,
    safeMetrics,
    noopRecordModelCostLedgerService
  );

  globalThis.fetch = async () =>
    new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" }
    });
  const delivered = await safeService.deliver({
    artifacts: [
      {
        source: "runtime_url",
        url: "https://media.example/images/render.png",
        type: "image"
      }
    ],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });

  assert.equal(uploadedMime, "image/png");
  assert.equal(delivered.attachments.length, 1);
  assert.equal(delivered.attachments[0]?.fileRef, "file-att-1");
  assert.equal(delivered.attachments[0]?.mimeType, "image/png");
  assert.equal(delivered.attachments[0]?.originalFilename, "render.png");
  assert.equal(enqueuedGeneratedSummaryJobs.length, 0);
  const successSeries = safeMetrics
    .getSnapshot()
    .mediaStageSeries.find(
      (series) =>
        series.key.stage === "delivery_persist" &&
        series.key.channel === "web" &&
        series.key.outcome === "success"
    );
  assert.equal(successSeries?.count, 1);

  let objectDownloadCalls = 0;
  let deletedObjectKey: string | null = null;
  const nativeMetrics = new PlatformHttpMetricsService();
  const nativeService = new MediaDeliveryService(
    {
      async create(input: {
        storagePath: string;
        originalFilename: string | null;
        mimeType: string;
        sizeBytes: bigint;
      }) {
        return createAttachment({
          storagePath: input.storagePath,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes
        });
      }
    } as never,
    noopAssistantRepository as never,
    [],
    {
      buildChatMessageObjectKey() {
        return "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/generated.png";
      },
      async downloadObject(objectKey: string) {
        objectDownloadCalls += 1;
        assert.equal(objectKey, "assistant-media/runtime-output/generated.png");
        return {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
          contentType: "image/png"
        };
      },
      async saveObject(input: { mimeType: string; buffer: Buffer }) {
        return {
          objectKey:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/generated.png",
          sizeBytes: input.buffer.length,
          mimeType: input.mimeType
        };
      },
      async deleteObject(objectKey: string) {
        deletedObjectKey = objectKey;
      }
    } as never,
    fakeAssistantFileRegistry as never,
    fakeUploadMicroDescriptionJobService as never,
    noopQuotaUsageService as never,
    nativeMetrics,
    noopRecordModelCostLedgerService
  );

  enqueuedGeneratedSummaryJobs.length = 0;
  const nativeDelivered = await nativeService.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: "assistant-media/runtime-output/generated.png",
        type: "image",
        mimeType: "image/png",
        filename: "generated.png",
        sizeBytes: 9
      }
    ],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });

  assert.equal(objectDownloadCalls, 1);
  assert.equal(deletedObjectKey, "assistant-media/runtime-output/generated.png");
  assert.equal(nativeDelivered.attachments.length, 1);
  assert.equal(nativeDelivered.attachments[0]?.originalFilename, "generated.png");
  assert.deepEqual(enqueuedGeneratedSummaryJobs, [
    {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      assistantFileId: "file-att-1",
      attachmentId: "att-1"
    }
  ]);

  let deliveredImageBillingFacts: unknown = undefined;
  let deliveredTtsBillingFacts: unknown = undefined;
  const billingFactsService = new MediaDeliveryService(
    {
      async create(input: {
        storagePath: string;
        originalFilename: string | null;
        mimeType: string;
        sizeBytes: bigint;
        billingFacts?: unknown;
      }) {
        if (input.mimeType.startsWith("image/")) {
          deliveredImageBillingFacts = input.billingFacts;
        } else if (input.mimeType.startsWith("audio/")) {
          deliveredTtsBillingFacts = input.billingFacts;
        }
        return createAttachment({
          storagePath: input.storagePath,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          billingFacts:
            (input.billingFacts as AssistantChatMessageAttachment["billingFacts"]) ?? null
        });
      }
    } as never,
    noopAssistantRepository as never,
    [],
    {
      buildChatMessageObjectKey() {
        return "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/generated-output.bin";
      },
      async downloadObject(objectKey: string) {
        if (objectKey.endsWith(".png")) {
          return {
            buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
            contentType: "image/png"
          };
        }
        return {
          buffer: Buffer.from("audio-output"),
          contentType: "audio/mpeg"
        };
      },
      async saveObject(input: { mimeType: string; buffer: Buffer }) {
        return {
          objectKey: `assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/${
            input.mimeType.startsWith("image/") ? "generated.png" : "generated.mp3"
          }`,
          sizeBytes: input.buffer.length,
          mimeType: input.mimeType
        };
      },
      async deleteObject() {}
    } as never,
    fakeAssistantFileRegistry as never,
    fakeUploadMicroDescriptionJobService as never,
    noopQuotaUsageService as never,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService
  );

  await billingFactsService.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: "assistant-media/runtime-output/generated.png",
        type: "image",
        sourceToolCode: "image_generate",
        mimeType: "image/png",
        filename: "generated.png",
        sizeBytes: 9,
        billingFacts: {
          providerKey: "openai",
          modelKey: "gpt-image-1",
          capability: "image",
          occurredAt: "2026-05-05T09:05:00.000Z",
          metering: {
            meteringKind: "token_metered",
            inputTokens: 30,
            cachedInputTokens: null,
            outputTokens: 60,
            totalTokens: 90,
            dimensions: { operation: "generate" }
          }
        }
      },
      {
        source: "persai_object_storage",
        objectKey: "assistant-media/runtime-output/generated.mp3",
        type: "audio",
        sourceToolCode: "tts",
        mimeType: "audio/mpeg",
        filename: "generated.mp3",
        sizeBytes: 12,
        billingFacts: {
          providerKey: "openai",
          modelKey: "gpt-4o-mini-tts",
          capability: "text_to_speech",
          occurredAt: "2026-05-05T09:06:00.000Z",
          metering: {
            meteringKind: "text_chars_metered",
            textChars: 120
          }
        }
      }
    ],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });

  assert.equal(deliveredImageBillingFacts, null);
  assert.deepEqual(deliveredTtsBillingFacts, {
    providerKey: "openai",
    modelKey: "gpt-4o-mini-tts",
    capability: "text_to_speech",
    occurredAt: "2026-05-05T09:06:00.000Z",
    metering: {
      meteringKind: "text_chars_metered",
      textChars: 120
    }
  });

  const existingFileLinks: Array<{ sourceAttachmentId: string; fileRef: string }> = [];
  const existingFileRefService = new MediaDeliveryService(
    {
      async create(input: {
        storagePath: string;
        originalFilename: string | null;
        mimeType: string;
        sizeBytes: bigint;
      }) {
        return createAttachment({
          storagePath: input.storagePath,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes
        });
      }
    } as never,
    noopAssistantRepository as never,
    [],
    {
      buildChatMessageObjectKey() {
        return "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/generated-existing.png";
      },
      async downloadObject() {
        return {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
          contentType: "image/png"
        };
      },
      async saveObject(input: { mimeType: string; buffer: Buffer }) {
        return {
          objectKey:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/generated-existing.png",
          sizeBytes: input.buffer.length,
          mimeType: input.mimeType
        };
      },
      async deleteObject() {}
    } as never,
    {
      async ensureAttachmentFile() {
        throw new Error("existing generated fileRef should not create a duplicate file row");
      },
      async linkAttachmentToExistingFile(input: { sourceAttachmentId: string; fileRef: string }) {
        existingFileLinks.push(input);
      },
      async ensureMediaDerivativeTracking() {
        return undefined;
      }
    } as never,
    fakeUploadMicroDescriptionJobService as never,
    noopQuotaUsageService as never,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService
  );

  const existingFileDelivered = await existingFileRefService.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: "assistant-media/runtime-output/generated-existing.png",
        fileRef: "existing-file-ref-1",
        type: "image",
        mimeType: "image/png",
        filename: "generated-existing.png",
        sizeBytes: 9
      }
    ],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });

  assert.equal(existingFileDelivered.attachments[0]?.fileRef, "existing-file-ref-1");
  assert.deepEqual(existingFileLinks, [
    {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      sourceAttachmentId: "att-1",
      fileRef: "existing-file-ref-1"
    }
  ]);
  assert.deepEqual(enqueuedGeneratedSummaryJobs.at(-1), {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    assistantFileId: "existing-file-ref-1",
    attachmentId: "att-1"
  });

  let persistedAttachmentDeletedObjectKey: string | null = null;
  const persistedAttachmentService = new MediaDeliveryService(
    {
      async create(input: {
        storagePath: string;
        originalFilename: string | null;
        mimeType: string;
        sizeBytes: bigint;
      }) {
        return createAttachment({
          storagePath: input.storagePath,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes
        });
      }
    } as never,
    noopAssistantRepository as never,
    [],
    {
      buildChatMessageObjectKey() {
        return "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/copied.png";
      },
      async downloadObject(objectKey: string) {
        assert.equal(
          objectKey,
          "assistant-media/assistants/assistant-1/chats/chat-older/messages/msg-older/original.png"
        );
        return {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
          contentType: "image/png"
        };
      },
      async saveObject(input: { mimeType: string; buffer: Buffer }) {
        return {
          objectKey:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/copied.png",
          sizeBytes: input.buffer.length,
          mimeType: input.mimeType
        };
      },
      async deleteObject(objectKey: string) {
        persistedAttachmentDeletedObjectKey = objectKey;
      }
    } as never,
    fakeAssistantFileRegistry as never,
    fakeUploadMicroDescriptionJobService as never,
    noopQuotaUsageService as never,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService
  );

  const persistedAttachmentDelivered = await persistedAttachmentService.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey:
          "assistant-media/assistants/assistant-1/chats/chat-older/messages/msg-older/original.png",
        type: "image",
        mimeType: "image/png",
        filename: "original.png",
        sizeBytes: 9
      }
    ],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });

  assert.equal(persistedAttachmentDeletedObjectKey, null);
  assert.equal(persistedAttachmentDelivered.attachments.length, 1);
  assert.equal(persistedAttachmentDelivered.attachments[0]?.originalFilename, "original.png");

  let adapterTarget: {
    channel: string;
    chatId: string | number;
    metadata?: Record<string, unknown>;
  } | null = null;
  let adapterCaption: string | undefined;
  const adapterService = new MediaDeliveryService(
    {
      async create(input: {
        storagePath: string;
        originalFilename: string | null;
        mimeType: string;
        sizeBytes: bigint;
      }) {
        return createAttachment({
          storagePath: input.storagePath,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes
        });
      }
    } as never,
    noopAssistantRepository as never,
    [
      {
        channel: "telegram",
        async sendImage(target, _buffer, _filename, caption) {
          adapterTarget = target;
          adapterCaption = caption;
        },
        async sendVoice() {},
        async sendAudio() {},
        async sendDocument() {},
        async sendVideo() {}
      }
    ],
    {
      buildChatMessageObjectKey() {
        return "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/telegram.png";
      },
      async downloadObject(objectKey: string) {
        assert.equal(objectKey, "assistant-media/runtime-output/telegram.png");
        return {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
          contentType: "image/png"
        };
      },
      async saveObject(input: { mimeType: string; buffer: Buffer }) {
        return {
          objectKey:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/telegram.png",
          sizeBytes: input.buffer.length,
          mimeType: input.mimeType
        };
      },
      async deleteObject() {}
    } as never,
    fakeAssistantFileRegistry as never,
    fakeUploadMicroDescriptionJobService as never,
    noopQuotaUsageService as never,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService
  );

  await adapterService.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: "assistant-media/runtime-output/telegram.png",
        type: "image",
        mimeType: "image/png",
        filename: "telegram.png",
        sizeBytes: 9,
        caption: "Runtime caption"
      }
    ],
    channel: "telegram",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1",
    channelTarget: {
      channel: "telegram",
      chatId: "tg-chat-1",
      metadata: {
        botToken: "bot-token"
      }
    }
  });

  assert.deepEqual(adapterTarget, {
    channel: "telegram",
    chatId: "tg-chat-1",
    metadata: {
      botToken: "bot-token"
    }
  });
  assert.equal(adapterCaption, "Runtime caption");

  const monthlyQuotaCalls: Array<{ operation: "settle" | "reconcile"; toolCode: string }> = [];
  const settlementAwareAssistantRepository = {
    async findById() {
      return {
        id: "assistant-1",
        userId: "user-1",
        workspaceId: "workspace-1",
        draftDisplayName: null,
        draftInstructions: null,
        draftUpdatedAt: null,
        applyStatus: "succeeded",
        applyTargetVersionId: null,
        applyAppliedVersionId: null,
        applyRequestedAt: null,
        applyStartedAt: null,
        applyFinishedAt: null,
        applyErrorCode: null,
        applyErrorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }
  };
  const settlementAwareQuotaUsageService = {
    async settleAssistantMonthlyMediaQuota(input: { toolCode: string }) {
      monthlyQuotaCalls.push({ operation: "settle", toolCode: input.toolCode });
    },
    async markAssistantMonthlyMediaQuotaReconciliationRequired(input: { toolCode: string }) {
      monthlyQuotaCalls.push({ operation: "reconcile", toolCode: input.toolCode });
    }
  };
  const settlementAwareObjectStorage = {
    buildChatMessageObjectKey() {
      return "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/settled.png";
    },
    async downloadObject() {
      return {
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
        contentType: "image/png"
      };
    },
    async saveObject(input: { mimeType: string; buffer: Buffer }) {
      return {
        objectKey: "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/settled.png",
        sizeBytes: input.buffer.length,
        mimeType: input.mimeType
      };
    },
    async deleteObject() {}
  };
  const settlementAwareAttachmentRepository = {
    async create(input: {
      storagePath: string;
      originalFilename: string | null;
      mimeType: string;
      sizeBytes: bigint;
    }) {
      return createAttachment({
        storagePath: input.storagePath,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes
      });
    }
  };
  const deliveredSettlementService = new MediaDeliveryService(
    settlementAwareAttachmentRepository as never,
    settlementAwareAssistantRepository as never,
    [],
    settlementAwareObjectStorage as never,
    fakeAssistantFileRegistry as never,
    fakeUploadMicroDescriptionJobService as never,
    settlementAwareQuotaUsageService as never,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService
  );
  await deliveredSettlementService.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: "assistant-media/runtime-output/settled.png",
        type: "image",
        sourceToolCode: "image_generate",
        mimeType: "image/png",
        filename: "settled.png",
        sizeBytes: 9
      }
    ],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });
  const failedSettlementService = new MediaDeliveryService(
    settlementAwareAttachmentRepository as never,
    settlementAwareAssistantRepository as never,
    [
      {
        channel: "telegram",
        async sendImage() {
          throw new Error("telegram unavailable");
        },
        async sendVoice() {},
        async sendAudio() {},
        async sendDocument() {},
        async sendVideo() {}
      }
    ],
    settlementAwareObjectStorage as never,
    fakeAssistantFileRegistry as never,
    fakeUploadMicroDescriptionJobService as never,
    settlementAwareQuotaUsageService as never,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService
  );
  await failedSettlementService.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: "assistant-media/runtime-output/reconcile.png",
        type: "image",
        sourceToolCode: "image_edit",
        mimeType: "image/png",
        filename: "reconcile.png",
        sizeBytes: 9
      }
    ],
    channel: "telegram",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1",
    channelTarget: {
      channel: "telegram",
      chatId: "tg-chat-1"
    }
  });
  assert.deepEqual(monthlyQuotaCalls, [
    { operation: "settle", toolCode: "image_generate" },
    { operation: "reconcile", toolCode: "image_edit" }
  ]);
  await failedSettlementService.markUndeliveredArtifactsReconciliationRequired({
    assistantId: "assistant-1",
    reason: "test_delivery_not_called",
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: "assistant-media/runtime-output/not-delivered.png",
        type: "image",
        sourceToolCode: "image_generate",
        mimeType: "image/png",
        filename: "not-delivered.png",
        sizeBytes: 9
      },
      {
        source: "persai_object_storage",
        objectKey: "assistant-media/runtime-output/ignored.png",
        type: "image",
        mimeType: "image/png",
        filename: "ignored.png",
        sizeBytes: 9
      }
    ]
  });
  assert.deepEqual(monthlyQuotaCalls, [
    { operation: "settle", toolCode: "image_generate" },
    { operation: "reconcile", toolCode: "image_edit" },
    { operation: "reconcile", toolCode: "image_generate" }
  ]);
  // ADR-108 Slice 8 — `settleUserStoppedArtifacts` for `video_generate`
  // is a no-op on the legacy unit-counter; the VC wallet is the SOLE
  // surface and there is no per-unit refund to issue. Below we confirm
  // the legacy settle list is unchanged after a video-only call.
  await failedSettlementService.settleUserStoppedArtifacts({
    assistantId: "assistant-1",
    reason: "test_user_stop",
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: "assistant-media/runtime-output/user-stopped.png",
        type: "image",
        sourceToolCode: "video_generate",
        mimeType: "image/png",
        filename: "user-stopped.png",
        sizeBytes: 9
      }
    ]
  });
  assert.deepEqual(monthlyQuotaCalls, [
    { operation: "settle", toolCode: "image_generate" },
    { operation: "reconcile", toolCode: "image_edit" },
    { operation: "reconcile", toolCode: "image_generate" }
  ]);
  globalThis.fetch = originalFetch;
}

void run();
