import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import { RuntimeFilesToolService } from "../src/modules/turns/runtime-files-tool.service";
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

function createService(input: {
  sandboxJob: Record<string, unknown>;
  apiClient?: Record<string, unknown>;
}) {
  const sandboxClientService = {
    isConfigured: () => true,
    async waitForCompletion() {
      return input.sandboxJob;
    }
  };
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
    ...input.apiClient
  };
  return new RuntimeFilesToolService(
    sandboxClientService as never,
    persaiInternalApiClientService as never
  );
}

const attachToolCallParams = {
  sessionId: "session-1",
  requestId: "request-1",
  channel: "web" as const,
  chatId: null,
  externalThreadKey: "web-1782153682653",
  messageId: "message-1"
};

test("files.attach happy path workspace source returns artifact and upserts manifest", async () => {
  let upsertCalled = false;
  let upsertInput: Record<string, unknown> | undefined;
  const service = createService({
    sandboxJob: {
      status: "completed",
      reason: null,
      warning: null,
      violationMessage: null,
      content: JSON.stringify({
        action: "attached",
        attachment: {
          workspaceRelPath: wp("report.csv"),
          sourcePath: wp("report.csv"),
          sizeBytes: 12,
          mimeType: "text/csv",
          displayName: "report.csv"
        }
      })
    },
    apiClient: {
      async upsertWorkspaceFileMetadata(input: Record<string, unknown>) {
        upsertCalled = true;
        upsertInput = input;
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

  assert.equal(upsertCalled, true);
  assert.equal(upsertInput?.workspaceId, "workspace-1");
  assert.equal(upsertInput?.path, wp("report.csv"));
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
    sandboxJob: {
      status: "completed",
      reason: null,
      warning: null,
      violationMessage: null,
      content: JSON.stringify({
        attachment: {
          workspaceRelPath: wp("report.csv"),
          sourcePath: wp("report.csv"),
          sizeBytes: 12,
          mimeType: "text/csv",
          displayName: "report.csv"
        }
      })
    },
    apiClient: {
      async upsertWorkspaceFileMetadata() {
        return undefined;
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

test("files.attach sandbox path_not_attachable does not call API", async () => {
  let apiCalled = false;
  const service = createService({
    sandboxJob: {
      status: "completed",
      reason: "path_not_attachable",
      warning: "files.attach accepts only active hierarchical /workspace/... paths",
      violationMessage: null,
      content: null
    },
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

test("files.attach manifest upsert failure is swallowed after artifact creation", async () => {
  const service = createService({
    sandboxJob: {
      status: "completed",
      reason: null,
      warning: null,
      violationMessage: null,
      content: JSON.stringify({
        attachment: {
          workspaceRelPath: wp("report.csv"),
          sourcePath: wp("report.csv"),
          sizeBytes: 12,
          mimeType: "text/csv",
          displayName: "report.csv"
        }
      })
    },
    apiClient: {
      async upsertWorkspaceFileMetadata() {
        throw new Error("api down");
      }
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-4",
      name: "files",
      arguments: { action: "attach", path: wp("report.csv") }
    },
    ...attachToolCallParams
  });

  assert.equal(result.isError, false);
  assert.equal(result.payload.action, "attached");
});

test("files.write workspace_quota_exhausted surfaces stable reason to model", async () => {
  const service = createService({
    sandboxJob: {
      status: "completed",
      reason: "workspace_quota_exhausted",
      warning: null,
      violationMessage: null,
      content: null
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
    sandboxJob: {
      status: "completed",
      reason: "shared_quota_exhausted",
      warning: null,
      violationMessage: null,
      content: null
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
test("files.list workspace-root widen reads from manifest API and skips sandbox", async () => {
  let manifestCalled = false;
  let sandboxCalled = false;
  const service = new RuntimeFilesToolService(
    {
      isConfigured: () => true,
      async waitForCompletion() {
        sandboxCalled = true;
        return {
          status: "completed",
          reason: null,
          warning: null,
          violationMessage: null,
          content: JSON.stringify({ items: [] })
        };
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true, code: null, message: null };
      },
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
    } as never
  );

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
  assert.equal(sandboxCalled, false);
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
    sandboxJob: {
      status: "completed",
      reason: null,
      warning: null,
      violationMessage: null,
      content: JSON.stringify({ items: [] })
    },
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
    sandboxJob: {
      status: "completed",
      reason: null,
      warning: null,
      violationMessage: null,
      content: JSON.stringify({ items: [] })
    },
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
    sandboxJob: {
      status: "completed",
      reason: null,
      warning: null,
      violationMessage: null,
      content: JSON.stringify({ items: [] })
    },
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
  let sandboxCalled = false;
  const service = createService({
    sandboxJob: {
      status: "completed",
      reason: null,
      warning: null,
      violationMessage: null,
      content: JSON.stringify({ content: "secret", sizeBytes: 6, truncated: false })
    }
  });
  (
    service as unknown as { sandboxClientService: { waitForCompletion: () => Promise<unknown> } }
  ).sandboxClientService.waitForCompletion = async () => {
    sandboxCalled = true;
    return {
      status: "completed",
      reason: null,
      warning: null,
      violationMessage: null,
      content: JSON.stringify({ content: "secret", sizeBytes: 6, truncated: false })
    };
  };

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
  assert.equal(sandboxCalled, true);
});

test("files.list /tmp path keeps sandbox find behavior", async () => {
  let manifestCalled = false;
  let sandboxCalled = false;
  const service = new RuntimeFilesToolService(
    {
      isConfigured: () => true,
      async waitForCompletion() {
        sandboxCalled = true;
        return {
          status: "completed",
          reason: null,
          warning: null,
          violationMessage: null,
          content: JSON.stringify({
            items: [
              {
                path: wp("scratch.txt"),
                type: "file",
                sizeBytes: 4,
                mimeType: "text/plain",
                modifiedAt: "2026-06-20T10:00:00.000Z"
              }
            ]
          })
        };
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true, code: null, message: null };
      },
      async listWorkspaceFilesFromManifest() {
        manifestCalled = true;
        return { items: [] };
      },
      async listWorkspaceFileShortDescriptions() {
        return [];
      }
    } as never
  );

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
  assert.equal(sandboxCalled, true);
  assert.equal(result.isError, false);
  assert.equal(result.payload.action, "listed");
});

// ADR-127 W1 — after a successful sandbox write on an active visible
// `/workspace/...` path, the
// runtime upserts `workspace_file_metadata` via the internal API. A
// `/tmp/...` write must NOT upsert (scratch stays pod-only).
test("files.write session-root path upserts manifest", async () => {
  let upsertCalled = false;
  let upsertInput: Record<string, unknown> | undefined;
  const service = new RuntimeFilesToolService(
    {
      isConfigured: () => true,
      async waitForCompletion() {
        return {
          status: "completed",
          reason: null,
          warning: null,
          violationMessage: null,
          content: JSON.stringify({ sizeBytes: 42 })
        };
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true, code: null, message: null };
      },
      async upsertWorkspaceFileMetadata(input: Record<string, unknown>) {
        upsertCalled = true;
        upsertInput = input;
      }
    } as never
  );

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
  assert.equal(upsertInput?.sizeBytes, 42);
});

test("files.write requestedName resolves under the real current session root", async () => {
  let sandboxArgs: Record<string, unknown> | undefined;
  let upsertInput: Record<string, unknown> | undefined;
  const service = new RuntimeFilesToolService(
    {
      isConfigured: () => true,
      async waitForCompletion(input: { args: Record<string, unknown> }) {
        sandboxArgs = input.args;
        return {
          status: "completed",
          reason: null,
          warning: null,
          violationMessage: null,
          content: JSON.stringify({ sizeBytes: 4 })
        };
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true, code: null, message: null };
      },
      async upsertWorkspaceFileMetadata(input: Record<string, unknown>) {
        upsertInput = input;
      }
    } as never
  );

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
  assert.deepEqual(sandboxArgs, {
    action: "write",
    path: wp("test.txt"),
    content: "test"
  });
  assert.equal(upsertInput?.path, wp("test.txt"));
});

test("files.write relative path resolves under the real current session root", async () => {
  let sandboxArgs: Record<string, unknown> | undefined;
  const service = new RuntimeFilesToolService(
    {
      isConfigured: () => true,
      async waitForCompletion(input: { args: Record<string, unknown> }) {
        sandboxArgs = input.args;
        return {
          status: "completed",
          reason: null,
          warning: null,
          violationMessage: null,
          content: JSON.stringify({ sizeBytes: 4 })
        };
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true, code: null, message: null };
      },
      async upsertWorkspaceFileMetadata() {
        return undefined;
      }
    } as never
  );

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
  assert.equal(sandboxArgs?.path, wp("reports/test.txt"));
});

test("files.write canonicalizes current/current placeholder to the real session root", async () => {
  let sandboxArgs: Record<string, unknown> | undefined;
  let upsertInput: Record<string, unknown> | undefined;
  const service = new RuntimeFilesToolService(
    {
      isConfigured: () => true,
      async waitForCompletion(input: { args: Record<string, unknown> }) {
        sandboxArgs = input.args;
        return {
          status: "completed",
          reason: null,
          warning: null,
          violationMessage: null,
          content: JSON.stringify({ sizeBytes: 4 })
        };
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true, code: null, message: null };
      },
      async upsertWorkspaceFileMetadata(input: Record<string, unknown>) {
        upsertInput = input;
      }
    } as never
  );

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
  assert.equal(sandboxArgs?.path, wp("test.txt"));
  assert.equal(upsertInput?.path, wp("test.txt"));
});

test("files.write rejects model-authored foreign session roots", async () => {
  let sandboxCalled = false;
  const service = new RuntimeFilesToolService(
    {
      isConfigured: () => true,
      async waitForCompletion() {
        sandboxCalled = true;
        return {
          status: "completed",
          reason: null,
          warning: null,
          violationMessage: null,
          content: JSON.stringify({ sizeBytes: 4 })
        };
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true, code: null, message: null };
      }
    } as never
  );

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
  assert.equal(sandboxCalled, false);
});

test("files.write default collision returns resolved sibling path and upserts manifest there", async () => {
  let sandboxArgs: Record<string, unknown> | undefined;
  let upsertInput: Record<string, unknown> | undefined;
  const service = new RuntimeFilesToolService(
    {
      isConfigured: () => true,
      async waitForCompletion(input: { args: Record<string, unknown> }) {
        sandboxArgs = input.args;
        return {
          status: "completed",
          reason: null,
          warning: null,
          violationMessage: null,
          content: JSON.stringify({
            sizeBytes: 42,
            resolvedPath: wp("notes (1).md")
          })
        };
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true, code: null, message: null };
      },
      async upsertWorkspaceFileMetadata(input: Record<string, unknown>) {
        upsertInput = input;
      }
    } as never
  );

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
  assert.deepEqual(sandboxArgs, {
    action: "write",
    path: wp("notes.md"),
    content: "# notes\nhello"
  });
  assert.equal(upsertInput?.path, wp("notes (1).md"));
  assert.equal(upsertInput?.originChatId, "chat-1");
  assert.equal(upsertInput?.originAssistantId, "assistant-1");
});

test("files.write replace=true overwrites the exact path", async () => {
  let sandboxArgs: Record<string, unknown> | undefined;
  let upsertInput: Record<string, unknown> | undefined;
  const service = new RuntimeFilesToolService(
    {
      isConfigured: () => true,
      async waitForCompletion(input: { args: Record<string, unknown> }) {
        sandboxArgs = input.args;
        return {
          status: "completed",
          reason: null,
          warning: null,
          violationMessage: null,
          content: JSON.stringify({
            sizeBytes: 7,
            resolvedPath: wp("report.txt")
          })
        };
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true, code: null, message: null };
      },
      async upsertWorkspaceFileMetadata(input: Record<string, unknown>) {
        upsertInput = input;
      }
    } as never
  );

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
  assert.deepEqual(sandboxArgs, {
    action: "write",
    path: wp("report.txt"),
    content: "updated",
    replace: true
  });
  assert.equal(upsertInput?.path, wp("report.txt"));
});

test("files.write create_only collisions still fail honestly", async () => {
  let sandboxArgs: Record<string, unknown> | undefined;
  const service = new RuntimeFilesToolService(
    {
      isConfigured: () => true,
      async waitForCompletion(input: { args: Record<string, unknown> }) {
        sandboxArgs = input.args;
        return {
          status: "completed",
          reason: "create_only_collision",
          warning: null,
          violationMessage: null,
          content: null
        };
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true, code: null, message: null };
      }
    } as never
  );

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

  assert.deepEqual(sandboxArgs, {
    action: "write",
    path: wp("report.txt"),
    content: "data",
    mode: "create_only"
  });
  assert.equal(result.isError, true);
  assert.equal(result.payload.action, "skipped");
  assert.equal(result.payload.reason, "create_only_collision");
});

test("files.write /tmp path does NOT upsert manifest", async () => {
  let upsertCalled = false;
  const service = new RuntimeFilesToolService(
    {
      isConfigured: () => true,
      async waitForCompletion() {
        return {
          status: "completed",
          reason: null,
          warning: null,
          violationMessage: null,
          content: JSON.stringify({ sizeBytes: 4 })
        };
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true, code: null, message: null };
      },
      async upsertWorkspaceFileMetadata() {
        upsertCalled = true;
      }
    } as never
  );

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

  assert.equal(result.isError, false);
  assert.equal(result.payload.action, "written");
  assert.equal(upsertCalled, false);
});

test("files.write session-root upsert failure is swallowed; write still succeeds", async () => {
  const service = new RuntimeFilesToolService(
    {
      isConfigured: () => true,
      async waitForCompletion() {
        return {
          status: "completed",
          reason: null,
          warning: null,
          violationMessage: null,
          content: JSON.stringify({ sizeBytes: 3 })
        };
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true, code: null, message: null };
      },
      async upsertWorkspaceFileMetadata() {
        throw new Error("api down");
      }
    } as never
  );

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

  assert.equal(result.isError, false);
  assert.equal(result.payload.action, "written");
});

test("files.delete session-root path deletes manifest after sandbox rm", async () => {
  let manifestDeleteCalled = false;
  let manifestDeleteInput: Record<string, unknown> | undefined;
  const service = createService({
    sandboxJob: {
      status: "completed",
      reason: null,
      warning: null,
      violationMessage: null,
      content: JSON.stringify({})
    },
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

test("files.delete /tmp path does NOT delete manifest", async () => {
  let manifestDeleteCalled = false;
  const service = createService({
    sandboxJob: {
      status: "completed",
      reason: null,
      warning: null,
      violationMessage: null,
      content: JSON.stringify({})
    },
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

  assert.equal(result.isError, false);
  assert.equal(result.payload.action, "deleted");
  assert.equal(manifestDeleteCalled, false);
});
