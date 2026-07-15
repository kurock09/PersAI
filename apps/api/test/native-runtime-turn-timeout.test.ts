import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveNativeRuntimeTurnTimeoutMs } from "../src/modules/workspace-management/application/native-runtime-turn-timeout";

const VIDEO_WORKER_BUNDLE = {
  runtime: {
    workerTools: {
      tools: [
        { toolCode: "image_generate", timeoutMs: 180_000 },
        { toolCode: "video_generate", timeoutMs: 600_000 }
      ]
    }
  }
};

describe("resolveNativeRuntimeTurnTimeoutMs", () => {
  test("returns the configured wall-clock budget regardless of worker timeouts", () => {
    assert.equal(resolveNativeRuntimeTurnTimeoutMs({}, 90_000), 90_000);
    assert.equal(resolveNativeRuntimeTurnTimeoutMs(null, 90_000), 90_000);
    assert.equal(resolveNativeRuntimeTurnTimeoutMs(VIDEO_WORKER_BUNDLE, 1_800_000), 1_800_000);
  });

  test("does not inflate the stream ceiling to max(workerTimeouts)+15s", () => {
    assert.equal(resolveNativeRuntimeTurnTimeoutMs(VIDEO_WORKER_BUNDLE, 90_000), 90_000);
    assert.notEqual(resolveNativeRuntimeTurnTimeoutMs(VIDEO_WORKER_BUNDLE, 90_000), 615_000);
  });

  test("keeps shorter configured wall clocks even when worker timeouts are longer", () => {
    assert.equal(
      resolveNativeRuntimeTurnTimeoutMs(
        {
          runtime: {
            workerTools: {
              tools: [{ toolCode: "tts", timeoutMs: 60_000 }]
            }
          }
        },
        90_000
      ),
      90_000
    );
  });
});
