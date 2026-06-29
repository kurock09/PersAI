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
    storagePath: "/workspace/out.bin",
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

const registeredAttachments = new Map<string, AssistantChatMessageAttachment>();

const fakeRegisterChatAttachmentService = {
  async execute(input: {
    storagePath: string;
    mimeType: string;
    originalFilename: string;
    sizeBytes: number;
    attachmentType: string;
  }) {
    const attachment = createAttachment({
      storagePath: input.storagePath,
      mimeType: input.mimeType,
      originalFilename: input.originalFilename,
      sizeBytes: BigInt(input.sizeBytes),
      attachmentType: input.attachmentType as AssistantChatMessageAttachment["attachmentType"]
    });
    registeredAttachments.set(attachment.id, attachment);
    return { attachmentId: attachment.id, storagePath: input.storagePath };
  }
};

function attachmentRepositoryWithRegisterLookup() {
  return {
    async findById(id: string) {
      return registeredAttachments.get(id) ?? null;
    }
  };
}

const fakeWorkspaceFileMetadataService = {
  async upsert() {},
  async get() {
    return null;
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

function fakeMediaObjectStorage(
  input: {
    onSaveMime?: (mimeType: string) => void;
    saveObjectKey?: string;
    downloadObject?: (objectKey: string) => Promise<{ buffer: Buffer; contentType: string } | null>;
    onDeleteObject?: (objectKey: string) => void;
  } = {}
) {
  const defaultPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  return {
    buildWorkspaceObjectKey(scope: { workspaceId: string; workspaceRelPath: string }) {
      return `workspaces/${scope.workspaceId}${scope.workspaceRelPath}`;
    },
    buildChatMessageObjectKey() {
      return input.saveObjectKey ?? "workspaces/workspace-1/workspace/file.bin";
    },
    async saveObject(saveInput: { mimeType: string; buffer: Buffer }) {
      input.onSaveMime?.(saveInput.mimeType);
      return {
        objectKey: input.saveObjectKey ?? "workspaces/workspace-1/workspace/file.bin",
        sizeBytes: saveInput.buffer.length,
        mimeType: saveInput.mimeType
      };
    },
    async downloadObject(objectKey: string) {
      if (input.downloadObject) {
        return input.downloadObject(objectKey);
      }
      if (objectKey.endsWith(".mp3") || objectKey.endsWith(".mpeg")) {
        return { buffer: Buffer.from("audio-output"), contentType: "audio/mpeg" };
      }
      return { buffer: defaultPngBuffer, contentType: "image/png" };
    },
    async deleteObject(objectKey: string) {
      input.onDeleteObject?.(objectKey);
    }
  };
}

async function run(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const sourceUploadMetrics = new PlatformHttpMetricsService();

  const sourceUploadService = new MediaDeliveryService(
    attachmentRepositoryWithRegisterLookup() as never,
    noopAssistantRepository as never,
    [],
    fakeMediaObjectStorage(),
    fakeRegisterChatAttachmentService as never,
    fakeWorkspaceFileMetadataService as never,
    noopQuotaUsageService as never,
    sourceUploadMetrics,
    noopRecordModelCostLedgerService,
    {} as never,
    {} as never,
    {} as never
  );

  globalThis.fetch = async () =>
    new Response(Buffer.from("console.log('x');"), {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" }
    });
  const sourceUpload = await sourceUploadService.deliver({
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

  assert.deepEqual(sourceUpload.attachments, [
    {
      id: "att-1",
      path: "/workspace/payload.js",
      thumbnailStoragePath: null,
      posterStoragePath: null,
      attachmentType: "document",
      originalFilename: "payload.js",
      mimeType: "text/plain",
      sizeBytes: 17,
      processingStatus: "ready",
      createdAt: "2026-04-04T00:00:00.000Z"
    }
  ]);
  const sourceUploadFailureSeries = sourceUploadMetrics
    .getSnapshot()
    .mediaStageSeries.find(
      (series) =>
        series.key.stage === "delivery_persist" &&
        series.key.channel === "web" &&
        series.key.outcome === "failure"
    );
  assert.equal(sourceUploadFailureSeries, undefined);

  let uploadedMime: string | null = null;
  const safeMetrics = new PlatformHttpMetricsService();
  const safeService = new MediaDeliveryService(
    {
      ...attachmentRepositoryWithRegisterLookup(),
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
    fakeMediaObjectStorage({
      onSaveMime: (mimeType) => {
        uploadedMime = mimeType;
      }
    }),
    fakeRegisterChatAttachmentService as never,
    fakeWorkspaceFileMetadataService as never,
    noopQuotaUsageService as never,
    safeMetrics,
    noopRecordModelCostLedgerService,
    {} as never,
    {} as never,
    {} as never
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
  assert.ok((delivered.attachments[0]?.path ?? "").startsWith("/workspace/"));
  assert.equal(delivered.attachments[0]?.mimeType, "image/png");
  assert.equal(delivered.attachments[0]?.originalFilename, "render.png");
  const successSeries = safeMetrics
    .getSnapshot()
    .mediaStageSeries.find(
      (series) =>
        series.key.stage === "delivery_persist" &&
        series.key.channel === "web" &&
        series.key.outcome === "success"
    );
  assert.equal(successSeries?.count, 1);

  let legacyObjectKeyRegisterCalls = 0;
  const legacyObjectKeyMetrics = new PlatformHttpMetricsService();
  const legacyObjectKeyService = new MediaDeliveryService(
    attachmentRepositoryWithRegisterLookup() as never,
    noopAssistantRepository as never,
    [],
    fakeMediaObjectStorage(),
    {
      async execute() {
        legacyObjectKeyRegisterCalls += 1;
        return { attachmentId: "att-legacy", storagePath: "/workspace/ignored.png" };
      }
    } as never,
    fakeWorkspaceFileMetadataService as never,
    noopQuotaUsageService as never,
    legacyObjectKeyMetrics,
    noopRecordModelCostLedgerService,
    {} as never,
    {} as never,
    {} as never
  );

  const legacyObjectKeyDelivered = await legacyObjectKeyService.deliver({
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

  assert.equal(legacyObjectKeyRegisterCalls, 0);
  assert.deepEqual(legacyObjectKeyDelivered.attachments, []);
  const legacyObjectKeyFailureSeries = legacyObjectKeyMetrics
    .getSnapshot()
    .mediaStageSeries.find(
      (series) =>
        series.key.stage === "delivery_persist" &&
        series.key.channel === "web" &&
        series.key.outcome === "failure"
    );
  assert.equal(legacyObjectKeyFailureSeries?.count, 1);

  let deliveredImageBillingFacts: unknown = undefined;
  let deliveredTtsBillingFacts: unknown = undefined;
  const billingFactsRegister = {
    async execute(input: {
      storagePath: string;
      mimeType: string;
      originalFilename: string;
      sizeBytes: number;
      attachmentType: string;
      billingFacts?: unknown;
    }) {
      if (input.mimeType.startsWith("image/")) {
        deliveredImageBillingFacts = input.billingFacts;
      } else if (input.mimeType.startsWith("audio/")) {
        deliveredTtsBillingFacts = input.billingFacts;
      }
      return fakeRegisterChatAttachmentService.execute(input);
    }
  };
  const billingFactsService = new MediaDeliveryService(
    attachmentRepositoryWithRegisterLookup() as never,
    noopAssistantRepository as never,
    [],
    fakeMediaObjectStorage({
      downloadObject: async () => ({
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
        contentType: "image/png"
      })
    }) as never,
    billingFactsRegister as never,
    fakeWorkspaceFileMetadataService as never,
    noopQuotaUsageService as never,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService,
    {} as never,
    {} as never,
    {} as never
  );

  await billingFactsService.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: "/workspace/generated.png",
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
        objectKey: "/workspace/generated.mp3",
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

  const existingWorkspacePathService = new MediaDeliveryService(
    attachmentRepositoryWithRegisterLookup() as never,
    noopAssistantRepository as never,
    [],
    fakeMediaObjectStorage() as never,
    fakeRegisterChatAttachmentService as never,
    fakeWorkspaceFileMetadataService as never,
    noopQuotaUsageService as never,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService,
    {} as never,
    {} as never,
    {} as never
  );

  const existingWorkspacePathDelivered = await existingWorkspacePathService.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: "/workspace/generated-existing.png",
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

  assert.equal(
    existingWorkspacePathDelivered.attachments[0]?.path,
    "/workspace/generated-existing.png"
  );

  let adapterTarget: {
    channel: string;
    chatId: string | number;
    metadata?: Record<string, unknown>;
  } | null = null;
  let adapterCaption: string | undefined;
  const adapterService = new MediaDeliveryService(
    attachmentRepositoryWithRegisterLookup() as never,
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
    fakeMediaObjectStorage({
      downloadObject: async (objectKey: string) => {
        assert.equal(objectKey, "workspaces/workspace-1/workspace/telegram.png");
        return {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
          contentType: "image/png"
        };
      }
    }) as never,
    fakeRegisterChatAttachmentService as never,
    fakeWorkspaceFileMetadataService as never,
    noopQuotaUsageService as never,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService,
    {} as never,
    {} as never,
    {} as never
  );

  await adapterService.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: "/workspace/telegram.png",
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
  const settlementAwareObjectStorage = fakeMediaObjectStorage();
  const settlementAwareAttachmentRepository = attachmentRepositoryWithRegisterLookup();
  const deliveredSettlementService = new MediaDeliveryService(
    settlementAwareAttachmentRepository as never,
    settlementAwareAssistantRepository as never,
    [],
    settlementAwareObjectStorage as never,
    fakeRegisterChatAttachmentService as never,
    fakeWorkspaceFileMetadataService as never,
    settlementAwareQuotaUsageService as never,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService,
    {} as never,
    {} as never,
    {} as never
  );
  await deliveredSettlementService.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: "/workspace/settled.png",
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
    fakeRegisterChatAttachmentService as never,
    fakeWorkspaceFileMetadataService as never,
    settlementAwareQuotaUsageService as never,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService,
    {} as never,
    {} as never,
    {} as never
  );
  await failedSettlementService.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: "/workspace/reconcile.png",
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
        objectKey: "/workspace/not-delivered.png",
        type: "image",
        sourceToolCode: "image_generate",
        mimeType: "image/png",
        filename: "not-delivered.png",
        sizeBytes: 9
      },
      {
        source: "persai_object_storage",
        objectKey: "/workspace/ignored.png",
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
        objectKey: "/workspace/user-stopped.png",
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

  let oversizedVideoAttachmentCreates = 0;
  const oversizedVideoService = new MediaDeliveryService(
    {
      ...attachmentRepositoryWithRegisterLookup(),
      async create(input: {
        attachmentType: string;
        originalFilename: string | null;
        mimeType: string;
        sizeBytes: bigint;
        metadata: Record<string, unknown> | null;
      }) {
        oversizedVideoAttachmentCreates += 1;
        return createAttachment({
          id: "att-external-video-1",
          attachmentType: input.attachmentType as "video",
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          metadata: input.metadata
        });
      }
    } as never,
    noopAssistantRepository as never,
    [],
    fakeMediaObjectStorage() as never,
    fakeRegisterChatAttachmentService as never,
    fakeWorkspaceFileMetadataService as never,
    noopQuotaUsageService as never,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService,
    {} as never,
    {} as never,
    {} as never
  );
  const oversizedVideoBuffer = Buffer.alloc(51 * 1024 * 1024, 0);
  globalThis.fetch = async () =>
    new Response(oversizedVideoBuffer, {
      status: 200,
      headers: { "Content-Type": "video/mp4" }
    });
  const oversizedVideoDelivered = await oversizedVideoService.deliver({
    artifacts: [
      {
        source: "runtime_url",
        url: "https://files.heygen.ai/video/promo.mp4",
        type: "video",
        downloadUrl: "https://files.heygen.ai/video/promo.mp4",
        filename: "promo.mp4"
      }
    ],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-oversized-video",
    workspaceId: "workspace-1"
  });
  assert.equal(oversizedVideoAttachmentCreates, 1);
  assert.equal(oversizedVideoDelivered.attachments.length, 1);
  assert.equal(oversizedVideoDelivered.attachments[0]?.attachmentType, "video");
  assert.equal(
    oversizedVideoDelivered.attachments[0]?.externalDownloadUrl,
    "https://files.heygen.ai/video/promo.mp4"
  );
  assert.equal(oversizedVideoDelivered.externalDeliveries?.length, 1);
  assert.equal(
    oversizedVideoDelivered.externalDeliveries?.[0]?.reason,
    "file_too_large_for_inline_delivery"
  );
  assert.equal(
    oversizedVideoDelivered.externalDeliveries?.[0]?.url,
    "https://files.heygen.ai/video/promo.mp4"
  );

  globalThis.fetch = originalFetch;
}

void run();
