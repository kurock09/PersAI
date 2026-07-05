import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import { createFakeMediaObjectStorageForRead } from "./helpers/runtime-outbound-test-doubles";
import { RuntimeFilesToolService } from "../src/modules/turns/runtime-files-tool.service";
import { RuntimeStoragePlaneFilesService } from "../src/modules/turns/runtime-storage-plane-files.service";

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
  const artefactPath =
    "/workspace/assistants/assistant-1/sessions/session-1/2026-06-23T22-00-00-marketing-poster.png";
  const editedPath = "/workspace/assistants/assistant-1/sessions/session-1/edited.png";

  let apiCalled = false;
  const persaiInternalApiClientService = {
    async consumeToolDailyLimit() {
      return { allowed: true, code: null, message: null };
    },
    async getWorkspaceFileMetadata(input: { path: string }) {
      if (input.path === artefactPath || input.path === editedPath) {
        return {
          path: input.path,
          mimeType: "image/png",
          sizeBytes: 8,
          originChatId: null,
          originAssistantId: "assistant-1",
          updatedAt: new Date().toISOString()
        };
      }
      return null;
    },
    async registerChatAttachment() {
      apiCalled = true;
      throw new Error("files.attach should not register mid-turn");
    }
  };

  const service = new RuntimeFilesToolService(
    persaiInternalApiClientService as never,
    new RuntimeStoragePlaneFilesService(
      {
        buildWorkspaceObjectKey() {
          return "fake/object";
        },
        async saveObject(input: { buffer: Buffer }) {
          return {
            objectKey: "fake/object",
            sizeBytes: input.buffer.length,
            mimeType: "image/png"
          };
        },
        async downloadByWorkspacePath() {
          return Buffer.from("img-bytes");
        }
      } as never,
      persaiInternalApiClientService as never
    ),
    createFakeMediaObjectStorageForRead() as never
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

  const attachResult = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tc-attach",
      name: "files",
      arguments: { action: "attach", path: editedPath }
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
  assert.equal(apiCalled, false);
  assert.equal(attachResult.discoveredFileHandles, undefined);
  assert.equal(attachResult.artifacts?.[0]?.storagePath, editedPath);
  assert.equal(attachResult.artifacts?.[0]?.mimeType, "image/png");
  assert.equal(attachResult.artifacts?.[0]?.sizeBytes, 8);
  assert.equal(attachResult.artifacts?.[0]?.kind, "image");
  assert.equal(attachResult.artifacts?.[0]?.filename, "edited.png");
  assert.equal(attachResult.artifacts?.[0]?.sourceToolCode, undefined);
  assert.equal(attachResult.artifacts?.[0]?.voiceNote, false);
});
