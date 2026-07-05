import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import { RuntimeGrepGlobToolService } from "../src/modules/turns/runtime-grep-glob-tool.service";

const SESSION_ROOT = "/workspace/assistants/assistant-1/sessions/session-1";

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
          toolCode: "grep",
          enabled: true,
          visibleToModel: true,
          usageRule: "allowed",
          executionMode: "inline",
          dailyCallLimit: null
        },
        {
          toolCode: "glob",
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
      sandbox: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: false }
    }
  } as unknown as AssistantRuntimeBundle;
}

function createService(apiClient: Record<string, unknown> = {}) {
  const persaiInternalApiClientService = {
    async consumeToolDailyLimit() {
      return { allowed: true, code: null, message: null };
    },
    async grepWorkspaceFiles() {
      return {
        matches: [
          {
            file: `${SESSION_ROOT}/notes.md`,
            line: 2,
            text: "hello token"
          }
        ],
        truncated: false,
        reason: null,
        warning: null
      };
    },
    async globWorkspaceFiles() {
      return {
        paths: [`${SESSION_ROOT}/notes.md`],
        truncated: false,
        reason: null,
        warning: null
      };
    },
    ...apiClient
  };
  return new RuntimeGrepGlobToolService(persaiInternalApiClientService as never);
}

test("grep uses storage-plane API without sandbox configured", async () => {
  let grepInput: Record<string, unknown> | undefined;
  const service = createService({
    async grepWorkspaceFiles(input: Record<string, unknown>) {
      grepInput = input;
      return {
        matches: [{ file: `${SESSION_ROOT}/notes.md`, line: 1, text: "token" }],
        truncated: false,
        reason: null,
        warning: null
      };
    }
  });

  const result = await service.executeGrepToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-grep",
      name: "grep",
      arguments: { pattern: "token", glob: "**/*.md" }
    },
    sessionId: "session-1",
    requestId: "request-1"
  });

  assert.equal(result.isError, false);
  assert.equal(result.payload.action, "matched");
  assert.equal(result.payload.matchCount, 1);
  assert.equal(grepInput?.workspaceId, "workspace-1");
  assert.equal(grepInput?.assistantId, "assistant-1");
  assert.equal(grepInput?.sessionId, "session-1");
  assert.equal(grepInput?.pattern, "token");
  assert.equal(grepInput?.path, SESSION_ROOT);
});

test("glob uses storage-plane API without sandbox configured", async () => {
  let globInput: Record<string, unknown> | undefined;
  const service = createService({
    async globWorkspaceFiles(input: Record<string, unknown>) {
      globInput = input;
      return {
        paths: [`${SESSION_ROOT}/notes.md`],
        truncated: false,
        reason: null,
        warning: null
      };
    }
  });

  const result = await service.executeGlobToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-glob",
      name: "glob",
      arguments: { pattern: "*.md" }
    },
    sessionId: "session-1",
    requestId: "request-1"
  });

  assert.equal(result.isError, false);
  assert.equal(result.payload.action, "found");
  assert.equal(result.payload.paths?.[0], `${SESSION_ROOT}/notes.md`);
  assert.equal(globInput?.pattern, "*.md");
  assert.equal(globInput?.path, SESSION_ROOT);
});

test("grep scratch path surfaces scratch_path_unsupported", async () => {
  const service = createService({
    async grepWorkspaceFiles() {
      return {
        matches: [],
        truncated: false,
        reason: "scratch_path_unsupported",
        warning: "use shell"
      };
    }
  });

  const result = await service.executeGrepToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-grep-tmp",
      name: "grep",
      arguments: { pattern: "token", path: "/tmp/scratch.txt" }
    },
    sessionId: "session-1",
    requestId: "request-1"
  });

  assert.equal(result.isError, true);
  assert.equal(result.payload.reason, "scratch_path_unsupported");
});
