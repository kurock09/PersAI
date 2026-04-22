import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { InternalRuntimeMemoryCloseByRefController } from "../src/modules/workspace-management/interface/http/internal-runtime-memory-close-by-ref.controller";

const VALID_PAYLOAD = {
  assistantId: "assistant-1",
  itemId: "loop-1",
  requestId: "req-1"
};

function setupEnv(): void {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-token";
}

async function runHappyClosed(): Promise<void> {
  setupEnv();
  const controller = new InternalRuntimeMemoryCloseByRefController({
    parseRuntimeInput(payload: unknown) {
      return payload as never;
    },
    async executeForRuntime() {
      return { closed: true, closedItemId: "loop-1", reason: "closed" };
    }
  } as never);
  const result = await controller.closeByRef(
    { headers: { authorization: "Bearer internal-token" } },
    VALID_PAYLOAD
  );
  assert.deepEqual(result, {
    ok: true,
    closed: true,
    closedItemId: "loop-1",
    reason: "closed"
  });
}

async function runHappyAlreadyClosed(): Promise<void> {
  setupEnv();
  const controller = new InternalRuntimeMemoryCloseByRefController({
    parseRuntimeInput(payload: unknown) {
      return payload as never;
    },
    async executeForRuntime() {
      return { closed: true, closedItemId: "loop-1", reason: "already_closed" };
    }
  } as never);
  const result = await controller.closeByRef(
    { headers: { authorization: "Bearer internal-token" } },
    VALID_PAYLOAD
  );
  assert.deepEqual(result, {
    ok: true,
    closed: true,
    closedItemId: "loop-1",
    reason: "already_closed"
  });
}

async function runRejectsMissingAuth(): Promise<void> {
  setupEnv();
  const controller = new InternalRuntimeMemoryCloseByRefController({
    parseRuntimeInput(payload: unknown) {
      return payload as never;
    },
    async executeForRuntime() {
      throw new Error("must not run");
    }
  } as never);
  await assert.rejects(
    () => controller.closeByRef({ headers: {} }, VALID_PAYLOAD),
    (err) => err instanceof UnauthorizedException
  );
}

async function runRejectsWrongToken(): Promise<void> {
  setupEnv();
  const controller = new InternalRuntimeMemoryCloseByRefController({
    parseRuntimeInput(payload: unknown) {
      return payload as never;
    },
    async executeForRuntime() {
      throw new Error("must not run");
    }
  } as never);
  await assert.rejects(
    () =>
      controller.closeByRef({ headers: { authorization: "Bearer wrong-token" } }, VALID_PAYLOAD),
    (err) => err instanceof UnauthorizedException
  );
}

async function runPropagatesParseAndExecuteErrors(): Promise<void> {
  setupEnv();
  // parseRuntimeInput throws BadRequest → controller must rethrow.
  const parseFails = new InternalRuntimeMemoryCloseByRefController({
    parseRuntimeInput() {
      throw new Error("invalid");
    },
    async executeForRuntime() {
      throw new Error("must not run");
    }
  } as never);
  await assert.rejects(
    () =>
      parseFails.closeByRef({ headers: { authorization: "Bearer internal-token" } }, VALID_PAYLOAD),
    (err) => err instanceof Error && err.message === "invalid"
  );

  // executeForRuntime throws (e.g. NotFoundException) → controller must
  // rethrow so Nest can map it to the right HTTP status (404 / 400).
  const execFails = new InternalRuntimeMemoryCloseByRefController({
    parseRuntimeInput(payload: unknown) {
      return payload as never;
    },
    async executeForRuntime() {
      throw new Error("not found");
    }
  } as never);
  await assert.rejects(
    () =>
      execFails.closeByRef({ headers: { authorization: "Bearer internal-token" } }, VALID_PAYLOAD),
    (err) => err instanceof Error && err.message === "not found"
  );
}

async function run(): Promise<void> {
  await runHappyClosed();
  await runHappyAlreadyClosed();
  await runRejectsMissingAuth();
  await runRejectsWrongToken();
  await runPropagatesParseAndExecuteErrors();
}

void run();
