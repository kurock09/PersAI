import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  applySectionPatches,
  buildStructureFromExtractedText,
  buildStructureFromRenderedHtml,
  createDefaultStyleProfile,
  extractStructurePlainText,
  mergeStyleProfile,
  renderStructureToHtml,
  resolveEditStrategyForCreate
} from "../src/modules/turns/persai-document-structure";

describe("persai-document-structure", () => {
  test("resolveEditStrategyForCreate routes large source to structured_large", () => {
    assert.equal(
      resolveEditStrategyForCreate({ totalInlinedSourceBytes: 25_000 }),
      "structured_large"
    );
    assert.equal(resolveEditStrategyForCreate({ totalInlinedSourceBytes: 4_000 }), "fast_small");
  });

  test("buildStructureFromExtractedText preserves paragraph text deterministically", () => {
    const structure = buildStructureFromExtractedText(
      "INTRO\n\nFirst paragraph.\n\nSecond paragraph."
    );
    const plain = extractStructurePlainText(structure);
    assert.match(plain, /INTRO/);
    assert.match(plain, /First paragraph/);
    assert.match(plain, /Second paragraph/);
  });

  test("renderStructureToHtml is deterministic for structure + style", () => {
    const structure = buildStructureFromExtractedText("Body paragraph one.\n\nBody paragraph two.");
    const style = createDefaultStyleProfile();
    const html = renderStructureToHtml(structure, style);
    assert.match(html, /Body paragraph one/);
    assert.match(html, /<style>/);
  });

  test("renderStructureToHtml does not duplicate section heading blocks", () => {
    const structure = buildStructureFromExtractedText("INTRO\n\nFirst paragraph.");
    const html = renderStructureToHtml(structure, createDefaultStyleProfile());
    const introMatches = html.match(/INTRO/g) ?? [];
    assert.equal(introMatches.length, 1);
    assert.match(html, /<h2>INTRO<\/h2>/);
  });

  test("lazy upgrade from rendered HTML produces sections", () => {
    const html =
      '<!DOCTYPE html><html><body><section id="sec-1"><h2>Title</h2><p>Alpha</p></section><section id="sec-2"><p>Beta</p></section></body></html>';
    const structure = buildStructureFromRenderedHtml(html);
    assert.equal(structure.sections.length, 2);
    assert.equal(structure.sections[0]?.id, "sec-1");
  });

  test("applySectionPatches updates only targeted section blocks", () => {
    const structure = buildStructureFromExtractedText("Alpha section body.");
    const targetSectionId = structure.sections[0]!.id;
    const next = applySectionPatches(structure, [
      {
        sectionId: targetSectionId,
        blocks: [
          {
            id: "blk-new",
            type: "paragraph",
            html: "Rewritten section body"
          }
        ]
      }
    ]);
    const plain = extractStructurePlainText(next);
    assert.match(plain, /Rewritten section body/);
    assert.equal(plain.includes("Alpha section body"), false);
  });

  test("mergeStyleProfile changes typography without touching structure text", () => {
    const structure = buildStructureFromExtractedText("Immutable body text.");
    const before = extractStructurePlainText(structure);
    const style = mergeStyleProfile(createDefaultStyleProfile(), {
      typography: { bodyFontSizePt: 13 }
    });
    const html = renderStructureToHtml(structure, style);
    assert.match(html, /font-size: 13pt/);
    assert.equal(extractStructurePlainText(structure), before);
  });
});
