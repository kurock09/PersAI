import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createEmptyTurnDeliveryFacts,
  finalizeTurnDeliveryFacts,
  recordTurnDeliveryFactsFromToolOutcome,
  resolveRuntimeFileScopeTier,
  resolveUndeliveredProducedPaths
} from "../src/modules/turns/turn-delivery-facts";

describe("turn-delivery-facts", () => {
  test("resolveUndeliveredProducedPaths returns produced minus attached", () => {
    const tracker = createEmptyTurnDeliveryFacts();
    tracker.producedPaths.push("/workspace/a.pdf", "/workspace/b.pdf");
    tracker.attachedPaths.push("/workspace/a.pdf");
    assert.deepEqual(resolveUndeliveredProducedPaths(tracker), ["/workspace/b.pdf"]);
    assert.deepEqual(finalizeTurnDeliveryFacts(tracker).attachedPaths, ["/workspace/a.pdf"]);
  });

  test("recordTurnDeliveryFactsFromToolOutcome tracks render without attach", () => {
    const tracker = createEmptyTurnDeliveryFacts();
    recordTurnDeliveryFactsFromToolOutcome({
      tracker,
      toolName: "document",
      isError: false,
      payload: {
        toolCode: "document",
        action: "rendered",
        render: {
          outputPath: "/workspace/test_pdf_document/output/test_document.pdf",
          mimeType: "application/pdf",
          sizeBytes: 15522
        }
      }
    });
    const facts = finalizeTurnDeliveryFacts(tracker);
    assert.deepEqual(facts.producedPaths, [
      "/workspace/test_pdf_document/output/test_document.pdf"
    ]);
    assert.deepEqual(facts.attachedPaths, []);
  });

  test("resolveRuntimeFileScopeTier prefers produced paths and chat origin", () => {
    const produced = new Set(["/workspace/out/report.pdf"]);
    assert.equal(
      resolveRuntimeFileScopeTier({
        storagePath: "/workspace/out/report.pdf",
        currentChatId: "chat-1",
        producedPathsThisTurn: produced
      }),
      "chat"
    );
    assert.equal(
      resolveRuntimeFileScopeTier({
        storagePath: "/workspace/other.pdf",
        currentChatId: "chat-1",
        producedPathsThisTurn: produced,
        originChatId: "chat-1"
      }),
      "chat"
    );
    assert.equal(
      resolveRuntimeFileScopeTier({
        storagePath: "/shared/outbound/self/old.pdf",
        currentChatId: "chat-1",
        producedPathsThisTurn: produced
      }),
      "workspace_shared"
    );
  });
});
