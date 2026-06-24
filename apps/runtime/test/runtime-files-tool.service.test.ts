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
