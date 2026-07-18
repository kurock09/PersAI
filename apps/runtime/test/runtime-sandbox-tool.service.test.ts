import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeSandboxToolService } from "../src/modules/turns/runtime-sandbox-tool.service";

const TEST_SESSION_ROOT = "/workspace/assistants/assistant-handle/sessions/session-1";

function wp(relativePath: string): string {
  return `${TEST_SESSION_ROOT}/${relativePath.replace(/^\/+/, "")}`;
}

function createBundle() {
  return {
    metadata: {
      assistantId: "assistant-1",
      assistantHandle: "assistant-handle",
      siblingAssistantHandles: [],
      workspaceId: "workspace-1"
    },
    governance: {
      toolPolicies: [
        {
          toolCode: "shell",
          executionMode: "sandbox",
          enabled: true,
          visibleToModel: true,
          usageRule: "allowed",
          dailyCallLimit: null
        }
      ]
    },
    runtime: {
      sandbox: {
        enabled: true
      }
    }
  } as never;
}

function createServiceStubs(input: {
  files: Array<{
    storagePath: string;
    mimeType: string;
    sizeBytes: number;
    contentHash?: string;
  }>;
  upsertResults?: Array<{
    documentRegistration: {
      registered: boolean;
      versionNumber: number | null;
      bumped: boolean;
      isOverwrite: boolean;
      contentChanged: boolean;
    } | null;
  }>;
}) {
  const upsertCalls: Array<Record<string, unknown>> = [];
  const metadataReads: string[] = [];
  const upsertResults = input.upsertResults ?? [];
  let upsertIndex = 0;
  const service = new RuntimeSandboxToolService(
    {
      isConfigured() {
        return true;
      },
      async waitForForegroundThreshold() {
        return {
          yielded: false,
          job: {
            status: "completed",
            reason: null,
            warning: null,
            violationMessage: null,
            files: input.files
          }
        } as never;
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true };
      },
      async assertBackgroundJobCap() {
        return { allowed: true as const };
      },
      async getWorkspaceFileMetadata(input: { path: string }) {
        metadataReads.push(input.path);
        return null;
      },
      async upsertWorkspaceFileMetadata(upsertInput: Record<string, unknown>) {
        upsertCalls.push(upsertInput);
        const result = upsertResults[upsertIndex] ?? { documentRegistration: null };
        upsertIndex += 1;
        return result;
      }
    } as never,
    {
      async downloadByWorkspacePath(input: { storagePath: string }) {
        return Buffer.from(`bytes:${input.storagePath}`);
      }
    } as never
  );
  return { service, upsertCalls, metadataReads };
}

test("syncs active hierarchical produced files including csv from sandbox jobs", async () => {
  const { service, upsertCalls, metadataReads } = createServiceStubs({
    files: [
      {
        storagePath: wp("reports/current.pdf"),
        mimeType: "application/pdf",
        sizeBytes: 128,
        contentHash: "pdf-hash"
      },
      {
        storagePath: "/workspace/current.pdf",
        mimeType: "application/pdf",
        sizeBytes: 256
      },
      {
        storagePath: "/workspace/assistants/assistant-handle/report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512
      },
      {
        storagePath: wp("exports/report.csv"),
        mimeType: "text/csv",
        sizeBytes: 64,
        contentHash: "csv-hash"
      },
      {
        storagePath: "/workspace/shared/team.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: 1024,
        contentHash: "xlsx-hash"
      }
    ],
    upsertResults: [
      {
        documentRegistration: {
          registered: true,
          versionNumber: 1,
          bumped: false,
          isOverwrite: false,
          contentChanged: true
        }
      },
      { documentRegistration: null },
      {
        documentRegistration: {
          registered: true,
          versionNumber: 2,
          bumped: true,
          isOverwrite: true,
          contentChanged: true
        }
      }
    ]
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-shell-1",
      name: "shell",
      arguments: { command: "python render.py" }
    },
    sessionId: "session-1",
    requestId: "request-1",
    chatId: "chat-1",
    sourceUserMessageText: "render the docs",
    sourceUserMessageCreatedAt: "2026-07-03T16:00:00.000Z"
  });

  assert.equal(result.isError, false);
  assert.deepEqual(metadataReads, [
    wp("reports/current.pdf"),
    wp("exports/report.csv"),
    "/workspace/shared/team.xlsx"
  ]);
  assert.equal(upsertCalls.length, 3);
  assert.equal(upsertCalls[0]?.path, wp("reports/current.pdf"));
  assert.equal(upsertCalls[1]?.path, wp("exports/report.csv"));
  assert.equal(upsertCalls[1]?.originChatId, "chat-1");
  assert.equal(upsertCalls[2]?.path, "/workspace/shared/team.xlsx");
  assert.deepEqual(result.payload.documentSync, [
    {
      path: wp("reports/current.pdf"),
      registered: true,
      versionNumber: 1,
      bumped: false,
      isOverwrite: false,
      contentChanged: true
    },
    {
      path: "/workspace/shared/team.xlsx",
      registered: true,
      versionNumber: 2,
      bumped: true,
      isOverwrite: true,
      contentChanged: true
    }
  ]);
});

test("upserts manifest for shell csv output without chatId", async () => {
  const { service, upsertCalls } = createServiceStubs({
    files: [
      {
        storagePath: wp("report.csv"),
        mimeType: "text/csv",
        sizeBytes: 32,
        contentHash: "csv-hash"
      }
    ]
  });

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-shell-2",
      name: "shell",
      arguments: { command: "echo hi > report.csv" }
    },
    sessionId: "session-1",
    requestId: "request-2"
  });

  assert.equal(result.isError, false);
  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0]?.path, wp("report.csv"));
  assert.equal(upsertCalls[0]?.originChatId, undefined);
  assert.equal(upsertCalls[0]?.contentHash, "csv-hash");
});

test("manifest sync fails closed when GCS bytes are missing", async () => {
  const brokenService = new RuntimeSandboxToolService(
    {
      isConfigured() {
        return true;
      },
      async waitForForegroundThreshold() {
        return {
          yielded: false,
          job: {
            status: "completed",
            reason: null,
            warning: null,
            violationMessage: null,
            files: [{ storagePath: wp("ghost.csv"), mimeType: "text/csv", sizeBytes: 10 }]
          }
        } as never;
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true };
      },
      async getWorkspaceFileMetadata() {
        return null;
      },
      async upsertWorkspaceFileMetadata() {
        throw new Error("should not upsert");
      }
    } as never,
    {
      async downloadByWorkspacePath() {
        return null;
      }
    } as never
  );

  const result = await brokenService.executeToolCall({
    bundle: createBundle(),
    toolCall: { id: "tool-shell-3", name: "shell", arguments: { command: "x" } },
    sessionId: "session-1",
    requestId: "request-3"
  });

  assert.equal(result.isError, true);
  assert.equal(result.payload.reason, "manifest_sync_failed");
});

test("long warm shell yields only an opaque jobRef while the SandboxJob keeps running", async () => {
  let cancelled = false;
  const service = new RuntimeSandboxToolService(
    {
      isConfigured() {
        return true;
      },
      async waitForForegroundThreshold() {
        return {
          yielded: true,
          job: {
            jobId: "raw-sandbox-job-id",
            status: "detached",
            toolCode: "shell",
            files: []
          }
        };
      },
      async cancelJob() {
        cancelled = true;
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true };
      },
      async assertBackgroundJobCap() {
        return { allowed: true as const };
      },
      async registerSandboxAsyncJob() {
        return { registered: true, jobRef: `jr1.sandbox.${"a".repeat(32)}` };
      }
    } as never,
    {} as never
  );

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: { id: "tool-shell-bg", name: "shell", arguments: { command: "sleep 60" } },
    sessionId: "11111111-1111-4111-8111-111111111111",
    requestId: "request-bg",
    chatId: "22222222-2222-4222-8222-222222222222",
    channel: "web",
    threadKey: "thread-bg",
    sourceClientTurnId: "turn-bg",
    sourceUserMessageId: "33333333-3333-4333-8333-333333333333"
  });

  assert.equal(result.isError, false);
  assert.equal(result.payload.action, "background");
  assert.match(result.payload.jobRef ?? "", /^jr1\.sandbox\./);
  assert.equal(result.payload.job, null);
  assert.equal(JSON.stringify(result.payload).includes("raw-sandbox-job-id"), false);
  assert.equal(cancelled, false);
});

test("yielded without detached stamp does not register an opaque jobRef", async () => {
  let registerCalls = 0;
  let cancelled = false;
  const service = new RuntimeSandboxToolService(
    {
      isConfigured() {
        return true;
      },
      async waitForForegroundThreshold() {
        return {
          yielded: true,
          job: {
            jobId: "still-leased-job",
            status: "running",
            toolCode: "shell",
            files: []
          }
        };
      },
      async cancelJob() {
        cancelled = true;
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true };
      },
      async assertBackgroundJobCap() {
        return { allowed: true as const };
      },
      async registerSandboxAsyncJob() {
        registerCalls += 1;
        return { registered: true, jobRef: `jr1.sandbox.${"b".repeat(32)}` };
      }
    } as never,
    {} as never
  );

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: { id: "tool-shell-premature", name: "shell", arguments: { command: "sleep 60" } },
    sessionId: "11111111-1111-4111-8111-111111111111",
    requestId: "request-premature",
    chatId: "22222222-2222-4222-8222-222222222222",
    channel: "web",
    threadKey: "thread-premature",
    sourceClientTurnId: "turn-premature",
    sourceUserMessageId: "33333333-3333-4333-8333-333333333333"
  });

  assert.equal(result.isError, true);
  assert.equal(result.payload.reason, "async_detach_incomplete");
  assert.equal(registerCalls, 0);
  assert.equal(cancelled, true);
});

test("shell/exec skips before submit when chat is at the unified background job cap", async () => {
  let waited = false;
  const service = new RuntimeSandboxToolService(
    {
      isConfigured() {
        return true;
      },
      async waitForForegroundThreshold() {
        waited = true;
        return {
          yielded: false,
          job: { status: "completed", files: [] }
        } as never;
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true };
      },
      async assertBackgroundJobCap() {
        return { allowed: false as const, code: "background_job_concurrency_limit" as const };
      }
    } as never,
    {} as never
  );

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: { id: "tool-shell-cap", name: "shell", arguments: { command: "echo hi" } },
    sessionId: "session-cap",
    requestId: "request-cap",
    chatId: "chat-cap"
  });

  assert.equal(result.isError, false);
  assert.equal(result.payload.action, "skipped");
  assert.equal(result.payload.reason, "background_job_concurrency_limit");
  assert.equal(waited, false);
});

test("post-detach re-assert-cap failure orphan-cancels and skips register", async () => {
  let assertCalls = 0;
  let forceCancel = false;
  let registerCalls = 0;
  const assertArgs: Array<{ chatId: string; excludeSandboxJobId?: string }> = [];
  const service = new RuntimeSandboxToolService(
    {
      isConfigured() {
        return true;
      },
      async waitForForegroundThreshold() {
        return {
          yielded: true,
          job: {
            jobId: "detached-job",
            status: "detached",
            toolCode: "shell",
            files: []
          }
        };
      },
      async cancelJob(_id: string, options?: { forceDetachedOrphan?: boolean }) {
        forceCancel = options?.forceDetachedOrphan === true;
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true };
      },
      async assertBackgroundJobCap(input: { chatId: string; excludeSandboxJobId?: string }) {
        assertCalls += 1;
        assertArgs.push(input);
        if (assertCalls === 1) return { allowed: true as const };
        return { allowed: false as const, code: "background_job_concurrency_limit" as const };
      },
      async registerSandboxAsyncJob() {
        registerCalls += 1;
        return { registered: true, jobRef: `jr1.sandbox.${"c".repeat(32)}` };
      }
    } as never,
    {} as never
  );

  const result = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: { id: "tool-shell-postcap", name: "shell", arguments: { command: "sleep 60" } },
    sessionId: "11111111-1111-4111-8111-111111111111",
    requestId: "request-postcap",
    chatId: "22222222-2222-4222-8222-222222222222",
    channel: "web",
    threadKey: "thread-postcap",
    sourceClientTurnId: "turn-postcap",
    sourceUserMessageId: "33333333-3333-4333-8333-333333333333"
  });

  assert.equal(result.isError, false);
  assert.equal(result.payload.reason, "background_job_concurrency_limit");
  assert.equal(assertCalls, 2);
  assert.equal(assertArgs[0]?.excludeSandboxJobId, undefined);
  assert.equal(assertArgs[1]?.excludeSandboxJobId, "detached-job");
  assert.equal(forceCancel, true);
  assert.equal(registerCalls, 0);
});
