import assert from "node:assert/strict";
import type { RuntimeConfig } from "@persai/config";
import type { RuntimeBundleRef, RuntimeConversationAddress } from "@persai/runtime-contract";
import type { RuntimeTurnReceipt } from "@prisma/client";
import {
  IdempotencyService,
  type ClaimRuntimeTurnInput
} from "../src/modules/turns/idempotency.service";
import { RuntimeStateKeyspaceService } from "../src/modules/runtime-state/runtime-state-keyspace.service";
import type { RuntimeStateRedisService } from "../src/modules/runtime-state/infrastructure/coordination/runtime-state-redis.service";
import type {
  CreateAcceptedRuntimeTurnReceiptInput,
  RuntimeStatePostgresService
} from "../src/modules/runtime-state/infrastructure/persistence/runtime-state-postgres.service";

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
    PERSAI_MEDIA_OBJECT_PREFIX: "assistant-media"
  };
}

function createConversation(externalThreadKey: string): RuntimeConversationAddress {
  return {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    channel: "web",
    externalThreadKey,
    externalUserKey: "user-1",
    mode: "direct"
  };
}

function createBundle(publishedVersionId: string, bundleHash: string): RuntimeBundleRef {
  return {
    bundleId: `bundle-${publishedVersionId}`,
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    publishedVersionId,
    bundleHash,
    compiledAt: "2026-04-11T12:00:00.000Z"
  };
}

function createClaimInput(params: {
  requestId: string;
  idempotencyKey: string;
  externalThreadKey: string;
}): ClaimRuntimeTurnInput {
  return {
    requestId: params.requestId,
    idempotencyKey: params.idempotencyKey,
    runtimeTier: "paid_shared_restricted",
    conversation: createConversation(params.externalThreadKey),
    bundle: createBundle(
      "version-1",
      "1111111111111111111111111111111111111111111111111111111111111111"
    ),
    sessionId: "session-1"
  };
}

function createReceipt(
  input: CreateAcceptedRuntimeTurnReceiptInput,
  overrides?: Partial<RuntimeTurnReceipt>
): RuntimeTurnReceipt {
  return {
    id: overrides?.id ?? `${input.requestId}-id`,
    assistantId: input.conversation.assistantId,
    workspaceId: input.conversation.workspaceId,
    runtimeSessionId: overrides?.runtimeSessionId ?? input.runtimeSessionId ?? null,
    publishedVersionId: overrides?.publishedVersionId ?? input.publishedVersionId ?? null,
    runtimeTier: overrides?.runtimeTier ?? input.runtimeTier,
    conversationKey: input.conversationKey,
    channel: input.conversation.channel,
    externalThreadKey: input.conversation.externalThreadKey,
    externalUserKey: input.conversation.externalUserKey,
    mode: input.conversation.mode,
    requestId: overrides?.requestId ?? input.requestId,
    idempotencyKey: input.idempotencyKey,
    bundleHash: overrides?.bundleHash ?? input.bundleHash ?? null,
    status: overrides?.status ?? "accepted",
    resultPayload: overrides?.resultPayload ?? null,
    errorCode: overrides?.errorCode ?? null,
    errorMessage: overrides?.errorMessage ?? null,
    completedAt: overrides?.completedAt ?? null,
    createdAt: overrides?.createdAt ?? new Date("2026-04-11T12:00:00.000Z"),
    updatedAt: overrides?.updatedAt ?? new Date("2026-04-11T12:00:00.000Z")
  };
}

class FakeRuntimeStatePostgresService {
  readonly receiptsByRequestId = new Map<string, RuntimeTurnReceipt>();
  readonly receiptsByConversationAndIdempotency = new Map<string, RuntimeTurnReceipt>();
  pendingConflictReceipt: RuntimeTurnReceipt | null = null;

  async findTurnReceiptByRequestId(requestId: string): Promise<RuntimeTurnReceipt | null> {
    return this.receiptsByRequestId.get(requestId) ?? null;
  }

  async findTurnReceiptByConversationAndIdempotencyKey(
    conversationKey: string,
    idempotencyKey: string
  ): Promise<RuntimeTurnReceipt | null> {
    return (
      this.receiptsByConversationAndIdempotency.get(`${conversationKey}|${idempotencyKey}`) ?? null
    );
  }

  async createAcceptedTurnReceipt(
    input: CreateAcceptedRuntimeTurnReceiptInput
  ): Promise<RuntimeTurnReceipt> {
    if (this.pendingConflictReceipt !== null) {
      const conflict = this.pendingConflictReceipt;
      this.pendingConflictReceipt = null;
      this.store(conflict);
      throw { code: "P2002" };
    }

    const existing = await this.findTurnReceiptByConversationAndIdempotencyKey(
      input.conversationKey,
      input.idempotencyKey
    );
    if (existing !== null) {
      throw { code: "P2002" };
    }

    const receipt = createReceipt(input);
    this.store(receipt);
    return receipt;
  }

  private store(receipt: RuntimeTurnReceipt): void {
    this.receiptsByRequestId.set(receipt.requestId, receipt);
    this.receiptsByConversationAndIdempotency.set(
      `${receipt.conversationKey}|${receipt.idempotencyKey}`,
      receipt
    );
  }
}

class FakeRuntimeStateRedisService {
  readonly markers = new Map<string, string>();

  async readTurnReceiptMarker(input: {
    conversation: RuntimeConversationAddress;
    idempotencyKey: string;
  }): Promise<string | null> {
    return this.markers.get(JSON.stringify(input)) ?? null;
  }

  async writeTurnReceiptMarker(input: {
    conversation: RuntimeConversationAddress;
    idempotencyKey: string;
    requestId: string;
  }): Promise<void> {
    this.markers.set(
      JSON.stringify({
        conversation: input.conversation,
        idempotencyKey: input.idempotencyKey
      }),
      input.requestId
    );
  }
}

export async function runIdempotencyServiceTest(): Promise<void> {
  const keyspace = new RuntimeStateKeyspaceService(createConfig());
  const postgres = new FakeRuntimeStatePostgresService();
  const redis = new FakeRuntimeStateRedisService();
  const service = new IdempotencyService(
    keyspace,
    postgres as unknown as RuntimeStatePostgresService,
    redis as unknown as RuntimeStateRedisService
  );

  const firstInput = createClaimInput({
    requestId: "request-1",
    idempotencyKey: "turn-1",
    externalThreadKey: "thread-1"
  });
  const firstResult = await service.claimOrReplayAcceptedTurn(firstInput);

  assert.equal(firstResult.replayed, false);
  assert.equal(firstResult.receipt.requestId, "request-1");
  assert.equal(
    redis.markers.get(
      JSON.stringify({
        conversation: firstInput.conversation,
        idempotencyKey: firstInput.idempotencyKey
      })
    ),
    "request-1"
  );

  const replayResult = await service.claimOrReplayAcceptedTurn({
    ...firstInput,
    requestId: "request-2"
  });

  assert.equal(replayResult.replayed, true);
  assert.equal(replayResult.receipt.requestId, "request-1");

  const conflictInput = createClaimInput({
    requestId: "request-3",
    idempotencyKey: "turn-2",
    externalThreadKey: "thread-2"
  });
  const conflictConversationKey = keyspace.createConversationKey(conflictInput.conversation);
  postgres.pendingConflictReceipt = createReceipt({
    runtimeSessionId: "session-9",
    publishedVersionId: conflictInput.bundle.publishedVersionId,
    runtimeTier: conflictInput.runtimeTier,
    conversationKey: conflictConversationKey,
    conversation: conflictInput.conversation,
    requestId: "request-existing",
    idempotencyKey: conflictInput.idempotencyKey,
    bundleHash: conflictInput.bundle.bundleHash
  });

  const conflictResult = await service.claimOrReplayAcceptedTurn(conflictInput);

  assert.equal(conflictResult.replayed, true);
  assert.equal(conflictResult.receipt.requestId, "request-existing");
  assert.equal(
    redis.markers.get(
      JSON.stringify({
        conversation: conflictInput.conversation,
        idempotencyKey: conflictInput.idempotencyKey
      })
    ),
    "request-existing"
  );
}
