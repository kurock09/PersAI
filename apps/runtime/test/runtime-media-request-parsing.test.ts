import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { InternalRuntimeMediaJobsController } from "../src/modules/turns/interface/http/internal-runtime-media-jobs.controller";
import { RuntimeImageEditToolService } from "../src/modules/turns/runtime-image-edit-tool.service";
import { RuntimeImageGenerateToolService } from "../src/modules/turns/runtime-image-generate-tool.service";
import { RuntimeVideoGenerateToolService } from "../src/modules/turns/runtime-video-generate-tool.service";

describe("runtime media request parsing", () => {
  test("image_generate accepts persisted toolCode inside worker request", () => {
    const service = new RuntimeImageGenerateToolService(
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
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
    const service = new RuntimeImageGenerateToolService(
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
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

  test("image_edit accepts persisted toolCode inside worker request", () => {
    const service = new RuntimeImageEditToolService(
      {} as never,
      {} as never,
      {} as never,
      {} as never
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
      {} as never,
      {} as never
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

  test("internal media-job parsing preserves attachment aliases", () => {
    const controller = new InternalRuntimeMediaJobsController(
      {} as never,
      {} as never,
      {} as never
    );
    const parsed = (
      controller as unknown as {
        parseInput(body: Record<string, unknown>): {
          attachments: Array<{ aliases?: string[]; fileRef?: string }>;
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
          objectKey: "assistant-media/path.png",
          mimeType: "image/png",
          filename: "input.png",
          sizeBytes: 123,
          fileRef: "file-1",
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
    assert.equal(parsed.attachments[0]?.fileRef, "file-1");
  });
});
