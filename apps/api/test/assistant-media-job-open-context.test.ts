import assert from "node:assert/strict";
import { AssistantMediaJobService } from "../src/modules/workspace-management/application/assistant-media-job.service";

function buildPrismaStub(
  rows: Array<{
    id: string;
    kind: "image" | "audio" | "video";
    requestJson: unknown;
    status: "queued" | "running" | "completion_pending";
    createdAt: Date;
    startedAt: Date | null;
    updatedAt: Date;
  }>
): InstanceType<typeof AssistantMediaJobService>["prisma"] {
  return {
    assistantMediaJob: {
      findMany: async () => rows
    }
  } as never;
}

async function run(): Promise<void> {
  const service = new AssistantMediaJobService({} as never);

  // ── Test 1: image_generate with count=3 carries requestedCount=3 ────────
  {
    const prisma = buildPrismaStub([
      {
        id: "job-img-gen",
        kind: "image",
        requestJson: {
          attachments: [],
          sourceUserMessageText: "Generate 3 images",
          sourceUserMessageCreatedAt: "2026-05-31T00:00:00.000Z",
          directToolExecution: {
            toolCode: "image_generate",
            request: {
              toolCode: "image_generate",
              count: 3,
              prompt: "sunset",
              filename: null,
              size: null,
              background: "auto"
            }
          }
        },
        status: "queued",
        createdAt: new Date("2026-05-31T10:00:00.000Z"),
        startedAt: null,
        updatedAt: new Date("2026-05-31T10:00:00.000Z")
      }
    ]);
    (service as never)["prisma"] = prisma;

    const results = await service.listOpenJobsForChatContext({
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1"
    });

    assert.equal(results.length, 1);
    const ctx = results[0]!;
    assert.equal(
      ctx.requestedCount,
      3,
      "requestedCount should be 3 for image_generate with count=3"
    );
    assert.equal(ctx.expectedResultCount, 3, "expectedResultCount should match requestedCount");
    assert.equal(ctx.toolCode, "image_generate");
    assert.equal(ctx.kind, "image");
    assert.equal(ctx.status, "queued");
  }

  // ── Test 2: image_edit with count=2 carries requestedCount=2 ─────────────
  {
    const prisma = buildPrismaStub([
      {
        id: "job-img-edit",
        kind: "image",
        requestJson: {
          attachments: [],
          sourceUserMessageText: "Edit 2 images",
          sourceUserMessageCreatedAt: "2026-05-31T00:00:00.000Z",
          directToolExecution: {
            toolCode: "image_edit",
            request: {
              toolCode: "image_edit",
              count: 2,
              prompt: "recolor",
              sourceImageAlias: "att-1",
              referenceImageAlias: null,
              filename: null,
              size: null,
              background: "auto"
            }
          }
        },
        status: "running",
        createdAt: new Date("2026-05-31T10:00:00.000Z"),
        startedAt: new Date("2026-05-31T10:01:00.000Z"),
        updatedAt: new Date("2026-05-31T10:01:00.000Z")
      }
    ]);
    (service as never)["prisma"] = prisma;

    const results = await service.listOpenJobsForChatContext({
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1"
    });

    assert.equal(results.length, 1);
    const ctx = results[0]!;
    assert.equal(ctx.requestedCount, 2, "requestedCount should be 2 for image_edit with count=2");
    assert.equal(ctx.expectedResultCount, 2, "expectedResultCount should match requestedCount");
    assert.equal(ctx.toolCode, "image_edit");
    assert.notEqual(ctx.startedAt, null, "startedAt should be present for running job");
  }

  // ── Test 3: video_generate always has requestedCount=1 ───────────────────
  {
    const prisma = buildPrismaStub([
      {
        id: "job-video",
        kind: "video",
        requestJson: {
          attachments: [],
          sourceUserMessageText: "Make a video",
          sourceUserMessageCreatedAt: "2026-05-31T00:00:00.000Z",
          directToolExecution: {
            toolCode: "video_generate",
            request: {
              toolCode: "video_generate",
              prompt: "short film",
              filename: null,
              size: null,
              seconds: 4,
              referenceImageAlias: null
            }
          }
        },
        status: "completion_pending",
        createdAt: new Date("2026-05-31T10:00:00.000Z"),
        startedAt: new Date("2026-05-31T10:01:00.000Z"),
        updatedAt: new Date("2026-05-31T10:05:00.000Z")
      }
    ]);
    (service as never)["prisma"] = prisma;

    const results = await service.listOpenJobsForChatContext({
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1"
    });

    assert.equal(results.length, 1);
    const ctx = results[0]!;
    assert.equal(ctx.requestedCount, 1, "video_generate always counts as 1");
    assert.equal(ctx.expectedResultCount, 1);
    assert.equal(ctx.toolCode, "video_generate");
    assert.equal(ctx.kind, "video");
  }

  // ── Test 4: Missing/corrupt requestJson falls back to null ────────────────
  {
    const prisma = buildPrismaStub([
      {
        id: "job-legacy",
        kind: "image",
        requestJson: null,
        status: "queued",
        createdAt: new Date("2026-05-31T10:00:00.000Z"),
        startedAt: null,
        updatedAt: new Date("2026-05-31T10:00:00.000Z")
      }
    ]);
    (service as never)["prisma"] = prisma;

    const results = await service.listOpenJobsForChatContext({
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1"
    });

    assert.equal(results.length, 1);
    const ctx = results[0]!;
    assert.equal(ctx.requestedCount, null, "null requestJson yields null requestedCount");
    assert.equal(
      ctx.expectedResultCount,
      null,
      "null requestedCount yields null expectedResultCount"
    );
    assert.equal(
      ctx.toolCode,
      "image_generate",
      "kind=image falls back to image_generate toolCode"
    );
  }

  console.log("[assistant-media-job-open-context.test] All 4 assertions passed.");
}

void run();
