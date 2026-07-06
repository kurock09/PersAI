import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import { createFakeMediaObjectStorageForRead } from "./helpers/runtime-outbound-test-doubles";
import { RuntimeFilesToolService } from "../src/modules/turns/runtime-files-tool.service";
import { RuntimeStoragePlaneFilesService } from "../src/modules/turns/runtime-storage-plane-files.service";
import { stringifyToolResultPayloadForModel } from "../src/modules/turns/sanitize-tool-result-for-model";

const TEST_SESSION_ROOT = "/workspace/assistants/assistant-1/sessions/session-1";

function wp(relativePath: string): string {
  return `${TEST_SESSION_ROOT}/${relativePath.replace(/^\/+/, "")}`;
}

function createBundle(): AssistantRuntimeBundle {
  return {
    metadata: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      assistantHandle: "my-bot",
      siblingAssistantHandles: []
    },
    governance: {
      toolPolicies: [
        {
          toolCode: "files",
          enabled: true,
          visibleToModel: true,
          usageRule: "allowed",
          executionMode: "inline",
          dailyCallLimit: null
        }
      ],
      quota: {
        workspaceQuotaBytes: null,
        sharedQuotaBytes: null
      }
    },
    runtime: {
      sandbox: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true }
    }
  } as unknown as AssistantRuntimeBundle;
}

function createService(
  input: {
    apiClient?: Record<string, unknown>;
    mediaObjectStorage?: {
      downloadByWorkspacePath?: (input: {
        workspaceId: string;
        storagePath: string;
      }) => Promise<Buffer | null>;
    };
    storagePlane?: {
      readTextFile?: RuntimeStoragePlaneFilesService["readTextFile"];
      writeTextFile?: RuntimeStoragePlaneFilesService["writeTextFile"];
      deletePersistedWorkspaceFile?: RuntimeStoragePlaneFilesService["deletePersistedWorkspaceFile"];
      attachPersistedWorkspaceFile?: RuntimeStoragePlaneFilesService["attachPersistedWorkspaceFile"];
    };
  } = {}
) {
  const persaiInternalApiClientService = {
    async consumeToolDailyLimit() {
      return { allowed: true, code: null, message: null };
    },
    async registerChatAttachment() {
      return {
        attachmentId: "attachment-1",
        storagePath: wp("report.csv")
      };
    },
    async getWorkspaceFileMetadata() {
      return null;
    },
    async upsertWorkspaceFileMetadata() {
      return undefined;
    },
    async deleteWorkspaceFileFromManifest() {
      return undefined;
    },
    async sumWorkspaceFileStorageBytes() {
      return 0;
    },
    async listWorkspaceFilesFromManifest() {
      return { items: [] };
    },
    ...input.apiClient
  };
  const mediaObjectStorage = {
    buildWorkspaceObjectKey() {
      return "fake/object";
    },
    async saveObject(input: { buffer: Buffer }) {
      return { objectKey: "fake/object", sizeBytes: input.buffer.length, mimeType: "text/plain" };
    },
    async downloadByWorkspacePath() {
      return Buffer.from("hello");
    }
  };
  const storagePlaneFilesService = new RuntimeStoragePlaneFilesService(
    mediaObjectStorage as never,
    persaiInternalApiClientService as never
  );
  if (input.storagePlane?.readTextFile !== undefined) {
    storagePlaneFilesService.readTextFile = input.storagePlane.readTextFile;
  }
  if (input.storagePlane?.writeTextFile !== undefined) {
    storagePlaneFilesService.writeTextFile = input.storagePlane.writeTextFile;
  }
  if (input.storagePlane?.deletePersistedWorkspaceFile !== undefined) {
    storagePlaneFilesService.deletePersistedWorkspaceFile =
      input.storagePlane.deletePersistedWorkspaceFile;
  }
  if (input.storagePlane?.attachPersistedWorkspaceFile !== undefined) {
    storagePlaneFilesService.attachPersistedWorkspaceFile =
      input.storagePlane.attachPersistedWorkspaceFile;
  }
  const previewMediaObjectStorage = {
    ...createFakeMediaObjectStorageForRead(),
    ...input.mediaObjectStorage
  };
  return new RuntimeFilesToolService(
    persaiInternalApiClientService as never,
    storagePlaneFilesService,
    previewMediaObjectStorage as never
  );
}

function inlineFilesService(persaiInternalApiClientService: Record<string, unknown> = {}) {
  const mergedApi = {
    async consumeToolDailyLimit() {
      return { allowed: true, code: null, message: null };
    },
    async getWorkspaceFileMetadata() {
      return null;
    },
    async deleteWorkspaceFileFromManifest() {
      return undefined;
    },
    async sumWorkspaceFileStorageBytes() {
      return 0;
    },
    async listWorkspaceFilesFromManifest() {
      return { items: [] };
    },
    async upsertWorkspaceFileMetadata() {
      return undefined;
    },
    ...persaiInternalApiClientService
  };
  return createService({ apiClient: mergedApi });
}

function attachMetadata(path: string, mimeType = "text/csv", sizeBytes = 12) {
  return {
    path,
    mimeType,
    sizeBytes,
    originChatId: null,
    originAssistantId: "assistant-1",
    updatedAt: new Date().toISOString()
  };
}

const attachToolCallParams = {
  sessionId: "session-1",
  requestId: "request-1",
  channel: "web" as const,
  chatId: null,
  externalThreadKey: "web-1782153682653",
  messageId: "message-1"
};

test("files.attach happy path workspace source returns artifact from storage plane", async () => {
  let metadataCalled = false;
  const service = createService({
    apiClient: {
      async getWorkspaceFileMetadata(input: Record<string, unknown>) {
        metadataCalled = true;
        assert.equal(input.path, wp("report.csv"));
        return attachMetadata(wp("report.csv"));
      }
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-1",
      name: "files",
      arguments: { action: "attach", path: wp("report.csv") }
    },
    ...attachToolCallParams
  });

  assert.equal(metadataCalled, true);
  assert.equal(result.isError, false);
  assert.equal(result.payload.action, "attached");
  assert.equal(result.payload.path, wp("report.csv"));
  assert.equal(result.payload.sizeBytes, 12);
  assert.equal(result.artifacts?.[0]?.storagePath, wp("report.csv"));
  const modelJson = stringifyToolResultPayloadForModel(result.payload);
  assert.ok(!modelJson.includes("attachment-1"));
  assert.ok(!modelJson.includes('"attachmentId"'));
});

test("files.attach session-root file still returns artifact", async () => {
  const service = createService({
    apiClient: {
      async getWorkspaceFileMetadata() {
        return attachMetadata(wp("report.csv"));
      }
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-2",
      name: "files",
      arguments: { action: "attach", path: wp("report.csv") }
    },
    ...attachToolCallParams
  });

  assert.equal(result.payload.action, "attached");
  assert.equal(result.artifacts?.[0]?.storagePath, wp("report.csv"));
});

test("files.attach path_not_attachable does not call API", async () => {
  let apiCalled = false;
  const service = createService({
    apiClient: {
      async registerChatAttachment() {
        apiCalled = true;
        return { attachmentId: "attachment-3", storagePath: wp("report.csv") };
      }
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-3",
      name: "files",
      arguments: { action: "attach", path: "/workspace/sales.csv" }
    },
    ...attachToolCallParams
  });

  assert.equal(apiCalled, false);
  assert.equal(result.isError, true);
  assert.equal(result.payload.reason, "path_not_attachable");
});

test("files.attach missing manifest row returns path_not_found", async () => {
  const service = createService();

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-4",
      name: "files",
      arguments: { action: "attach", path: wp("report.csv") }
    },
    ...attachToolCallParams
  });

  assert.equal(result.isError, true);
  assert.equal(result.payload.reason, "path_not_found");
});

test("files.write workspace_quota_exhausted surfaces stable reason to model", async () => {
  const service = createService({
    storagePlane: {
      async writeTextFile() {
        return { ok: false, reason: "workspace_quota_exhausted", warning: null };
      }
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-write-quota-ws",
      name: "files",
      arguments: { action: "write", path: wp("big.bin"), content: "data" }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: null,
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, true);
  assert.equal(result.payload.requestedAction, "write");
  assert.equal(result.payload.action, "skipped");
  assert.equal(result.payload.reason, "workspace_quota_exhausted");
});

test("files.write shared_quota_exhausted surfaces stable reason to model", async () => {
  const service = createService({
    storagePlane: {
      async writeTextFile() {
        return { ok: false, reason: "shared_quota_exhausted", warning: null };
      }
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-write-quota-shared",
      name: "files",
      arguments: {
        action: "write",
        path: wp("out.csv"),
        content: "data"
      }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: null,
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, true);
  assert.equal(result.payload.requestedAction, "write");
  assert.equal(result.payload.action, "skipped");
  assert.equal(result.payload.reason, "shared_quota_exhausted");
});

// ADR-127 W1 — `/workspace/...` listings come from `workspace_file_metadata`,
// not from the pod FS. The runtime must call the internal API and ignore
// the sandbox `find` for shared paths.
test("files.list workspace-root widen reads from manifest API only", async () => {
  let manifestCalled = false;
  const service = inlineFilesService({
    async listWorkspaceFilesFromManifest(input: Record<string, unknown>) {
      manifestCalled = true;
      assert.equal(input.workspaceId, "workspace-1");
      assert.equal(input.pathPrefix, "/workspace");
      assert.equal(input.assistantId, "assistant-1");
      assert.equal(input.scope, "workspace");
      assert.equal(input.currentChatId, null);
      assert.equal(input.currentAssistantId, "assistant-1");
      return {
        items: [
          {
            path: "/workspace/assistants",
            type: "directory",
            sizeBytes: 0,
            mimeType: null,
            modifiedAt: null,
            shortDescription: null
          }
        ]
      };
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-list-shared",
      name: "files",
      arguments: { action: "list", path: "/workspace" }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: null,
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(manifestCalled, true);
  assert.equal(result.isError, false);
  assert.equal(result.payload.requestedAction, "list");
  assert.equal(result.payload.action, "listed");
  const items = (result.payload as { items?: unknown }).items;
  assert.ok(Array.isArray(items));
  assert.equal(items.length, 1);
  const first = items[0] as Record<string, unknown>;
  assert.equal(first.path, "/workspace/assistants");
  assert.equal(first.type, "directory");
});

test("files.list assistant-root path widens manifest request explicitly", async () => {
  let manifestInput: Record<string, unknown> | null = null;
  const service = createService({
    apiClient: {
      async listWorkspaceFilesFromManifest(input: Record<string, unknown>) {
        manifestInput = input;
        return { items: [] };
      }
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-list-assistant",
      name: "files",
      arguments: { action: "list", path: "/workspace/assistants/assistant-1" }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: "chat-current",
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, false);
  const capturedManifestInput = manifestInput as Record<string, unknown> | null;
  assert.notEqual(capturedManifestInput, null);
  assert.equal(capturedManifestInput?.scope, "assistant");
  assert.equal(capturedManifestInput?.currentChatId, "chat-current");
  assert.equal(capturedManifestInput?.currentAssistantId, "assistant-1");
});

test("files.list ignores supplied scope and derives widen from path", async () => {
  let manifestInput: Record<string, unknown> | null = null;
  const service = createService({
    apiClient: {
      async listWorkspaceFilesFromManifest(input: Record<string, unknown>) {
        manifestInput = input;
        return { items: [] };
      }
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-list-ignored-scope",
      name: "files",
      arguments: { action: "list", path: "/workspace", scope: "assistant" }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: "chat-current",
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, false);
  const capturedManifestInput = manifestInput as Record<string, unknown> | null;
  assert.notEqual(capturedManifestInput, null);
  assert.equal(capturedManifestInput?.pathPrefix, "/workspace");
  assert.equal(capturedManifestInput?.scope, "workspace");
});

test("files.list defaults to the current session root when path is omitted", async () => {
  let manifestInput: Record<string, unknown> | null = null;
  const service = createService({
    apiClient: {
      async listWorkspaceFilesFromManifest(input: Record<string, unknown>) {
        manifestInput = input;
        return { items: [] };
      }
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-list-default",
      name: "files",
      arguments: { action: "list" }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: "chat-current",
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, false);
  const capturedManifestInput = manifestInput as Record<string, unknown> | null;
  assert.notEqual(capturedManifestInput, null);
  assert.equal(
    capturedManifestInput?.pathPrefix,
    "/workspace/assistants/assistant-1/sessions/session-1"
  );
  assert.equal(capturedManifestInput?.scope, "chat");
});

test("files.read allows an exact widened path without cross-scope flags", async () => {
  const service = createService({
    storagePlane: {
      async readTextFile() {
        return {
          ok: true,
          content: "secret",
          sizeBytes: 6,
          sha256: "abc",
          truncated: false
        };
      }
    },
    apiClient: {
      async getWorkspaceFileMetadata() {
        return {
          path: "/workspace/assistants/assistant-1/old-report.txt",
          mimeType: "text/plain",
          sizeBytes: 6,
          originChatId: null,
          originAssistantId: "assistant-1",
          updatedAt: new Date().toISOString()
        };
      }
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-read-widened",
      name: "files",
      arguments: { action: "read", path: "/workspace/assistants/assistant-1/old-report.txt" }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: "chat-current",
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, false);
});

test("files.list /tmp path returns scratch_path_unsupported", async () => {
  let manifestCalled = false;
  const service = inlineFilesService({
    async listWorkspaceFilesFromManifest() {
      manifestCalled = true;
      return { items: [] };
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-list-workspace",
      name: "files",
      arguments: { action: "list", path: "/tmp" }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: null,
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(manifestCalled, false);
  assert.equal(result.isError, true);
  assert.equal(result.payload.reason, "scratch_path_unsupported");
});

// ADR-137 S3 — workspace writes go through the storage plane (GCS + manifest).
test("files.write session-root path upserts manifest", async () => {
  let upsertCalled = false;
  let upsertInput: Record<string, unknown> | undefined;
  const service = inlineFilesService({
    async upsertWorkspaceFileMetadata(input: Record<string, unknown>) {
      upsertCalled = true;
      upsertInput = input;
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-write-shared",
      name: "files",
      arguments: {
        action: "write",
        path: wp("notes.md"),
        content: "# notes\nhello"
      }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: null,
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, false);
  assert.equal(result.payload.action, "written");
  assert.equal(upsertCalled, true);
  assert.equal(upsertInput?.workspaceId, "workspace-1");
  assert.equal(upsertInput?.path, wp("notes.md"));
  assert.equal(upsertInput?.mimeType, "text/markdown");
  assert.equal(upsertInput?.sizeBytes, Buffer.byteLength("# notes\nhello", "utf8"));
});

test("files.write requestedName resolves under the real current session root", async () => {
  let upsertInput: Record<string, unknown> | undefined;
  const service = inlineFilesService({
    async upsertWorkspaceFileMetadata(input: Record<string, unknown>) {
      upsertInput = input;
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-write-requested-name",
      name: "files",
      arguments: {
        action: "write",
        requestedName: "test.txt",
        content: "test"
      }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: "chat-1",
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, false);
  assert.equal(result.payload.path, wp("test.txt"));
  assert.equal(upsertInput?.path, wp("test.txt"));
});

test("files.write relative path resolves under the real current session root", async () => {
  const service = inlineFilesService({
    async upsertWorkspaceFileMetadata() {
      return undefined;
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-write-relative-path",
      name: "files",
      arguments: {
        action: "write",
        path: "reports/test.txt",
        content: "test"
      }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: "chat-1",
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, false);
  assert.equal(result.payload.path, wp("reports/test.txt"));
});

test("files.write canonicalizes current/current placeholder to the real session root", async () => {
  let upsertInput: Record<string, unknown> | undefined;
  const service = inlineFilesService({
    async upsertWorkspaceFileMetadata(input: Record<string, unknown>) {
      upsertInput = input;
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-write-current-placeholder",
      name: "files",
      arguments: {
        action: "write",
        path: "/workspace/assistants/current/sessions/current/test.txt",
        content: "test"
      }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: "chat-1",
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, false);
  assert.equal(result.payload.path, wp("test.txt"));
  assert.equal(upsertInput?.path, wp("test.txt"));
});

test("files.write rejects model-authored foreign session roots", async () => {
  const service = inlineFilesService();

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-write-foreign-session",
      name: "files",
      arguments: {
        action: "write",
        path: "/workspace/assistants/other-bot/sessions/session-2/test.txt",
        content: "test"
      }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: "chat-1",
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, true);
  assert.equal(result.payload.reason, "invalid_arguments");
  assert.match(
    result.payload.warning ?? "",
    /cannot create files by spelling assistant\/session IDs/
  );
});

test("files.write default collision returns resolved sibling path and upserts manifest there", async () => {
  let upsertInput: Record<string, unknown> | undefined;
  const service = inlineFilesService({
    async listWorkspaceFilesFromManifest() {
      return {
        items: [
          {
            type: "file",
            path: wp("notes.md"),
            mimeType: "text/markdown",
            sizeBytes: 10,
            modifiedAt: null,
            shortDescription: null
          }
        ]
      };
    },
    async upsertWorkspaceFileMetadata(input: Record<string, unknown>) {
      upsertInput = input;
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-write-collision",
      name: "files",
      arguments: {
        action: "write",
        path: wp("notes.md"),
        content: "# notes\nhello"
      }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: "chat-1",
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, false);
  assert.equal(result.payload.action, "written");
  assert.equal(result.payload.path, wp("notes (1).md"));
  assert.equal(upsertInput?.path, wp("notes (1).md"));
  assert.equal(upsertInput?.originChatId, "chat-1");
  assert.equal(upsertInput?.originAssistantId, "assistant-1");
});

test("files.write replace=true overwrites the exact path", async () => {
  let upsertInput: Record<string, unknown> | undefined;
  const service = inlineFilesService({
    async upsertWorkspaceFileMetadata(input: Record<string, unknown>) {
      upsertInput = input;
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-write-replace",
      name: "files",
      arguments: {
        action: "write",
        path: wp("report.txt"),
        content: "updated",
        replace: true
      }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: null,
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, false);
  assert.equal(result.payload.path, wp("report.txt"));
  assert.equal(upsertInput?.path, wp("report.txt"));
  assert.equal(upsertInput?.replace, true);
});

test("files.write create_only collisions still fail honestly", async () => {
  const service = inlineFilesService({
    async listWorkspaceFilesFromManifest() {
      return {
        items: [
          {
            type: "file",
            path: wp("report.txt"),
            mimeType: "text/plain",
            sizeBytes: 4,
            modifiedAt: null,
            shortDescription: null
          }
        ]
      };
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-write-create-only",
      name: "files",
      arguments: {
        action: "write",
        path: wp("report.txt"),
        content: "data",
        mode: "create_only"
      }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: null,
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, true);
  assert.equal(result.payload.action, "skipped");
  assert.equal(result.payload.reason, "create_only_collision");
});

test("files.write /tmp path returns scratch_path_unsupported", async () => {
  let upsertCalled = false;
  const service = inlineFilesService({
    async upsertWorkspaceFileMetadata() {
      upsertCalled = true;
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-write-workspace",
      name: "files",
      arguments: {
        action: "write",
        path: "/tmp/scratch.txt",
        content: "data"
      }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: null,
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, true);
  assert.equal(result.payload.reason, "scratch_path_unsupported");
  assert.equal(upsertCalled, false);
});

test("files.write session-root upsert failure fails the write honestly", async () => {
  const service = inlineFilesService({
    async upsertWorkspaceFileMetadata() {
      throw new Error("api down");
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-write-shared-upsert-fail",
      name: "files",
      arguments: {
        action: "write",
        path: wp("note.txt"),
        content: "abc"
      }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: null,
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, true);
  assert.equal(result.payload.reason, "files_failed");
});

test("files.delete session-root path deletes manifest via storage plane", async () => {
  let manifestDeleteCalled = false;
  let manifestDeleteInput: Record<string, unknown> | undefined;
  const service = createService({
    apiClient: {
      async deleteWorkspaceFileFromManifest(input: Record<string, unknown>) {
        manifestDeleteCalled = true;
        manifestDeleteInput = input;
      }
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-delete-shared",
      name: "files",
      arguments: {
        action: "delete",
        path: wp("note.txt")
      }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: null,
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, false);
  assert.equal(result.payload.action, "deleted");
  assert.equal(manifestDeleteCalled, true);
  assert.equal(manifestDeleteInput?.workspaceId, "workspace-1");
  assert.equal(manifestDeleteInput?.path, wp("note.txt"));
});

test("files.delete /tmp path returns scratch_path_unsupported", async () => {
  let manifestDeleteCalled = false;
  const service = createService({
    apiClient: {
      async deleteWorkspaceFileFromManifest() {
        manifestDeleteCalled = true;
      }
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-delete-workspace",
      name: "files",
      arguments: {
        action: "delete",
        path: "/tmp/scratch.txt"
      }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: null,
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, true);
  assert.equal(result.payload.reason, "scratch_path_unsupported");
  assert.equal(manifestDeleteCalled, false);
});

test("files.search calls manifest search API and returns matched items", async () => {
  let searchInput: Record<string, unknown> | undefined;
  const service = createService({
    apiClient: {
      async searchWorkspaceFiles(input: Record<string, unknown>) {
        searchInput = input;
        return [
          {
            path: wp("reports/q2-revenue.xlsx"),
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            sizeBytes: 2048,
            shortDescription: "Q2 revenue spreadsheet"
          }
        ];
      }
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-search",
      name: "files",
      arguments: { action: "search", query: "revenue spreadsheet" }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: "chat-1",
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(searchInput?.workspaceId, "workspace-1");
  assert.equal(searchInput?.assistantId, "assistant-1");
  assert.equal(searchInput?.sessionId, "session-1");
  assert.equal(searchInput?.query, "revenue spreadsheet");
  assert.equal(result.isError, false);
  assert.equal(result.payload.requestedAction, "search");
  assert.equal(result.payload.action, "searched");
  assert.equal(result.payload.query, "revenue spreadsheet");
  const items = result.payload.items;
  assert.ok(Array.isArray(items));
  assert.equal(items?.length, 1);
  assert.equal(items?.[0]?.path, wp("reports/q2-revenue.xlsx"));
  assert.equal(items?.[0]?.shortDescription, "Q2 revenue spreadsheet");
  assert.equal(result.discoveredFileHandles?.[0]?.semanticSummaryHint, "Q2 revenue spreadsheet");
  assert.equal(result.discoveredFileHandles?.[0]?.aliases?.[0], "found file #1");
});

test("files.preview ignores model maxBytes for image visual preview", async () => {
  const imagePath = wp("shots/ui.png");
  const pngBytes = Buffer.alloc(425 * 1024, 0xff);
  const service = createService({
    apiClient: {
      async getWorkspaceFileMetadata() {
        return attachMetadata(imagePath, "image/png", pngBytes.length);
      }
    },
    mediaObjectStorage: {
      async downloadByWorkspacePath() {
        return pngBytes;
      }
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-preview-image",
      name: "files",
      arguments: { action: "preview", path: imagePath, maxBytes: 4096 }
    },
    sessionId: "session-1",
    requestId: "request-1",
    channel: "web",
    chatId: "chat-1",
    externalThreadKey: null,
    messageId: null
  });

  assert.equal(result.isError, false);
  assert.equal(result.payload.action, "previewed");
  assert.ok(
    Array.isArray(result.pendingFilePreviewBlocks) && result.pendingFilePreviewBlocks.length > 0
  );
});
