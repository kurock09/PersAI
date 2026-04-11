import assert from "node:assert/strict";
import type { RuntimeConfig } from "@persai/config";
import type { RuntimeBundleRef, RuntimeConversationAddress } from "@persai/runtime-contract";
import { RuntimeStateKeyspaceService } from "../src/modules/runtime-state/runtime-state-keyspace.service";

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
    RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 15_000
  };
}

function createConversation(): RuntimeConversationAddress {
  return {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    channel: "telegram",
    externalThreadKey: "tg-chat-42",
    externalUserKey: "user-1",
    mode: "group"
  };
}

function createBundle(): RuntimeBundleRef {
  return {
    bundleId: "bundle-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    publishedVersionId: "version-1",
    bundleHash: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    compiledAt: "2026-04-11T00:00:00.000Z"
  };
}

export async function runRuntimeStateKeyspaceServiceTest(): Promise<void> {
  const service = new RuntimeStateKeyspaceService(createConfig());
  const conversation = createConversation();

  const conversationKey = service.createConversationKey(conversation);
  assert.match(conversationKey, /^[a-f0-9]{64}$/);
  assert.equal(conversationKey, service.createConversationKey(createConversation()));
  assert.notEqual(
    conversationKey,
    service.createConversationKey({ ...conversation, externalUserKey: "user-2" })
  );

  assert.equal(
    service.buildConversationSessionPointerKey(conversation),
    `persai:test-runtime:conversation:${conversationKey}:session`
  );
  assert.equal(
    service.buildSessionLeaseKey("session-1"),
    "persai:test-runtime:session:session-1:lease"
  );

  const receiptKey = service.buildTurnReceiptKey({
    conversation,
    idempotencyKey: "turn-1"
  });
  const inFlightKey = service.buildTurnInFlightKey({
    conversation,
    idempotencyKey: "turn-1"
  });
  assert.equal(
    receiptKey,
    service.buildTurnReceiptKeyFromConversationKey(conversationKey, "turn-1")
  );
  assert.equal(
    inFlightKey,
    service.buildTurnInFlightKeyFromConversationKey(conversationKey, "turn-1")
  );
  assert.notEqual(
    receiptKey,
    service.buildTurnReceiptKeyFromConversationKey(conversationKey, "turn-2")
  );
  assert.notEqual(
    inFlightKey,
    service.buildTurnInFlightKeyFromConversationKey(conversationKey, "turn-2")
  );

  const bundleMarkerKey = service.buildBundleMarkerKey(createBundle());
  assert.match(bundleMarkerKey, /^persai:test-runtime:bundle_marker:[a-f0-9]{64}$/);
  assert.equal(
    service.buildAssistantBundleMarkerSetKey("assistant-1"),
    "persai:test-runtime:assistant:assistant-1:bundle_markers"
  );

  assert.deepEqual(service.getPolicySnapshot(), {
    redisKeyPrefix: "persai:test-runtime",
    sessionLeaseTtlSeconds: 45,
    turnInFlightTtlSeconds: 45,
    turnReceiptTtlSeconds: 3600,
    bundleMarkerTtlSeconds: 7200
  });
}
