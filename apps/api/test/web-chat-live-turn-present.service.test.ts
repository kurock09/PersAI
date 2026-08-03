import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { WebChatLiveTurnPresentService } from "../src/modules/workspace-management/application/web-chat-live-turn-present.service";

describe("WebChatLiveTurnPresentService", () => {
  const postgresIntegrationUrl =
    process.env.PERSAI_POSTGRES_INTEGRATION_URL ??
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";

  test("publishes media + open-jobs snapshot on the owning turn bus", async () => {
    const published: Array<{ event: string; payload: unknown }> = [];
    const service = new WebChatLiveTurnPresentService(
      {
        assistantWebChatTurnAttempt: {
          findFirst: async () => ({
            assistantId: "assistant-1",
            userId: "user-1",
            chatId: "chat-1",
            surfaceThreadKey: "web:user-1",
            clientTurnId: "client-turn-1",
            userMessageId: "user-message-1",
            assistantMessageId: "assistant-message-1"
          })
        }
      } as never,
      {
        publish: (input: { event: string; payload: unknown }) => {
          published.push({ event: input.event, payload: input.payload });
        }
      } as never,
      {
        bindAssistantMessageId: async () => undefined
      } as never,
      {
        listOpenJobsForWebChat: async () => []
      } as never,
      {
        listOpenJobsForWebChat: async () => []
      } as never,
      {
        claimOpenTurnLivePresent: async () => "newly_claimed",
        listOpenSandboxJobsForWebChat: async () => []
      } as never,
      {
        createMessage: async () => ({
          id: "assistant-message-1"
        })
      } as never
    );

    const attempt = await service.findOpenUserTurnAttempt({
      assistantId: "assistant-1",
      chatId: "chat-1",
      userMessageId: "user-message-1"
    });
    assert.ok(attempt);
    assert.equal(attempt.clientTurnId, "client-turn-1");

    service.publishMedia({
      attempt,
      assistantMessageId: "assistant-message-1",
      attachments: [
        {
          id: "att-1",
          path: "ws/a/s/onion.png",
          thumbnailStoragePath: null,
          posterStoragePath: null,
          attachmentType: "image",
          originalFilename: "onion.png",
          mimeType: "image/png",
          sizeBytes: 1024,
          processingStatus: "ready",
          createdAt: "2026-07-26T17:42:58.000Z"
        }
      ]
    });
    await service.publishOpenJobsSnapshot({
      attempt,
      terminalJob: { kind: "media", id: "media-terminal-1" }
    });

    assert.equal(published.length, 2);
    assert.equal(published[0]?.event, "media");
    assert.deepEqual(published[0]?.payload, {
      assistantMessageId: "assistant-message-1",
      attachments: [
        {
          id: "att-1",
          path: "ws/a/s/onion.png",
          thumbnailStoragePath: null,
          posterStoragePath: null,
          attachmentType: "image",
          originalFilename: "onion.png",
          mimeType: "image/png",
          sizeBytes: 1024,
          processingStatus: "ready",
          createdAt: "2026-07-26T17:42:58.000Z"
        }
      ]
    });
    assert.equal(published[1]?.event, "async_jobs_open");
    assert.deepEqual(published[1]?.payload, {
      activeMediaJobs: [],
      activeDocumentJobs: [],
      activeSandboxJobs: [],
      terminalJob: { kind: "media", id: "media-terminal-1" }
    });
  });

  test("query shape includes null surfaceClient and excludes async_continuation", async () => {
    let capturedWhere: Record<string, unknown> | null = null;
    const service = new WebChatLiveTurnPresentService(
      {
        assistantWebChatTurnAttempt: {
          findFirst: async (input: { where: Record<string, unknown> }) => {
            capturedWhere = input.where;
            return null;
          }
        }
      } as never,
      { publish: () => undefined } as never,
      { bindAssistantMessageId: async () => undefined } as never,
      { listOpenJobsForWebChat: async () => [] } as never,
      { listOpenJobsForWebChat: async () => [] } as never,
      {
        claimOpenTurnLivePresent: async () => "newly_claimed",
        listOpenSandboxJobsForWebChat: async () => []
      } as never,
      { createMessage: async () => ({ id: "assistant-message-1" }) } as never
    );

    await service.findOpenUserTurnAttempt({
      assistantId: "assistant-1",
      chatId: "chat-1",
      userMessageId: "user-message-1"
    });

    assert.deepEqual(capturedWhere, {
      assistantId: "assistant-1",
      chatId: "chat-1",
      userMessageId: "user-message-1",
      status: "running",
      OR: [{ surfaceClient: null }, { surfaceClient: { not: "async_continuation" } }]
    });
  });

  test("PostgreSQL includes null surfaceClient and excludes async_continuation", async (t) => {
    const prisma = new PrismaClient({
      datasources: { db: { url: postgresIntegrationUrl } }
    });
    try {
      try {
        await prisma.$connect();
      } catch {
        t.skip("Postgres unavailable for live-turn SQL probe");
        return;
      }
      // TEMP tables are invisible to Prisma model queries (they hit public).
      // Probe the SQL predicate that mirrors findOpenOrdinaryUserTurnAttempt.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
          CREATE TEMP TABLE "assistant_web_chat_turn_attempts" (
            "assistant_id" uuid NOT NULL,
            "user_id" uuid NOT NULL,
            "chat_id" uuid,
            "surface_thread_key" text NOT NULL,
            "client_turn_id" text NOT NULL,
            "user_message_id" uuid,
            "assistant_message_id" uuid,
            "status" text NOT NULL,
            "surface_client" text,
            "running_at" timestamptz,
            "updated_at" timestamptz NOT NULL
          ) ON COMMIT DROP
        `);
        await tx.$executeRawUnsafe(`
          INSERT INTO "assistant_web_chat_turn_attempts"
            ("assistant_id", "user_id", "chat_id", "surface_thread_key", "client_turn_id",
             "user_message_id", "assistant_message_id", "status", "surface_client",
             "running_at", "updated_at")
          VALUES
            ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000020',
             '00000000-0000-0000-0000-000000000030', 'thread-ordinary', 'turn-ordinary-null',
             '00000000-0000-0000-0000-000000000040', NULL, 'running', NULL,
             NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '2 minutes'),
            ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000020',
             '00000000-0000-0000-0000-000000000030', 'thread-async', 'turn-async',
             '00000000-0000-0000-0000-000000000040', NULL, 'running', 'async_continuation',
             NOW(), NOW())
        `);
        const rows = await tx.$queryRawUnsafe<
          Array<{ client_turn_id: string; surface_thread_key: string }>
        >(`
          SELECT "client_turn_id", "surface_thread_key"
          FROM "assistant_web_chat_turn_attempts"
          WHERE "assistant_id" = '00000000-0000-0000-0000-000000000010'
            AND "chat_id" = '00000000-0000-0000-0000-000000000030'
            AND "user_message_id" = '00000000-0000-0000-0000-000000000040'
            AND "status" = 'running'
            AND ("surface_client" IS NULL OR "surface_client" <> 'async_continuation')
          ORDER BY "running_at" DESC NULLS LAST, "updated_at" DESC
          LIMIT 1
        `);
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.client_turn_id, "turn-ordinary-null");
        assert.equal(rows[0]?.surface_thread_key, "thread-ordinary");
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});
