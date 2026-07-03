import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createEmptyTurnDeliveryFacts,
  finalizeTurnDeliveryFacts,
  recordTurnDeliveryFactsFromToolOutcome,
  resolveRuntimeFileVisibilityTier,
  resolveUndeliveredProducedPaths
} from "../src/modules/turns/turn-delivery-facts";

const TEST_SESSION_ROOT = "/workspace/assistants/my-bot/sessions/session-1";

function wp(relativePath: string): string {
  return `${TEST_SESSION_ROOT}/${relativePath.replace(/^\/+/, "")}`;
}

describe("turn-delivery-facts", () => {
  test("resolveUndeliveredProducedPaths returns produced minus attached", () => {
    const tracker = createEmptyTurnDeliveryFacts();
    tracker.producedPaths.push(wp("a.pdf"), wp("b.pdf"));
    tracker.attachedPaths.push(wp("a.pdf"));
    assert.deepEqual(resolveUndeliveredProducedPaths(tracker), [wp("b.pdf")]);
    assert.deepEqual(finalizeTurnDeliveryFacts(tracker).attachedPaths, [wp("a.pdf")]);
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
          outputPath: wp("test_pdf_document/output/test_document.pdf"),
          mimeType: "application/pdf",
          sizeBytes: 15522
        }
      }
    });
    const facts = finalizeTurnDeliveryFacts(tracker);
    assert.deepEqual(facts.producedPaths, [wp("test_pdf_document/output/test_document.pdf")]);
    assert.deepEqual(facts.attachedPaths, []);
  });

  test("resolveRuntimeFileVisibilityTier prefers produced paths and session roots", () => {
    const produced = new Set([wp("out/report.pdf")]);
    assert.equal(
      resolveRuntimeFileVisibilityTier({
        storagePath: wp("out/report.pdf"),
        currentChatId: "chat-1",
        producedPathsThisTurn: produced
      }),
      "session"
    );
    assert.equal(
      resolveRuntimeFileVisibilityTier({
        storagePath: wp("other.pdf"),
        currentChatId: "chat-1",
        producedPathsThisTurn: produced,
        originChatId: "chat-1"
      }),
      "session"
    );
    assert.equal(
      resolveRuntimeFileVisibilityTier({
        storagePath: "/workspace/shared/old.pdf",
        currentChatId: "chat-1",
        producedPathsThisTurn: produced
      }),
      "workspace"
    );
  });
});
