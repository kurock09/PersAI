import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { shouldDeferMediaToolExecution } from "../src/modules/turns/media-tool-deferral";

describe("shouldDeferMediaToolExecution", () => {
  test("never defers media-job worker threads", () => {
    assert.equal(
      shouldDeferMediaToolExecution({
        externalThreadKey: "system:media-job:job-1"
      }),
      false
    );
  });

  test("defers ordinary-thread image and video tools", () => {
    assert.equal(
      shouldDeferMediaToolExecution({
        externalThreadKey: "web:chat-1"
      }),
      true
    );
    assert.equal(
      shouldDeferMediaToolExecution({
        externalThreadKey: "telegram:chat-1"
      }),
      true
    );
  });
});
