import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { shouldDeferMediaToolExecution } from "../src/modules/turns/media-tool-deferral";

describe("shouldDeferMediaToolExecution (ADR-165)", () => {
  test("never defers media-job worker threads", () => {
    assert.equal(
      shouldDeferMediaToolExecution({
        externalThreadKey: "system:media-job:job-1",
        toolCode: "video_generate"
      }),
      false
    );
    assert.equal(
      shouldDeferMediaToolExecution({
        externalThreadKey: "system:media-job:job-1",
        toolCode: "image_generate"
      }),
      false
    );
  });

  test("never defers image_generate / image_edit on ordinary threads", () => {
    assert.equal(
      shouldDeferMediaToolExecution({
        externalThreadKey: "web:chat-1",
        toolCode: "image_generate"
      }),
      false
    );
    assert.equal(
      shouldDeferMediaToolExecution({
        externalThreadKey: "telegram:chat-1",
        toolCode: "image_edit"
      }),
      false
    );
  });

  test("still defers video_generate on ordinary threads", () => {
    assert.equal(
      shouldDeferMediaToolExecution({
        externalThreadKey: "web:chat-1",
        toolCode: "video_generate"
      }),
      true
    );
    assert.equal(
      shouldDeferMediaToolExecution({
        externalThreadKey: "web:chat-1"
      }),
      true
    );
  });
});
