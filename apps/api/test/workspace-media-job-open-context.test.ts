import assert from "node:assert/strict";
import { AssistantMediaJobService } from "../src/modules/workspace-management/application/workspace-media-job.service";

function buildPrismaStub(
  rows: Array<{
    id: string;
    kind: "image" | "audio" | "video";
    requestJson: unknown;
    status: "queued" | "running" | "completion_pending" | "delivered";
    createdAt: Date;
    startedAt: Date | null;
    completedAt?: Date | null;
    updatedAt: Date;
    deliveredAt?: Date | null;
  }>
): InstanceType<typeof AssistantMediaJobService>["prisma"] {
  return {
    assistantMediaJob: {
      findMany: async (args?: {
        where?: {
          status?:
            | string
            | {
                in?: string[];
              };
          deliveredAt?: {
            gte?: Date;
          };
        };
      }) => {
        const statusFilter = args?.where?.status;
        const allowedStatuses =
          typeof statusFilter === "string"
            ? new Set([statusFilter])
            : Array.isArray(statusFilter?.in)
              ? new Set(statusFilter.in)
              : null;
        const deliveredAtGte = args?.where?.deliveredAt?.gte ?? null;
        return rows.filter((row) => {
          if (allowedStatuses !== null && !allowedStatuses.has(row.status)) {
            return false;
          }
          if (deliveredAtGte !== null) {
            if (row.deliveredAt === undefined || row.deliveredAt === null) {
              return false;
            }
            if (row.deliveredAt < deliveredAtGte) {
              return false;
            }
          }
          return true;
        });
      }
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
    assert.equal(ctx.sourceSummary, "Generate 3 images");
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
              referenceImageAliases: null,
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
    assert.equal(ctx.sourceSummary, "Edit 2 images");
  }

  // ── Test 3: running video_generate always has requestedCount=1 ────────────
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
        status: "running",
        createdAt: new Date("2026-05-31T10:00:00.000Z"),
        startedAt: new Date("2026-05-31T10:01:00.000Z"),
        completedAt: new Date("2026-05-31T10:05:00.000Z"),
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
    assert.equal(ctx.sourceSummary, "Make a video");
  }

  // ── Test 3b: runtime delivery updates move completion_pending out of open ──
  {
    const prisma = buildPrismaStub([
      {
        id: "job-video-finalizing",
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
        completedAt: new Date("2026-05-31T10:05:00.000Z"),
        updatedAt: new Date("2026-05-31T10:05:00.000Z"),
        deliveredAt: null
      }
    ]);
    (service as never)["prisma"] = prisma;

    const openResults = await service.listOpenJobsForChatContext({
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1"
    });
    const deliveryUpdates = await service.listJobDeliveryUpdatesForChatContext({
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1"
    });

    assert.equal(openResults.length, 0, "completion_pending should not stay in runtime open jobs");
    assert.equal(deliveryUpdates.length, 1);
    assert.equal(deliveryUpdates[0]?.kind, "media");
    assert.equal(deliveryUpdates[0]?.deliveryStatus, "finalizing_delivery");
    assert.equal(deliveryUpdates[0]?.completedAt, "2026-05-31T10:05:00.000Z");
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
    assert.equal(ctx.sourceSummary, null);
  }

  // ── Test 5: seriesItems length becomes requestedCount for series mode ─────
  {
    const prisma = buildPrismaStub([
      {
        id: "job-series",
        kind: "image",
        requestJson: {
          attachments: [],
          sourceUserMessageText: "Carousel about sneakers",
          sourceUserMessageCreatedAt: "2026-05-31T00:00:00.000Z",
          directToolExecution: {
            toolCode: "image_generate",
            request: {
              toolCode: "image_generate",
              count: 4,
              outputMode: "series",
              seriesItems: ["slide 1", "slide 2", "slide 3", "slide 4"],
              prompt: "carousel",
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

    assert.equal(results[0]?.requestedCount, 4);
    assert.equal(results[0]?.expectedResultCount, 4);
  }

  // ── Test 6: listOpenJobsForWebChat — talking-avatar mode → displayKind ─────
  // ADR-109 Slice 10b: the web view DTO must surface `displayKind` projected
  // from `requestJson.directToolExecution.request.mode` so the chat-input chip
  // can rotate copy by elapsed time. Three branches: explicit talking_avatar,
  // explicit cinematic, and absent/legacy mode.
  {
    const prisma = buildPrismaStub([
      {
        id: "job-talking-avatar",
        kind: "video",
        requestJson: {
          attachments: [],
          sourceUserMessageText: "Speak this in a friendly voice",
          sourceUserMessageCreatedAt: "2026-05-31T00:00:00.000Z",
          directToolExecution: {
            toolCode: "video_generate",
            request: {
              toolCode: "video_generate",
              prompt: "",
              filename: null,
              size: null,
              seconds: null,
              referenceImageAlias: null,
              mode: "talking_avatar",
              speechText: "Hi, this is Masha.",
              speechLanguage: "ru",
              personaId: "persona-1",
              voiceKey: "voice-1"
            }
          }
        },
        status: "running",
        createdAt: new Date("2026-05-31T10:00:00.000Z"),
        startedAt: new Date("2026-05-31T10:00:05.000Z"),
        updatedAt: new Date("2026-05-31T10:00:05.000Z")
      }
    ]);
    (service as never)["prisma"] = prisma;

    const results = await service.listOpenJobsForWebChat({
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1"
    });

    assert.equal(results.length, 1);
    assert.equal(
      results[0]?.displayKind,
      "talking_avatar",
      "talking_avatar mode must project to displayKind=talking_avatar"
    );
    assert.equal(results[0]?.operation, "video_generate");
    assert.equal(results[0]?.kind, "video");
  }

  // ── Test 9: web open jobs still keep completion_pending continuity chips ───
  {
    const prisma = buildPrismaStub([
      {
        id: "job-web-pending",
        kind: "image",
        requestJson: {
          attachments: [],
          sourceUserMessageText: "Generate a banner",
          sourceUserMessageCreatedAt: "2026-05-31T00:00:00.000Z",
          directToolExecution: {
            toolCode: "image_generate",
            request: {
              toolCode: "image_generate",
              count: 1,
              prompt: "festival banner",
              filename: null,
              size: null,
              background: "auto"
            }
          }
        },
        status: "completion_pending",
        createdAt: new Date("2026-05-31T10:00:00.000Z"),
        startedAt: new Date("2026-05-31T10:00:05.000Z"),
        completedAt: new Date("2026-05-31T10:01:10.000Z"),
        updatedAt: new Date("2026-05-31T10:01:10.000Z"),
        deliveredAt: null
      }
    ]);
    (service as never)["prisma"] = prisma;

    const results = await service.listOpenJobsForWebChat({
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1"
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.status, "completion_pending");
  }

  // ── Test 10: listOpenJobsForWebChat exposes requestedCount for multi-image ─
  {
    const prisma = buildPrismaStub([
      {
        id: "job-series-web",
        kind: "image",
        requestJson: {
          attachments: [],
          sourceUserMessageText: "Carousel slides",
          sourceUserMessageCreatedAt: "2026-05-31T00:00:00.000Z",
          directToolExecution: {
            toolCode: "image_edit",
            request: {
              toolCode: "image_edit",
              count: 7,
              outputMode: "series",
              prompt: "brand carousel",
              seriesItems: [
                "slide 1",
                "slide 2",
                "slide 3",
                "slide 4",
                "slide 5",
                "slide 6",
                "slide 7"
              ],
              sourceImageAlias: "ref-1",
              filename: null,
              size: null
            }
          }
        },
        status: "running",
        createdAt: new Date("2026-05-31T10:00:00.000Z"),
        startedAt: new Date("2026-05-31T10:00:05.000Z"),
        updatedAt: new Date("2026-05-31T10:00:05.000Z")
      }
    ]);
    (service as never)["prisma"] = prisma;

    const results = await service.listOpenJobsForWebChat({
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1"
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.requestedCount, 7);
  }

  // ── Test 11: listOpenJobsForWebChat includes requestedCount=1 for single ───
  {
    const prisma = buildPrismaStub([
      {
        id: "job-single-web",
        kind: "image",
        requestJson: {
          attachments: [],
          sourceUserMessageText: "One banner",
          sourceUserMessageCreatedAt: "2026-05-31T00:00:00.000Z",
          directToolExecution: {
            toolCode: "image_generate",
            request: {
              toolCode: "image_generate",
              count: 1,
              prompt: "festival banner",
              filename: null,
              size: null,
              background: "auto"
            }
          }
        },
        status: "running",
        createdAt: new Date("2026-05-31T10:00:00.000Z"),
        startedAt: new Date("2026-05-31T10:00:05.000Z"),
        updatedAt: new Date("2026-05-31T10:00:05.000Z")
      }
    ]);
    (service as never)["prisma"] = prisma;

    const results = await service.listOpenJobsForWebChat({
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1"
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.requestedCount, 1);
  }

  // ── Test 10: recent delivered jobs surface as recent delivery updates ──────
  {
    const prisma = buildPrismaStub([
      {
        id: "job-recent-delivered",
        kind: "image",
        requestJson: {
          attachments: [],
          sourceUserMessageText: "Generate a cover",
          sourceUserMessageCreatedAt: "2026-05-31T00:00:00.000Z",
          directToolExecution: {
            toolCode: "image_generate",
            request: {
              toolCode: "image_generate",
              count: 1,
              prompt: "album cover",
              filename: null,
              size: null,
              background: "auto"
            }
          }
        },
        status: "delivered",
        createdAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
        updatedAt: new Date(),
        deliveredAt: new Date()
      }
    ]);
    (service as never)["prisma"] = prisma;

    const results = await service.listJobDeliveryUpdatesForChatContext({
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1"
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.deliveryStatus, "delivered_recently");
    assert.equal(results[0]?.kind, "media");
  }

  // ── Test 7: listOpenJobsForWebChat — cinematic mode → displayKind ─────────
  {
    const prisma = buildPrismaStub([
      {
        id: "job-cinematic",
        kind: "video",
        requestJson: {
          attachments: [],
          sourceUserMessageText: "Make a cinematic clip",
          sourceUserMessageCreatedAt: "2026-05-31T00:00:00.000Z",
          directToolExecution: {
            toolCode: "video_generate",
            request: {
              toolCode: "video_generate",
              prompt: "sunrise on the dunes",
              filename: null,
              size: null,
              seconds: 4,
              referenceImageAlias: null,
              mode: "cinematic"
            }
          }
        },
        status: "running",
        createdAt: new Date("2026-05-31T10:00:00.000Z"),
        startedAt: new Date("2026-05-31T10:00:05.000Z"),
        updatedAt: new Date("2026-05-31T10:00:05.000Z")
      }
    ]);
    (service as never)["prisma"] = prisma;

    const results = await service.listOpenJobsForWebChat({
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1"
    });

    assert.equal(results.length, 1);
    assert.equal(
      results[0]?.displayKind,
      "cinematic",
      "cinematic mode must project to displayKind=cinematic"
    );
  }

  // ── Test 8: listOpenJobsForWebChat — missing/null mode falls back to ─────
  // cinematic (defensive default + legacy job rows). Image and audio jobs also
  // default to cinematic.
  {
    const prisma = buildPrismaStub([
      {
        id: "job-no-mode",
        kind: "video",
        requestJson: {
          attachments: [],
          sourceUserMessageText: "Generic video",
          sourceUserMessageCreatedAt: "2026-05-31T00:00:00.000Z",
          directToolExecution: {
            toolCode: "video_generate",
            request: {
              toolCode: "video_generate",
              prompt: "boats",
              filename: null,
              size: null,
              seconds: 4,
              referenceImageAlias: null
            }
          }
        },
        status: "running",
        createdAt: new Date("2026-05-31T10:00:00.000Z"),
        startedAt: new Date("2026-05-31T10:00:05.000Z"),
        updatedAt: new Date("2026-05-31T10:00:05.000Z")
      },
      {
        id: "job-legacy-null-request",
        kind: "video",
        requestJson: null,
        status: "queued",
        createdAt: new Date("2026-05-31T10:00:00.000Z"),
        startedAt: null,
        updatedAt: new Date("2026-05-31T10:00:00.000Z")
      },
      {
        id: "job-image",
        kind: "image",
        requestJson: {
          attachments: [],
          sourceUserMessageText: "Generate an image",
          sourceUserMessageCreatedAt: "2026-05-31T00:00:00.000Z",
          directToolExecution: {
            toolCode: "image_generate",
            request: {
              toolCode: "image_generate",
              count: 1,
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

    const results = await service.listOpenJobsForWebChat({
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1"
    });

    assert.equal(results.length, 3);
    assert.equal(
      results[0]?.displayKind,
      "cinematic",
      "video_generate without mode must default to displayKind=cinematic"
    );
    assert.equal(
      results[1]?.displayKind,
      "cinematic",
      "null requestJson must default to displayKind=cinematic"
    );
    assert.equal(
      results[2]?.displayKind,
      "cinematic",
      "image jobs must default to displayKind=cinematic"
    );
  }

  console.log("[workspace-media-job-open-context.test] All assertions passed.");
}

void run();
