import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ATTACHMENT_SEMANTIC_SUMMARY_MAX_CHARS,
  buildStoredAttachmentMetadata,
  deriveStoredAttachmentSemanticSummary
} from "../src/modules/workspace-management/application/media/media.types";

describe("attachment semantic summary metadata", () => {
  test("derives bounded summary from text extract without copying full preview", () => {
    const longText = `${"alpha ".repeat(80)}beta`;
    const derived = deriveStoredAttachmentSemanticSummary({ textExtract: longText });
    assert.equal(derived.semanticSummarySource, "text_extract");
    assert.ok(derived.semanticSummary !== null);
    assert.equal(derived.semanticSummary!.length, ATTACHMENT_SEMANTIC_SUMMARY_MAX_CHARS);
    assert.doesNotMatch(derived.semanticSummary ?? "", /\n/);
    assert.ok(!derived.semanticSummary!.includes("beta"));
  });

  test("prefers transcription over text extract for deterministic manifest summary", () => {
    const derived = deriveStoredAttachmentSemanticSummary({
      textExtract: "ignored transcript body",
      transcription: "Meeting notes about Q2 pipeline."
    });
    assert.equal(derived.semanticSummary, "Meeting notes about Q2 pipeline.");
    assert.equal(derived.semanticSummarySource, "transcription");
    const metadata = buildStoredAttachmentMetadata({
      source: "web_staged_upload",
      textExtract: "ignored transcript body",
      transcription: "Meeting notes about Q2 pipeline."
    });
    assert.deepEqual(metadata, {
      source: "web_staged_upload",
      contentPreview: "ignored transcript body"
    });
  });

  test("omits semantic summary mirror in attachment metadata", () => {
    const metadata = buildStoredAttachmentMetadata({
      source: "chat_upload",
      textExtract: "line one\nline two"
    });
    assert.deepEqual(metadata, {
      source: "chat_upload",
      contentPreview: "line one line two"
    });
    const derived = deriveStoredAttachmentSemanticSummary({ textExtract: "line one\nline two" });
    assert.equal(derived.semanticSummary, "line one line two");
    assert.equal(derived.semanticSummarySource, "text_extract");
  });
});
