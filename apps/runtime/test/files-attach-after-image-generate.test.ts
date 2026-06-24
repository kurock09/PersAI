import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import { RuntimeFilesToolService } from "../src/modules/turns/runtime-files-tool.service";

/**
 * ADR-126 AC11 regression pin: after image_generate dual-write, the model can
 * files.read the shared-outbound artefact path and files.attach a workspace edit.
 */
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

test("AC11: read shared-outbound artefact then attach workspace edit", async () => {
  const artefactPath = "/shared/outbound/self/2026-06-23T22-00-00-marketing-poster.png";
  const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];

  const sandboxClientService = {
    isConfigured: () => true,
    async waitForCompletion(job: { toolCode: string; args: Record<string, unknown> }) {
      sandboxCalls.push({ toolCode: job.toolCode, args: job.args });
      const action = job.args.action;
      if (action === "read") {
        return {
          status: "completed",
          reason: null,
          warning: null,
          violationMessage: null,
          content: JSON.stringify({
            content: "PNG_BYTES",
            sizeBytes: 8,
            sha256: "abc",
            truncated: false
          })
        };
      }
      if (action === "attach") {
        return {
          status: "completed",
          reason: null,
          warning: null,
          violationMessage: null,
          content: JSON.stringify({
            action: "attached",
            attachment: {
              workspaceRelPath: artefactPath,
              sourcePath: "/workspace/edited.png",
              sizeBytes: 8,
              mimeType: "image/png",
              displayName: "edited.png"
            }
          })
        };
      }
      return {
        status: "failed",
        reason: "unexpected_action",
        warning: null,
        violationMessage: null,
        content: null
      };
    }
  };

  const persaiInternalApiClientService = {
    async consumeToolDailyLimit() {
      return { allowed: true, code: null, message: null };
    },
    async registerChatAttachment() {
      return {
        storagePath: "/shared/workspace-1/outbound/self/edited.png",
        attachmentId: "attachment-2"
      };
    }
  };

  const service = new RuntimeFilesToolService(
    sandboxClientService as never,
    persaiInternalApiClientService as never
  );

  const readResult = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-read",
      name: "files",
      arguments: { action: "read", path: artefactPath }
    },
    sessionId: "session-1",
    requestId: "request-read",
    channel: "web",
    chatId: null,
    externalThreadKey: "web-thread",
    messageId: "message-1"
  });

  assert.equal(readResult.isError, false);
  assert.equal(readResult.payload.path, artefactPath);
  assert.equal(sandboxCalls[0]?.args.action, "read");

  const attachResult = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-attach",
      name: "files",
      arguments: { action: "attach", path: "/workspace/edited.png" }
    },
    sessionId: "session-1",
    requestId: "request-attach",
    channel: "web",
    chatId: null,
    externalThreadKey: "web-thread",
    messageId: "message-1"
  });

  assert.equal(attachResult.isError, false);
  assert.equal(attachResult.payload.action, "attached");
  assert.equal(sandboxCalls[1]?.args.action, "attach");
  assert.equal(
    attachResult.discoveredFileHandles?.[0]?.storagePath,
    "/shared/workspace-1/outbound/self/edited.png"
  );
});
