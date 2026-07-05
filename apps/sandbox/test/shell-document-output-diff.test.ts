import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildShellProducedFilesFromDocumentDiff,
  isWorkspaceDocumentOutputChanged
} from "../src/shell-document-output-diff";

describe("shell-document-output-diff", () => {
  test("isWorkspaceDocumentOutputChanged ignores mtime-only drift", () => {
    const snapshot = { sizeBytes: 100, contentHash: "abc" };
    assert.equal(
      isWorkspaceDocumentOutputChanged({
        before: snapshot,
        after: { sizeBytes: 100, contentHash: "abc" }
      }),
      false
    );
  });

  test("isWorkspaceDocumentOutputChanged detects new paths and byte changes", () => {
    assert.equal(
      isWorkspaceDocumentOutputChanged({
        before: undefined,
        after: { sizeBytes: 10, contentHash: "new" }
      }),
      true
    );
    assert.equal(
      isWorkspaceDocumentOutputChanged({
        before: { sizeBytes: 10, contentHash: "old" },
        after: { sizeBytes: 11, contentHash: "old" }
      }),
      true
    );
    assert.equal(
      isWorkspaceDocumentOutputChanged({
        before: { sizeBytes: 10, contentHash: "old" },
        after: { sizeBytes: 10, contentHash: "new" }
      }),
      true
    );
  });

  test("buildShellProducedFilesFromDocumentDiff emits csv and other non-office paths", () => {
    const sessionRoot = "/workspace/assistants/a/sessions/s1";
    const before = new Map<string, { sizeBytes: number; contentHash: string }>();
    const after = new Map([
      [`${sessionRoot}/report.csv`, { sizeBytes: 42, contentHash: "csv-hash" }],
      [`${sessionRoot}/chart.png`, { sizeBytes: 100, contentHash: "png-hash" }]
    ]);
    const produced = buildShellProducedFilesFromDocumentDiff({
      workspaceMountRoot: "/workspace",
      before,
      after,
      inferMimeType: (path) => (path.endsWith(".png") ? "image/png" : "text/csv")
    });
    assert.equal(produced.length, 2);
    assert.equal(produced[0]?.storagePath, `${sessionRoot}/report.csv`);
    assert.equal(produced[1]?.storagePath, `${sessionRoot}/chart.png`);
  });

  test("buildShellProducedFilesFromDocumentDiff emits only content-changed paths", () => {
    const sessionRoot = "/workspace/assistants/a/sessions/s1";
    const before = new Map([
      [`${sessionRoot}/old.docx`, { sizeBytes: 100, contentHash: "same" }],
      [`${sessionRoot}/stale.xlsx`, { sizeBytes: 50, contentHash: "unchanged" }]
    ]);
    const after = new Map([
      [`${sessionRoot}/old.docx`, { sizeBytes: 100, contentHash: "same" }],
      [`${sessionRoot}/stale.xlsx`, { sizeBytes: 50, contentHash: "unchanged" }],
      [`${sessionRoot}/new.pdf`, { sizeBytes: 20, contentHash: "fresh" }]
    ]);
    const produced = buildShellProducedFilesFromDocumentDiff({
      workspaceMountRoot: "/workspace",
      before,
      after,
      inferMimeType: (path) =>
        path.endsWith(".pdf") ? "application/pdf" : "application/octet-stream"
    });
    assert.equal(produced.length, 1);
    assert.equal(produced[0]?.storagePath, `${sessionRoot}/new.pdf`);
    assert.equal(produced[0]?.contentHash, "fresh");
  });
});
