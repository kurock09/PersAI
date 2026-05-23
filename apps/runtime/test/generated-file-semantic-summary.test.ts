import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildGeneratedFileSemanticSummary } from "../src/modules/turns/generated-file-semantic-summary";

describe("buildGeneratedFileSemanticSummary", () => {
  test("prefers revised/provider text for image outputs", () => {
    assert.equal(
      buildGeneratedFileSemanticSummary({
        preferredText: "Illustrated poster of a calm lake at sunrise with pine trees.",
        requestText: "draw something nice"
      }),
      "Illustrated poster of a calm lake at sunrise with pine trees."
    );
  });

  test("falls back to requested name when the request text is too generic", () => {
    assert.equal(
      buildGeneratedFileSemanticSummary({
        requestText: "make it better",
        requestedName: "Quarterly launch brief.pdf"
      }),
      "Quarterly launch brief"
    );
  });

  test("returns null for weak image/document requests when fallback analysis should run", () => {
    assert.equal(
      buildGeneratedFileSemanticSummary({
        requestText: "make it better"
      }),
      null
    );
  });

  test("allows weak request fallback for media types without background analysis", () => {
    assert.equal(
      buildGeneratedFileSemanticSummary({
        requestText: "make it better",
        allowWeakRequestFallback: true
      }),
      "make it better"
    );
  });
});
