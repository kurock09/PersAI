import assert from "node:assert/strict";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import {
  ReadSmokeTurnReceiptsService,
  type SmokeTurnReceiptItem
} from "../src/modules/workspace-management/application/read-smoke-turn-receipts.service";
import { InternalSmokeReceiptsController } from "../src/modules/workspace-management/interface/http/internal-smoke-receipts.controller";

interface FakeReceiptRow {
  id: string;
  requestId: string;
  status: string;
  channel: string;
  mode: string;
  conversationKey: string;
  externalThreadKey: string;
  bundleHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
  resultPayload: unknown;
}

function buildPrismaStub(rows: FakeReceiptRow[]): {
  service: ReadSmokeTurnReceiptsService;
  lastWhere: { value: Record<string, unknown> | null };
  lastTake: { value: number | null };
  lastOrderBy: { value: unknown };
} {
  const lastWhere: { value: Record<string, unknown> | null } = { value: null };
  const lastTake: { value: number | null } = { value: null };
  const lastOrderBy: { value: unknown } = { value: null };
  const fakePrisma = {
    runtimeTurnReceipt: {
      async findMany(args: {
        where: Record<string, unknown>;
        orderBy: unknown;
        take: number;
      }): Promise<FakeReceiptRow[]> {
        lastWhere.value = args.where;
        lastTake.value = args.take;
        lastOrderBy.value = args.orderBy;
        return rows;
      }
    }
  };
  const service = new ReadSmokeTurnReceiptsService(fakePrisma as never);
  return { service, lastWhere, lastTake, lastOrderBy };
}

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "smoke-token";

  // 1. happy path: returns mapped receipts incl. usage + tool aggregation + routing/compaction.
  {
    const stub = buildPrismaStub([
      {
        id: "receipt-1",
        requestId: "req-1",
        status: "completed",
        channel: "web",
        mode: "ordinary",
        conversationKey: "conv-1",
        externalThreadKey: "thread-1",
        bundleHash: "hash-abc",
        errorCode: null,
        errorMessage: null,
        createdAt: new Date("2026-04-20T12:00:00.000Z"),
        completedAt: new Date("2026-04-20T12:00:01.234Z"),
        resultPayload: {
          usageAccounting: {
            inputTokens: 1500,
            cachedInputTokens: 1200,
            outputTokens: 80,
            totalTokens: 1580,
            entries: [
              {
                stepType: "ordinary",
                modelRole: "normal",
                providerKey: "openai",
                modelKey: "gpt-5.4-mini",
                inputTokens: 1500,
                cachedInputTokens: 1200,
                outputTokens: 80,
                totalTokens: 1580
              },
              {
                stepType: "tool",
                modelRole: null,
                providerKey: "openai",
                modelKey: "gpt-5.4-mini",
                toolCode: "web_search",
                inputTokens: 200,
                cachedInputTokens: 0,
                outputTokens: 30,
                totalTokens: 230
              },
              {
                stepType: "tool",
                modelRole: null,
                providerKey: "openai",
                modelKey: "gpt-5.4-mini",
                toolCode: "web_search",
                inputTokens: 220,
                cachedInputTokens: 0,
                outputTokens: 25,
                totalTokens: 245
              }
            ]
          },
          turnRouting: { mode: "normal", executionMode: "ordinary_reply" },
          autoCompaction: { tokensBefore: 8000, tokensAfter: 3500 }
        }
      }
    ]);

    const controller = new InternalSmokeReceiptsController(stub.service);
    const result = await controller.listTurnReceipts(
      { headers: { authorization: "Bearer smoke-token" } },
      { assistantId: "assistant-1" }
    );

    assert.equal(result.ok, true);
    assert.equal(result.items.length, 1);
    const item = result.items[0] as SmokeTurnReceiptItem;
    assert.equal(item.requestId, "req-1");
    assert.equal(item.status, "completed");
    assert.equal(item.usage?.inputTokens, 1500);
    assert.equal(item.usage?.cachedInputTokens, 1200);
    assert.equal(item.usage?.outputTokens, 80);
    assert.equal(item.usage?.totalTokens, 1580);
    assert.equal(item.usage?.entries.length, 3);
    assert.deepEqual(item.toolCalls, [{ toolCode: "web_search", count: 2 }]);
    assert.equal(item.toolCallsSource, "usage_entries");
    assert.deepEqual(item.toolInvocations, []);
    assert.equal(item.routingMode, "normal");
    assert.equal(item.routingExecutionMode, "ordinary_reply");
    assert.equal(item.autoCompactionTokensBefore, 8000);
    assert.equal(item.autoCompactionTokensAfter, 3500);
    assert.equal(result.nextCursor, "2026-04-20T12:00:00.000Z");

    assert.deepEqual(stub.lastWhere.value, { assistantId: "assistant-1" });
    assert.equal(stub.lastTake.value, 100);
  }

  // 2. afterCursor + limit propagate to prisma findMany.
  {
    const stub = buildPrismaStub([]);
    const controller = new InternalSmokeReceiptsController(stub.service);
    const result = await controller.listTurnReceipts(
      { headers: { authorization: "Bearer smoke-token" } },
      {
        assistantId: "assistant-1",
        afterCursor: "2026-04-20T12:00:00.000Z",
        limit: "50"
      }
    );

    assert.equal(result.items.length, 0);
    assert.equal(result.nextCursor, null);
    assert.equal(stub.lastTake.value, 50);
    const where = stub.lastWhere.value as { createdAt?: { gt?: Date } };
    assert.ok(where.createdAt?.gt instanceof Date);
    assert.equal(where.createdAt?.gt?.toISOString(), "2026-04-20T12:00:00.000Z");
  }

  // 3. limit clamps to MAX_LIMIT (500).
  {
    const stub = buildPrismaStub([]);
    const controller = new InternalSmokeReceiptsController(stub.service);
    await controller.listTurnReceipts(
      { headers: { authorization: "Bearer smoke-token" } },
      { assistantId: "assistant-1", limit: "5000" }
    );
    assert.equal(stub.lastTake.value, 500);
  }

  // 4. missing assistantId returns 400 ApiErrorHttpException.
  {
    const stub = buildPrismaStub([]);
    const controller = new InternalSmokeReceiptsController(stub.service);
    await assert.rejects(
      () => controller.listTurnReceipts({ headers: { authorization: "Bearer smoke-token" } }, {}),
      (error: unknown) =>
        error instanceof ApiErrorHttpException && error.errorObject.code === "assistant_id_required"
    );
  }

  // 5. invalid afterCursor returns 400 ApiErrorHttpException.
  {
    const stub = buildPrismaStub([]);
    const controller = new InternalSmokeReceiptsController(stub.service);
    await assert.rejects(
      () =>
        controller.listTurnReceipts(
          { headers: { authorization: "Bearer smoke-token" } },
          { assistantId: "assistant-1", afterCursor: "not-a-date" }
        ),
      (error: unknown) =>
        error instanceof ApiErrorHttpException && error.errorObject.code === "after_cursor_invalid"
    );
  }

  // 6. invalid limit returns 400 ApiErrorHttpException.
  {
    const stub = buildPrismaStub([]);
    const controller = new InternalSmokeReceiptsController(stub.service);
    await assert.rejects(
      () =>
        controller.listTurnReceipts(
          { headers: { authorization: "Bearer smoke-token" } },
          { assistantId: "assistant-1", limit: "0" }
        ),
      (error: unknown) =>
        error instanceof ApiErrorHttpException && error.errorObject.code === "limit_invalid"
    );
  }

  // 7. unauthorized request rejected before any prisma read.
  {
    const stub = buildPrismaStub([]);
    const controller = new InternalSmokeReceiptsController(stub.service);
    await assert.rejects(() =>
      controller.listTurnReceipts(
        { headers: { authorization: "Bearer wrong-token" } },
        { assistantId: "assistant-1" }
      )
    );
    assert.equal(stub.lastWhere.value, null);
  }

  // 8. requestId filter propagates to prisma findMany.
  {
    const stub = buildPrismaStub([]);
    const controller = new InternalSmokeReceiptsController(stub.service);
    await controller.listTurnReceipts(
      { headers: { authorization: "Bearer smoke-token" } },
      { assistantId: "assistant-1", requestId: "req-xyz" }
    );
    const where = stub.lastWhere.value as { requestId?: string };
    assert.equal(where.requestId, "req-xyz");
  }

  // 9. completely empty resultPayload still produces a sane mapped row (usage=null, no tools).
  {
    const stub = buildPrismaStub([
      {
        id: "receipt-2",
        requestId: "req-2",
        status: "failed",
        channel: "web",
        mode: "ordinary",
        conversationKey: "conv-2",
        externalThreadKey: "thread-2",
        bundleHash: null,
        errorCode: "provider_failed",
        errorMessage: "Provider returned 500.",
        createdAt: new Date("2026-04-20T13:00:00.000Z"),
        completedAt: null,
        resultPayload: null
      }
    ]);
    const controller = new InternalSmokeReceiptsController(stub.service);
    const result = await controller.listTurnReceipts(
      { headers: { authorization: "Bearer smoke-token" } },
      { assistantId: "assistant-1" }
    );
    const item = result.items[0] as SmokeTurnReceiptItem;
    assert.equal(item.status, "failed");
    assert.equal(item.errorCode, "provider_failed");
    assert.equal(item.usage, null);
    assert.deepEqual(item.toolCalls, []);
    assert.equal(item.toolCallsSource, "none");
    assert.deepEqual(item.toolInvocations, []);
    assert.equal(item.routingMode, null);
    assert.equal(item.autoCompactionTokensBefore, null);
  }

  // 10. toolInvocations in payload take precedence over usage.entries[].toolCode for tool counts.
  {
    const stub = buildPrismaStub([
      {
        id: "receipt-3",
        requestId: "req-3",
        status: "completed",
        channel: "web",
        mode: "ordinary",
        conversationKey: "conv-3",
        externalThreadKey: "thread-3",
        bundleHash: "hash-xyz",
        errorCode: null,
        errorMessage: null,
        createdAt: new Date("2026-04-20T14:00:00.000Z"),
        completedAt: new Date("2026-04-20T14:00:01.500Z"),
        resultPayload: {
          usageAccounting: {
            inputTokens: 5000,
            cachedInputTokens: 2000,
            outputTokens: 200,
            totalTokens: 5200,
            entries: [
              {
                stepType: "main_turn",
                modelRole: "normal_reply",
                providerKey: "openai",
                modelKey: "gpt-5.4-mini",
                inputTokens: 5000,
                cachedInputTokens: 2000,
                outputTokens: 200,
                totalTokens: 5200
              },
              {
                stepType: "tool_execution",
                modelRole: null,
                providerKey: "openai",
                modelKey: "gpt-image-1",
                toolCode: "image_generate",
                inputTokens: 50,
                cachedInputTokens: 0,
                outputTokens: 0,
                totalTokens: 50
              }
            ]
          },
          toolInvocations: [
            { name: "web_search", iteration: 0, ok: true, executionMode: "inline" },
            { name: "web_fetch", iteration: 0, ok: true, executionMode: "inline" },
            { name: "web_fetch", iteration: 0, ok: false, executionMode: "inline" },
            { name: "image_generate", iteration: 1, ok: true, executionMode: "worker" }
          ]
        }
      }
    ]);
    const controller = new InternalSmokeReceiptsController(stub.service);
    const result = await controller.listTurnReceipts(
      { headers: { authorization: "Bearer smoke-token" } },
      { assistantId: "assistant-1" }
    );
    const item = result.items[0] as SmokeTurnReceiptItem;
    assert.equal(item.toolCallsSource, "tool_invocations");
    assert.deepEqual(item.toolCalls, [
      { toolCode: "image_generate", count: 1 },
      { toolCode: "web_fetch", count: 2 },
      { toolCode: "web_search", count: 1 }
    ]);
    assert.equal(item.toolInvocations.length, 4);
    assert.deepEqual(item.toolInvocations[0], {
      name: "web_search",
      iteration: 0,
      ok: true,
      executionMode: "inline"
    });
    assert.equal(item.toolInvocations[2]?.ok, false);
  }

  // 11. malformed toolInvocations entries (missing name, bad types) are filtered out.
  {
    const stub = buildPrismaStub([
      {
        id: "receipt-4",
        requestId: "req-4",
        status: "completed",
        channel: "web",
        mode: "ordinary",
        conversationKey: "conv-4",
        externalThreadKey: "thread-4",
        bundleHash: null,
        errorCode: null,
        errorMessage: null,
        createdAt: new Date("2026-04-20T15:00:00.000Z"),
        completedAt: new Date("2026-04-20T15:00:00.500Z"),
        resultPayload: {
          toolInvocations: [
            { name: "web_search", iteration: 0, ok: true, executionMode: "inline" },
            { name: "", iteration: 0, ok: true },
            { iteration: 0, ok: true },
            "not-an-object",
            { name: "memory_write", iteration: "bad", ok: "true" }
          ]
        }
      }
    ]);
    const controller = new InternalSmokeReceiptsController(stub.service);
    const result = await controller.listTurnReceipts(
      { headers: { authorization: "Bearer smoke-token" } },
      { assistantId: "assistant-1" }
    );
    const item = result.items[0] as SmokeTurnReceiptItem;
    assert.equal(item.toolInvocations.length, 2);
    assert.equal(item.toolInvocations[0]?.name, "web_search");
    assert.equal(item.toolInvocations[1]?.name, "memory_write");
    assert.equal(item.toolInvocations[1]?.iteration, 0);
    assert.equal(item.toolInvocations[1]?.ok, false);
    assert.equal(item.toolInvocations[1]?.executionMode, null);
  }
}

void run();
