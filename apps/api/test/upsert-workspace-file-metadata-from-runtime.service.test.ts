import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { UpsertWorkspaceFileMetadataFromRuntimeService } from "../src/modules/workspace-management/application/upsert-workspace-file-metadata-from-runtime.service";

describe("UpsertWorkspaceFileMetadataFromRuntimeService", () => {
  const sessionRoot = "/workspace/assistants/assistant-1/sessions/runtime-session-1";

  function buildService() {
    const calls: Array<{
      workspaceId: string;
      path: string;
      mimeType: string;
      sizeBytes: number | bigint;
      contentHash?: string;
      shortDescription?: string;
    }> = [];
    const refreshCalls: Array<{
      workspaceId: string;
      storagePath: string;
      mimeType: string;
      sizeBytes: bigint;
    }> = [];
    const metadata = {
      async upsert(input: {
        workspaceId: string;
        path: string;
        mimeType: string;
        sizeBytes: number | bigint;
        contentHash?: string;
        shortDescription?: string;
      }) {
        calls.push(input);
      }
    };
    const attachments = {
      async refreshWorkspacePathProjection(input: {
        workspaceId: string;
        storagePath: string;
        mimeType: string;
        sizeBytes: bigint;
      }) {
        refreshCalls.push(input);
        return 1;
      }
    };
    const registerCalls: Array<Record<string, unknown>> = [];
    const prisma = {
      assistantChat: {
        async findFirst() {
          return {
            surface: "web",
            surfaceThreadKey: "thread-1"
          };
        },
        async findUnique() {
          return { chatMode: "project" };
        }
      }
    };
    const registrationService = {
      async execute(input: Record<string, unknown>) {
        registerCalls.push(input);
        return {
          accepted: true,
          docId: "doc-1",
          versionId: "version-1",
          versionNumber: 1,
          descriptorMode: "create_document",
          documentType: "workspace_document",
          outputFormat: "pdf",
          outputPath: String(input.outputPath ?? `${sessionRoot}/report.pdf`),
          workspaceProjectPath: null,
          sourceManifestPath: null,
          inspectionPath: null
        };
      }
    };
    const microDescriptionJobService = {
      async enqueueIfNeeded() {
        return { accepted: false, reason: "test_stub" };
      }
    };
    const service = new UpsertWorkspaceFileMetadataFromRuntimeService(
      prisma as never,
      metadata as never,
      attachments as never,
      registrationService as never,
      microDescriptionJobService as never
    );
    return { service, calls, refreshCalls, registerCalls };
  }

  test("upserts a hierarchical session file row and omits empty shortDescription", async () => {
    const { service, calls } = buildService();
    const input = service.parseInput({
      workspaceId: "workspace-1",
      path: `${sessionRoot}/notes.md`,
      mimeType: "text/markdown",
      sizeBytes: 128
    });
    await service.execute(input);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.workspaceId, "workspace-1");
    assert.equal(calls[0]?.path, `${sessionRoot}/notes.md`);
    assert.equal(calls[0]?.mimeType, "text/markdown");
    assert.equal(calls[0]?.sizeBytes, 128);
    assert.equal(calls[0]?.shortDescription, undefined);
  });

  test("propagates shortDescription when provided", async () => {
    const { service, calls } = buildService();
    const input = service.parseInput({
      workspaceId: "workspace-1",
      path: `${sessionRoot}/recipe.md`,
      mimeType: "text/markdown",
      sizeBytes: 256,
      shortDescription: "Mom's pie crust"
    });
    await service.execute(input);
    assert.equal(calls[0]?.shortDescription, "Mom's pie crust");
  });

  test("replace upsert propagates contentHash and refreshes matching attachment projections", async () => {
    const { service, calls, refreshCalls } = buildService();
    const input = service.parseInput({
      workspaceId: "workspace-1",
      path: `${sessionRoot}/report.csv`,
      mimeType: "text/csv",
      sizeBytes: 42,
      contentHash: "abc123",
      replace: true
    });
    await service.execute(input);
    assert.equal(calls[0]?.contentHash, "abc123");
    assert.equal(refreshCalls.length, 1);
    assert.equal(refreshCalls[0]?.workspaceId, "workspace-1");
    assert.equal(refreshCalls[0]?.storagePath, `${sessionRoot}/report.csv`);
    assert.equal(refreshCalls[0]?.mimeType, "text/csv");
    assert.equal(refreshCalls[0]?.sizeBytes, BigInt(42));
  });

  test("registers visible workspace document writes with chat/user context", async () => {
    const { service, registerCalls } = buildService();
    const input = service.parseInput({
      workspaceId: "workspace-1",
      path: `${sessionRoot}/report.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 42,
      replace: true,
      originChatId: "chat-1",
      originAssistantId: "assistant-1",
      sourceUserMessageText: "Обнови pdf",
      sourceUserMessageCreatedAt: "2026-07-03T09:00:00.000Z"
    });
    const result = await service.execute(input);
    assert.equal(registerCalls.length, 1);
    assert.equal(registerCalls[0]?.assistantId, "assistant-1");
    assert.equal(registerCalls[0]?.channel, "web");
    assert.equal(registerCalls[0]?.externalThreadKey, "thread-1");
    assert.equal(registerCalls[0]?.outputPath, `${sessionRoot}/report.pdf`);
    assert.equal(registerCalls[0]?.sourceUserMessageText, "Обнови pdf");
    assert.deepEqual(result.documentRegistration, {
      registered: true,
      versionNumber: 1,
      bumped: false,
      isOverwrite: false
    });
  });

  test("returns overwrite registration outcome for revise_document semantics", async () => {
    const registerCalls: Array<Record<string, unknown>> = [];
    const registrationService = {
      async execute(input: Record<string, unknown>) {
        registerCalls.push(input);
        return {
          accepted: true,
          docId: "doc-1",
          versionId: "version-2",
          versionNumber: 2,
          descriptorMode: "revise_document",
          documentType: "workspace_document",
          outputFormat: "xlsx",
          outputPath: String(input.outputPath ?? `${sessionRoot}/report.xlsx`),
          workspaceProjectPath: null,
          sourceManifestPath: null,
          inspectionPath: null
        };
      }
    };
    const service = new UpsertWorkspaceFileMetadataFromRuntimeService(
      {
        assistantChat: {
          async findFirst() {
            return {
              surface: "web",
              surfaceThreadKey: "thread-1"
            };
          },
          async findUnique() {
            return { chatMode: "project" };
          }
        }
      } as never,
      {
        async upsert() {
          return;
        }
      } as never,
      {
        async refreshWorkspacePathProjection() {
          return 1;
        }
      } as never,
      registrationService as never,
      {
        async enqueueIfNeeded() {
          return { accepted: false, reason: "test_stub" };
        }
      } as never
    );
    const input = service.parseInput({
      workspaceId: "workspace-1",
      path: `${sessionRoot}/report.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 42,
      replace: true,
      originChatId: "chat-1",
      originAssistantId: "assistant-1",
      sourceUserMessageText: "Перезапиши xlsx",
      sourceUserMessageCreatedAt: "2026-07-03T09:00:00.000Z"
    });
    const result = await service.execute(input);
    assert.equal(registerCalls.length, 1);
    assert.deepEqual(result.documentRegistration, {
      registered: true,
      versionNumber: 2,
      bumped: true,
      isOverwrite: true
    });
  });

  test("rejects paths outside /workspace/ (e.g. /tmp/)", () => {
    const { service } = buildService();
    assert.throws(
      () =>
        service.parseInput({
          workspaceId: "workspace-1",
          path: "/tmp/scratch.bin",
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
          path: "/workspace/../etc/passwd",
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
          path: `${sessionRoot}/a.txt`,
          mimeType: "text/plain",
          sizeBytes: -1
        }),
      BadRequestException
    );
    assert.throws(
      () =>
        service.parseInput({
          workspaceId: "workspace-1",
          path: `${sessionRoot}/a.txt`,
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
