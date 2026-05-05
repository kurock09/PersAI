import assert from "node:assert/strict";
import { describe, test } from "node:test";
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
      filename: "edit.png",
      size: "1024x1024",
      background: "auto",
      sourceImageIndex: 1
    });
    assert.ok(!(parsed instanceof Error));
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
      referenceImageIndex: 1
    });
    assert.ok(!(parsed instanceof Error));
  });
});
