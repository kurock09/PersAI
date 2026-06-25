import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { ListWorkspaceFilesFromManifestService } from "../src/modules/workspace-management/application/list-workspace-files-from-manifest.service";

describe("ListWorkspaceFilesFromManifestService", () => {
  const baseRows = [
    {
      workspaceId: "workspace-1",
      path: "/shared/input/photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: BigInt(1200),
      contentHash: null,
      shortDescription: "front-door selfie",
      createdAt: new Date("2026-06-20T10:00:00.000Z"),
      updatedAt: new Date("2026-06-20T10:00:00.000Z")
    },
    {
      workspaceId: "workspace-1",
      path: "/shared/input/notes/day1.md",
      mimeType: "text/markdown",
      sizeBytes: BigInt(64),
      contentHash: null,
      shortDescription: null,
      createdAt: new Date("2026-06-21T10:00:00.000Z"),
      updatedAt: new Date("2026-06-21T10:00:00.000Z")
    },
    {
      workspaceId: "workspace-1",
      path: "/shared/input/notes/day2.md",
      mimeType: "text/markdown",
      sizeBytes: BigInt(70),
      contentHash: null,
      shortDescription: null,
      createdAt: new Date("2026-06-22T10:00:00.000Z"),
      updatedAt: new Date("2026-06-22T10:00:00.000Z")
    },
    {
      workspaceId: "workspace-1",
      path: "/shared/outbound/alice/report.pdf",
      mimeType: "application/pdf",
      sizeBytes: BigInt(2048),
      contentHash: null,
      shortDescription: null,
      createdAt: new Date("2026-06-23T10:00:00.000Z"),
      updatedAt: new Date("2026-06-23T10:00:00.000Z")
    },
    {
      workspaceId: "workspace-1",
      path: "/shared/outbound/bob/song.mp3",
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

  test("rejects pathPrefix that does not start with /shared/", async () => {
    const { service } = buildService();
    await assert.rejects(
      service.execute({
        workspaceId: "workspace-1",
        pathPrefix: "/workspace/scratch",
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
        pathPrefix: "/shared/../etc",
        assistantHandle: "alice"
      }),
      BadRequestException
    );
  });

  test("lists immediate /shared/input children: a file and a directory", async () => {
    const { service, calls } = buildService();
    const out = await service.execute({
      workspaceId: "workspace-1",
      pathPrefix: "/shared/input",
      assistantHandle: "alice"
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.pathPrefix, "/shared/input/");
    assert.equal(out.items.length, 2);
    assert.equal(out.items[0]?.type, "directory");
    assert.equal(out.items[0]?.path, "/shared/input/notes");
    assert.equal(out.items[0]?.role, "shared_input");
    assert.equal(out.items[1]?.type, "file");
    assert.equal(out.items[1]?.path, "/shared/input/photo.jpg");
    assert.equal(out.items[1]?.mimeType, "image/jpeg");
    assert.equal(out.items[1]?.sizeBytes, 1200);
    assert.equal(out.items[1]?.shortDescription, "front-door selfie");
    assert.equal(out.items[1]?.role, "shared_input");
  });

  test("classifies outbound roles by handle ownership", async () => {
    const { service } = buildService();
    const out = await service.execute({
      workspaceId: "workspace-1",
      pathPrefix: "/shared/outbound",
      assistantHandle: "alice"
    });
    assert.equal(out.items.length, 2);
    const alice = out.items.find((item) => item.path === "/shared/outbound/alice");
    const bob = out.items.find((item) => item.path === "/shared/outbound/bob");
    assert.equal(alice?.role, "shared_outbound_self");
    assert.equal(bob?.role, "shared_outbound_other");
  });

  test("lists deep children of a subdirectory", async () => {
    const { service } = buildService();
    const out = await service.execute({
      workspaceId: "workspace-1",
      pathPrefix: "/shared/input/notes",
      assistantHandle: "alice"
    });
    assert.equal(out.items.length, 2);
    assert.deepEqual(out.items.map((item) => item.path).sort(), [
      "/shared/input/notes/day1.md",
      "/shared/input/notes/day2.md"
    ]);
    for (const item of out.items) {
      assert.equal(item.type, "file");
      assert.equal(item.role, "shared_input");
    }
  });

  test("returns empty list when no manifest rows under prefix", async () => {
    const { service } = buildService();
    const out = await service.execute({
      workspaceId: "workspace-1",
      pathPrefix: "/shared/does-not-exist",
      assistantHandle: "alice"
    });
    assert.equal(out.items.length, 0);
  });

  test("parses raw input and trims required fields", () => {
    const { service } = buildService();
    const parsed = service.parseInput({
      workspaceId: "  workspace-1 ",
      pathPrefix: "/shared/input",
      assistantHandle: " alice "
    });
    assert.equal(parsed.workspaceId, "workspace-1");
    assert.equal(parsed.pathPrefix, "/shared/input");
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
