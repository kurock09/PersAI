import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { InternalRuntimeCompactionEnqueueController } from "../src/modules/workspace-management/interface/http/internal-runtime-compaction-enqueue.controller";

const VALID_PAYLOAD = {
  assistantId: "assistant-1",
  workspaceId: "workspace-1",
  channel: "web",
  externalThreadKey: "thread-1",
  externalUserKey: "user-1",
  runtimeTier: "paid_isolated",
  trigger: "post_turn",
  enqueuedRequestId: "req-1"
};

async function runAuthorizedRequestEnqueues(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-token";

  const parsed: unknown[] = [];
  const executed: unknown[] = [];
  const controller = new InternalRuntimeCompactionEnqueueController({
    parseInput(payload: unknown) {
      parsed.push(payload);
      return payload as never;
    },
    async execute(input: unknown) {
      executed.push(input);
      return { enqueued: true, jobId: "job-1", superseded: false };
    }
  } as never);

  const result = await controller.enqueue(
    { headers: { authorization: "Bearer internal-token" } },
    VALID_PAYLOAD
  );
  assert.deepEqual(result, {
    ok: true,
    enqueued: true,
    jobId: "job-1",
    superseded: false
  });
  assert.equal(parsed.length, 1);
  assert.equal(executed.length, 1);
}

async function runRejectsMissingAuth(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-token";

  const controller = new InternalRuntimeCompactionEnqueueController({
    parseInput(payload: unknown) {
      return payload as never;
    },
    async execute() {
      throw new Error("must not run");
    }
  } as never);

  await assert.rejects(
    () => controller.enqueue({ headers: {} }, VALID_PAYLOAD),
    (error) => error instanceof UnauthorizedException
  );
}

async function runRejectsWrongToken(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-token";

  const controller = new InternalRuntimeCompactionEnqueueController({
    parseInput(payload: unknown) {
      return payload as never;
    },
    async execute() {
      throw new Error("must not run");
    }
  } as never);

  await assert.rejects(
    () =>
      controller.enqueue(
        { headers: { authorization: "Bearer not-the-right-token" } },
        VALID_PAYLOAD
      ),
    (error) => error instanceof UnauthorizedException
  );
}

async function runReportsSupersededOutcome(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-token";

  const controller = new InternalRuntimeCompactionEnqueueController({
    parseInput(payload: unknown) {
      return payload as never;
    },
    async execute() {
      return { enqueued: false, jobId: null, superseded: true };
    }
  } as never);

  const result = await controller.enqueue(
    { headers: { authorization: "Bearer internal-token" } },
    VALID_PAYLOAD
  );
  assert.deepEqual(result, {
    ok: true,
    enqueued: false,
    jobId: null,
    superseded: true
  });
}

async function run(): Promise<void> {
  await runAuthorizedRequestEnqueues();
  await runRejectsMissingAuth();
  await runRejectsWrongToken();
  await runReportsSupersededOutcome();
}

void run();
