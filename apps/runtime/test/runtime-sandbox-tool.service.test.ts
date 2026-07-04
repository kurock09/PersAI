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

test("syncs only active hierarchical document outputs from sandbox jobs", async () => {
  const upsertCalls: Array<Record<string, unknown>> = [];
  const upsertResults: Array<{
    documentRegistration: {
      registered: boolean;
      versionNumber: number | null;
      bumped: boolean;
      isOverwrite: boolean;
      contentChanged: boolean;
    } | null;
  }> = [];
  const metadataReads: string[] = [];
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
              storagePath: "/workspace/shared/team.xlsx",
              mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              sizeBytes: 1024,
              contentHash: "xlsx-hash"
            }
          ]
        } as never;
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return {
          allowed: true
        };
      },
      async getWorkspaceFileMetadata(input: { path: string }) {
        metadataReads.push(input.path);
        return null;
      },
      async upsertWorkspaceFileMetadata(input: Record<string, unknown>) {
        upsertCalls.push(input);
        const path = String(input.path ?? "");
        const isOverwrite = path.endsWith(".xlsx");
        upsertResults.push({
          documentRegistration: {
            registered: true,
            versionNumber: isOverwrite ? 2 : 1,
            bumped: isOverwrite,
            isOverwrite,
            contentChanged: true
          }
        });
        return upsertResults[upsertResults.length - 1]!;
      }
    } as never
  );

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
  assert.deepEqual(metadataReads, [wp("reports/current.pdf"), "/workspace/shared/team.xlsx"]);
  assert.equal(upsertCalls.length, 2);
  assert.equal(upsertCalls[0]?.path, wp("reports/current.pdf"));
  assert.equal(upsertCalls[1]?.path, "/workspace/shared/team.xlsx");
  assert.equal(upsertCalls[0]?.replace, false);
  assert.equal(upsertCalls[0]?.sourceUserMessageText, "render the docs");
  assert.equal(upsertCalls[1]?.sourceUserMessageCreatedAt, "2026-07-03T16:00:00.000Z");
  assert.equal(upsertCalls[0]?.contentHash, "pdf-hash");
  assert.equal(upsertCalls[1]?.contentHash, "xlsx-hash");
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
