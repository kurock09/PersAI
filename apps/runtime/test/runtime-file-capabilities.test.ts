import assert from "node:assert/strict";
import {
  DEFAULT_MAX_FILE_PREVIEW_BYTES,
  FILE_PREVIEW_ABSOLUTE_MAX_BYTES,
  clampPlanMaxFilePreviewBytes,
  resolveEffectiveMaxFilePreviewBytes,
  resolveEffectiveMaxFilePreviewEdgePx
} from "@persai/config";
import {
  buildFilesInspectContent,
  resolveFileCapabilities
} from "../src/modules/turns/runtime-file-capabilities";

async function run(): Promise<void> {
  assert.equal(resolveEffectiveMaxFilePreviewBytes(null), DEFAULT_MAX_FILE_PREVIEW_BYTES);
  assert.equal(
    resolveEffectiveMaxFilePreviewBytes(FILE_PREVIEW_ABSOLUTE_MAX_BYTES + 1),
    FILE_PREVIEW_ABSOLUTE_MAX_BYTES
  );
  assert.equal(clampPlanMaxFilePreviewBytes(1_048_576), 1_048_576);
  assert.equal(resolveEffectiveMaxFilePreviewEdgePx(null), 2048);
  assert.equal(resolveEffectiveMaxFilePreviewEdgePx(1024), 1024);

  assert.deepEqual(resolveFileCapabilities("text/plain", 100, DEFAULT_MAX_FILE_PREVIEW_BYTES), [
    "text"
  ]);
  assert.deepEqual(
    resolveFileCapabilities("application/pdf", 2048, DEFAULT_MAX_FILE_PREVIEW_BYTES),
    ["text", "visual"]
  );
  assert.deepEqual(
    resolveFileCapabilities("application/pdf", DEFAULT_MAX_FILE_PREVIEW_BYTES + 1, 1_048_576),
    ["text"]
  );
  assert.deepEqual(resolveFileCapabilities("image/png", 512, DEFAULT_MAX_FILE_PREVIEW_BYTES), [
    "visual"
  ]);

  const inspectContent = JSON.parse(
    buildFilesInspectContent({
      mimeType: "application/pdf",
      sizeBytes: 2048,
      policy: { maxFilePreviewBytes: 1_048_576, maxFilePreviewEdgePx: 1024 } as never,
      metadata: {
        internalRuntimeFileExtractionCache: {
          schema: "persai.internalRuntimeFileExtractionCache.v1"
        }
      }
    })
  ) as Record<string, unknown>;
  assert.deepEqual(inspectContent.capabilities, ["text", "visual"]);
  assert.equal(inspectContent.effectiveMaxPreviewBytes, 1_048_576);
  assert.equal(inspectContent.effectiveMaxPreviewEdgePx, 1024);
  assert.equal(inspectContent.extractionCached, true);
}

run()
  .then(() => {
    console.log("runtime-file-capabilities.test.ts passed");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
