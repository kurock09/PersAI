import assert from "node:assert/strict";
import { BadRequestException, ConflictException, UnauthorizedException } from "@nestjs/common";
import { InternalRuntimeDeepSeekAppendTraceController } from "../src/modules/workspace-management/interface/http/internal-runtime-deepseek-append-trace.controller";
import {
  DeepSeekChatAppendTraceService,
  type DeepSeekChatAppendTraceService as DeepSeekChatAppendTraceServiceType
} from "../src/modules/workspace-management/application/deepseek-chat-append-trace.service";

function setupEnv(): void {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-token";
}

const AUTH = { headers: { authorization: "Bearer internal-token" } };
const CHAT_ID = "00000000-0000-4000-8000-000000000001";
const EVENT = {
  sourceKey: "seed:stable",
  kind: "stable_snapshot",
  role: "system",
  contentText: "stable",
  contentJson: null,
  stateKey: "stable",
  revision: 1,
  supersedes: null
};
const TRACE = {
  activeEpoch: 1,
  nextOrdinal: 1,
  configHash: "a".repeat(64),
  events: [{ ...EVENT, ordinal: 0 }]
};

async function run(): Promise<void> {
  setupEnv();
  const parser = new DeepSeekChatAppendTraceService({} as never);
  assert.deepEqual(
    parser.parseAppend({
      assistantChatId: CHAT_ID,
      epoch: 1,
      expectedOrdinal: 0,
      events: [EVENT]
    }),
    {
      assistantChatId: CHAT_ID,
      epoch: 1,
      expectedOrdinal: 0,
      events: [{ ...EVENT, ordinal: 0 }]
    }
  );
  assert.throws(
    () =>
      parser.parseAppend({
        assistantChatId: CHAT_ID,
        epoch: 1,
        expectedOrdinal: 0,
        events: [{ ...EVENT, kind: "unknown" }]
      }),
    (error: unknown) => error instanceof BadRequestException
  );
  assert.throws(
    () =>
      parser.parseAppend({
        assistantChatId: CHAT_ID,
        epoch: 1,
        expectedOrdinal: 0,
        events: [{ ...EVENT, contentText: null, contentJson: null }]
      }),
    (error: unknown) => error instanceof BadRequestException
  );

  // A matching source key is not enough: retries must replay every persisted
  // model-visible field exactly. This must fail before returning trace state.
  const idempotencyTx = {
    assistantChat: {
      findUnique: async () => ({ id: CHAT_ID })
    },
    $queryRaw: async () => [],
    deepSeekChatAppendTrace: {
      upsert: async () => ({ activeEpoch: 1, nextOrdinal: 1, configHash: "a".repeat(64) }),
      findUniqueOrThrow: async () => ({
        activeEpoch: 1,
        nextOrdinal: 1,
        configHash: "a".repeat(64),
        events: [{ ...EVENT, ordinal: 0, contentJson: { first: "persisted", second: [1, 2] } }]
      })
    },
    deepSeekChatAppendTraceEvent: {
      findMany: async () => [
        {
          ...EVENT,
          ordinal: 0,
          contentJson: { first: "persisted", second: [1, 2] }
        }
      ]
    }
  };
  const idempotencyService = new DeepSeekChatAppendTraceService({
    $transaction: async (callback: (tx: typeof idempotencyTx) => Promise<unknown>) =>
      callback(idempotencyTx)
  } as never);
  await assert.rejects(
    () =>
      idempotencyService.append({
        assistantChatId: CHAT_ID,
        epoch: 1,
        expectedOrdinal: 0,
        events: [
          {
            ...EVENT,
            ordinal: 0,
            contentJson: { second: [1, 2], first: "different" }
          }
        ]
      }),
    (error: unknown) => error instanceof ConflictException
  );
  const idempotentReplay = await idempotencyService.append({
    assistantChatId: CHAT_ID,
    epoch: 1,
    // The caller has already observed the persisted append, so its ordinal is
    // now the trace tail. Exact source-key replay must still be a no-op.
    expectedOrdinal: 1,
    events: [
      {
        ...EVENT,
        ordinal: 0,
        contentJson: { second: [1, 2], first: "persisted" }
      }
    ]
  });
  assert.equal(idempotentReplay.nextOrdinal, 1);

  const calls: Array<{ operation: string; input: unknown }> = [];
  const service = {
    parseRead: (input: unknown) => ({
      assistantChatId: (input as { assistantChatId: string }).assistantChatId
    }),
    parseAppend: (input: unknown) => input,
    parseReset: (input: unknown) => input,
    parseClear: (input: unknown) => input,
    async read(input: unknown) {
      calls.push({ operation: "read", input });
      return null;
    },
    async append(input: unknown) {
      calls.push({ operation: "append", input });
      return TRACE;
    },
    async reset(input: unknown) {
      calls.push({ operation: "reset", input });
      return TRACE;
    },
    async clear(input: unknown) {
      calls.push({ operation: "clear", input });
      return { ...TRACE, activeEpoch: 2, nextOrdinal: 0, events: [] };
    }
  } as unknown as DeepSeekChatAppendTraceServiceType;
  const controller = new InternalRuntimeDeepSeekAppendTraceController(service);

  assert.deepEqual(await controller.read(AUTH, { assistantChatId: CHAT_ID }), {
    ok: true,
    trace: null
  });
  assert.deepEqual(
    await controller.append(AUTH, {
      assistantChatId: CHAT_ID,
      epoch: 1,
      expectedOrdinal: 0,
      events: [EVENT]
    }),
    { ok: true, trace: TRACE }
  );
  assert.deepEqual(
    await controller.reset(AUTH, {
      assistantChatId: CHAT_ID,
      expectedEpoch: 1,
      seedEvents: [EVENT]
    }),
    { ok: true, trace: TRACE }
  );
  assert.deepEqual(await controller.clear(AUTH, { assistantChatId: CHAT_ID, expectedEpoch: 1 }), {
    ok: true,
    trace: { ...TRACE, activeEpoch: 2, nextOrdinal: 0, events: [] }
  });
  assert.deepEqual(
    calls.map((call) => call.operation),
    ["read", "append", "reset", "clear"]
  );

  await assert.rejects(
    () =>
      controller.read(
        { headers: { authorization: "Bearer wrong-token" } },
        { assistantChatId: CHAT_ID }
      ),
    (error: unknown) => error instanceof UnauthorizedException
  );

  const invalidService = {
    ...service,
    parseAppend: () => {
      throw new BadRequestException("DeepSeek trace events are invalid.");
    }
  } as unknown as DeepSeekChatAppendTraceServiceType;
  await assert.rejects(
    () =>
      new InternalRuntimeDeepSeekAppendTraceController(invalidService).append(AUTH, {
        assistantChatId: CHAT_ID,
        epoch: 1,
        expectedOrdinal: 0,
        events: []
      }),
    (error: unknown) => error instanceof BadRequestException
  );
}

void run();
