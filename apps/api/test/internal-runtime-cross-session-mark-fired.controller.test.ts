import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { InternalRuntimeCrossSessionMarkFiredController } from "../src/modules/workspace-management/interface/http/internal-runtime-cross-session-mark-fired.controller";

const VALID_PAYLOAD = {
  assistantChatId: "chat-1",
  firedAt: "2026-04-22T12:00:00.000Z",
  requestId: "req-1"
};

function setupEnv(): void {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-token";
}

async function runHappyPathAdvanced(): Promise<void> {
  setupEnv();
  const parsed: unknown[] = [];
  const executed: unknown[] = [];
  const controller = new InternalRuntimeCrossSessionMarkFiredController({
    parseInput(payload: unknown) {
      parsed.push(payload);
      return payload as never;
    },
    async execute(input: unknown) {
      executed.push(input);
      return { outcome: "advanced" } as const;
    }
  } as never);
  const result = await controller.markFired(
    { headers: { authorization: "Bearer internal-token" } },
    VALID_PAYLOAD
  );
  assert.deepEqual(result, { ok: true, outcome: "advanced" });
  assert.equal(parsed.length, 1);
  assert.equal(executed.length, 1);
}

async function runHappyPathNoopAlreadyNewer(): Promise<void> {
  setupEnv();
  const controller = new InternalRuntimeCrossSessionMarkFiredController({
    parseInput(payload: unknown) {
      return payload as never;
    },
    async execute() {
      return { outcome: "noop_already_newer" } as const;
    }
  } as never);
  const result = await controller.markFired(
    { headers: { authorization: "Bearer internal-token" } },
    VALID_PAYLOAD
  );
  assert.deepEqual(result, { ok: true, outcome: "noop_already_newer" });
}

async function runRejectsMissingAuth(): Promise<void> {
  setupEnv();
  const controller = new InternalRuntimeCrossSessionMarkFiredController({
    parseInput(payload: unknown) {
      return payload as never;
    },
    async execute() {
      throw new Error("must not run");
    }
  } as never);
  await assert.rejects(
    () => controller.markFired({ headers: {} }, VALID_PAYLOAD),
    (err) => err instanceof UnauthorizedException
  );
}

async function runRejectsWrongToken(): Promise<void> {
  setupEnv();
  const controller = new InternalRuntimeCrossSessionMarkFiredController({
    parseInput(payload: unknown) {
      return payload as never;
    },
    async execute() {
      throw new Error("must not run");
    }
  } as never);
  await assert.rejects(
    () =>
      controller.markFired(
        { headers: { authorization: "Bearer not-the-right-token" } },
        VALID_PAYLOAD
      ),
    (err) => err instanceof UnauthorizedException
  );
}

async function run(): Promise<void> {
  await runHappyPathAdvanced();
  await runHappyPathNoopAlreadyNewer();
  await runRejectsMissingAuth();
  await runRejectsWrongToken();
}

void run();
