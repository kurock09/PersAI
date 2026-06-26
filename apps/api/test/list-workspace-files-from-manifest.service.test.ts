import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { ListWorkspaceFilesFromManifestService } from "../src/modules/workspace-management/application/list-workspace-files-from-manifest.service";

describe("ListWorkspaceFilesFromManifestService", () => {
  const baseRows = [
    {
      workspaceId: "workspace-1",
      path: "/workspace/photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: BigInt(1200),
      contentHash: null,
      shortDescription: "front-door selfie",
      createdAt: new Date("2026-06-20T10:00:00.000Z"),
      updatedAt: new Date("2026-06-20T10:00:00.000Z")
    },
    {
      workspaceId: "workspace-1",
      path: "/workspace/notes/day1.md",
      mimeType: "text/markdown",
      sizeBytes: BigInt(64),
      contentHash: null,
      shortDescription: null,
      createdAt: new Date("2026-06-21T10:00:00.000Z"),
      updatedAt: new Date("2026-06-21T10:00:00.000Z")
    },
    {
      workspaceId: "workspace-1",
      path: "/workspace/notes/day2.md",
      mimeType: "text/markdown",
      sizeBytes: BigInt(70),
      contentHash: null,
      shortDescription: null,
      createdAt: new Date("2026-06-22T10:00:00.000Z"),
      updatedAt: new Date("2026-06-22T10:00:00.000Z")
    },
    {
      workspaceId: "workspace-1",
      path: "/workspace/report.pdf",
      mimeType: "application/pdf",
      sizeBytes: BigInt(2048),
      contentHash: null,
      shortDescription: null,
      createdAt: new Date("2026-06-23T10:00:00.000Z"),
      updatedAt: new Date("2026-06-23T10:00:00.000Z")
    },
    {
      workspaceId: "workspace-1",
      path: "/workspace/song.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: BigInt(4096),
      contentHash: null,
      shortDescription: null,
      createdAt: new Date("2026-06-24T10:00:00.000Z"),
      updatedAt: new Date("2026-06-24T10:00:00.000Z")
    }
  ];

  function buildService(rows = baseRows) {
    const calls: Array<{ workspaceId: string; pathPrefix: string }> = [];
    const metadata = {
      async list(input: { workspaceId: string; pathPrefix: string; limit: number }) {
        calls.push({ workspaceId: input.workspaceId, pathPrefix: input.pathPrefix });
        return rows.filter(
          (row) => row.workspaceId === input.workspaceId && row.path.startsWith(input.pathPrefix)
        );
      }
    };
    const service = new ListWorkspaceFilesFromManifestService(metadata as never);
    return { service, calls };
  }

  test("rejects pathPrefix that does not start with /workspace/", async () => {
    const { service } = buildService();
    await assert.rejects(
      service.execute({
        workspaceId: "workspace-1",
        pathPrefix: "/tmp/scratch",
        assistantHandle: "alice"
      }),
      BadRequestException
    );
  });

  test("rejects pathPrefix containing ..", async () => {
    const { service } = buildService();
    await assert.rejects(
      service.execute({
        workspaceId: "workspace-1",
        pathPrefix: "/workspace/../etc",
        assistantHandle: "alice"
      }),
      BadRequestException
    );
  });

  test("lists immediate /workspace children: collapses deep entries into top-level directories + files", async () => {
    const { service, calls } = buildService();
    const out = await service.execute({
      workspaceId: "workspace-1",
      pathPrefix: "/workspace",
      assistantHandle: "alice"
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.pathPrefix, "/workspace/");
    // photo.jpg + notes/ + report.pdf + song.mp3 = 4 top-level entries.
    assert.equal(out.items.length, 4);
    const byPath = new Map(out.items.map((item) => [item.path, item]));
    const notesDir = byPath.get("/workspace/notes");
    assert.equal(notesDir?.type, "directory");
    const photo = byPath.get("/workspace/photo.jpg");
    assert.equal(photo?.type, "file");
    assert.equal(photo?.mimeType, "image/jpeg");
    assert.equal(photo?.sizeBytes, 1200);
    assert.equal(photo?.shortDescription, "front-door selfie");
  });

  test("lists deep children of a subdirectory", async () => {
    const { service } = buildService();
    const out = await service.execute({
      workspaceId: "workspace-1",
      pathPrefix: "/workspace/notes",
      assistantHandle: "alice"
    });
    assert.equal(out.items.length, 2);
    assert.deepEqual(out.items.map((item) => item.path).sort(), [
      "/workspace/notes/day1.md",
      "/workspace/notes/day2.md"
    ]);
    for (const item of out.items) {
      assert.equal(item.type, "file");
    }
  });

  test("returns empty list when no manifest rows under prefix", async () => {
    const { service } = buildService();
    const out = await service.execute({
      workspaceId: "workspace-1",
      pathPrefix: "/workspace/does-not-exist",
      assistantHandle: "alice"
    });
    assert.equal(out.items.length, 0);
  });

  test("parses raw input and trims required fields", () => {
    const { service } = buildService();
    const parsed = service.parseInput({
      workspaceId: "  workspace-1 ",
      pathPrefix: "/workspace",
      assistantHandle: " alice "
    });
    assert.equal(parsed.workspaceId, "workspace-1");
    assert.equal(parsed.pathPrefix, "/workspace");
    assert.equal(parsed.assistantHandle, "alice");
    assert.throws(
      () =>
        service.parseInput({
          workspaceId: "workspace-1",
          pathPrefix: "",
          assistantHandle: "alice"
        }),
      BadRequestException
    );
  });
});
