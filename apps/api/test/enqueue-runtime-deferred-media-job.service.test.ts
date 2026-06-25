import assert from "node:assert/strict";
import { EnqueueRuntimeDeferredMediaJobService } from "../src/modules/workspace-management/application/enqueue-runtime-deferred-media-job.service";

type ReserveCall = { toolCode: string; units: number };
type ReleaseCall = { toolCode: string; units: number };

function buildService(overrides: {
  openJobCount?: number;
  reserveAllowed?: boolean;
  toolActivationStatus?: "active" | "inactive";
  enqueueThrows?: boolean;
  toolCode?: "image_generate" | "video_generate";
  vcoinBalance?: number;
  vcoinReadCalls?: string[];
}): {
  service: EnqueueRuntimeDeferredMediaJobService;
  reserveCalls: ReserveCall[];
  releaseCalls: ReleaseCall[];
  enqueueCalls: { count: number };
} {
  const {
    openJobCount = 0,
    reserveAllowed = true,
    toolActivationStatus = "active",
    enqueueThrows = false,
    toolCode = "image_generate",
    vcoinBalance,
    vcoinReadCalls
  } = overrides;

  const reserveCalls: ReserveCall[] = [];
  const releaseCalls: ReleaseCall[] = [];
  const enqueueCalls = { count: 0 };

  const assistant = { id: "assistant-1", workspaceId: "workspace-1" };

  const service = new EnqueueRuntimeDeferredMediaJobService(
    {
      async findMessageByIdForAssistant(messageId: string, assistantId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "user" as const,
          createdAt: new Date("2026-05-11T00:00:00.000Z")
        };
      },
      async findChatById(chatId: string) {
        return {
          id: chatId,
          assistantId: "assistant-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          surface: "web" as const
        };
      }
    } as never,
    {
      async countOpenJobsForChat() {
        return openJobCount;
      },
      async enqueue() {
        enqueueCalls.count += 1;
        if (enqueueThrows) {
          throw new Error("simulated job insert failure");
        }
        return { id: "job-1" };
      }
    } as never,
    {
      async build() {
        return {
          message:
            "Image generate is exhausted for the current monthly period. It resets Jun 1, 2026.",
          guidance:
            'Use a request that does not need media generation. You can also buy "Image pack" for $10 on /app/packages, or upgrade to Pro for a larger monthly limit.'
        };
      }
    } as never,
    {
      // TrackWorkspaceQuotaUsageService stub
      async reserveAssistantMonthlyMediaQuota(params: { toolCode: string; units: number }) {
        reserveCalls.push({ toolCode: params.toolCode, units: params.units });
        return {
          allowed: reserveAllowed,
          currentUsedUnits: reserveAllowed ? 0 : 30,
          limitUnits: 30,
          periodStartedAt: "2026-05-01T00:00:00.000Z",
          periodEndsAt: "2026-06-01T00:00:00.000Z",
          periodSource: "subscription_period" as const
        };
      },
      async releaseAssistantMonthlyMediaQuota(params: { toolCode: string; units: number }) {
        releaseCalls.push({ toolCode: params.toolCode, units: params.units });
      }
    } as never,
    {
      async execute() {
        return {
          assistant,
          planCode: "pro",
          tools: [
            {
              toolCode,
              displayName: toolCode === "video_generate" ? "Video generate" : "Image generate",
              activationStatus: toolActivationStatus,
              dailyCallLimit: null
            }
          ]
        };
      }
    } as never,
    // ADR-108 Slice 2 — VC wallet repository. Image-only tests pass a
    // throwing mock so any accidental wallet read on the image path is
    // surfaced as a test failure (image enqueues must never consult the
    // wallet — cross-slice invariant 1 / 6).
    toolCode === "video_generate"
      ? ({
          async getOrCreate(workspaceId: string) {
            if (vcoinReadCalls) {
              vcoinReadCalls.push(workspaceId);
            }
            return {
              workspaceId,
              balanceVc: vcoinBalance ?? 0,
              updatedAt: new Date("2026-06-03T19:00:00.000Z")
            };
          },
          async debit() {
            throw new Error("debit must not run from the enqueue path (settle-only)");
          }
        } as never)
      : ({
          async getOrCreate() {
            throw new Error(
              "VC wallet must NOT be read on image_generate / image_edit enqueues (invariant 1/6)"
            );
          },
          async debit() {
            throw new Error("VC wallet debit must NOT run from the enqueue path");
          }
        } as never)
  );

  return { service, reserveCalls, releaseCalls, enqueueCalls };
}

function imageGenerateInput(count: number, messageId: string) {
  return {
    assistantId: "assistant-1",
    sourceUserMessageId: messageId,
    sourceUserMessageText: "Generate images",
    attachments: [],
    directToolExecution: {
      toolCode: "image_generate" as const,
      request: {
        toolCode: "image_generate" as const,
        count,
        prompt: "hero images",
        filename: null,
        size: null,
        background: "auto" as const
      }
    }
  };
}

function videoGenerateInput(messageId: string) {
  return {
    assistantId: "assistant-1",
    sourceUserMessageId: messageId,
    sourceUserMessageText: "Generate a short video",
    attachments: [],
    directToolExecution: {
      toolCode: "video_generate" as const,
      request: {
        toolCode: "video_generate" as const,
        prompt: "rolling waves at sunset",
        filename: null,
        size: null,
        seconds: 5,
        referenceImageAlias: null
      }
    }
  };
}

function imageGenerateSeriesInput(count: number, messageId: string, seriesItems: string[]) {
  return {
    assistantId: "assistant-1",
    sourceUserMessageId: messageId,
    sourceUserMessageText: "Generate carousel",
    attachments: [],
    directToolExecution: {
      toolCode: "image_generate" as const,
      request: {
        toolCode: "image_generate" as const,
        count,
        outputMode: "series" as const,
        seriesItems,
        prompt: "carousel",
        filename: null,
        size: null,
        background: "auto" as const
      }
    }
  };
}

async function run(): Promise<void> {
  // ── Test 1: count=2 reserves exactly 2 units and enqueues ────────────────
  {
    const { service, reserveCalls, releaseCalls, enqueueCalls } = buildService({});
    const result = await service.execute(imageGenerateInput(2, "message-1"));

    assert.equal(result.accepted, true, "count=2 with quota should be accepted");
    assert.equal(reserveCalls.length, 1, "reserve called exactly once (single seam)");
    assert.equal(reserveCalls[0]!.units, 2, "reserve units must equal requested count (2)");
    assert.equal(reserveCalls[0]!.toolCode, "image_generate");
    assert.equal(releaseCalls.length, 0, "no release on success");
    assert.equal(enqueueCalls.count, 1, "enqueue called once");
  }

  // ── Test 2: quota-exceeded → structured rejection, no enqueue ────────────
  {
    const { service, reserveCalls, releaseCalls, enqueueCalls } = buildService({
      reserveAllowed: false
    });
    const result = await service.execute(imageGenerateInput(3, "message-2"));

    assert.equal(result.accepted, false);
    if (!result.accepted) {
      assert.equal(result.code, "monthly_media_quota_exceeded");
      assert.equal(result.limitKind, "monthly_media_quota");
      assert.equal(result.requestedUnits, 3);
      assert.equal(
        result.message,
        "Image generate is exhausted for the current monthly period. It resets Jun 1, 2026."
      );
    }
    assert.equal(reserveCalls.length, 1, "reserve attempted with requested units");
    assert.equal(reserveCalls[0]!.units, 3);
    assert.equal(
      releaseCalls.length,
      0,
      "rejected reservation does not release (nothing reserved)"
    );
    assert.equal(enqueueCalls.count, 0, "no enqueue when quota rejected");
  }

  // ── Test 3: 3rd job (2 open) → concurrency structured rejection ──────────
  {
    const { service, reserveCalls, releaseCalls, enqueueCalls } = buildService({
      openJobCount: 2
    });
    const result = await service.execute(imageGenerateInput(2, "message-3"));

    assert.equal(result.accepted, false);
    if (!result.accepted) {
      assert.equal(result.code, "media_job_concurrency_limit");
      assert.equal(result.limitKind, "media_job_concurrency");
      assert.equal(result.activeJobs, 2);
      assert.equal(result.maxActiveJobs, 2);
      assert.equal(result.requestedUnits, 2);
    }
    assert.equal(reserveCalls.length, 0, "concurrency rejection must NOT reserve quota");
    assert.equal(releaseCalls.length, 0);
    assert.equal(enqueueCalls.count, 0, "no enqueue when concurrency limit reached");
  }

  // ── Test 4: insert failure → compensating release of the SAME units ──────
  {
    const { service, reserveCalls, releaseCalls, enqueueCalls } = buildService({
      enqueueThrows: true
    });
    await assert.rejects(
      () => service.execute(imageGenerateInput(4, "message-4")),
      /simulated job insert failure/,
      "insert failure should rethrow after compensating release"
    );
    assert.equal(reserveCalls.length, 1, "reserved once");
    assert.equal(reserveCalls[0]!.units, 4);
    assert.equal(releaseCalls.length, 1, "compensating release fired exactly once");
    assert.equal(releaseCalls[0]!.units, 4, "compensating release must match reserved units");
    assert.equal(releaseCalls[0]!.toolCode, "image_generate");
    assert.equal(enqueueCalls.count, 1, "enqueue was attempted");
  }

  // ── Test 5: tool not active on plan → plan_feature_unavailable, no reserve
  {
    const { service, reserveCalls, releaseCalls, enqueueCalls } = buildService({
      toolActivationStatus: "inactive"
    });
    const result = await service.execute(imageGenerateInput(1, "message-5"));

    assert.equal(result.accepted, false);
    if (!result.accepted) {
      assert.equal(result.code, "plan_feature_unavailable");
      assert.equal(result.limitKind, "plan_feature_unavailable");
      assert.equal(result.requestedUnits, 1);
    }
    assert.equal(reserveCalls.length, 0, "inactive tool must not reserve");
    assert.equal(releaseCalls.length, 0);
    assert.equal(enqueueCalls.count, 0);
  }

  // ── Test 6: out-of-range count rejected at parse (4xx) ───────────────────
  {
    const { service } = buildService({});
    assert.throws(
      () =>
        service.parseInput({
          assistantId: "assistant-1",
          sourceUserMessageId: "message-6",
          sourceUserMessageText: "Generate images",
          attachments: [],
          directToolExecution: {
            toolCode: "image_generate",
            request: {
              toolCode: "image_generate",
              count: 11,
              prompt: "too many",
              filename: null,
              size: null,
              background: "auto"
            }
          }
        }),
      /count for image_generate must be an integer between/,
      "count above MAX must be rejected at parse"
    );
  }

  // ── Test 7: series mode reserves by seriesItems length and enqueues ───────
  {
    const { service, reserveCalls, enqueueCalls } = buildService({});
    const parsed = service.parseInput(
      imageGenerateSeriesInput(3, "message-7", ["slide 1", "slide 2", "slide 3"])
    );
    const result = await service.execute(parsed);

    assert.equal(result.accepted, true);
    assert.equal(reserveCalls.length, 1);
    assert.equal(
      reserveCalls[0]!.units,
      3,
      "series mode must reserve units from semantic item count"
    );
    assert.equal(enqueueCalls.count, 1);
  }

  // ── Test 8: series mode rejects mismatched seriesItems length at parse ────
  {
    const { service } = buildService({});
    assert.throws(
      () => service.parseInput(imageGenerateSeriesInput(3, "message-8", ["slide 1", "slide 2"])),
      /must contain exactly 3 item\(s\) when outputMode="series"/,
      "series mode must be rejected when seriesItems length mismatches count"
    );
  }

  // ── Test 9: seriesItems without outputMode=series is rejected at parse ────
  {
    const { service } = buildService({});
    assert.throws(
      () =>
        service.parseInput({
          assistantId: "assistant-1",
          sourceUserMessageId: "message-9",
          sourceUserMessageText: "Generate images",
          attachments: [],
          directToolExecution: {
            toolCode: "image_generate",
            request: {
              toolCode: "image_generate",
              count: 2,
              outputMode: "variants",
              seriesItems: ["frame 1", "frame 2"],
              prompt: "bad shape",
              filename: null,
              size: null,
              background: "auto"
            }
          }
        }),
      /can only be provided when outputMode="series"/,
      "seriesItems must be rejected when outputMode is not series"
    );
  }

  // ── ADR-108 Slice 2: VC pre-check rejects empty-wallet video_generate ────
  {
    const vcoinReadCalls: string[] = [];
    const { service, reserveCalls, releaseCalls, enqueueCalls } = buildService({
      toolCode: "video_generate",
      vcoinBalance: 0,
      vcoinReadCalls
    });
    const result = await service.execute(videoGenerateInput("message-vc-empty"));

    assert.equal(result.accepted, false, "balance_vc=0 must reject the enqueue");
    if (!result.accepted) {
      assert.equal(result.code, "vcoin_balance_exhausted");
      assert.equal(result.limitKind, "vcoin_balance_exhausted");
      assert.equal(result.requestedUnits, 1);
      assert.match(result.message, /Vcoin balance is empty/);
    }
    assert.deepEqual(vcoinReadCalls, ["workspace-1"], "wallet read once with workspace id");
    assert.equal(reserveCalls.length, 0, "VC pre-check rejects BEFORE the unit reservation");
    assert.equal(releaseCalls.length, 0, "no reservation → no compensating release");
    assert.equal(enqueueCalls.count, 0, "rejected enqueue must not insert a job");
  }

  // ── ADR-108 Slice 8: video_generate has retired the legacy unit counter ──
  // Positive balance proceeds, but the VC wallet is the SOLE accounting
  // surface; no monthly_media_quota reservation is taken anymore.
  {
    const vcoinReadCalls: string[] = [];
    const { service, reserveCalls, releaseCalls, enqueueCalls } = buildService({
      toolCode: "video_generate",
      vcoinBalance: 5,
      vcoinReadCalls
    });
    const result = await service.execute(videoGenerateInput("message-vc-ok"));

    assert.equal(result.accepted, true);
    assert.deepEqual(vcoinReadCalls, ["workspace-1"], "wallet read once on the happy path");
    assert.equal(
      reserveCalls.length,
      0,
      "video_generate no longer reserves the legacy unit counter"
    );
    assert.equal(releaseCalls.length, 0, "nothing to release when nothing was reserved");
    assert.equal(enqueueCalls.count, 1);
  }

  // ── ADR-126 v3: image_edit accepts storagePath attachment refs (not objectKey)
  {
    const { service, reserveCalls, enqueueCalls } = buildService({});
    const parsed = service.parseInput({
      assistantId: "assistant-1",
      sourceUserMessageId: "message-img-edit",
      sourceUserMessageText: "Edit this photo",
      attachments: [
        {
          attachmentId: "att-1",
          kind: "image",
          storagePath: "/workspace/input/3534.jpg",
          mimeType: "image/jpeg",
          displayName: "3534.jpg",
          sizeBytes: 2800000,
          aliases: ["image #3"]
        }
      ],
      directToolExecution: {
        toolCode: "image_edit",
        request: {
          toolCode: "image_edit",
          count: 1,
          prompt: "instagram carousel slide",
          filename: null,
          size: null,
          background: "auto",
          sourceImageAlias: "image #3",
          referenceImageAliases: []
        }
      }
    });
    const result = await service.execute(parsed);

    assert.equal(result.accepted, true, "image_edit with storagePath attachment must enqueue");
    assert.equal(reserveCalls.length, 1);
    assert.equal(reserveCalls[0]!.toolCode, "image_edit");
    assert.equal(enqueueCalls.count, 1);
  }

  // ── ADR-108 Slice 2: image_generate enqueue NEVER consults the wallet ────
  {
    // The VC repo mock throws on any access; if image_generate accidentally
    // read it, the test would fail loudly. (Cross-slice invariant 1 / 6.)
    const { service, reserveCalls, enqueueCalls } = buildService({});
    const result = await service.execute(imageGenerateInput(2, "message-img-no-vc"));
    assert.equal(result.accepted, true);
    assert.equal(reserveCalls.length, 1);
    assert.equal(reserveCalls[0]!.toolCode, "image_generate");
    assert.equal(enqueueCalls.count, 1);
  }

  // ── ADR-127 W4: storagePath attachment is accepted (v3 validator, regression) ──
  {
    const { service, reserveCalls, enqueueCalls } = buildService({});
    const parsed = service.parseInput({
      assistantId: "assistant-1",
      sourceUserMessageId: "message-w4-sp",
      sourceUserMessageText: "Edit this photo",
      attachments: [
        {
          attachmentId: "att-w4-sp",
          kind: "image",
          storagePath: "/workspace/input/photo.jpg",
          mimeType: "image/jpeg",
          displayName: "photo.jpg",
          sizeBytes: 1024,
          aliases: ["image #1"]
        }
      ],
      directToolExecution: {
        toolCode: "image_edit",
        request: {
          toolCode: "image_edit",
          count: 1,
          prompt: "make it brighter",
          filename: null,
          size: null,
          background: "auto",
          sourceImageAlias: "image #1",
          referenceImageAliases: []
        }
      }
    });
    const result = await service.execute(parsed);
    assert.equal(
      result.accepted,
      true,
      "ADR-127 W4: storagePath attachment must be accepted after fallback removal"
    );
    assert.equal(enqueueCalls.count, 1);
    assert.equal(reserveCalls[0]?.toolCode, "image_edit");
  }

  // ── ADR-127 W4: objectKey-only attachment is rejected (fallback removed) ──
  {
    const { service } = buildService({});
    assert.throws(
      () =>
        service.parseInput({
          assistantId: "assistant-1",
          sourceUserMessageId: "message-w4-ok",
          sourceUserMessageText: "Edit photo",
          attachments: [
            {
              attachmentId: "att-w4-ok",
              kind: "image",
              objectKey: "assistant-media/foo.jpg",
              mimeType: "image/jpeg",
              displayName: "foo.jpg",
              sizeBytes: 1024,
              aliases: ["image #1"]
            }
          ],
          directToolExecution: {
            toolCode: "image_edit",
            request: {
              toolCode: "image_edit",
              count: 1,
              prompt: "adjust",
              filename: null,
              size: null,
              background: "auto",
              sourceImageAlias: "image #1",
              referenceImageAliases: []
            }
          }
        }),
      /attachments must contain valid runtime attachment refs/,
      "ADR-127 W4: objectKey-only attachment must be rejected after fallback removal"
    );
  }

  // ── ADR-127 W4: mixed attachments (one storagePath + one objectKey-only) rejected ──
  {
    const { service } = buildService({});
    assert.throws(
      () =>
        service.parseInput({
          assistantId: "assistant-1",
          sourceUserMessageId: "message-w4-mixed",
          sourceUserMessageText: "Edit photos",
          attachments: [
            {
              attachmentId: "att-w4-good",
              kind: "image",
              storagePath: "/workspace/input/good.jpg",
              mimeType: "image/jpeg",
              displayName: "good.jpg",
              sizeBytes: 1024,
              aliases: ["image #1"]
            },
            {
              attachmentId: "att-w4-bad",
              kind: "image",
              objectKey: "assistant-media/bad.jpg",
              mimeType: "image/jpeg",
              displayName: "bad.jpg",
              sizeBytes: 2048,
              aliases: ["image #2"]
            }
          ],
          directToolExecution: {
            toolCode: "image_edit",
            request: {
              toolCode: "image_edit",
              count: 1,
              prompt: "collage",
              filename: null,
              size: null,
              background: "auto",
              sourceImageAlias: "image #1",
              referenceImageAliases: ["image #2"]
            }
          }
        }),
      /attachments must contain valid runtime attachment refs/,
      "ADR-127 W4: mixed attachments must be rejected when any element is objectKey-only"
    );
  }

  console.log("[enqueue-runtime-deferred-media-job.service.test] All scenarios passed.");
}

void run();
