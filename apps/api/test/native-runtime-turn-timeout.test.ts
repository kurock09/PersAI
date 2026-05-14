import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveNativeRuntimeTurnTimeoutMs } from "../src/modules/workspace-management/application/native-runtime-turn-timeout";

describe("resolveNativeRuntimeTurnTimeoutMs", () => {
  test("returns the fallback when runtime bundle has no worker timeouts", () => {
    assert.equal(resolveNativeRuntimeTurnTimeoutMs({}, 90_000), 90_000);
    assert.equal(resolveNativeRuntimeTurnTimeoutMs(null, 90_000), 90_000);
  });

  test("keeps the fallback when worker timeouts are shorter", () => {
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

  test("extends the timeout beyond the longest worker timeout", () => {
    assert.equal(
      resolveNativeRuntimeTurnTimeoutMs(
        {
          runtime: {
            workerTools: {
              tools: [
                { toolCode: "image_generate", timeoutMs: 180_000 },
                { toolCode: "video_generate", timeoutMs: 600_000 }
              ]
            }
          }
        },
        90_000
      ),
      615_000
    );
  });
});
