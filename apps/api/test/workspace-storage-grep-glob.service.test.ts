import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobWorkspaceFilesFromManifestService } from "../src/modules/workspace-management/application/glob-workspace-files-from-manifest.service";
import { GrepWorkspaceFilesFromStorageService } from "../src/modules/workspace-management/application/grep-workspace-files-from-storage.service";
import { matchesWorkspaceGlob } from "../src/modules/workspace-management/application/workspace-path-glob";

describe("workspace-path-glob", () => {
  it("matches recursive glob patterns against relative paths", () => {
    assert.equal(
      matchesWorkspaceGlob({
        filePath: "/workspace/assistants/a1/sessions/s1/reports/q2.md",
        searchRoot: "/workspace/assistants/a1/sessions/s1",
        pattern: "**/*.md"
      }),
      true
    );
    assert.equal(
      matchesWorkspaceGlob({
        filePath: "/workspace/assistants/a1/sessions/s1/reports/q2.csv",
        searchRoot: "/workspace/assistants/a1/sessions/s1",
        pattern: "**/*.md"
      }),
      false
    );
  });
});

describe("GlobWorkspaceFilesFromManifestService", () => {
  it("returns manifest-backed paths for a glob pattern", async () => {
    const metadata = {
      async list() {
        return [
          {
            path: "/workspace/assistants/a1/sessions/s1/notes.md",
            mimeType: "text/markdown",
            sizeBytes: 12n,
            shortDescription: null,
            updatedAt: new Date("2026-07-05T10:00:00.000Z")
          },
          {
            path: "/workspace/assistants/a1/sessions/s1/report.csv",
            mimeType: "text/csv",
            sizeBytes: 8n,
            shortDescription: null,
            updatedAt: new Date("2026-07-05T10:00:00.000Z")
          }
        ];
      }
    };
    const service = new GlobWorkspaceFilesFromManifestService(metadata as never);
    const outcome = await service.execute({
      workspaceId: "workspace-1",
      assistantId: "a1",
      sessionId: "s1",
      pattern: "*.md"
    });
    assert.deepEqual(outcome.paths, ["/workspace/assistants/a1/sessions/s1/notes.md"]);
    assert.equal(outcome.truncated, false);
    assert.equal(outcome.reason, null);
  });
});

describe("GrepWorkspaceFilesFromStorageService", () => {
  it("scans committed GCS bytes for matching lines", async () => {
    const metadata = {
      async list() {
        return [
          {
            path: "/workspace/assistants/a1/sessions/s1/notes.md",
            mimeType: "text/markdown",
            sizeBytes: 20n,
            shortDescription: null,
            updatedAt: new Date("2026-07-05T10:00:00.000Z")
          }
        ];
      }
    };
    const storage = {
      buildWorkspaceObjectKey() {
        return "workspace/object";
      },
      async downloadObject() {
        return {
          buffer: Buffer.from("alpha\nbeta token\n", "utf8"),
          contentType: "text/markdown"
        };
      }
    };
    const service = new GrepWorkspaceFilesFromStorageService(metadata as never, storage as never);
    const outcome = await service.execute({
      workspaceId: "workspace-1",
      assistantId: "a1",
      sessionId: "s1",
      pattern: "token"
    });
    assert.equal(outcome.matches.length, 1);
    assert.equal(outcome.matches[0]?.line, 2);
    assert.match(outcome.matches[0]?.text ?? "", /token/);
    assert.equal(outcome.reason, null);
  });
});
