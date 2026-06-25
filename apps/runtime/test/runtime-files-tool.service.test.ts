import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import { RuntimeFilesToolService } from "../src/modules/turns/runtime-files-tool.service";
import { stringifyToolResultPayloadForModel } from "../src/modules/turns/sanitize-tool-result-for-model";

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
        storagePath: "/shared/outbound/self/report.csv"
      };
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

test("files.attach happy path workspace source creates API row and hides attachment identity", async () => {
  let apiCalled = false;
  let apiInput: Record<string, unknown> | undefined;
  const service = createService({
    sandboxJob: {
      status: "completed",
      reason: null,
      warning: null,
      violationMessage: null,
      content: JSON.stringify({
        action: "attached",
        attachment: {
          workspaceRelPath: "/shared/outbound/self/report.csv",
          sourcePath: "/workspace/report.csv",
          sizeBytes: 12,
          mimeType: "text/csv",
          displayName: "report.csv"
        }
      })
    },
    apiClient: {
      async registerChatAttachment(input: Record<string, unknown>) {
        apiCalled = true;
        apiInput = input as Record<string, unknown>;
        return {
          attachmentId: "attachment-1",
          storagePath: "/shared/outbound/self/report.csv"
        };
      }
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-1",
      name: "files",
      arguments: { action: "attach", path: "/workspace/report.csv" }
    },
    ...attachToolCallParams
  });

  assert.equal(apiCalled, true);
  assert.equal(apiInput?.channel, "web");
  assert.equal(apiInput?.externalThreadKey, "web-1782153682653");
  assert.equal(apiInput?.chatId, undefined);
  assert.equal(result.isError, false);
  assert.equal(result.payload.action, "attached");
  assert.equal(result.payload.path, "/shared/outbound/self/report.csv");
  assert.equal(result.payload.sizeBytes, 12);
  assert.equal(result.discoveredFileHandles?.[0]?.storagePath, "/shared/outbound/self/report.csv");
  const modelJson = stringifyToolResultPayloadForModel(result.payload);
  assert.ok(!modelJson.includes("attachment-1"));
  assert.ok(!modelJson.includes('"attachmentId"'));
});

test("files.attach happy path shared_outbound_self still calls API", async () => {
  let apiCalled = false;
  const service = createService({
    sandboxJob: {
      status: "completed",
      reason: null,
      warning: null,
      violationMessage: null,
      content: JSON.stringify({
        attachment: {
          workspaceRelPath: "/shared/outbound/self/report.csv",
          sourcePath: "/shared/outbound/self/report.csv",
          sizeBytes: 12,
          mimeType: "text/csv",
          displayName: "report.csv"
        }
      })
    },
    apiClient: {
      async registerChatAttachment(input: Record<string, unknown>) {
        apiCalled = true;
        assert.equal(input.channel, "web");
        assert.equal(input.externalThreadKey, "web-1782153682653");
        assert.equal(input.chatId, undefined);
        return { attachmentId: "attachment-2", storagePath: "/shared/outbound/self/report.csv" };
      }
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-2",
      name: "files",
      arguments: { action: "attach", path: "/shared/outbound/self/report.csv" }
    },
    ...attachToolCallParams
  });

  assert.equal(apiCalled, true);
  assert.equal(result.payload.action, "attached");
});

test("files.attach sandbox path_not_attachable does not call API", async () => {
  let apiCalled = false;
  const service = createService({
    sandboxJob: {
      status: "completed",
      reason: "path_not_attachable",
      warning: "files.attach accepts only /workspace/ or /shared/<wsid>/outbound/self/ paths",
      violationMessage: null,
      content: null
    },
    apiClient: {
      async registerChatAttachment() {
        apiCalled = true;
        return { attachmentId: "attachment-3", storagePath: "/shared/outbound/self/report.csv" };
      }
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-3",
      name: "files",
      arguments: { action: "attach", path: "/shared/input/sales.csv" }
    },
    ...attachToolCallParams
  });

  assert.equal(apiCalled, false);
  assert.equal(result.isError, true);
  assert.equal(result.payload.reason, "path_not_attachable");
});

test("files.attach API failure returns files_attach_failed", async () => {
  const service = createService({
    sandboxJob: {
      status: "completed",
      reason: null,
      warning: null,
      violationMessage: null,
      content: JSON.stringify({
        attachment: {
          workspaceRelPath: "/shared/outbound/self/report.csv",
          sourcePath: "/workspace/report.csv",
          sizeBytes: 12,
          mimeType: "text/csv",
          displayName: "report.csv"
        }
      })
    },
    apiClient: {
      async registerChatAttachment() {
        throw new Error("api down");
      }
    }
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-4",
      name: "files",
      arguments: { action: "attach", path: "/workspace/report.csv" }
    },
    ...attachToolCallParams
  });

  assert.equal(result.isError, true);
  assert.equal(result.payload.reason, "files_attach_failed");
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
      arguments: { action: "write", path: "/workspace/big.bin", content: "data" }
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
        path: "/shared/outbound/self/out.csv",
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

// ADR-127 W1 — `/shared/...` listings come from `workspace_file_metadata`,
// not from the pod FS. The runtime must call the internal API and ignore
// the sandbox `find` for shared paths.
test("files.list /shared/ path reads from manifest API and skips sandbox", async () => {
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
        assert.equal(input.pathPrefix, "/shared/input");
        assert.equal(input.assistantHandle, "my-bot");
        return {
          items: [
            {
              path: "/shared/input/photo.jpg",
              type: "file",
              role: "shared_input",
              sizeBytes: 1200,
              mimeType: "image/jpeg",
              modifiedAt: "2026-06-20T10:00:00.000Z",
              shortDescription: "front-door selfie"
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
      arguments: { action: "list", path: "/shared/input" }
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
  assert.equal(first.path, "/shared/input/photo.jpg");
  assert.equal(first.shortDescription, "front-door selfie");
});

test("files.list /workspace/ path keeps sandbox find behavior", async () => {
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
                path: "/workspace/scratch.txt",
                type: "file",
                role: "workspace",
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
      arguments: { action: "list", path: "/workspace" }
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

// ADR-127 W1 — after a successful sandbox write on `/shared/...`, the
// runtime upserts `workspace_file_metadata` via the internal API. A
// `/workspace/...` write must NOT upsert (scratch stays pod-only).
test("files.write /shared/ path upserts manifest", async () => {
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
        path: "/shared/outbound/self/notes.md",
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
  assert.equal(upsertInput?.path, "/shared/outbound/self/notes.md");
  assert.equal(upsertInput?.mimeType, "text/markdown");
  assert.equal(upsertInput?.sizeBytes, 42);
});

test("files.write /workspace/ path does NOT upsert manifest", async () => {
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
        path: "/workspace/scratch.txt",
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

test("files.write /shared/ upsert failure is swallowed; write still succeeds", async () => {
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
        path: "/shared/outbound/self/note.txt",
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

test("files.delete /shared/ path deletes manifest after sandbox rm", async () => {
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
        path: "/shared/outbound/self/note.txt"
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
  assert.equal(manifestDeleteInput?.path, "/shared/outbound/self/note.txt");
});

test("files.delete /workspace/ path does NOT delete manifest", async () => {
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
        path: "/workspace/scratch.txt"
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
