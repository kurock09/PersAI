import assert from "node:assert/strict";
import type { RuntimeBillingFacts } from "@persai/runtime-contract";
import { PlatformHttpMetricsService } from "../src/modules/platform-core/application/platform-http-metrics.service";
import { MediaDeliveryService } from "../src/modules/workspace-management/application/media/media-delivery.service";
import type { AssistantChatMessageAttachment } from "../src/modules/workspace-management/domain/assistant-chat-message-attachment.entity";
import type { RuntimeProviderModelCatalogByProvider } from "../src/modules/workspace-management/application/runtime-provider-profile";

const SESSION_ROOT = "/workspace/assistants/assistant-1/sessions/runtime-session-1";

/**
 * ADR-108 Slice 2 — `MediaDeliveryService` video-only success-delivery
 * settle path tests.
 *
 * Cross-slice invariants exercised here:
 *   1) Image / image-edit / TTS / STT settle paths are byte-identical
 *      to before Slice 2 — they neither read the platform settings,
 *      nor consult the catalog, nor touch the VC wallet, nor open a
 *      `prisma.$transaction` (the existing best-effort settle is
 *      preserved).
 *   2) The USD-micros leg is computed in the same shape as
 *      `record-model-cost-ledger.service.ts::calculateTimeMeteredCostMicros`
 *      so admins can audit the VC debit against
 *      `model_cost_ledger_events.actualCostMicros`.
 *   4) For `video_generate`, the unit-counter settle and the VC wallet
 *      debit run inside ONE `prisma.$transaction` so retries cannot
 *      double-debit and a failed write rolls both back.
 *   6) When a video settle fails (missing billing facts, catalog drift,
 *      transactional rollback), the existing reconciliation path runs
 *      exactly as before Slice 2 — the wallet is NOT debited.
 */

const billingFactsTimeMetered: RuntimeBillingFacts = {
  providerKey: "runway",
  modelKey: "runway-gen4-720p",
  capability: "video",
  occurredAt: "2026-06-03T19:00:00.000Z",
  metering: {
    meteringKind: "time_metered",
    durationMs: 5000,
    durationSeconds: 5
  }
};

type ProviderModelEntry = {
  providerKey: "runway" | "kling" | "openai";
  model: string;
  pricePerUnit: number;
  unit: "second" | "minute";
};

function buildCatalogByProvider(
  entries: ProviderModelEntry[] = [
    // Plain USD per second/minute (ADR-108 Slice 9 pricing-math fix).
    { providerKey: "runway", model: "runway-gen4-720p", pricePerUnit: 0.05, unit: "second" }
  ]
): RuntimeProviderModelCatalogByProvider {
  const emptyCatalog = { models: [] as never[] };
  const byProvider = {
    openai: { ...emptyCatalog, models: [] as unknown[] },
    anthropic: emptyCatalog,
    kling: { ...emptyCatalog, models: [] as unknown[] },
    runway: { ...emptyCatalog, models: [] as unknown[] }
  };
  for (const entry of entries) {
    byProvider[entry.providerKey].models.push({
      model: entry.model,
      capabilities: ["video"],
      active: true,
      effectiveFrom: null,
      effectiveTo: null,
      inputTokenWeight: 1,
      cachedInputTokenWeight: 1,
      outputTokenWeight: 1,
      displayLabel: null,
      notes: null,
      billingMode: "time_metered",
      providerPriceMetadata: {
        currency: "USD",
        timePricing: { unit: entry.unit, pricePerUnit: entry.pricePerUnit }
      }
    });
  }
  return byProvider as never;
}

function buildAttachment(
  overrides: Partial<AssistantChatMessageAttachment> = {}
): AssistantChatMessageAttachment {
  return {
    id: "att-vid-1",
    messageId: "msg-1",
    chatId: "chat-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    attachmentType: "video",
    storagePath: `${SESSION_ROOT}/clip.mp4`,
    originalFilename: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: BigInt(64),
    durationMs: 5000,
    width: null,
    height: null,
    processingStatus: "ready",
    transcription: null,
    billingFacts: null,
    metadata: null,
    createdAt: new Date("2026-06-03T19:00:01.000Z"),
    ...overrides
  };
}

type SettleCall = {
  toolCode: string;
  units: number;
  hasTx: boolean;
};
type DebitCall = {
  workspaceId: string;
  amountVc: number;
  hasTx: boolean;
};

function buildVideoSettleService(opts?: {
  /**
   * ADR-108 Slice 8 — pre-Slice-8 this flag made the legacy unit-counter
   * settle throw inside the wrapping `prisma.$transaction`. Slice 8
   * removed the unit-counter settle for `video_generate`, so this flag
   * now makes the VC wallet `debit` throw instead, exercising the same
   * "transaction rolls back" rollback path against the new code shape.
   */
  reservationFails?: boolean;
  catalogEntries?: ProviderModelEntry[];
}): {
  service: MediaDeliveryService;
  settleCalls: SettleCall[];
  debitCalls: DebitCall[];
  reconcileCalls: Array<{ toolCode: string; units: number }>;
  txCalls: { count: number };
  platformSettingsReads: { count: number };
  loggedLines: string[];
} {
  const settleCalls: SettleCall[] = [];
  const debitCalls: DebitCall[] = [];
  const reconcileCalls: Array<{ toolCode: string; units: number }> = [];
  const txCalls = { count: 0 };
  const platformSettingsReads = { count: 0 };
  const loggedLines: string[] = [];

  const attachmentRepo = {
    async create() {
      return buildAttachment();
    },
    async findById(id: string) {
      return buildAttachment({ id });
    }
  } as never;

  const assistantRepo = {
    async findById(assistantId: string) {
      return {
        id: assistantId,
        workspaceId: "workspace-1",
        userId: "user-1",
        handle: "assistant-1"
      };
    }
  } as never;

  const objectStorage = {
    buildWorkspaceObjectKey(scope: { workspaceId: string; workspaceRelPath: string }) {
      return `workspaces/${scope.workspaceId}${scope.workspaceRelPath}`;
    },
    buildChatMessageObjectKey() {
      return "workspaces/workspace-1/assistants/assistant-1/sessions/runtime-session-1/clip.mp4";
    },
    async downloadObject() {
      return {
        buffer: Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]),
        contentType: "video/mp4"
      };
    },
    async saveObject() {
      return {
        objectKey:
          "workspaces/workspace-1/assistants/assistant-1/sessions/runtime-session-1/clip.mp4",
        sizeBytes: 8,
        mimeType: "video/mp4"
      };
    },
    async deleteObject() {}
  } as never;

  const registerChatAttachment = {
    async execute() {
      return { attachmentId: "att-vid-1", storagePath: `${SESSION_ROOT}/clip.mp4` };
    }
  } as never;

  const workspaceFileMetadata = {
    async get() {
      return null;
    }
  } as never;

  const trackQuotaService = {
    async settleAssistantMonthlyMediaQuota(params: {
      toolCode: string;
      units: number;
      tx?: unknown;
    }) {
      // ADR-108 Slice 8 — image / image-edit still hit this branch.
      // `video_generate` no longer reaches it.
      settleCalls.push({
        toolCode: params.toolCode,
        units: params.units,
        hasTx: params.tx !== undefined
      });
    },
    async markAssistantMonthlyMediaQuotaReconciliationRequired(params: {
      toolCode: string;
      units: number;
    }) {
      reconcileCalls.push({ toolCode: params.toolCode, units: params.units });
    }
  } as never;

  const httpMetrics = new PlatformHttpMetricsService();

  const ledgerService = {
    async recordPersistedBillingFactsEvent() {
      return 0;
    }
  } as never;

  const platformSettingsResolver = {
    async execute() {
      platformSettingsReads.count += 1;
      return {
        availableModelCatalogByProvider: buildCatalogByProvider(opts?.catalogEntries),
        vcoinExchangeRate: 20
      };
    }
  } as never;

  const vcoinRepo = {
    async getOrCreate() {
      throw new Error("settle path must NOT call getOrCreate (it uses debit)");
    },
    async debit(input: { workspaceId: string; amountVc: number; tx?: unknown }) {
      debitCalls.push({
        workspaceId: input.workspaceId,
        amountVc: input.amountVc,
        hasTx: input.tx !== undefined
      });
      if (opts?.reservationFails) {
        throw new Error("simulated VC wallet debit failure inside tx");
      }
      return {
        previousBalanceVc: 100,
        balanceVc: 100 - input.amountVc,
        debitedAt: new Date("2026-06-03T19:00:02.000Z")
      };
    }
  } as never;

  // Minimal Prisma stub: only `$transaction` is exercised. The callback
  // is invoked with a sentinel "tx" object that the trackQuotaService and
  // vcoinRepo mocks observe via `params.tx !== undefined`.
  const prismaStub = {
    async $transaction(cb: (tx: unknown) => Promise<unknown>) {
      txCalls.count += 1;
      const txClient = { __isTx: true };
      return cb(txClient);
    }
  } as never;

  const service = new MediaDeliveryService(
    attachmentRepo,
    assistantRepo,
    [],
    objectStorage,
    registerChatAttachment,
    workspaceFileMetadata,
    trackQuotaService,
    httpMetrics,
    ledgerService,
    platformSettingsResolver,
    vcoinRepo,
    prismaStub
  );

  // Pipe the service's logger through `console.log` indirection so we
  // can assert the structured `adr108_video_settle ...` line is emitted.
  // The Logger uses Nest's default logger (writes to stdout), so we
  // just intercept via patching service["logger"].log.
  const logger = (service as unknown as { logger: { log: (msg: string) => void } }).logger;
  const originalLog = logger.log.bind(logger);
  logger.log = (msg: string) => {
    loggedLines.push(msg);
    originalLog(msg);
  };

  return {
    service,
    settleCalls,
    debitCalls,
    reconcileCalls,
    txCalls,
    platformSettingsReads,
    loggedLines
  };
}

async function runVideoGenerateSettleDebitsInTx(): Promise<void> {
  const ctx = buildVideoSettleService();
  await ctx.service.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: `${SESSION_ROOT}/clip.mp4`,
        type: "video",
        sourceToolCode: "video_generate",
        mimeType: "video/mp4",
        filename: "clip.mp4",
        sizeBytes: 8,
        billingFacts: billingFactsTimeMetered
      }
    ],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });

  assert.equal(ctx.txCalls.count, 1, "exactly one prisma.$transaction must wrap the debit");
  assert.equal(ctx.platformSettingsReads.count, 1, "platform settings resolved exactly once");
  // ADR-108 Slice 8 — video_generate is VC-priced and no longer settles
  // a legacy monthly_media_quota unit counter. Only the VC debit runs.
  assert.equal(ctx.settleCalls.length, 0, "video_generate must NOT settle the legacy unit counter");
  assert.equal(ctx.debitCalls.length, 1);
  assert.equal(ctx.debitCalls[0]!.workspaceId, "workspace-1");
  // 5s × $0.05/s × 20 VC/USD = ceil(5) = 5 VC
  assert.equal(ctx.debitCalls[0]!.amountVc, 5);
  assert.equal(ctx.debitCalls[0]!.hasTx, true, "debit must run inside a transaction");
  assert.equal(ctx.reconcileCalls.length, 0, "successful settle must not reconcile");
  const auditLine = ctx.loggedLines.find((line) => line.startsWith("adr108_video_settle"));
  assert.ok(auditLine, "audit log line must be emitted");
  assert.match(auditLine!, /usdMicros=250000/);
  assert.match(auditLine!, /vcDebited=5/);
  assert.match(auditLine!, /previousBalanceVc=100/);
  assert.match(auditLine!, /balanceVc=95/);
}

async function runKlingVideoSettleDebitsCorrectly(): Promise<void> {
  const ctx = buildVideoSettleService({
    catalogEntries: [{ providerKey: "kling", model: "kling-v3", pricePerUnit: 2.4, unit: "minute" }]
  });
  await ctx.service.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: `${SESSION_ROOT}/kling.mp4`,
        type: "video",
        sourceToolCode: "video_generate",
        mimeType: "video/mp4",
        filename: "kling.mp4",
        sizeBytes: 8,
        billingFacts: {
          providerKey: "kling",
          modelKey: "kling-v3",
          capability: "video",
          occurredAt: "2026-06-03T19:00:00.000Z",
          metering: { meteringKind: "time_metered", durationMs: 12_000, durationSeconds: 12 }
        }
      }
    ],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });

  // 12s × $2.40/min = $0.48 = 480_000 micros; × 20 / 1M = 9.6 → ceil = 10 VC
  assert.equal(ctx.txCalls.count, 1);
  assert.equal(ctx.debitCalls.length, 1);
  assert.equal(ctx.debitCalls[0]!.amountVc, 10);
  assert.equal(ctx.debitCalls[0]!.hasTx, true);
  // ADR-108 Slice 8 — `video_generate` no longer touches the legacy
  // monthly-unit-counter; only the VC wallet debit runs.
  assert.equal(ctx.settleCalls.length, 0);
}

async function runOpenAIVideoSettleDebitsCorrectly(): Promise<void> {
  const ctx = buildVideoSettleService({
    catalogEntries: [
      { providerKey: "openai", model: "sora-1.0-1080p", pricePerUnit: 0.2, unit: "second" }
    ]
  });
  await ctx.service.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: `${SESSION_ROOT}/sora.mp4`,
        type: "video",
        sourceToolCode: "video_generate",
        mimeType: "video/mp4",
        filename: "sora.mp4",
        sizeBytes: 8,
        billingFacts: {
          providerKey: "openai",
          modelKey: "sora-1.0-1080p",
          capability: "video",
          occurredAt: "2026-06-03T19:00:00.000Z",
          metering: { meteringKind: "time_metered", durationMs: 4_000, durationSeconds: 4 }
        }
      }
    ],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });

  // 4s × $0.20/s = $0.80 = 800_000 micros; × 20 / 1M = 16 VC (no rounding)
  assert.equal(ctx.txCalls.count, 1);
  assert.equal(ctx.debitCalls.length, 1);
  assert.equal(ctx.debitCalls[0]!.amountVc, 16);
  assert.equal(ctx.debitCalls[0]!.hasTx, true);
}

async function runImageGenerateDoesNotConsultVcoin(): Promise<void> {
  const ctx = buildVideoSettleService();
  await ctx.service.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: `${SESSION_ROOT}/render.png`,
        type: "image",
        sourceToolCode: "image_generate",
        mimeType: "image/png",
        filename: "render.png",
        sizeBytes: 9
      }
    ],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });

  assert.equal(ctx.txCalls.count, 0, "image settle must NOT open a $transaction (invariant 1)");
  assert.equal(
    ctx.platformSettingsReads.count,
    0,
    "image settle must NOT read platform runtime provider settings"
  );
  assert.equal(ctx.debitCalls.length, 0, "image settle must NEVER debit the wallet");
  assert.equal(ctx.settleCalls.length, 1);
  assert.equal(ctx.settleCalls[0]!.toolCode, "image_generate");
  assert.equal(ctx.settleCalls[0]!.hasTx, false, "image settle keeps the no-tx best-effort path");
  assert.equal(ctx.reconcileCalls.length, 0);
}

async function runVideoSettleFailureRollsBackWithoutLegacyReconciliation(): Promise<void> {
  // ADR-108 Slice 8 — `video_generate` is VC-priced. Simulate the wallet
  // debit (the only step inside the transaction now) throwing. The
  // transaction rolls back and the outer deliver() catch logs the
  // failure, but the legacy monthly_media_quota reconciliation MUST NOT
  // fire because there is no unit counter to reconcile for video.
  const ctx = buildVideoSettleService({ reservationFails: true });
  await ctx.service.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: `${SESSION_ROOT}/clip.mp4`,
        type: "video",
        sourceToolCode: "video_generate",
        mimeType: "video/mp4",
        filename: "clip.mp4",
        sizeBytes: 8,
        billingFacts: billingFactsTimeMetered
      }
    ],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });

  assert.equal(ctx.txCalls.count, 1, "transaction was opened");
  assert.equal(
    ctx.settleCalls.length,
    0,
    "video_generate must NOT touch the legacy monthly-unit-counter"
  );
  assert.equal(
    ctx.debitCalls.length,
    1,
    "debit was attempted inside the tx (and threw, rolling back)"
  );
  assert.equal(ctx.debitCalls[0]!.hasTx, true);
  assert.equal(
    ctx.reconcileCalls.length,
    0,
    "video_generate is VC-priced — legacy reconciliation must be skipped"
  );
  assert.equal(
    ctx.loggedLines.filter((line) => line.startsWith("adr108_video_settle")).length,
    0,
    "audit log line must NOT be emitted when the transaction rolled back"
  );
}

async function runVideoSettleMissingBillingFactsSkipsLegacyReconciliation(): Promise<void> {
  // ADR-108 Slice 8 — when billingFacts is missing for a video artifact,
  // the settle helper throws; the deliver() catch logs the failure but
  // does NOT reconcile the legacy monthly_media_quota counter (there is
  // no unit row to reconcile for video). The wallet stays untouched.
  const ctx = buildVideoSettleService();
  await ctx.service.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: `${SESSION_ROOT}/clip.mp4`,
        type: "video",
        sourceToolCode: "video_generate",
        mimeType: "video/mp4",
        filename: "clip.mp4",
        sizeBytes: 8
        // no billingFacts on purpose
      }
    ],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });

  assert.equal(
    ctx.platformSettingsReads.count,
    0,
    "missing billingFacts must short-circuit before any platform-settings IO (fail-fast)"
  );
  assert.equal(ctx.txCalls.count, 0, "no transaction is opened when billingFacts is missing");
  assert.equal(ctx.settleCalls.length, 0, "settle was not invoked");
  assert.equal(ctx.debitCalls.length, 0, "debit was not invoked");
  assert.equal(
    ctx.reconcileCalls.length,
    0,
    "video_generate is VC-priced — legacy reconciliation must be skipped"
  );
}

async function run(): Promise<void> {
  await runVideoGenerateSettleDebitsInTx();
  await runKlingVideoSettleDebitsCorrectly();
  await runOpenAIVideoSettleDebitsCorrectly();
  await runImageGenerateDoesNotConsultVcoin();
  await runVideoSettleFailureRollsBackWithoutLegacyReconciliation();
  await runVideoSettleMissingBillingFactsSkipsLegacyReconciliation();
  console.log("media-delivery-video-vcoin-settle: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
