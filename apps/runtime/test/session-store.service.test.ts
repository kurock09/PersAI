import assert from "node:assert/strict";
import type { RuntimeConfig } from "@persai/config";
import type { PersaiRuntimeTier, RuntimeConversationAddress } from "@persai/runtime-contract";
import type { RuntimeSession } from "@prisma/client";
import { SessionStoreService } from "../src/modules/sessions/session-store.service";
import { RuntimeStateKeyspaceService } from "../src/modules/runtime-state/runtime-state-keyspace.service";
import type { RuntimeStateRedisService } from "../src/modules/runtime-state/infrastructure/coordination/runtime-state-redis.service";
import type {
  RuntimeStatePostgresService,
  UpdateRuntimeSessionInput,
  UpsertRuntimeSessionInput
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
    assistantId: "3bbccd8e-8ad3-4961-9b9d-bc630554fa91",
    workspaceId: "54f58d0e-76a7-4d6d-9d5d-a777a935a7c0",
    channel: "web",
    externalThreadKey,
    externalUserKey: "user-1",
    mode: "direct"
  };
}

function createSession(params: {
  id: string;
  conversationKey: string;
  conversation: RuntimeConversationAddress;
  runtimeTier: PersaiRuntimeTier;
  closedAt?: Date | null;
  currentBundleHash?: string | null;
  currentTokens?: number | null;
  providerKey?: string | null;
  modelKey?: string | null;
}): RuntimeSession {
  return {
    id: params.id,
    assistantId: params.conversation.assistantId,
    workspaceId: params.conversation.workspaceId,
    currentPublishedVersionId: "version-1",
    runtimeTier: params.runtimeTier,
    conversationKey: params.conversationKey,
    channel: params.conversation.channel,
    externalThreadKey: params.conversation.externalThreadKey,
    externalUserKey: params.conversation.externalUserKey,
    mode: params.conversation.mode,
    currentBundleHash: params.currentBundleHash ?? null,
    currentTokens: params.currentTokens ?? null,
    totalTokensFresh: true,
    compactionCount: 0,
    compactionHintTokens: null,
    memoryExtractionWatermark: 0,
    providerKey: params.providerKey ?? null,
    modelKey: params.modelKey ?? null,
    lastTurnAt: null,
    closedAt: params.closedAt ?? null,
    createdAt: new Date("2026-04-11T12:00:00.000Z"),
    updatedAt: new Date("2026-04-11T12:00:00.000Z")
  };
}

class FakeRuntimeStatePostgresService {
  readonly sessionsById = new Map<string, RuntimeSession>();
  readonly sessionsByConversationKey = new Map<string, RuntimeSession>();
  lastUpsertInput: UpsertRuntimeSessionInput | null = null;
  lastUpdateInput: UpdateRuntimeSessionInput | null = null;
  private upsertCount = 0;

  async findSessionById(id: string): Promise<RuntimeSession | null> {
    return this.sessionsById.get(id) ?? null;
  }

  async findSessionByConversationKey(conversationKey: string): Promise<RuntimeSession | null> {
    return this.sessionsByConversationKey.get(conversationKey) ?? null;
  }

  async upsertSession(input: UpsertRuntimeSessionInput): Promise<RuntimeSession> {
    this.lastUpsertInput = input;
    const existing = this.sessionsByConversationKey.get(input.conversationKey);
    const updatedAt = new Date(`2026-04-11T12:00:0${this.upsertCount}.000Z`);
    this.upsertCount += 1;

    const session: RuntimeSession = {
      id: existing?.id ?? `session-${this.upsertCount}`,
      assistantId: input.conversation.assistantId,
      workspaceId: input.conversation.workspaceId,
      currentPublishedVersionId:
        input.currentPublishedVersionId ?? existing?.currentPublishedVersionId ?? null,
      runtimeTier: input.runtimeTier,
      conversationKey: input.conversationKey,
      channel: input.conversation.channel,
      externalThreadKey: input.conversation.externalThreadKey,
      externalUserKey: input.conversation.externalUserKey,
      mode: input.conversation.mode,
      currentBundleHash: input.currentBundleHash ?? existing?.currentBundleHash ?? null,
      currentTokens: input.currentTokens ?? existing?.currentTokens ?? null,
      totalTokensFresh: input.totalTokensFresh ?? existing?.totalTokensFresh ?? true,
      compactionCount: input.compactionCount ?? existing?.compactionCount ?? 0,
      compactionHintTokens: input.compactionHintTokens ?? existing?.compactionHintTokens ?? null,
      memoryExtractionWatermark:
        input.memoryExtractionWatermark ?? existing?.memoryExtractionWatermark ?? 0,
      providerKey: input.providerKey ?? existing?.providerKey ?? null,
      modelKey: input.modelKey ?? existing?.modelKey ?? null,
      lastTurnAt: input.lastTurnAt ?? existing?.lastTurnAt ?? null,
      closedAt: input.closedAt ?? existing?.closedAt ?? null,
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt
    };

    this.sessionsById.set(session.id, session);
    this.sessionsByConversationKey.set(session.conversationKey, session);
    return session;
  }

  async updateSession(input: UpdateRuntimeSessionInput): Promise<RuntimeSession> {
    this.lastUpdateInput = input;
    const existing = this.sessionsById.get(input.sessionId);
    if (existing === undefined) {
      throw new Error(`Missing runtime session for ${input.sessionId}`);
    }

    const session: RuntimeSession = {
      ...existing,
      currentPublishedVersionId:
        input.currentPublishedVersionId ?? existing.currentPublishedVersionId,
      runtimeTier: input.runtimeTier ?? existing.runtimeTier,
      currentBundleHash: input.currentBundleHash ?? existing.currentBundleHash,
      currentTokens: input.currentTokens ?? existing.currentTokens,
      totalTokensFresh: input.totalTokensFresh ?? existing.totalTokensFresh,
      compactionCount: input.compactionCount ?? existing.compactionCount,
      compactionHintTokens: input.compactionHintTokens ?? existing.compactionHintTokens,
      memoryExtractionWatermark:
        input.memoryExtractionWatermark ?? existing.memoryExtractionWatermark,
      providerKey: input.providerKey ?? existing.providerKey,
      modelKey: input.modelKey ?? existing.modelKey,
      lastTurnAt: input.lastTurnAt ?? existing.lastTurnAt,
      closedAt: input.closedAt ?? existing.closedAt,
      updatedAt: new Date("2026-04-11T12:10:00.000Z")
    };

    this.sessionsById.set(session.id, session);
    this.sessionsByConversationKey.set(session.conversationKey, session);
    return session;
  }
}

class FakeRuntimeStateRedisService {
  readonly pointers = new Map<string, string>();
  clearCount = 0;

  async setConversationSessionPointer(
    address: RuntimeConversationAddress,
    sessionId: string
  ): Promise<void> {
    this.pointers.set(JSON.stringify(address), sessionId);
  }

  async getConversationSessionPointer(address: RuntimeConversationAddress): Promise<string | null> {
    return this.pointers.get(JSON.stringify(address)) ?? null;
  }

  async clearConversationSessionPointer(address: RuntimeConversationAddress): Promise<void> {
    this.clearCount += 1;
    this.pointers.delete(JSON.stringify(address));
  }
}

export async function runSessionStoreServiceTest(): Promise<void> {
  const keyspace = new RuntimeStateKeyspaceService(createConfig());
  const postgres = new FakeRuntimeStatePostgresService();
  const redis = new FakeRuntimeStateRedisService();
  const service = new SessionStoreService(
    keyspace,
    postgres as unknown as RuntimeStatePostgresService,
    redis as unknown as RuntimeStateRedisService
  );

  const staleConversation = createConversation("web-thread-stale");
  const staleConversationKey = keyspace.createConversationKey(staleConversation);
  const stalePointerRow = createSession({
    id: "session-stale",
    conversationKey: staleConversationKey,
    conversation: staleConversation,
    runtimeTier: "paid_shared_restricted",
    closedAt: new Date("2026-04-11T11:59:00.000Z")
  });
  const healedRow = createSession({
    id: "session-healed",
    conversationKey: staleConversationKey,
    conversation: staleConversation,
    runtimeTier: "paid_shared_restricted",
    currentTokens: 88
  });
  postgres.sessionsById.set(stalePointerRow.id, stalePointerRow);
  postgres.sessionsByConversationKey.set(staleConversationKey, healedRow);
  redis.pointers.set(JSON.stringify(staleConversation), stalePointerRow.id);

  const healed = await service.resolveSession({
    runtimeTier: "paid_shared_restricted",
    conversation: staleConversation
  });

  assert.equal(healed.found, true);
  assert.equal(healed.conversationKey, staleConversationKey);
  assert.equal(healed.session?.sessionId, healedRow.id);
  assert.equal(healed.session?.currentTokens, 88);
  assert.equal(redis.clearCount, 1);
  assert.equal(redis.pointers.get(JSON.stringify(staleConversation)), healedRow.id);

  const freshConversation = createConversation("web-thread-fresh");
  const ensured = await service.ensureSession({
    runtimeTier: "paid_shared_restricted",
    conversation: freshConversation,
    currentPublishedVersionId: "version-2",
    currentBundleHash: "bundle-hash-2"
  });

  assert.equal(ensured.created, true);
  assert.equal(ensured.session.sessionId, "session-1");
  assert.equal(postgres.lastUpsertInput?.currentBundleHash, "bundle-hash-2");
  assert.equal(redis.pointers.get(JSON.stringify(freshConversation)), "session-1");

  const refreshed = await service.ensureSession({
    runtimeTier: "paid_shared_restricted",
    conversation: freshConversation,
    currentTokens: 144,
    providerKey: "openai",
    modelKey: "gpt-5.4"
  });

  assert.equal(refreshed.created, false);
  assert.equal(refreshed.session.currentTokens, 144);
  assert.equal(refreshed.session.providerKey, "openai");
  assert.equal(refreshed.session.modelKey, "gpt-5.4");

  const updated = await service.updateSessionSummary({
    sessionId: "session-1",
    currentTokens: 233,
    totalTokensFresh: false
  });

  assert.equal(updated.currentTokens, 233);
  assert.equal(updated.totalTokensFresh, false);
  assert.deepEqual(postgres.lastUpdateInput, {
    sessionId: "session-1",
    currentTokens: 233,
    totalTokensFresh: false
  });
}
