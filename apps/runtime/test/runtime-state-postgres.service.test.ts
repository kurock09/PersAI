import assert from "node:assert/strict";
import type { RuntimeConversationAddress } from "@persai/runtime-contract";
import { RuntimeStatePostgresService } from "../src/modules/runtime-state/infrastructure/persistence/runtime-state-postgres.service";
import type { RuntimeStatePrismaService } from "../src/modules/runtime-state/infrastructure/persistence/runtime-state-prisma.service";

function createConversation(): RuntimeConversationAddress {
  return {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    channel: "web",
    externalThreadKey: "web-thread-1",
    externalUserKey: "user-1",
    mode: "direct"
  };
}

export async function runRuntimeStatePostgresServiceTest(): Promise<void> {
  const calls: Record<string, unknown> = {};

  const prisma = {
    runtimeBundleState: {
      upsert: async (args: unknown) => {
        calls.bundleUpsert = args;
        return args;
      },
      updateMany: async (args: unknown) => {
        calls.bundleInvalidate = args;
        return { count: 1 };
      }
    },
    runtimeSession: {
      findUnique: async (args: unknown) => {
        calls.sessionFindUnique = args;
        return args;
      },
      update: async (args: unknown) => {
        calls.sessionUpdate = args;
        return {
          id: "session-1",
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          currentPublishedVersionId: "version-1",
          runtimeTier: "paid_shared_restricted",
          conversationKey: "conversation-1",
          channel: "web",
          externalThreadKey: "web-thread-1",
          externalUserKey: "user-1",
          mode: "direct",
          currentBundleHash: "hash-2",
          currentTokens: 321,
          totalTokensFresh: true,
          compactionCount: 2,
          compactionHintTokens: 400,
          providerKey: "openai",
          modelKey: "gpt-5.4",
          lastTurnAt: new Date("2026-04-11T12:05:00.000Z"),
          closedAt: null,
          createdAt: new Date("2026-04-11T12:00:00.000Z"),
          updatedAt: new Date("2026-04-11T12:05:00.000Z")
        };
      },
      upsert: async (args: unknown) => {
        calls.sessionUpsert = args;
        return args;
      }
    },
    runtimeSessionCompaction: {
      create: async (args: unknown) => {
        calls.compactionCreate = args;
        return args;
      }
    },
    runtimeTurnReceipt: {
      create: async (args: unknown) => {
        calls.receiptCreate = args;
        return args;
      },
      update: async (args: unknown) => {
        calls.receiptUpdate = args;
        return args;
      }
    }
  } as unknown as RuntimeStatePrismaService;

  const service = new RuntimeStatePostgresService(prisma);

  await service.upsertBundleState({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    materializedSpecId: "spec-1",
    publishedVersionId: "version-1",
    runtimeTier: "free_shared_restricted",
    bundleHash: "hash-1"
  });

  assert.deepEqual(calls.bundleUpsert, {
    where: {
      publishedVersionId: "version-1"
    },
    create: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      materializedSpecId: "spec-1",
      publishedVersionId: "version-1",
      runtimeTier: "free_shared_restricted",
      bundleHash: "hash-1",
      lastWarmedAt: null,
      invalidatedAt: null
    },
    update: {
      materializedSpecId: "spec-1",
      runtimeTier: "free_shared_restricted",
      bundleHash: "hash-1"
    }
  });

  await service.upsertSession({
    conversationKey: "conversation-1",
    conversation: createConversation(),
    runtimeTier: "paid_shared_restricted",
    currentPublishedVersionId: "version-1",
    currentBundleHash: "hash-1",
    currentTokens: 123,
    totalTokensFresh: false,
    compactionCount: 2,
    compactionHintTokens: 400,
    providerKey: "openai",
    modelKey: "gpt-5.4"
  });

  assert.deepEqual(calls.sessionUpsert, {
    where: {
      conversationKey: "conversation-1"
    },
    create: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      currentPublishedVersionId: "version-1",
      runtimeTier: "paid_shared_restricted",
      conversationKey: "conversation-1",
      channel: "web",
      externalThreadKey: "web-thread-1",
      externalUserKey: "user-1",
      mode: "direct",
      currentBundleHash: "hash-1",
      currentTokens: 123,
      totalTokensFresh: false,
      compactionCount: 2,
      compactionHintTokens: 400,
      providerKey: "openai",
      modelKey: "gpt-5.4",
      lastTurnAt: null,
      closedAt: null
    },
    update: {
      currentPublishedVersionId: "version-1",
      runtimeTier: "paid_shared_restricted",
      channel: "web",
      externalThreadKey: "web-thread-1",
      externalUserKey: "user-1",
      mode: "direct",
      currentBundleHash: "hash-1",
      currentTokens: 123,
      totalTokensFresh: false,
      compactionCount: 2,
      compactionHintTokens: 400,
      providerKey: "openai",
      modelKey: "gpt-5.4"
    }
  });

  await service.findSessionById("session-1");

  assert.deepEqual(calls.sessionFindUnique, {
    where: {
      id: "session-1"
    }
  });

  await service.updateSession({
    sessionId: "session-1",
    currentBundleHash: "hash-2",
    currentTokens: 321,
    totalTokensFresh: true,
    providerKey: "openai",
    modelKey: "gpt-5.4",
    lastTurnAt: new Date("2026-04-11T12:05:00.000Z")
  });

  assert.deepEqual(calls.sessionUpdate, {
    where: {
      id: "session-1"
    },
    data: {
      currentBundleHash: "hash-2",
      currentTokens: 321,
      totalTokensFresh: true,
      providerKey: "openai",
      modelKey: "gpt-5.4",
      lastTurnAt: new Date("2026-04-11T12:05:00.000Z")
    }
  });

  await service.createAcceptedTurnReceipt({
    runtimeSessionId: "session-1",
    publishedVersionId: "version-1",
    runtimeTier: "paid_shared_restricted",
    conversationKey: "conversation-1",
    conversation: createConversation(),
    requestId: "request-1",
    idempotencyKey: "turn-1",
    bundleHash: "hash-1"
  });

  assert.deepEqual(calls.receiptCreate, {
    data: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      runtimeSessionId: "session-1",
      publishedVersionId: "version-1",
      runtimeTier: "paid_shared_restricted",
      conversationKey: "conversation-1",
      channel: "web",
      externalThreadKey: "web-thread-1",
      externalUserKey: "user-1",
      mode: "direct",
      requestId: "request-1",
      idempotencyKey: "turn-1",
      bundleHash: "hash-1",
      status: "accepted"
    }
  });

  await service.appendSessionCompaction({
    runtimeSessionId: "session-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    requestId: "request-1",
    reason: "shared_compaction",
    instructions: "Keep durable facts only.",
    summaryPayload: {
      schema: "persai.runtimeSessionCompaction.v1",
      summaryText: "Short summary"
    },
    tokensBefore: 321,
    tokensAfter: null
  });

  assert.deepEqual(calls.compactionCreate, {
    data: {
      runtimeSessionId: "session-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      requestId: "request-1",
      reason: "shared_compaction",
      instructions: "Keep durable facts only.",
      summaryPayload: {
        schema: "persai.runtimeSessionCompaction.v1",
        summaryText: "Short summary"
      },
      tokensBefore: 321,
      tokensAfter: null
    }
  });

  const completedAt = new Date("2026-04-11T12:00:00.000Z");
  await service.markTurnReceiptCompleted({
    requestId: "request-1",
    resultPayload: { ok: true },
    completedAt
  });

  assert.deepEqual(calls.receiptUpdate, {
    where: {
      requestId: "request-1"
    },
    data: {
      status: "completed",
      resultPayload: { ok: true },
      errorCode: null,
      errorMessage: null,
      completedAt
    }
  });

  const invalidatedAt = new Date("2026-04-11T12:01:00.000Z");
  await service.invalidateBundleStates({
    assistantId: "assistant-1",
    publishedVersionId: "version-1",
    invalidatedAt
  });

  assert.deepEqual(calls.bundleInvalidate, {
    where: {
      assistantId: "assistant-1",
      publishedVersionId: "version-1"
    },
    data: {
      invalidatedAt
    }
  });
}
