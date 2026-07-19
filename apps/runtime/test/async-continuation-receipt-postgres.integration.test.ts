import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RuntimeConfig } from "@persai/config";
import { PrismaClient } from "@prisma/client";
import type { RuntimeConversationAddress } from "@persai/runtime-contract";
import { RuntimeStatePostgresService } from "../src/modules/runtime-state/infrastructure/persistence/runtime-state-postgres.service";
import { RuntimeStateKeyspaceService } from "../src/modules/runtime-state/runtime-state-keyspace.service";
import { IdempotencyService } from "../src/modules/turns/idempotency.service";
import { InternalRuntimeAsyncContinuationsController } from "../src/modules/turns/interface/http/internal-runtime-async-continuations.controller";

const baseDatabaseUrl =
  process.env.PERSAI_POSTGRES_INTEGRATION_URL ??
  "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";

function databaseUrlForSchema(schema: string): string {
  const url = new URL(baseDatabaseUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

function createConfig(databaseUrl: string, redisPrefix: string): RuntimeConfig {
  return {
    APP_ENV: "local",
    DATABASE_URL: databaseUrl,
    PORT: 3012,
    LOG_LEVEL: "info",
    PERSAI_INTERNAL_API_TOKEN: "integration-internal-token",
    RUNTIME_STATE_REDIS_URL: process.env.RUNTIME_STATE_REDIS_URL ?? "redis://localhost:6379",
    RUNTIME_BUNDLE_CACHE_MAX_ENTRIES: 8,
    RUNTIME_STATE_REDIS_KEY_PREFIX: redisPrefix,
    RUNTIME_SESSION_LEASE_TTL_SECONDS: 45,
    RUNTIME_TURN_RECEIPT_TTL_SECONDS: 3600,
    RUNTIME_BUNDLE_MARKER_TTL_SECONDS: 7200,
    RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS: 5_000,
    RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 15_000,
    RUNTIME_SANDBOX_TIMEOUT_MS: 30_000,
    RUNTIME_SANDBOX_POD_PROVISION_BUDGET_MS: 240_000,
    PERSAI_MEDIA_OBJECT_PREFIX: "integration",
    ORPHAN_RECEIPT_GRACE_MS: 60_000
  };
}

export async function runAsyncContinuationReceiptPostgresIntegrationTest(): Promise<void> {
  const schema = `receipt_p1_${randomUUID().replaceAll("-", "")}`;
  const assistantId = randomUUID();
  const workspaceId = randomUUID();
  const sessionId = randomUUID();
  const requestIds = [`request-${randomUUID()}`, `request-${randomUUID()}`] as const;
  const idempotencyKey = `async-cont:${randomUUID()}`;
  const conversation: RuntimeConversationAddress = {
    assistantId,
    workspaceId,
    channel: "web",
    externalThreadKey: `thread-${randomUUID()}`,
    externalUserKey: `user-${randomUUID()}`,
    mode: "direct"
  };
  const schemaUrl = databaseUrlForSchema(schema);
  const config = createConfig(schemaUrl, `persai:receipt-p1:${randomUUID()}`);
  const keyspace = new RuntimeStateKeyspaceService(config);
  const conversationKey = keyspace.createConversationKey(conversation);
  const admin = new PrismaClient({
    datasources: { db: { url: baseDatabaseUrl } }
  });
  let first: PrismaClient | null = null;
  let second: PrismaClient | null = null;

  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await admin.$executeRawUnsafe(
      `CREATE TYPE "${schema}"."RuntimeTier" AS ENUM
       ('free_shared_restricted', 'paid_shared_restricted', 'paid_isolated')`
    );
    await admin.$executeRawUnsafe(
      `CREATE TYPE "${schema}"."RuntimeConversationChannel" AS ENUM
       ('web', 'telegram', 'max_ru')`
    );
    await admin.$executeRawUnsafe(
      `CREATE TYPE "${schema}"."RuntimeConversationMode" AS ENUM ('direct', 'group')`
    );
    await admin.$executeRawUnsafe(
      `CREATE TYPE "${schema}"."RuntimeTurnReceiptStatus" AS ENUM
       ('accepted', 'completed', 'interrupted', 'failed')`
    );
    await admin.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."runtime_turn_receipts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "assistant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "runtime_session_id" uuid,
        "published_version_id" uuid,
        "runtime_tier" "${schema}"."RuntimeTier" NOT NULL,
        "conversation_key" varchar(64) NOT NULL,
        "channel" "${schema}"."RuntimeConversationChannel" NOT NULL,
        "external_thread_key" varchar(255) NOT NULL,
        "external_user_key" varchar(255),
        "mode" "${schema}"."RuntimeConversationMode" NOT NULL,
        "request_id" varchar(128) NOT NULL UNIQUE,
        "idempotency_key" varchar(128) NOT NULL,
        "bundle_hash" varchar(64),
        "status" "${schema}"."RuntimeTurnReceiptStatus" NOT NULL DEFAULT 'accepted',
        "result_payload" jsonb,
        "error_code" varchar(128),
        "error_message" text,
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("conversation_key", "idempotency_key")
      )
    `);

    first = new PrismaClient({ datasources: { db: { url: schemaUrl } } });
    second = new PrismaClient({ datasources: { db: { url: schemaUrl } } });
    await Promise.all([first.$connect(), second.$connect()]);
    const firstStore = new RuntimeStatePostgresService(first as never);
    const secondStore = new RuntimeStatePostgresService(second as never);
    const createInput = (requestId: string) => ({
      runtimeSessionId: sessionId,
      publishedVersionId: null,
      runtimeTier: "paid_shared_restricted" as const,
      conversationKey,
      conversation,
      requestId,
      idempotencyKey,
      bundleHash: "b".repeat(64)
    });

    // Two distinct transport requests race on separate PostgreSQL connections.
    const raced = await Promise.allSettled([
      firstStore.createAcceptedTurnReceipt(createInput(requestIds[0])),
      secondStore.createAcceptedTurnReceipt(createInput(requestIds[1]))
    ]);
    const fulfilled = raced.filter(
      (
        result
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof firstStore.createAcceptedTurnReceipt>>
      > => result.status === "fulfilled"
    );
    const rejected = raced.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    assert.equal(
      fulfilled.length,
      1,
      `exactly one logical continuation must be admitted: ${rejected
        .map((result) => String(result.reason))
        .join(" | ")}`
    );
    assert.equal(rejected.length, 1, "the competing requestId must hit receipt uniqueness");
    assert.equal(
      (rejected[0]?.reason as { code?: string }).code,
      "P2002",
      "the production Prisma uniqueness path must reject the loser"
    );
    const winningRequestId = fulfilled[0]!.value.requestId;
    const losingRequestId = winningRequestId === requestIds[0] ? requestIds[1] : requestIds[0];

    const idempotency = new IdempotencyService(keyspace, firstStore, {
      readTurnReceiptMarker: async () => null,
      writeTurnReceiptMarker: async () => undefined
    } as never);
    const controller = new InternalRuntimeAsyncContinuationsController(
      {} as never,
      idempotency,
      { readAcceptedTurnInFlight: async () => null } as never,
      config
    );
    const statusBody = {
      requestId: losingRequestId,
      idempotencyKey,
      conversation,
      sessionId
    };
    const authorizedRequest = {
      headers: { authorization: `Bearer ${config.PERSAI_INTERNAL_API_TOKEN}` }
    };

    const acceptedStatus = await controller.status(authorizedRequest as never, statusBody as never);
    assert.equal(acceptedStatus.receiptStatus, "absent");
    assert.equal(acceptedStatus.logicalReceiptStatus, "accepted");
    assert.equal(acceptedStatus.logicalReceiptRequestId, winningRequestId);
    assert.equal(acceptedStatus.logicalEverAccepted, true);
    assert.equal(acceptedStatus.logicalOrphanReconciled, false);

    const reconciled = await firstStore.reconcileOrphanAcceptedTurnReceipt({
      requestId: winningRequestId,
      reconciledAt: new Date(),
      errorCode: "orphan_reconciled",
      errorMessage: "integration orphan"
    });
    assert.equal(reconciled.count, 1);

    const orphanStatus = await controller.status(authorizedRequest as never, statusBody as never);
    assert.equal(orphanStatus.receiptStatus, "absent");
    assert.equal(orphanStatus.logicalReceiptStatus, "failed");
    assert.equal(orphanStatus.logicalReceiptRequestId, winningRequestId);
    assert.equal(orphanStatus.logicalEverAccepted, true);
    assert.equal(orphanStatus.logicalOrphanReconciled, true);

    const replay = await idempotency.createAcceptedTurn({
      requestId: losingRequestId,
      idempotencyKey,
      runtimeTier: "paid_shared_restricted",
      conversation,
      bundle: {
        bundleId: "bundle-integration",
        assistantId,
        workspaceId,
        publishedVersionId: randomUUID(),
        bundleHash: "b".repeat(64),
        compiledAt: new Date().toISOString()
      },
      sessionId
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.receipt.requestId, winningRequestId);
    assert.equal(replay.receipt.errorCode, "orphan_reconciled");

    const rows = await first.$queryRawUnsafe<
      Array<{ requestId: string; status: string; errorCode: string | null }>
    >(
      `SELECT "request_id" AS "requestId", "status", "error_code" AS "errorCode"
       FROM "${schema}"."runtime_turn_receipts"`
    );
    assert.deepEqual(rows, [
      {
        requestId: winningRequestId,
        status: "failed",
        errorCode: "orphan_reconciled"
      }
    ]);
  } finally {
    await Promise.allSettled([first?.$disconnect(), second?.$disconnect()]);
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}

void runAsyncContinuationReceiptPostgresIntegrationTest().then(() => {
  console.log("async-continuation-receipt-postgres.integration.test.ts passed");
});
