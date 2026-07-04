import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createEmptyTurnDeliveryFacts,
  finalizeTurnDeliveryFacts,
  recordTurnDeliveryFactsFromToolOutcome,
  resolveAutoAttachCandidatePaths,
  resolveRuntimeFileVisibilityTier,
  resolveShellAutoAttachPaths,
  resolveUndeliveredProducedPaths
} from "../src/modules/turns/turn-delivery-facts";

const TEST_SESSION_ROOT = "/workspace/assistants/assistant-1/sessions/session-1";

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

  test("resolveShellAutoAttachPaths applies overwrite and single-v1 rules", () => {
    const overwritePath = wp("report.xlsx");
    const draftPath = wp("draft.xlsx");
    const finalPath = wp("final.xlsx");
    assert.deepEqual(
      resolveShellAutoAttachPaths(
        [
          { path: overwritePath, versionNumber: 2, isOverwrite: true, contentChanged: true },
          { path: draftPath, versionNumber: 1, isOverwrite: false, contentChanged: true },
          { path: finalPath, versionNumber: 1, isOverwrite: false, contentChanged: true }
        ],
        []
      ),
      [overwritePath]
    );
    assert.deepEqual(
      resolveShellAutoAttachPaths(
        [{ path: finalPath, versionNumber: 1, isOverwrite: false, contentChanged: true }],
        []
      ),
      [finalPath]
    );
    assert.deepEqual(
      resolveShellAutoAttachPaths(
        [{ path: overwritePath, versionNumber: 2, isOverwrite: true, contentChanged: false }],
        []
      ),
      []
    );
  });

  test("resolveAutoAttachCandidatePaths keeps non-shell undelivered outputs", () => {
    const tracker = createEmptyTurnDeliveryFacts();
    tracker.producedPaths.push(wp("rendered.pdf"));
    tracker.shellDocumentRegistrations.push({
      path: wp("draft.xlsx"),
      versionNumber: 1,
      isOverwrite: false,
      contentChanged: true
    });
    tracker.shellDocumentRegistrations.push({
      path: wp("final.xlsx"),
      versionNumber: 1,
      isOverwrite: false,
      contentChanged: true
    });
    assert.deepEqual(resolveAutoAttachCandidatePaths(tracker), [wp("rendered.pdf")]);
  });

  test("recordTurnDeliveryFactsFromToolOutcome tracks shell document sync", () => {
    const tracker = createEmptyTurnDeliveryFacts();
    recordTurnDeliveryFactsFromToolOutcome({
      tracker,
      toolName: "shell",
      isError: false,
      payload: {
        toolCode: "shell",
        executionMode: "sandbox",
        action: "completed",
        reason: null,
        warning: null,
        job: null,
        paths: [wp("report.xlsx")],
        documentSync: [
          {
            path: wp("report.xlsx"),
            registered: true,
            versionNumber: 2,
            bumped: true,
            isOverwrite: true,
            contentChanged: true
          }
        ]
      }
    });
    const facts = finalizeTurnDeliveryFacts(tracker);
    assert.deepEqual(facts.producedPaths, [wp("report.xlsx")]);
    assert.deepEqual(facts.shellDocumentRegistrations, [
      { path: wp("report.xlsx"), versionNumber: 2, isOverwrite: true, contentChanged: true }
    ]);
    assert.deepEqual(resolveAutoAttachCandidatePaths(facts), [wp("report.xlsx")]);
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
