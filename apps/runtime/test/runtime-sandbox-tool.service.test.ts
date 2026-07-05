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
      async waitForCompletion() {
        return {
          status: "completed",
          reason: null,
          warning: null,
          violationMessage: null,
          files: input.files
        } as never;
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true };
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
      async waitForCompletion() {
        return {
          status: "completed",
          reason: null,
          warning: null,
          violationMessage: null,
          files: [{ storagePath: wp("ghost.csv"), mimeType: "text/csv", sizeBytes: 10 }]
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
