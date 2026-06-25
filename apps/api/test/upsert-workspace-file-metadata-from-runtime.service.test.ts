import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { UpsertWorkspaceFileMetadataFromRuntimeService } from "../src/modules/workspace-management/application/upsert-workspace-file-metadata-from-runtime.service";

describe("UpsertWorkspaceFileMetadataFromRuntimeService", () => {
  function buildService() {
    const calls: Array<{
      workspaceId: string;
      path: string;
      mimeType: string;
      sizeBytes: number | bigint;
      shortDescription?: string;
    }> = [];
    const metadata = {
      async upsert(input: {
        workspaceId: string;
        path: string;
        mimeType: string;
        sizeBytes: number | bigint;
        shortDescription?: string;
      }) {
        calls.push(input);
      }
    };
    const service = new UpsertWorkspaceFileMetadataFromRuntimeService(metadata as never);
    return { service, calls };
  }

  test("upserts a /shared/ row and omits empty shortDescription", async () => {
    const { service, calls } = buildService();
    const input = service.parseInput({
      workspaceId: "workspace-1",
      path: "/shared/outbound/alice/notes.md",
      mimeType: "text/markdown",
      sizeBytes: 128
    });
    await service.execute(input);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.workspaceId, "workspace-1");
    assert.equal(calls[0]?.path, "/shared/outbound/alice/notes.md");
    assert.equal(calls[0]?.mimeType, "text/markdown");
    assert.equal(calls[0]?.sizeBytes, 128);
    assert.equal(calls[0]?.shortDescription, undefined);
  });

  test("propagates shortDescription when provided", async () => {
    const { service, calls } = buildService();
    const input = service.parseInput({
      workspaceId: "workspace-1",
      path: "/shared/input/recipe.md",
      mimeType: "text/markdown",
      sizeBytes: 256,
      shortDescription: "Mom's pie crust"
    });
    await service.execute(input);
    assert.equal(calls[0]?.shortDescription, "Mom's pie crust");
  });

  test("rejects /workspace/ scratch paths", () => {
    const { service } = buildService();
    assert.throws(
      () =>
        service.parseInput({
          workspaceId: "workspace-1",
          path: "/workspace/scratch/tmp.bin",
          mimeType: "application/octet-stream",
          sizeBytes: 1
        }),
      BadRequestException
    );
  });

  test("rejects path with .. traversal", () => {
    const { service } = buildService();
    assert.throws(
      () =>
        service.parseInput({
          workspaceId: "workspace-1",
          path: "/shared/../etc/passwd",
          mimeType: "text/plain",
          sizeBytes: 1
        }),
      BadRequestException
    );
  });

  test("rejects negative or non-finite sizeBytes", () => {
    const { service } = buildService();
    assert.throws(
      () =>
        service.parseInput({
          workspaceId: "workspace-1",
          path: "/shared/input/a.txt",
          mimeType: "text/plain",
          sizeBytes: -1
        }),
      BadRequestException
    );
    assert.throws(
      () =>
        service.parseInput({
          workspaceId: "workspace-1",
          path: "/shared/input/a.txt",
          mimeType: "text/plain",
          sizeBytes: Number.NaN
        }),
      BadRequestException
    );
  });

  test("rejects non-object body", () => {
    const { service } = buildService();
    assert.throws(() => service.parseInput("not an object" as unknown), BadRequestException);
    assert.throws(() => service.parseInput([] as unknown), BadRequestException);
    assert.throws(() => service.parseInput(null), BadRequestException);
  });
});
