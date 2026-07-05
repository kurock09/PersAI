import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { InternalRuntimeMediaJobsController } from "../src/modules/turns/interface/http/internal-runtime-media-jobs.controller";
import { RuntimeImageEditToolService } from "../src/modules/turns/runtime-image-edit-tool.service";
import { RuntimeImageGenerateToolService } from "../src/modules/turns/runtime-image-generate-tool.service";
import { RuntimeVideoGenerateToolService } from "../src/modules/turns/runtime-video-generate-tool.service";
import {
  createFakeMediaObjectStorageForRead,
  createFakeSandboxClientForOutboundWrite
} from "./helpers/runtime-outbound-test-doubles";

describe("runtime media request parsing", () => {
  test("image_generate accepts persisted toolCode inside worker request", () => {
    const service = new RuntimeImageGenerateToolService({} as never, {} as never, {} as never);
    const parsed = (
      service as unknown as {
        readImageGenerateArguments(args: Record<string, unknown>): unknown;
      }
    ).readImageGenerateArguments({
      toolCode: "image_generate",
      prompt: "draw a cat",
      count: 1,
      filename: "cat.png",
      size: "1024x1024",
      background: "auto"
    });
    assert.ok(!(parsed instanceof Error));
  });

  test("image_generate accepts explicit series mode with one item per output", () => {
    const service = new RuntimeImageGenerateToolService({} as never, {} as never, {} as never);
    const parsed = (
      service as unknown as {
        readImageGenerateArguments(args: Record<string, unknown>): unknown;
      }
    ).readImageGenerateArguments({
      toolCode: "image_generate",
      prompt: "instagram carousel about sneakers",
      count: 3,
      outputMode: "series",
      seriesItems: ["hero frame", "detail frame", "cta frame"],
      background: "auto"
    });
    assert.ok(!(parsed instanceof Error));
    assert.equal((parsed as { outputMode: string }).outputMode, "series");
    assert.deepEqual((parsed as { seriesItems: string[] }).seriesItems, [
      "hero frame",
      "detail frame",
      "cta frame"
    ]);
  });

  test("image_generate synthesizes an overall prompt for series mode without a top-level prompt", () => {
    const service = new RuntimeImageGenerateToolService({} as never, {} as never, {} as never);
    const parsed = (
      service as unknown as {
        readImageGenerateArguments(args: Record<string, unknown>): unknown;
      }
    ).readImageGenerateArguments({
      toolCode: "image_generate",
      count: 3,
      outputMode: "series",
      seriesItems: ["hero frame", "detail frame", "cta frame"],
      background: "auto"
    });
    assert.ok(!(parsed instanceof Error));
    assert.ok(
      typeof (parsed as { prompt: unknown }).prompt === "string" &&
        (parsed as { prompt: string }).prompt.length > 0
    );
  });

  test("image_generate still rejects a missing prompt outside series mode", () => {
    const service = new RuntimeImageGenerateToolService({} as never, {} as never, {} as never);
    const parsed = (
      service as unknown as {
        readImageGenerateArguments(args: Record<string, unknown>): unknown;
      }
    ).readImageGenerateArguments({
      toolCode: "image_generate",
      count: 1,
      background: "auto"
    });
    assert.ok(parsed instanceof Error);
  });

  test("image_edit accepts persisted toolCode inside worker request", () => {
    const service = new RuntimeImageEditToolService(
      {} as never,
      {} as never,
      createFakeMediaObjectStorageForRead() as never,
      createFakeSandboxClientForOutboundWrite() as never
    );
    const parsed = (
      service as unknown as {
        readImageEditArguments(args: Record<string, unknown>): unknown;
      }
    ).readImageEditArguments({
      toolCode: "image_edit",
      prompt: "make it brighter",
      count: 2,
      filename: "edit.png",
      size: "1024x1024",
      background: "auto",
      sourceImageAlias: "current image #1"
    });
    assert.ok(!(parsed instanceof Error));
    assert.equal((parsed as { count: number }).count, 2);
  });

  test("image_edit rejects series mode when seriesItems count mismatches", () => {
    const service = new RuntimeImageEditToolService(
      {} as never,
      {} as never,
      createFakeMediaObjectStorageForRead() as never,
      createFakeSandboxClientForOutboundWrite() as never
    );
    const parsed = (
      service as unknown as {
        readImageEditArguments(args: Record<string, unknown>): unknown;
      }
    ).readImageEditArguments({
      toolCode: "image_edit",
      prompt: "make a 3-frame story",
      count: 3,
      outputMode: "series",
      seriesItems: ["frame 1", "frame 2"],
      sourceImageAlias: "current image #1"
    });
    assert.ok(parsed instanceof Error);
  });

  test("image_edit synthesizes an overall prompt for series mode without a top-level prompt", () => {
    const service = new RuntimeImageEditToolService(
      {} as never,
      {} as never,
      createFakeMediaObjectStorageForRead() as never,
      createFakeSandboxClientForOutboundWrite() as never
    );
    const parsed = (
      service as unknown as {
        readImageEditArguments(args: Record<string, unknown>): unknown;
      }
    ).readImageEditArguments({
      toolCode: "image_edit",
      count: 4,
      outputMode: "series",
      seriesItems: ["slide 1", "slide 2", "slide 3", "slide 4"],
      sourceImageAlias: "image #1",
      referenceImageAliases: ["image #2"],
      size: "1024x1024",
      background: "auto"
    });
    assert.ok(!(parsed instanceof Error));
    assert.ok(
      typeof (parsed as { prompt: unknown }).prompt === "string" &&
        (parsed as { prompt: string }).prompt.length > 0
    );
  });

  test("image_edit still rejects a missing prompt outside series mode", () => {
    const service = new RuntimeImageEditToolService(
      {} as never,
      {} as never,
      createFakeMediaObjectStorageForRead() as never,
      createFakeSandboxClientForOutboundWrite() as never
    );
    const parsed = (
      service as unknown as {
        readImageEditArguments(args: Record<string, unknown>): unknown;
      }
    ).readImageEditArguments({
      toolCode: "image_edit",
      count: 1,
      sourceImageAlias: "image #1",
      background: "auto"
    });
    assert.ok(parsed instanceof Error);
  });

  test("image_edit accepts multiple reference aliases and dedupes them", () => {
    const service = new RuntimeImageEditToolService(
      {} as never,
      {} as never,
      createFakeMediaObjectStorageForRead() as never,
      createFakeSandboxClientForOutboundWrite() as never
    );
    const parsed = (
      service as unknown as {
        readImageEditArguments(args: Record<string, unknown>): unknown;
      }
    ).readImageEditArguments({
      toolCode: "image_edit",
      prompt: "blend the styles",
      count: 1,
      sourceImageAlias: "image #1",
      referenceImageAliases: ["image #2", "image #2", "image #3", "image #4"],
      background: "auto"
    });
    assert.ok(!(parsed instanceof Error));
    assert.deepEqual((parsed as { referenceImageAliases: string[] }).referenceImageAliases, [
      "image #2",
      "image #3",
      "image #4"
    ]);
    assert.equal(
      (parsed as Record<string, unknown>).referenceImageAlias,
      undefined,
      "parsed RuntimeImageEditRequest must NOT carry the legacy singular referenceImageAlias field"
    );
  });

  test("image_edit drops a reference alias that equals the source alias", () => {
    const service = new RuntimeImageEditToolService(
      {} as never,
      {} as never,
      createFakeMediaObjectStorageForRead() as never,
      createFakeSandboxClientForOutboundWrite() as never
    );
    const parsed = (
      service as unknown as {
        readImageEditArguments(args: Record<string, unknown>): unknown;
      }
    ).readImageEditArguments({
      toolCode: "image_edit",
      prompt: "tweak it",
      count: 1,
      sourceImageAlias: "image #1",
      referenceImageAliases: ["image #1", "image #2"],
      background: "auto"
    });
    assert.ok(!(parsed instanceof Error));
    assert.deepEqual((parsed as { referenceImageAliases: string[] }).referenceImageAliases, [
      "image #2"
    ]);
  });

  test("image_edit rejects more than the maximum reference images", () => {
    const service = new RuntimeImageEditToolService(
      {} as never,
      {} as never,
      createFakeMediaObjectStorageForRead() as never,
      createFakeSandboxClientForOutboundWrite() as never
    );
    const tooMany = Array.from({ length: 16 }, (_, index) => `image #${String(index + 2)}`);
    const parsed = (
      service as unknown as {
        readImageEditArguments(args: Record<string, unknown>): unknown;
      }
    ).readImageEditArguments({
      toolCode: "image_edit",
      prompt: "blend many",
      count: 1,
      sourceImageAlias: "image #1",
      referenceImageAliases: tooMany,
      background: "auto"
    });
    assert.ok(parsed instanceof Error);
  });

  test("persisted RuntimeImageEditRequest passes worker rehydrate parse", () => {
    // Regression guard for the post-`4a0baa39` (ADR-117 cleanup) hotfix where
    // the parser whitelist was tightened to plural-only `referenceImageAliases`
    // while the persisted request shape still carried the legacy singular
    // `referenceImageAlias`. The worker rehydrate parse rejected every job as
    // `invalid_arguments: Unexpected arguments: referenceImageAlias` and the
    // scheduler burned the full ~7.5 min exponential-backoff retry budget.
    const service = new RuntimeImageEditToolService(
      {} as never,
      {} as never,
      createFakeMediaObjectStorageForRead() as never,
      createFakeSandboxClientForOutboundWrite() as never
    );
    const readImageEditArguments = (
      service as unknown as {
        readImageEditArguments(args: Record<string, unknown>): unknown;
      }
    ).readImageEditArguments.bind(service);

    // Step 1 — fresh parse of a model tool call.
    const freshArgs = {
      toolCode: "image_edit" as const,
      prompt: "carousel from this product photo",
      count: 4,
      outputMode: "series" as const,
      seriesItems: ["slide 1", "slide 2", "slide 3", "slide 4"],
      sourceImageAlias: "image #1",
      referenceImageAliases: ["image #2"],
      filename: "x.png",
      size: "1024x1536" as const,
      background: "auto" as const
    };
    const parsedFresh = readImageEditArguments(freshArgs);
    assert.ok(
      !(parsedFresh instanceof Error),
      `fresh image_edit parse must succeed: ${parsedFresh instanceof Error ? parsedFresh.message : ""}`
    );
    assert.equal(
      (parsedFresh as Record<string, unknown>).referenceImageAlias,
      undefined,
      "parsed RuntimeImageEditRequest must NOT carry the legacy singular referenceImageAlias field"
    );

    // Step 2 — feed the parsed request back through the same parser, simulating
    // the deferred-media-job worker rehydrate (the persisted
    // `directToolExecution.request` shape is fed straight back into
    // `readImageEditArguments`).
    const parsedRehydrate = readImageEditArguments(
      parsedFresh as unknown as Record<string, unknown>
    );
    assert.ok(
      !(parsedRehydrate instanceof Error),
      `persisted RuntimeImageEditRequest must rehydrate-parse without 'Unexpected arguments' errors (got: ${parsedRehydrate instanceof Error ? parsedRehydrate.message : ""})`
    );
    assert.deepEqual(
      (parsedRehydrate as { referenceImageAliases: string[] | null }).referenceImageAliases,
      ["image #2"]
    );
  });

  test("video_generate accepts persisted toolCode inside worker request", () => {
    const service = new RuntimeVideoGenerateToolService(
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const parsed = (
      service as unknown as {
        readVideoGenerateArguments(args: Record<string, unknown>): unknown;
      }
    ).readVideoGenerateArguments({
      toolCode: "video_generate",
      prompt: "animate this",
      filename: "clip.mp4",
      size: "1280x720",
      seconds: 4,
      referenceImageAlias: "last generated image"
    });
    assert.ok(!(parsed instanceof Error));
  });

  test("video_generate accepts acceptedProviderTask for media-job recovery resume", () => {
    const service = new RuntimeVideoGenerateToolService(
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const parsed = (
      service as unknown as {
        readVideoGenerateArguments(args: Record<string, unknown>): unknown;
      }
    ).readVideoGenerateArguments({
      toolCode: "video_generate",
      action: "generate",
      prompt: "resume pirate",
      mode: "talking_avatar",
      speechText: "Ahoy",
      speechLanguage: "ru-RU",
      personaId: "persona-1",
      acceptedProviderTask: {
        provider: "heygen",
        model: "avatar_v",
        providerTaskId: "17548ce70b234d0fa9c047daa9ce410e",
        acceptedAt: "2026-07-05T10:46:58.010Z",
        providerStage: "accepted",
        taskKind: "talking_avatar"
      }
    });
    assert.ok(!(parsed instanceof Error));
    assert.equal(
      (parsed as { acceptedProviderTask?: { providerTaskId?: string } }).acceptedProviderTask
        ?.providerTaskId,
      "17548ce70b234d0fa9c047daa9ce410e"
    );
  });

  test("internal media-job parsing preserves attachment aliases", () => {
    const controller = new InternalRuntimeMediaJobsController(
      {} as never,
      {} as never,
      {} as never
    );
    const parsed = (
      controller as unknown as {
        parseInput(body: Record<string, unknown>): {
          attachments: Array<{ aliases?: string[]; storagePath?: string }>;
        };
      }
    ).parseInput({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      runtimeTier: "paid_shared_restricted",
      runtimeBundleDocument: "{}",
      job: {
        id: "job-1",
        surface: "web",
        kind: "image",
        chatId: "chat-1",
        sourceUserMessageId: "message-1",
        sourceUserMessageText: "edit this image",
        sourceUserMessageCreatedAt: "2026-05-07T16:45:48.221Z"
      },
      attachments: [
        {
          attachmentId: "attachment-1",
          kind: "image",
          storagePath: "assistant-media/path.png",
          mimeType: "image/png",
          displayName: "input.png",
          sizeBytes: 123,
          aliases: ["current attachment #1", "current image #1"]
        }
      ],
      directToolExecution: {
        toolCode: "image_edit",
        request: {
          toolCode: "image_edit",
          prompt: "make it brighter",
          filename: "edit.png",
          size: "1024x1024",
          background: "auto",
          sourceImageAlias: "current image #1"
        }
      }
    });

    assert.deepEqual(parsed.attachments[0]?.aliases, ["current attachment #1", "current image #1"]);
    assert.equal(parsed.attachments[0]?.storagePath, "assistant-media/path.png");
  });
});
