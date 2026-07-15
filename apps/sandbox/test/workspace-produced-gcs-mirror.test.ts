import assert from "node:assert/strict";
import { test } from "node:test";
import type { RuntimeSandboxProducedFile } from "@persai/runtime-contract";
import { mirrorVisibleWorkspaceProducedFilesToGcs } from "../src/workspace-produced-gcs-mirror";

test("mirrorVisibleWorkspaceProducedFilesToGcs uploads shell-produced workspace paths", async () => {
  const saved: Array<{ objectKey: string; buffer: Buffer; mimeType: string }> = [];
  const producedFiles: RuntimeSandboxProducedFile[] = [
    {
      relativePath: "assistants/a/sessions/s/report.pdf",
      displayName: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 11,
      logicalSizeBytes: 11,
      storagePath: "/workspace/assistants/a/sessions/s/report.pdf",
      contentHash: "abc"
    }
  ];

  await mirrorVisibleWorkspaceProducedFilesToGcs({
    workspaceId: "ws-1",
    workspaceRoot: "/tmp/ws",
    workspaceMountRoot: "/workspace",
    producedFiles,
    resolveLocalAbsolutePath: () => "/tmp/ws/assistants/a/sessions/s/report.pdf",
    objectStorage: {
      buildWorkspaceObjectKey: ({ workspaceId, workspaceRelPath }) =>
        `prefix/workspaces/${workspaceId}/workspace/${workspaceRelPath.replace(/^\/workspace\//, "")}`,
      saveObject: async (input) => {
        saved.push(input);
      }
    },
    readFile: async () => Buffer.from("pdf-bytes")
  });

  assert.equal(saved.length, 1);
  assert.equal(
    saved[0]?.objectKey,
    "prefix/workspaces/ws-1/workspace/assistants/a/sessions/s/report.pdf"
  );
  assert.equal(saved[0]?.mimeType, "application/pdf");
  assert.equal(saved[0]?.buffer.toString("utf8"), "pdf-bytes");
});

test("mirrorVisibleWorkspaceProducedFilesToGcs throws when saveObject fails", async () => {
  await assert.rejects(
    () =>
      mirrorVisibleWorkspaceProducedFilesToGcs({
        workspaceId: "ws-1",
        workspaceRoot: "/tmp/ws",
        workspaceMountRoot: "/workspace",
        producedFiles: [
          {
            relativePath: "assistants/a/sessions/s/report.csv",
            displayName: "report.csv",
            mimeType: "text/csv",
            sizeBytes: 4,
            logicalSizeBytes: 4,
            storagePath: "/workspace/assistants/a/sessions/s/report.csv"
          }
        ],
        resolveLocalAbsolutePath: () => "/tmp/ws/assistants/a/sessions/s/report.csv",
        objectStorage: {
          buildWorkspaceObjectKey: () => "key",
          saveObject: async () => {
            throw new Error("gcs unavailable");
          }
        },
        readFile: async () => Buffer.from("data")
      }),
    /shell_produced_gcs_mirror_failed/
  );
});

test("mirrorVisibleWorkspaceProducedFilesToGcs skips sandbox job object keys", async () => {
  let saveCount = 0;
  await mirrorVisibleWorkspaceProducedFilesToGcs({
    workspaceId: "ws-1",
    workspaceRoot: "/tmp/ws",
    workspaceMountRoot: "/workspace",
    producedFiles: [
      {
        relativePath: "out.pdf",
        displayName: "out.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        logicalSizeBytes: 1,
        storagePath: "assistant-media/sandbox/jobs/job-1/out.pdf"
      }
    ],
    resolveLocalAbsolutePath: () => {
      throw new Error("should not resolve sandbox keys");
    },
    objectStorage: {
      buildWorkspaceObjectKey: () => "unused",
      saveObject: async () => {
        saveCount += 1;
      }
    },
    readFile: async () => Buffer.from("x")
  });
  assert.equal(saveCount, 0);
});

test("mirrorVisibleWorkspaceProducedFilesToGcs skips ADR-150 install-layer paths", async () => {
  let saveCount = 0;
  let readCount = 0;
  await mirrorVisibleWorkspaceProducedFilesToGcs({
    workspaceId: "ws-1",
    workspaceRoot: "/tmp/ws",
    workspaceMountRoot: "/workspace",
    producedFiles: [
      {
        relativePath: "assistants/a/sessions/s/.local/lib/x.py",
        displayName: "x.py",
        mimeType: "text/x-python",
        sizeBytes: 1,
        logicalSizeBytes: 1,
        storagePath: "/workspace/assistants/a/sessions/s/.local/lib/x.py"
      }
    ],
    resolveLocalAbsolutePath: () => {
      throw new Error("should not resolve install-layer paths");
    },
    objectStorage: {
      buildWorkspaceObjectKey: () => "unused",
      saveObject: async () => {
        saveCount += 1;
      }
    },
    readFile: async () => {
      readCount += 1;
      return Buffer.from("x");
    }
  });
  assert.equal(saveCount, 0);
  assert.equal(readCount, 0);
});
