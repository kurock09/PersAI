import assert from "node:assert/strict";
import type { RuntimeConfig } from "@persai/config";
import type { RuntimeBundleRef, RuntimeConversationAddress } from "@persai/runtime-contract";
import { RuntimeStateRedisService } from "../src/modules/runtime-state/infrastructure/coordination/runtime-state-redis.service";
import { RuntimeStateKeyspaceService } from "../src/modules/runtime-state/runtime-state-keyspace.service";

type SetOptions = {
  EX?: number;
  NX?: boolean;
};

class FakeRuntimeRedisClient {
  private readonly strings = new Map<string, string>();
  private readonly sets = new Map<string, Set<string>>();

  async connect(): Promise<void> {}

  async quit(): Promise<void> {}

  async eval(
    script: string,
    options: {
      keys: string[];
      arguments: string[];
    }
  ): Promise<number> {
    void script;
    if (options.keys.length === 2) {
      const [leaseKey, inFlightKey] = options.keys;
      const [ownerToken, requestId] = options.arguments;
      if (
        leaseKey === undefined ||
        inFlightKey === undefined ||
        ownerToken === undefined ||
        requestId === undefined
      ) {
        return 0;
      }
      if (this.strings.has(inFlightKey)) {
        return 1;
      }
      if (this.strings.has(leaseKey)) {
        return 0;
      }
      this.strings.set(leaseKey, ownerToken);
      this.strings.set(inFlightKey, requestId);
      return 2;
    }

    const [key] = options.keys;
    const [ownerToken] = options.arguments;
    if (key === undefined || ownerToken === undefined) {
      return 0;
    }
    return this.strings.get(key) === ownerToken ? 1 : 0;
  }

  async set(key: string, value: string, options?: SetOptions): Promise<string | null> {
    if (options?.NX && this.strings.has(key)) {
      return null;
    }

    this.strings.set(key, value);
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  async del(key: string): Promise<number> {
    const deletedString = this.strings.delete(key);
    const deletedSet = this.sets.delete(key);
    return deletedString || deletedSet ? 1 : 0;
  }

  async sAdd(key: string, members: string | string[]): Promise<number> {
    const values = Array.isArray(members) ? members : [members];
    const existing = this.sets.get(key) ?? new Set<string>();
    let added = 0;
    for (const value of values) {
      if (!existing.has(value)) {
        existing.add(value);
        added += 1;
      }
    }
    this.sets.set(key, existing);
    return added;
  }

  async sMembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? new Set<string>())];
  }

  async expire(key: string, seconds: number): Promise<number> {
    void key;
    void seconds;
    return 1;
  }
}

class TestRuntimeStateRedisService extends RuntimeStateRedisService {
  constructor(
    config: RuntimeConfig,
    keyspace: RuntimeStateKeyspaceService,
    private readonly client: FakeRuntimeRedisClient
  ) {
    super(config, keyspace);
  }

  protected override async getClient(): Promise<FakeRuntimeRedisClient> {
    return this.client;
  }
}

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
    RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS: 5_000
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

function createBundle(bundleHash: string, publishedVersionId: string): RuntimeBundleRef {
  return {
    bundleId: `bundle-${publishedVersionId}`,
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    publishedVersionId,
    bundleHash,
    compiledAt: "2026-04-11T00:00:00.000Z"
  };
}

export async function runRuntimeStateRedisServiceTest(): Promise<void> {
  const config = createConfig();
  const keyspace = new RuntimeStateKeyspaceService(config);
  const client = new FakeRuntimeRedisClient();
  const service = new TestRuntimeStateRedisService(config, keyspace, client);
  const conversation = createConversation();

  await service.setConversationSessionPointer(conversation, "session-1");
  assert.equal(await service.getConversationSessionPointer(conversation), "session-1");
  await service.clearConversationSessionPointer(conversation);
  assert.equal(await service.getConversationSessionPointer(conversation), null);
  await service.setConversationSessionPointer(conversation, "session-1");

  assert.equal(await service.tryAcquireSessionLease("session-1", "owner-1"), true);
  assert.equal(await service.renewSessionLease("session-1", "owner-1"), true);
  assert.equal(await service.renewSessionLease("session-1", "owner-2"), false);
  assert.equal(await service.tryAcquireSessionLease("session-1", "owner-2"), false);
  assert.equal(await service.releaseSessionLease("session-1", "owner-2"), false);
  assert.equal(await service.releaseSessionLease("session-1", "owner-1"), true);
  assert.equal(await service.renewSessionLease("session-1", "owner-1"), false);
  assert.equal(await service.tryAcquireSessionLease("session-1", "owner-2"), true);

  const claimConversation = createConversation();
  assert.equal(
    await service.claimAcceptedTurnInFlight({
      sessionId: "session-claim",
      ownerToken: "owner-claim-1",
      conversation: claimConversation,
      idempotencyKey: "turn-claim",
      requestId: "request-claim-1"
    }),
    "acquired"
  );
  assert.equal(
    await service.readTurnInFlightMarker({
      conversation: claimConversation,
      idempotencyKey: "turn-claim"
    }),
    "request-claim-1"
  );
  assert.equal(
    await service.claimAcceptedTurnInFlight({
      sessionId: "session-claim",
      ownerToken: "owner-claim-2",
      conversation: claimConversation,
      idempotencyKey: "turn-claim",
      requestId: "request-claim-2"
    }),
    "in_flight"
  );
  await service.clearTurnInFlightMarker({
    conversation: claimConversation,
    idempotencyKey: "turn-claim"
  });
  assert.equal(
    await service.claimAcceptedTurnInFlight({
      sessionId: "session-claim",
      ownerToken: "owner-claim-3",
      conversation: claimConversation,
      idempotencyKey: "turn-other",
      requestId: "request-claim-3"
    }),
    "busy"
  );
  assert.equal(await service.releaseSessionLease("session-claim", "owner-claim-1"), true);
  assert.equal(
    await service.claimAcceptedTurnInFlight({
      sessionId: "session-claim",
      ownerToken: "owner-claim-4",
      conversation: claimConversation,
      idempotencyKey: "turn-other",
      requestId: "request-claim-4"
    }),
    "acquired"
  );

  await service.writeTurnReceiptMarker({
    conversation,
    idempotencyKey: "turn-1",
    requestId: "request-1"
  });
  assert.equal(
    await service.readTurnReceiptMarker({
      conversation,
      idempotencyKey: "turn-1"
    }),
    "request-1"
  );

  const bundleOne = createBundle(
    "1111111111111111111111111111111111111111111111111111111111111111",
    "version-1"
  );
  const bundleTwo = createBundle(
    "2222222222222222222222222222222222222222222222222222222222222222",
    "version-2"
  );

  await service.markBundleWarm(bundleOne);
  await service.markBundleWarm(bundleTwo);

  assert.equal(await service.isBundleWarm(bundleOne), true);
  assert.equal(await service.isBundleWarm(bundleTwo), true);

  assert.equal(
    await service.invalidateBundleMarkers({
      assistantId: "assistant-1",
      publishedVersionId: "version-1"
    }),
    1
  );
  assert.equal(await service.isBundleWarm(bundleOne), false);
  assert.equal(await service.isBundleWarm(bundleTwo), true);

  assert.equal(
    await service.invalidateBundleMarkers({
      assistantId: "assistant-1"
    }),
    1
  );
  assert.equal(await service.isBundleWarm(bundleTwo), false);
}
