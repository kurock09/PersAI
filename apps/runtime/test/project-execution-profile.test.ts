import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RuntimeTurnRequest } from "@persai/runtime-contract";
import {
  buildProjectModePrecheckDecision,
  hasProjectDocumentContext,
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
  test("detects project chat mode and PDF document context", () => {
    const request = createRequest({
      message: {
        ...createRequest().message,
        attachments: [
          {
            attachmentId: "attachment-1",
            kind: "file",
            objectKey: "assistant-media/assistants/assistant-1/uploads/spec.pdf",
            mimeType: "application/pdf",
            filename: "spec.pdf",
            sizeBytes: 2048
          }
        ]
      }
    });
    assert.equal(isProjectChatMode(request), true);
    assert.equal(hasProjectDocumentContext(request), true);
  });

  test("builds retrieval-aware reasoning precheck with reasoning tool-loop mode", () => {
    const request = createRequest({
      message: {
        ...createRequest().message,
        attachments: [
          {
            attachmentId: "attachment-1",
            kind: "file",
            objectKey: "assistant-media/assistants/assistant-1/uploads/spec.pdf",
            mimeType: "application/pdf",
            filename: "spec.pdf",
            sizeBytes: 2048
          }
        ]
      }
    });
    const decision = buildProjectModePrecheckDecision({
      request,
      fallbackMode: "premium",
      policyMode: "active",
      availableKnowledge: true,
      availableWeb: true,
      ordinarySourcePriorityMode: "mixed_ambiguous",
      productKnowledgeIntent: false,
      skillState: null,
      selectedSkillIds: []
    });
    assert.equal(decision.executionMode, "reasoning");
    assert.equal(decision.retrievalHint, true);
    assert.equal(decision.reasonCode, "project_mode_document_context");
    assert.equal(decision.retrievalPlan.useUserKnowledge, true);
    assert.equal(decision.retrievalPlan.useProductKnowledge, false);
    assert.notEqual(decision.retrievalPlan.reasonCode, "reasoning_request");
  });

  test("admits Product KB in project mode only for explicit product intent", () => {
    const decision = buildProjectModePrecheckDecision({
      request: createRequest(),
      fallbackMode: "premium",
      policyMode: "active",
      availableKnowledge: true,
      availableWeb: false,
      ordinarySourcePriorityMode: "product_first",
      productKnowledgeIntent: true,
      skillState: null,
      selectedSkillIds: []
    });
    assert.equal(decision.retrievalPlan.useUserKnowledge, true);
    assert.equal(decision.retrievalPlan.useProductKnowledge, true);
  });

  test("exposes staged project developer contract text", () => {
    assert.match(PROJECT_EXECUTION_DEVELOPER_CONTRACT, /plan/);
    assert.match(PROJECT_EXECUTION_DEVELOPER_CONTRACT, /gather/);
    assert.match(PROJECT_EXECUTION_DEVELOPER_CONTRACT, /synthesize/);
  });
});
