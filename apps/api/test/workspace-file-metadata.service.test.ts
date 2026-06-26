import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WorkspaceFileMetadataService } from "../src/modules/workspace-management/application/workspace-file-metadata.service";

describe("workspace-file-metadata.service", () => {
  test("upserts and reads metadata rows", async () => {
    const rows = new Map<string, { path: string; shortDescription: string | null }>();
    const repository = {
      async upsert(input: { workspaceId: string; path: string; shortDescription: string | null }) {
        rows.set(`${input.workspaceId}:${input.path}`, {
          path: input.path,
          shortDescription: input.shortDescription
        });
      },
      async get(input: { workspaceId: string; path: string }) {
        const row = rows.get(`${input.workspaceId}:${input.path}`);
        if (row === undefined) {
          return null;
        }
        return {
          workspaceId: input.workspaceId,
          path: row.path,
          mimeType: "text/plain",
          sizeBytes: BigInt(1),
          contentHash: null,
          shortDescription: row.shortDescription,
          createdAt: new Date("2026-06-23T00:00:00.000Z"),
          updatedAt: new Date("2026-06-23T00:00:00.000Z")
        };
      },
      async list() {
        return [];
      },
      async delete(input: { workspaceId: string; path: string }) {
        rows.delete(`${input.workspaceId}:${input.path}`);
      }
    };

    const service = new WorkspaceFileMetadataService(repository as never);
    await service.upsert({
      workspaceId: "workspace-1",
      path: "/workspace/notes.md",
      mimeType: "text/markdown",
      sizeBytes: 42,
      shortDescription: "Meeting notes"
    });

    const row = await service.get({
      workspaceId: "workspace-1",
      path: "/workspace/notes.md"
    });
    assert.equal(row?.shortDescription, "Meeting notes");
  });
});
