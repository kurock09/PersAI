import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFilePreviewBlocks } from "../src/modules/turns/runtime-file-preview-hydration";

test("buildFilePreviewBlocks hydrates PDF preview blocks from workspace bytes", async () => {
  const pdfBytes = Buffer.from("%PDF-1.4 test");
  const result = await buildFilePreviewBlocks({
    downloadBytes: async () => pdfBytes,
    mimeType: "application/pdf",
    filename: "report.pdf",
    sizeBytes: pdfBytes.length,
    effectiveMaxPreviewBytes: 1024 * 1024,
    effectiveMaxPreviewEdgePx: 1024,
    alias: "report",
    instruction: "check layout"
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.visualKind, "pdf");
  assert.equal(result.blocks.length, 2);
  assert.equal(result.blocks[0]?.type, "text");
  assert.equal(result.blocks[1]?.type, "pdf");
});

test("buildFilePreviewBlocks rejects unsupported mime types", async () => {
  const result = await buildFilePreviewBlocks({
    downloadBytes: async () => Buffer.from("hello"),
    mimeType: "text/plain",
    filename: "notes.txt",
    sizeBytes: 5,
    effectiveMaxPreviewBytes: 1024,
    effectiveMaxPreviewEdgePx: 512,
    alias: null,
    instruction: null
  });
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.reason, "preview_unsupported");
});
