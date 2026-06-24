import assert from "node:assert/strict";
import {
  buildDocumentReadMetadata,
  normalizeRuntimeFilesReadExtractionQuality
} from "../src/modules/turns/runtime-files-read-metadata";

async function run(): Promise<void> {
  const quality = normalizeRuntimeFilesReadExtractionQuality({
    status: "needs_review",
    score: 0.4,
    reasonCodes: ["low_text_density"],
    textChars: 120
  });
  assert.deepEqual(quality, {
    status: "needs_review",
    score: 0.4,
    reasonCodes: ["low_text_density"],
    textChars: 120
  });

  const metadata = buildDocumentReadMetadata({
    extracted: true,
    text: "cached body",
    note: "from cache",
    quality,
    cached: true
  });
  assert.equal(metadata.charCount, 11);
  assert.equal(metadata.truncated, false);
  assert.equal(metadata.readNote, "from cache");
  assert.equal(metadata.extractionCached, true);

  const truncatedMetadata = buildDocumentReadMetadata({
    extracted: true,
    text: "a".repeat(16_001),
    note: null,
    quality: null,
    cached: false
  });
  assert.equal(truncatedMetadata.truncated, true);
  assert.equal(truncatedMetadata.charCount, 16_001);
}

run()
  .then(() => {
    console.log("runtime-files-read-metadata.test.ts passed");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
