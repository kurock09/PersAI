import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { InternalRuntimeCrossSessionCarryOverController } from "../src/modules/workspace-management/interface/http/internal-runtime-cross-session-carry-over.controller";

const VALID_PAYLOAD = {
  assistantId: "assistant-1",
  ttlDays: 7,
  excludeRuntimeSessionId: null,
  requestId: "req-1"
};

function setupEnv(): void {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-token";
}

async function runHappyPath(): Promise<void> {
  setupEnv();

  const synopsisDate = new Date("2026-04-21T12:00:00.000Z");
  const openLoopDate = new Date("2026-04-21T13:00:00.000Z");

  const parsed: unknown[] = [];
  const executed: unknown[] = [];
  const controller = new InternalRuntimeCrossSessionCarryOverController({
    parseInput(payload: unknown) {
      parsed.push(payload);
      return payload as never;
    },
    async execute(input: unknown) {
      executed.push(input);
      return {
        recentSynopses: [
          {
            runtimeSessionId: "session-1",
            channel: "telegram",
            synopsisUpdatedAt: synopsisDate,
            summaryPayload: { kind: "session1" }
          }
        ],
        unresolvedOpenLoops: [
          {
            id: "loop-1",
            summary: "Pick a venue",
            createdAt: openLoopDate
          }
        ]
      };
    }
  } as never);

  const result = await controller.carryOver(
    { headers: { authorization: "Bearer internal-token" } },
    VALID_PAYLOAD
  );
  assert.deepEqual(result, {
    ok: true,
    recentSynopses: [
      {
        runtimeSessionId: "session-1",
        channel: "telegram",
        synopsisUpdatedAt: synopsisDate.toISOString(),
        summaryPayload: { kind: "session1" }
      }
    ],
    unresolvedOpenLoops: [
      {
        id: "loop-1",
        summary: "Pick a venue",
        createdAt: openLoopDate.toISOString()
      }
    ]
  });
  assert.equal(parsed.length, 1);
  assert.equal(executed.length, 1);
}

async function runRejectsMissingAuth(): Promise<void> {
  setupEnv();
  const controller = new InternalRuntimeCrossSessionCarryOverController({
    parseInput(payload: unknown) {
      return payload as never;
    },
    async execute() {
      throw new Error("must not run");
    }
  } as never);
  await assert.rejects(
    () => controller.carryOver({ headers: {} }, VALID_PAYLOAD),
    (err) => err instanceof UnauthorizedException
  );
}

async function runRejectsWrongToken(): Promise<void> {
  setupEnv();
  const controller = new InternalRuntimeCrossSessionCarryOverController({
    parseInput(payload: unknown) {
      return payload as never;
    },
    async execute() {
      throw new Error("must not run");
    }
  } as never);
  await assert.rejects(
    () =>
      controller.carryOver(
        { headers: { authorization: "Bearer not-the-right-token" } },
        VALID_PAYLOAD
      ),
    (err) => err instanceof UnauthorizedException
  );
}

async function runEmptyResultPassthrough(): Promise<void> {
  setupEnv();
  const controller = new InternalRuntimeCrossSessionCarryOverController({
    parseInput(payload: unknown) {
      return payload as never;
    },
    async execute() {
      return {
        recentSynopses: [],
        unresolvedOpenLoops: []
      };
    }
  } as never);
  const result = await controller.carryOver(
    { headers: { authorization: "Bearer internal-token" } },
    VALID_PAYLOAD
  );
  assert.deepEqual(result, {
    ok: true,
    recentSynopses: [],
    unresolvedOpenLoops: []
  });
}

async function run(): Promise<void> {
  await runHappyPath();
  await runRejectsMissingAuth();
  await runRejectsWrongToken();
  await runEmptyResultPassthrough();
}

void run();
