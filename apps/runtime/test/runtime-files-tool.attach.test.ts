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

test("files.attach happy path workspace source emits assistant artifact", async () => {
  let apiCalled = false;
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
      async registerChatAttachment() {
        apiCalled = true;
        throw new Error("files.attach should not register mid-turn");
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

  assert.equal(apiCalled, false);
  assert.equal(result.isError, false);
  assert.equal(result.payload.action, "attached");
  assert.equal(result.payload.path, wp("report.csv"));
  assert.equal(result.payload.sizeBytes, 12);
  assert.equal(result.discoveredFileHandles, undefined);
  assert.equal(result.artifacts?.length, 1);
  const artifact = result.artifacts?.[0];
  assert.equal(artifact?.storagePath, wp("report.csv"));
  assert.equal(artifact?.mimeType, "text/csv");
  assert.equal(artifact?.sizeBytes, 12);
  assert.equal(artifact?.kind, "file");
  assert.equal(artifact?.filename, "report.csv");
  assert.equal(artifact?.sourceToolCode, undefined);
  assert.equal(artifact?.voiceNote, false);
  assert.match(artifact?.artifactId ?? "", /^[0-9a-f-]{36}$/);
  const modelJson = stringifyToolResultPayloadForModel(result.payload);
  assert.ok(!modelJson.includes('"attachmentId"'));
  assert.match(modelJson, /"path":".*report\.csv"/);
});

test("files.attach session-root image file emits assistant artifact", async () => {
  let apiCalled = false;
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
          mimeType: "image/png",
          displayName: "report.png"
        }
      })
    },
    apiClient: {
      async registerChatAttachment() {
        apiCalled = true;
        throw new Error("files.attach should not register mid-turn");
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

  assert.equal(apiCalled, false);
  assert.equal(result.payload.action, "attached");
  assert.equal(result.artifacts?.[0]?.kind, "image");
  assert.equal(result.artifacts?.[0]?.filename, "report.png");
  assert.equal(result.artifacts?.[0]?.sourceToolCode, undefined);
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

test("files.attach sandbox failed job returns files_failed", async () => {
  const service = createService({
    sandboxJob: {
      status: "failed",
      reason: null,
      warning: "sandbox attach failed",
      violationMessage: null,
      content: null
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

  assert.equal(result.isError, true);
  assert.equal(result.payload.reason, "files_failed");
  assert.equal(result.payload.warning, "sandbox attach failed");
});
