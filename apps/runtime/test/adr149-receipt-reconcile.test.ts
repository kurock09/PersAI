import assert from "node:assert/strict";
import type { RuntimeConfig } from "@persai/config";
import type { RuntimeTurnReceipt } from "@prisma/client";
import type { RuntimeConversationAddress } from "@persai/runtime-contract";
import { IdempotencyService } from "../src/modules/turns/idempotency.service";
import {
  ORPHAN_RECEIPT_RECONCILE_ERROR_CODE,
  ReconcileOrphanTurnReceiptsService
} from "../src/modules/turns/reconcile-orphan-turn-receipts.service";
import { RuntimeStateKeyspaceService } from "../src/modules/runtime-state/runtime-state-keyspace.service";
import type { RuntimeStatePostgresService } from "../src/modules/runtime-state/infrastructure/persistence/runtime-state-postgres.service";
import type { RuntimeStateRedisService } from "../src/modules/runtime-state/infrastructure/coordination/runtime-state-redis.service";

function createConfig(): RuntimeConfig {
  return {
    APP_ENV: "local",
    DATABASE_URL: "postgresql://persai:persai@localhost:5432/persai",
    PORT: 3012,
    LOG_LEVEL: "info",
    RUNTIME_STATE_REDIS_URL: "redis://localhost:6379",
    RUNTIME_BUNDLE_CACHE_MAX_ENTRIES: 8,
    RUNTIME_STATE_REDIS_KEY_PREFIX: "persai:test-runtime",
    RUNTIME_SESSION_LEASE_TTL_SECONDS: 45,
    RUNTIME_TURN_RECEIPT_TTL_SECONDS: 3600,
    RUNTIME_BUNDLE_MARKER_TTL_SECONDS: 7200,
    RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS: 5_000,
    RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 15_000,
    RUNTIME_SANDBOX_TIMEOUT_MS: 30_000,
    RUNTIME_SANDBOX_POD_PROVISION_BUDGET_MS: 240_000,
    PERSAI_MEDIA_OBJECT_PREFIX: "fs",
    ORPHAN_RECEIPT_GRACE_MS: 60_000
  };
}

function createConversation(): RuntimeConversationAddress {
  return {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    channel: "web",
    externalThreadKey: "thread-1",
    externalUserKey: "user-1",
    mode: "direct"
  };
}

function createReceipt(overrides?: Partial<RuntimeTurnReceipt>): RuntimeTurnReceipt {
  return {
    id: "receipt-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    runtimeSessionId: "session-1",
    publishedVersionId: "version-1",
    runtimeTier: "paid_shared_restricted",
    conversationKey: "conv-1",
    channel: "web",
    externalThreadKey: "thread-1",
    externalUserKey: "user-1",
    mode: "direct",
    requestId: "request-1",
    idempotencyKey: "turn-1",
    bundleHash: "hash-1",
    status: "accepted",
    resultPayload: null,
    errorCode: null,
    errorMessage: null,
    completedAt: null,
    createdAt: new Date("2026-07-15T10:00:00.000Z"),
    updatedAt: new Date("2026-07-15T10:00:00.000Z"),
    ...overrides
  };
}

class FakeRuntimeStatePostgresService {
  receipts = new Map<string, RuntimeTurnReceipt>();

  async findStaleAcceptedTurnReceiptCandidates(input: { staleBefore: Date; limit: number }) {
    return [...this.receipts.values()]
      .filter((receipt) => receipt.status === "accepted" && receipt.updatedAt < input.staleBefore)
      .slice(0, input.limit);
  }

  async reconcileOrphanAcceptedTurnReceipt(input: {
    requestId: string;
    reconciledAt: Date;
    errorCode: string;
    errorMessage: string;
  }) {
    const receipt = this.receipts.get(input.requestId);
    if (receipt === undefined || receipt.status !== "accepted") {
      return { count: 0 };
    }
    receipt.status = "failed";
    receipt.errorCode = input.errorCode;
    receipt.errorMessage = input.errorMessage;
    receipt.completedAt = input.reconciledAt;
    receipt.resultPayload = null;
    return { count: 1 };
  }

  async findTurnReceiptByConversationAndIdempotencyKey(
    conversationKey: string,
    idempotencyKey: string
  ) {
    return (
      [...this.receipts.values()].find(
        (receipt) =>
          receipt.conversationKey === conversationKey && receipt.idempotencyKey === idempotencyKey
      ) ?? null
    );
  }

  async findTurnReceiptByRequestId(requestId: string) {
    return this.receipts.get(requestId) ?? null;
  }

  async createAcceptedTurnReceipt(input: {
    conversationKey: string;
    conversation: RuntimeConversationAddress;
    requestId: string;
    idempotencyKey: string;
    runtimeTier: RuntimeTurnReceipt["runtimeTier"];
    publishedVersionId?: string | null;
    runtimeSessionId?: string | null;
    bundleHash?: string | null;
  }) {
    const existing = [...this.receipts.values()].find(
      (receipt) =>
        receipt.conversationKey === input.conversationKey &&
        receipt.idempotencyKey === input.idempotencyKey
    );
    if (existing !== undefined) {
      const error = new Error("Unique constraint failed");
      (error as { code?: string }).code = "P2002";
      throw error;
    }
    const receipt = createReceipt({
      conversationKey: input.conversationKey,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      runtimeTier: input.runtimeTier,
      publishedVersionId: input.publishedVersionId ?? null,
      runtimeSessionId: input.runtimeSessionId ?? null,
      bundleHash: input.bundleHash ?? null,
      status: "accepted"
    });
    this.receipts.set(receipt.requestId, receipt);
    return receipt;
  }

  async reclaimOrphanReconciledTurnReceipt(input: {
    conversationKey: string;
    idempotencyKey: string;
    requestId: string;
    runtimeSessionId?: string | null;
    publishedVersionId?: string | null;
    runtimeTier: RuntimeTurnReceipt["runtimeTier"];
    bundleHash?: string | null;
  }) {
    const receipt = [...this.receipts.values()].find(
      (row) =>
        row.conversationKey === input.conversationKey &&
        row.idempotencyKey === input.idempotencyKey &&
        row.errorCode === ORPHAN_RECEIPT_RECONCILE_ERROR_CODE
    );
    if (receipt === undefined) {
      return { count: 0 };
    }
    this.receipts.delete(receipt.requestId);
    const reclaimed = createReceipt({
      ...receipt,
      requestId: input.requestId,
      status: "accepted",
      errorCode: null,
      errorMessage: null,
      completedAt: null,
      runtimeSessionId: input.runtimeSessionId ?? null,
      publishedVersionId: input.publishedVersionId ?? null,
      runtimeTier: input.runtimeTier,
      bundleHash: input.bundleHash ?? null
    });
    this.receipts.set(reclaimed.requestId, reclaimed);
    return { count: 1 };
  }
}

class FakeRuntimeStateRedisService {
  inFlight = new Map<string, string>();
  sessionLeases = new Set<string>();

  async readTurnInFlightMarker(input: {
    conversation: RuntimeConversationAddress;
    idempotencyKey: string;
  }) {
    return (
      this.inFlight.get(`${input.conversation.externalThreadKey}:${input.idempotencyKey}`) ?? null
    );
  }

  async clearTurnInFlightMarker(input: {
    conversation: RuntimeConversationAddress;
    idempotencyKey: string;
  }) {
    this.inFlight.delete(`${input.conversation.externalThreadKey}:${input.idempotencyKey}`);
  }

  async hasSessionLease(sessionId: string) {
    return this.sessionLeases.has(sessionId);
  }

  async writeTurnReceiptMarker(): Promise<void> {
    return;
  }

  async readTurnReceiptMarker(): Promise<string | null> {
    return null;
  }
}

export async function runAdr149ReceiptReconcileTest(): Promise<void> {
  const config = createConfig();
  const keyspace = new RuntimeStateKeyspaceService(config);
  const conversation = createConversation();
  const conversationKey = keyspace.createConversationKey(conversation);
  const postgres = new FakeRuntimeStatePostgresService();
  const redis = new FakeRuntimeStateRedisService();
  const reconcileService = new ReconcileOrphanTurnReceiptsService(
    config,
    postgres as unknown as RuntimeStatePostgresService,
    redis as unknown as RuntimeStateRedisService
  );

  const now = new Date("2026-07-15T12:00:00.000Z");
  const graceMs = 60_000;
  const staleAt = new Date(now.getTime() - graceMs - 5_000);

  postgres.receipts.set(
    "request-stale",
    createReceipt({
      requestId: "request-stale",
      conversationKey,
      updatedAt: staleAt
    })
  );
  postgres.receipts.set(
    "request-fresh",
    createReceipt({
      requestId: "request-fresh",
      idempotencyKey: "turn-fresh",
      updatedAt: new Date(now.getTime() - 1_000)
    })
  );
  postgres.receipts.set(
    "request-inflight",
    createReceipt({
      requestId: "request-inflight",
      idempotencyKey: "turn-inflight",
      updatedAt: staleAt
    })
  );
  redis.inFlight.set("thread-1:turn-inflight", "request-inflight");

  const result = await reconcileService.executeBatch(8, { now, graceMs });

  assert.equal(result.candidates, 2);
  assert.equal(result.applied, 1);
  assert.equal(result.skippedFresh, 0);
  assert.equal(result.skippedInFlight, 1);
  assert.equal(postgres.receipts.get("request-stale")?.status, "failed");
  assert.equal(
    postgres.receipts.get("request-stale")?.errorCode,
    ORPHAN_RECEIPT_RECONCILE_ERROR_CODE
  );

  const second = await reconcileService.executeBatch(8, { now, graceMs });
  assert.equal(second.applied, 0);

  const idempotency = new IdempotencyService(
    keyspace,
    postgres as unknown as RuntimeStatePostgresService,
    redis as unknown as RuntimeStateRedisService
  );
  const replay = await idempotency.createAcceptedTurn({
    requestId: "request-replay",
    idempotencyKey: "turn-1",
    runtimeTier: "paid_shared_restricted",
    conversation,
    bundle: {
      bundleId: "bundle-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "version-1",
      bundleHash: "hash-1",
      compiledAt: "2026-07-15T10:00:00.000Z"
    },
    sessionId: "session-1"
  });

  assert.equal(replay.replayed, false);
  assert.equal(replay.receipt.requestId, "request-replay");
  assert.equal(replay.receipt.status, "accepted");
  assert.equal(replay.conversationKey, conversationKey);
}

void runAdr149ReceiptReconcileTest().then(() => {
  console.log("adr149-receipt-reconcile.test.ts passed");
});
