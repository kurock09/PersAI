import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { ListWorkspaceFilesFromManifestService } from "../src/modules/workspace-management/application/list-workspace-files-from-manifest.service";

describe("ListWorkspaceFilesFromManifestService", () => {
  const sessionRoot = "/workspace/assistants/assistant-1/sessions/runtime-session-1";
  const assistantSharedRoot = "/workspace/assistants/assistant-1/shared";
  const baseRows = [
    {
      workspaceId: "workspace-1",
      path: `${sessionRoot}/photo.jpg`,
      mimeType: "image/jpeg",
      sizeBytes: BigInt(1200),
      contentHash: null,
      shortDescription: "front-door selfie",
      createdAt: new Date("2026-06-20T10:00:00.000Z"),
      updatedAt: new Date("2026-06-20T10:00:00.000Z")
    },
    {
      workspaceId: "workspace-1",
      path: `${sessionRoot}/notes/day1.md`,
      mimeType: "text/markdown",
      sizeBytes: BigInt(64),
      contentHash: null,
      shortDescription: null,
      createdAt: new Date("2026-06-21T10:00:00.000Z"),
      updatedAt: new Date("2026-06-21T10:00:00.000Z")
    },
    {
      workspaceId: "workspace-1",
      path: `${sessionRoot}/notes/day2.md`,
      mimeType: "text/markdown",
      sizeBytes: BigInt(70),
      contentHash: null,
      shortDescription: null,
      createdAt: new Date("2026-06-22T10:00:00.000Z"),
      updatedAt: new Date("2026-06-22T10:00:00.000Z")
    },
    {
      workspaceId: "workspace-1",
      path: `${assistantSharedRoot}/report.pdf`,
      mimeType: "application/pdf",
      sizeBytes: BigInt(2048),
      contentHash: null,
      shortDescription: null,
      createdAt: new Date("2026-06-23T10:00:00.000Z"),
      updatedAt: new Date("2026-06-23T10:00:00.000Z")
    },
    {
      workspaceId: "workspace-1",
      path: "/workspace/shared/song.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: BigInt(4096),
      contentHash: null,
      shortDescription: null,
      createdAt: new Date("2026-06-24T10:00:00.000Z"),
      updatedAt: new Date("2026-06-24T10:00:00.000Z")
    }
  ];

  function buildService(rows = baseRows) {
    const calls: Array<{
      workspaceId: string;
      pathPrefix: string;
      originChatId?: string | null;
      originAssistantId?: string | null;
    }> = [];
    const metadata = {
      async list(input: {
        workspaceId: string;
        pathPrefix: string;
        originChatId?: string | null;
        originAssistantId?: string | null;
        limit: number;
      }) {
        calls.push({
          workspaceId: input.workspaceId,
          pathPrefix: input.pathPrefix,
          ...(input.originChatId === undefined ? {} : { originChatId: input.originChatId }),
          ...(input.originAssistantId === undefined
            ? {}
            : { originAssistantId: input.originAssistantId })
        });
        return rows.filter(
          (row) =>
            row.workspaceId === input.workspaceId &&
            row.path.startsWith(input.pathPrefix) &&
            (input.originChatId === undefined ||
              ("originChatId" in row && row.originChatId === input.originChatId)) &&
            (input.originAssistantId === undefined ||
              ("originAssistantId" in row && row.originAssistantId === input.originAssistantId))
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
        assistantId: "alice",
        currentAssistantId: "assistant-1"
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
        assistantId: "alice",
        currentAssistantId: "assistant-1"
      }),
      BadRequestException
    );
  });

  test("rejects flat root file prefixes from the retired workspace layout", async () => {
    const { service } = buildService();
    await assert.rejects(
      service.execute({
        workspaceId: "workspace-1",
        pathPrefix: "/workspace/report.pdf",
        assistantId: "alice",
        currentAssistantId: "assistant-1"
      }),
      BadRequestException
    );
  });

  test("lists immediate /workspace children: collapses deep entries into top-level directories + files", async () => {
    const { service, calls } = buildService();
    const out = await service.execute({
      workspaceId: "workspace-1",
      pathPrefix: "/workspace",
      assistantId: "alice",
      scope: "workspace",
      currentChatId: "chat-1",
      currentAssistantId: "assistant-1"
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.pathPrefix, "/workspace/");
    assert.equal(out.items.length, 2);
    const byPath = new Map(out.items.map((item) => [item.path, item]));
    assert.equal(byPath.get("/workspace/assistants")?.type, "directory");
    assert.equal(byPath.get("/workspace/shared")?.type, "directory");
  });

  test("lists deep children of a session subdirectory", async () => {
    const { service } = buildService();
    const out = await service.execute({
      workspaceId: "workspace-1",
      pathPrefix: `${sessionRoot}/notes`,
      assistantId: "alice",
      scope: "workspace",
      currentChatId: "chat-1",
      currentAssistantId: "assistant-1"
    });
    assert.equal(out.items.length, 2);
    assert.deepEqual(out.items.map((item) => item.path).sort(), [
      `${sessionRoot}/notes/day1.md`,
      `${sessionRoot}/notes/day2.md`
    ]);
    for (const item of out.items) {
      assert.equal(item.type, "file");
    }
  });

  test("returns empty list when no manifest rows under prefix", async () => {
    const { service } = buildService();
    const out = await service.execute({
      workspaceId: "workspace-1",
      pathPrefix: `${sessionRoot}/does-not-exist`,
      assistantId: "alice",
      scope: "workspace",
      currentChatId: "chat-1",
      currentAssistantId: "assistant-1"
    });
    assert.equal(out.items.length, 0);
  });

  test("chat scope lists only rows from the current chat", async () => {
    const { service, calls } = buildService([
      {
        ...baseRows[0]!,
        path: `${sessionRoot}/current.md`,
        originChatId: "chat-current",
        originAssistantId: "assistant-1"
      },
      {
        ...baseRows[1]!,
        path: "/workspace/assistants/assistant-1/sessions/runtime-session-other/other.md",
        originChatId: "chat-other",
        originAssistantId: "assistant-1"
      }
    ]);
    const out = await service.execute({
      workspaceId: "workspace-1",
      pathPrefix: sessionRoot,
      assistantId: "alice",
      scope: "chat",
      currentChatId: "chat-current",
      currentAssistantId: "assistant-1"
    });
    assert.equal(calls[0]?.originChatId, "chat-current");
    assert.deepEqual(
      out.items.map((item) => item.path),
      [`${sessionRoot}/current.md`]
    );
  });

  test("assistant scope lists rows from the current assistant across chats", async () => {
    const { service, calls } = buildService([
      {
        ...baseRows[0]!,
        path: `${assistantSharedRoot}/current.md`,
        originChatId: "chat-current",
        originAssistantId: "assistant-1"
      },
      {
        ...baseRows[1]!,
        path: `${assistantSharedRoot}/assistant-past.md`,
        originChatId: "chat-past",
        originAssistantId: "assistant-1"
      },
      {
        ...baseRows[2]!,
        path: "/workspace/assistants/bob/shared/other-assistant.md",
        originChatId: "chat-other",
        originAssistantId: "assistant-2"
      }
    ]);
    const out = await service.execute({
      workspaceId: "workspace-1",
      pathPrefix: assistantSharedRoot,
      assistantId: "alice",
      scope: "assistant",
      currentChatId: "chat-current",
      currentAssistantId: "assistant-1"
    });
    assert.equal(calls[0]?.originAssistantId, "assistant-1");
    assert.deepEqual(out.items.map((item) => item.path).sort(), [
      `${assistantSharedRoot}/assistant-past.md`,
      `${assistantSharedRoot}/current.md`
    ]);
  });

  test("parses raw input and trims required fields", () => {
    const { service } = buildService();
    const parsed = service.parseInput({
      workspaceId: "  workspace-1 ",
      pathPrefix: "/workspace",
      assistantId: " alice ",
      currentAssistantId: " assistant-1 "
    });
    assert.equal(parsed.workspaceId, "workspace-1");
    assert.equal(parsed.pathPrefix, "/workspace");
    assert.equal(parsed.assistantId, "alice");
    assert.throws(
      () =>
        service.parseInput({
          workspaceId: "workspace-1",
          pathPrefix: "",
          assistantId: "alice",
          currentAssistantId: "assistant-1"
        }),
      BadRequestException
    );
  });
});
