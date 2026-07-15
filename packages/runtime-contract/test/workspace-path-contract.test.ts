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
  isSessionInstallLayerPath,
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
      assistantId: null,
      sessionId: null
    });
    assert.deepEqual(classifyVisibleWorkspacePath("/workspace/assistants/a"), {
      kind: "assistantRoot",
      normalizedPath: "/workspace/assistants/a",
      assistantId: "a",
      sessionId: null
    });
    assert.deepEqual(classifyVisibleWorkspacePath("/workspace/assistants/a/sessions"), {
      kind: "assistantSessionsRoot",
      normalizedPath: "/workspace/assistants/a/sessions",
      assistantId: "a",
      sessionId: null
    });
    assert.deepEqual(classifyVisibleWorkspacePath("/workspace/assistants/a/sessions/s"), {
      kind: "sessionRoot",
      normalizedPath: "/workspace/assistants/a/sessions/s",
      assistantId: "a",
      sessionId: "s"
    });
    assert.deepEqual(
      classifyVisibleWorkspacePath("/workspace/assistants/a/sessions/s/report.pdf"),
      {
        kind: "sessionDescendant",
        normalizedPath: "/workspace/assistants/a/sessions/s/report.pdf",
        assistantId: "a",
        sessionId: "s"
      }
    );
    assert.deepEqual(classifyVisibleWorkspacePath("/workspace/assistants/a/shared"), {
      kind: "assistantSharedRoot",
      normalizedPath: "/workspace/assistants/a/shared",
      assistantId: "a",
      sessionId: null
    });
    assert.deepEqual(classifyVisibleWorkspacePath("/workspace/shared"), {
      kind: "workspaceSharedRoot",
      normalizedPath: "/workspace/shared",
      assistantId: null,
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
    const staleChatPath = ["/workspace", "chats", "chat-1", "report.pdf"].join("/");
    const staleProjectPath = ["/workspace", "projects", "source", "output", "report.pdf"].join("/");

    assert.deepEqual(classifyVisibleWorkspacePath("/workspace/report.pdf"), {
      kind: "rootFlatFile",
      normalizedPath: "/workspace/report.pdf",
      assistantId: null,
      sessionId: null
    });
    assert.deepEqual(classifyVisibleWorkspacePath(staleChatPath), {
      kind: "staleChatsPath",
      normalizedPath: staleChatPath,
      assistantId: null,
      sessionId: null
    });
    assert.deepEqual(classifyVisibleWorkspacePath(staleProjectPath), {
      kind: "staleProjectsPath",
      normalizedPath: staleProjectPath,
      assistantId: null,
      sessionId: null
    });

    assert.equal(isRejectedRootFlatWorkspacePath("/workspace/report.pdf"), true);
    assert.equal(isStaleVisibleWorkspacePath(staleChatPath), true);
    assert.equal(isStaleVisibleWorkspacePath(staleProjectPath), true);

    assert.equal(isValidVisibleWorkspacePath("/workspace/report.pdf"), false);
    assert.equal(isValidVisibleWorkspacePath(staleChatPath), false);
    assert.equal(isValidVisibleWorkspacePath(staleProjectPath), false);
  });

  test("validates and sanitizes path segments deterministically", () => {
    assert.equal(isValidWorkspacePathSegment("assistant-1"), true);
    assert.equal(isValidWorkspacePathSegment("session_1"), true);
    assert.equal(isValidWorkspacePathSegment("bad/name"), false);
    assert.equal(isValidWorkspacePathSegment(".."), false);
    assert.equal(sanitizeWorkspacePathSegment("Résumé 2026/07"), "Resume-2026-07");
  });

  test("rejects unsafe builder segments", () => {
    assert.throws(() => buildAssistantWorkspaceRoot("bad/name"), /assistantId/);
    assert.throws(() => buildAssistantSessionRoot("assistant-1", "../session"), /sessionId/);
  });

  test("ADR-150 marks session install-layer paths", () => {
    const sessionRoot = buildAssistantSessionRoot("assistant-1", "session-1");
    assert.equal(
      isSessionInstallLayerPath(`${sessionRoot}/.local/lib/python3.11/site-packages/x.py`),
      true
    );
    assert.equal(
      isSessionInstallLayerPath(`${sessionRoot}/.npm-global/lib/node_modules/foo/index.js`),
      true
    );
    assert.equal(isSessionInstallLayerPath(`${sessionRoot}/node_modules/left-pad/index.js`), true);
    assert.equal(isSessionInstallLayerPath(`${sessionRoot}/pkg/node_modules/dep/index.js`), true);
    assert.equal(isSessionInstallLayerPath(`${sessionRoot}/pkg/node_modules`), true);
    assert.equal(isSessionInstallLayerPath(`${sessionRoot}/report.pdf`), false);
    assert.equal(isSessionInstallLayerPath(`${sessionRoot}/scripts/run.py`), false);
    assert.equal(
      isSessionInstallLayerPath("/workspace/assistants/assistant-1/shared/node_modules/x"),
      false
    );
  });
});
