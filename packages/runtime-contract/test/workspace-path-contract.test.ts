import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  WORKSPACE_ROOT,
  WORKSPACE_ASSISTANTS_ROOT,
  WORKSPACE_SHARED_ROOT,
  buildAssistantSharedRoot,
  buildAssistantSessionRoot,
  buildAssistantSessionsRoot,
  buildAssistantWorkspaceRoot,
  classifyVisibleWorkspacePath,
  isRejectedRootFlatWorkspacePath,
  isStaleVisibleWorkspacePath,
  isValidVisibleWorkspacePath,
  isValidWorkspacePathSegment,
  sanitizeWorkspacePathSegment
} from "../src/index";

describe("workspace path contract", () => {
  test("builds canonical ADR-133 hierarchy roots", () => {
    assert.equal(WORKSPACE_ROOT, "/workspace");
    assert.equal(WORKSPACE_ASSISTANTS_ROOT, "/workspace/assistants");
    assert.equal(WORKSPACE_SHARED_ROOT, "/workspace/shared");
    assert.equal(buildAssistantWorkspaceRoot("assistant-1"), "/workspace/assistants/assistant-1");
    assert.equal(
      buildAssistantSessionsRoot("assistant-1"),
      "/workspace/assistants/assistant-1/sessions"
    );
    assert.equal(
      buildAssistantSessionRoot("assistant-1", "session-1"),
      "/workspace/assistants/assistant-1/sessions/session-1"
    );
    assert.equal(
      buildAssistantSharedRoot("assistant-1"),
      "/workspace/assistants/assistant-1/shared"
    );
  });

  test("classifies valid hierarchical session and widen roots", () => {
    assert.deepEqual(classifyVisibleWorkspacePath("/workspace"), {
      kind: "workspaceRoot",
      normalizedPath: "/workspace",
      assistantStableKey: null,
      sessionId: null
    });
    assert.deepEqual(classifyVisibleWorkspacePath("/workspace/assistants/a"), {
      kind: "assistantRoot",
      normalizedPath: "/workspace/assistants/a",
      assistantStableKey: "a",
      sessionId: null
    });
    assert.deepEqual(classifyVisibleWorkspacePath("/workspace/assistants/a/sessions"), {
      kind: "assistantSessionsRoot",
      normalizedPath: "/workspace/assistants/a/sessions",
      assistantStableKey: "a",
      sessionId: null
    });
    assert.deepEqual(classifyVisibleWorkspacePath("/workspace/assistants/a/sessions/s"), {
      kind: "sessionRoot",
      normalizedPath: "/workspace/assistants/a/sessions/s",
      assistantStableKey: "a",
      sessionId: "s"
    });
    assert.deepEqual(
      classifyVisibleWorkspacePath("/workspace/assistants/a/sessions/s/report.pdf"),
      {
        kind: "sessionDescendant",
        normalizedPath: "/workspace/assistants/a/sessions/s/report.pdf",
        assistantStableKey: "a",
        sessionId: "s"
      }
    );
    assert.deepEqual(classifyVisibleWorkspacePath("/workspace/assistants/a/shared"), {
      kind: "assistantSharedRoot",
      normalizedPath: "/workspace/assistants/a/shared",
      assistantStableKey: "a",
      sessionId: null
    });
    assert.deepEqual(classifyVisibleWorkspacePath("/workspace/shared"), {
      kind: "workspaceSharedRoot",
      normalizedPath: "/workspace/shared",
      assistantStableKey: null,
      sessionId: null
    });

    assert.equal(isValidVisibleWorkspacePath("/workspace"), true);
    assert.equal(isValidVisibleWorkspacePath("/workspace/assistants/a"), true);
    assert.equal(
      isValidVisibleWorkspacePath("/workspace/assistants/a/sessions/s/report.pdf"),
      true
    );
    assert.equal(isValidVisibleWorkspacePath("/workspace/assistants/a/shared/notes.txt"), true);
    assert.equal(isValidVisibleWorkspacePath("/workspace/shared/common.md"), true);
  });

  test("rejects root-flat and stale workspace paths", () => {
    assert.deepEqual(classifyVisibleWorkspacePath("/workspace/report.pdf"), {
      kind: "rootFlatFile",
      normalizedPath: "/workspace/report.pdf",
      assistantStableKey: null,
      sessionId: null
    });
    assert.deepEqual(classifyVisibleWorkspacePath("/workspace/chats/chat-1/report.pdf"), {
      kind: "staleChatsPath",
      normalizedPath: "/workspace/chats/chat-1/report.pdf",
      assistantStableKey: null,
      sessionId: null
    });
    assert.deepEqual(classifyVisibleWorkspacePath("/workspace/projects/source/output/report.pdf"), {
      kind: "staleProjectsPath",
      normalizedPath: "/workspace/projects/source/output/report.pdf",
      assistantStableKey: null,
      sessionId: null
    });

    assert.equal(isRejectedRootFlatWorkspacePath("/workspace/report.pdf"), true);
    assert.equal(isStaleVisibleWorkspacePath("/workspace/chats/chat-1/report.pdf"), true);
    assert.equal(isStaleVisibleWorkspacePath("/workspace/projects/source/output/report.pdf"), true);

    assert.equal(isValidVisibleWorkspacePath("/workspace/report.pdf"), false);
    assert.equal(isValidVisibleWorkspacePath("/workspace/chats/chat-1/report.pdf"), false);
    assert.equal(
      isValidVisibleWorkspacePath("/workspace/projects/source/output/report.pdf"),
      false
    );
  });

  test("validates and sanitizes path segments deterministically", () => {
    assert.equal(isValidWorkspacePathSegment("assistant-1"), true);
    assert.equal(isValidWorkspacePathSegment("session_1"), true);
    assert.equal(isValidWorkspacePathSegment("bad/name"), false);
    assert.equal(isValidWorkspacePathSegment(".."), false);
    assert.equal(sanitizeWorkspacePathSegment("Résumé 2026/07"), "Resume-2026-07");
  });

  test("rejects unsafe builder segments", () => {
    assert.throws(() => buildAssistantWorkspaceRoot("bad/name"), /assistantStableKey/);
    assert.throws(() => buildAssistantSessionRoot("assistant-1", "../session"), /sessionId/);
  });
});
