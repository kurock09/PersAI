import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { InternalRuntimeMemoryCloseMostSimilarController } from "../src/modules/workspace-management/interface/http/internal-runtime-memory-close-most-similar.controller";

const VALID_PAYLOAD = {
  assistantId: "assistant-1",
  referenceText: "Picked the venue",
  requestId: "req-1"
};

function setupEnv(): void {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-token";
}

async function runHappyMatched(): Promise<void> {
  setupEnv();
  const controller = new InternalRuntimeMemoryCloseMostSimilarController({
    parseInput(payload: unknown) {
      return payload as never;
    },
    async execute() {
      return {
        closed: true,
        closedItemId: "loop-1",
        reason: "matched"
      };
    }
  } as never);
  const result = await controller.closeMostSimilarOpenLoop(
    { headers: { authorization: "Bearer internal-token" } },
    VALID_PAYLOAD
  );
  assert.deepEqual(result, {
    ok: true,
    closed: true,
    closedItemId: "loop-1",
    reason: "matched"
  });
}

async function runHappyNoMatch(): Promise<void> {
  setupEnv();
  const controller = new InternalRuntimeMemoryCloseMostSimilarController({
    parseInput(payload: unknown) {
      return payload as never;
    },
    async execute() {
      return {
        closed: false,
        closedItemId: null,
        reason: "no_active_open_loop_matched"
      };
    }
  } as never);
  const result = await controller.closeMostSimilarOpenLoop(
    { headers: { authorization: "Bearer internal-token" } },
    VALID_PAYLOAD
  );
  assert.deepEqual(result, {
    ok: true,
    closed: false,
    closedItemId: null,
    reason: "no_active_open_loop_matched"
  });
}

async function runRejectsMissingAuth(): Promise<void> {
  setupEnv();
  const controller = new InternalRuntimeMemoryCloseMostSimilarController({
    parseInput(payload: unknown) {
      return payload as never;
    },
    async execute() {
      throw new Error("must not run");
    }
  } as never);
  await assert.rejects(
    () => controller.closeMostSimilarOpenLoop({ headers: {} }, VALID_PAYLOAD),
    (err) => err instanceof UnauthorizedException
  );
}

async function runRejectsWrongToken(): Promise<void> {
  setupEnv();
  const controller = new InternalRuntimeMemoryCloseMostSimilarController({
    parseInput(payload: unknown) {
      return payload as never;
    },
    async execute() {
      throw new Error("must not run");
    }
  } as never);
  await assert.rejects(
    () =>
      controller.closeMostSimilarOpenLoop(
        { headers: { authorization: "Bearer wrong-token" } },
        VALID_PAYLOAD
      ),
    (err) => err instanceof UnauthorizedException
  );
}

async function run(): Promise<void> {
  await runHappyMatched();
  await runHappyNoMatch();
  await runRejectsMissingAuth();
  await runRejectsWrongToken();
}

void run();
