import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { EnqueueBackgroundCompactionJobService } from "../src/modules/workspace-management/application/enqueue-background-compaction-job.service";

type CreatedRow = {
  assistantId: string;
  workspaceId: string;
  channel: string;
  externalThreadKey: string;
  externalUserKey: string | null;
  runtimeTier: string;
  trigger: string;
  status: string;
  pendingDedupeKey: string | null;
  enqueuedRequestId: string | null;
};

class FakePrisma {
  public created: Array<{ data: CreatedRow }> = [];
  public failNextWith: Prisma.PrismaClientKnownRequestError | Error | null = null;
  public assistantBackgroundCompactionJob = {
    create: async ({ data }: { data: CreatedRow; select: unknown }) => {
      if (this.failNextWith !== null) {
        const error = this.failNextWith;
        this.failNextWith = null;
        throw error;
      }
      this.created.push({ data });
      return { id: `job-${this.created.length}` };
    }
  };
}

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

async function runParseInputAcceptsValidPayload(): Promise<void> {
  const prisma = new FakePrisma();
  const service = new EnqueueBackgroundCompactionJobService(prisma as never);
  const parsed = service.parseInput(VALID_PAYLOAD);
  assert.equal(parsed.assistantId, "assistant-1");
  assert.equal(parsed.runtimeTier, "paid_isolated");
  assert.equal(parsed.channel, "web");
  assert.equal(parsed.trigger, "post_turn");
  assert.equal(parsed.enqueuedRequestId, "req-1");
}

async function runParseInputDefaultsTrigger(): Promise<void> {
  const prisma = new FakePrisma();
  const service = new EnqueueBackgroundCompactionJobService(prisma as never);
  const { trigger, ...rest } = VALID_PAYLOAD;
  void trigger;
  const parsed = service.parseInput({ ...rest });
  assert.equal(parsed.trigger, "post_turn");
}

async function runParseInputRejectsInvalidTier(): Promise<void> {
  const prisma = new FakePrisma();
  const service = new EnqueueBackgroundCompactionJobService(prisma as never);
  assert.throws(
    () => service.parseInput({ ...VALID_PAYLOAD, runtimeTier: "balanced" }),
    (error) => error instanceof BadRequestException
  );
}

async function runParseInputRejectsInvalidChannel(): Promise<void> {
  const prisma = new FakePrisma();
  const service = new EnqueueBackgroundCompactionJobService(prisma as never);
  assert.throws(
    () => service.parseInput({ ...VALID_PAYLOAD, channel: "discord" }),
    (error) => error instanceof BadRequestException
  );
}

async function runExecuteEnqueuesNewJob(): Promise<void> {
  const prisma = new FakePrisma();
  const service = new EnqueueBackgroundCompactionJobService(prisma as never);
  const outcome = await service.execute(service.parseInput(VALID_PAYLOAD));
  assert.equal(outcome.enqueued, true);
  assert.equal(outcome.superseded, false);
  assert.equal(outcome.jobId, "job-1");
  assert.equal(prisma.created.length, 1);
  const created = prisma.created[0]!.data;
  assert.equal(created.assistantId, "assistant-1");
  assert.equal(created.workspaceId, "workspace-1");
  assert.equal(created.channel, "web");
  assert.equal(created.runtimeTier, "paid_isolated");
  assert.equal(created.trigger, "post_turn");
  assert.equal(created.status, "pending");
  assert.equal(created.pendingDedupeKey, "assistant-1:web:thread-1");
  assert.equal(created.enqueuedRequestId, "req-1");
}

async function runExecuteSupersedesOnUniqueViolation(): Promise<void> {
  const prisma = new FakePrisma();
  prisma.failNextWith = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["pending_dedupe_key"] }
  });
  const service = new EnqueueBackgroundCompactionJobService(prisma as never);
  const outcome = await service.execute(service.parseInput(VALID_PAYLOAD));
  assert.equal(outcome.enqueued, false);
  assert.equal(outcome.superseded, true);
  assert.equal(outcome.jobId, null);
  assert.equal(prisma.created.length, 0);
}

async function runExecuteRethrowsUnknownErrors(): Promise<void> {
  const prisma = new FakePrisma();
  prisma.failNextWith = new Error("boom");
  const service = new EnqueueBackgroundCompactionJobService(prisma as never);
  await assert.rejects(
    () => service.execute(service.parseInput(VALID_PAYLOAD)),
    (error) => error instanceof Error && error.message === "boom"
  );
}

async function run(): Promise<void> {
  await runParseInputAcceptsValidPayload();
  await runParseInputDefaultsTrigger();
  await runParseInputRejectsInvalidTier();
  await runParseInputRejectsInvalidChannel();
  await runExecuteEnqueuesNewJob();
  await runExecuteSupersedesOnUniqueViolation();
  await runExecuteRethrowsUnknownErrors();
}

void run();
