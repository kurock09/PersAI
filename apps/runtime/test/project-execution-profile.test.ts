import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RuntimeTurnRequest } from "@persai/runtime-contract";
import {
  isProjectChatMode,
  PROJECT_EXECUTION_DEVELOPER_CONTRACT
} from "../src/modules/turns/project-execution-profile";

function createRequest(overrides?: Partial<RuntimeTurnRequest>): RuntimeTurnRequest {
  return {
    requestId: "request-1",
    idempotencyKey: "idem-1",
    runtimeTier: "paid_shared_restricted",
    conversation: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "conversation-1",
      externalUserKey: null,
      mode: "direct"
    },
    bundle: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      bundleId: "bundle-1",
      bundleHash: "bundle-hash-1",
      publishedVersionId: "version-1",
      compiledAt: "2026-04-18T12:00:00.000Z"
    },
    message: {
      text: "Compare the attached specification against our internal checklist.",
      attachments: [],
      locale: "en",
      timezone: "UTC",
      receivedAt: "2026-04-18T12:00:00.000Z"
    },
    deepMode: true,
    chatMode: "project",
    ...overrides
  };
}

describe("project-execution-profile", () => {
  test("detects project chat mode without owning routing level selection", () => {
    const request = createRequest({
      message: {
        ...createRequest().message,
        attachments: [
          {
            attachmentId: "attachment-1",
            kind: "file",
            storagePath: "assistant-media/assistants/assistant-1/uploads/spec.pdf",
            mimeType: "application/pdf",
            displayName: "spec.pdf",
            sizeBytes: 2048
          }
        ]
      }
    });
    assert.equal(isProjectChatMode(request), true);
  });

  test("exposes staged project developer contract text", () => {
    assert.match(PROJECT_EXECUTION_DEVELOPER_CONTRACT, /plan/);
    assert.match(PROJECT_EXECUTION_DEVELOPER_CONTRACT, /gather/);
    assert.match(PROJECT_EXECUTION_DEVELOPER_CONTRACT, /synthesize/);
    assert.match(PROJECT_EXECUTION_DEVELOPER_CONTRACT, /not proof of sufficiency/);
    assert.match(PROJECT_EXECUTION_DEVELOPER_CONTRACT, /external verification/);
  });
});
