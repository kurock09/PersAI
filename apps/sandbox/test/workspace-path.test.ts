import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertAllowedMountPrefix,
  buildSharedRoot,
  buildWorkspaceRoot,
  normalizeAndClampPath,
  normalizePosixPath,
  WorkspacePathError
} from "../src/workspace-path";

const WS_ID = "11111111-1111-4111-a111-111111111111";
const SELF_HANDLE = "my-bot";
const OTHER_HANDLE = "sibling-bot";

function makeCtx(opts?: { siblingHandles?: ReadonlySet<string> }) {
  return {
    roots: {
      workspaceRoot: buildWorkspaceRoot(),
      sharedRoot: buildSharedRoot(WS_ID)
    },
    assistantHandle: SELF_HANDLE,
    siblingHandles: opts?.siblingHandles ?? new Set<string>()
  };
}

// ─── normalizePosixPath ───────────────────────────────────────────────────────

test("normalizePosixPath: preserves canonical absolute path", () => {
  assert.equal(normalizePosixPath("/workspace/foo"), "/workspace/foo");
});

test("normalizePosixPath: collapses repeated slashes", () => {
  assert.equal(normalizePosixPath("//workspace//foo"), "/workspace/foo");
});

test("normalizePosixPath: collapses current-dir segments", () => {
  assert.equal(normalizePosixPath("/workspace/./foo"), "/workspace/foo");
});

test("normalizePosixPath: converts backslashes to forward slashes", () => {
  assert.equal(normalizePosixPath("\\workspace\\foo"), "/workspace/foo");
});

test("normalizePosixPath: rejects null byte in segment", () => {
  assert.throws(
    () => normalizePosixPath("/workspace/foo\0bar"),
    (e: unknown) => e instanceof WorkspacePathError && e.code === "invalid_path"
  );
});

test("normalizePosixPath: rejects .. above filesystem root", () => {
  assert.throws(
    () => normalizePosixPath("/../etc/passwd"),
    (e: unknown) => e instanceof WorkspacePathError && e.code === "invalid_path"
  );
});

test("normalizePosixPath: resolves .. within path without escaping root", () => {
  assert.equal(normalizePosixPath("/workspace/foo/../bar"), "/workspace/bar");
});

test("normalizePosixPath: rejects relative path without leading slash", () => {
  assert.throws(
    () => normalizePosixPath("workspace/foo"),
    (e: unknown) => e instanceof WorkspacePathError && e.code === "absolute_path_required"
  );
});

// ─── normalizeAndClampPath ────────────────────────────────────────────────────

test("normalizeAndClampPath: allows file inside mount root", () => {
  const { absolutePath, relativePath } = normalizeAndClampPath("/workspace", "/workspace/foo.txt");
  assert.equal(absolutePath, "/workspace/foo.txt");
  assert.equal(relativePath, "foo.txt");
});

test("normalizeAndClampPath: exact match of mount root returns empty relativePath", () => {
  const { absolutePath, relativePath } = normalizeAndClampPath("/workspace", "/workspace");
  assert.equal(absolutePath, "/workspace");
  assert.equal(relativePath, "");
});

test("normalizeAndClampPath: nested subdirectory resolves correctly", () => {
  const { absolutePath, relativePath } = normalizeAndClampPath(
    "/workspace",
    "/workspace/chats/c1/out.csv"
  );
  assert.equal(absolutePath, "/workspace/chats/c1/out.csv");
  assert.equal(relativePath, "chats/c1/out.csv");
});

test("normalizeAndClampPath: throws outside_mount_root when path escapes", () => {
  assert.throws(
    () => normalizeAndClampPath("/workspace", "/etc/passwd"),
    (e: unknown) => e instanceof WorkspacePathError && e.code === "outside_mount_root"
  );
});

test("normalizeAndClampPath: .. traversal that would escape root is rejected via normalizePosixPath", () => {
  assert.throws(
    () => normalizeAndClampPath("/workspace", "/workspace/../etc/passwd"),
    (e: unknown) => e instanceof WorkspacePathError && e.code === "outside_mount_root"
  );
});

// ─── assertAllowedMountPrefix ─────────────────────────────────────────────────

test("assertAllowedMountPrefix: /workspace/... → kind=workspace", () => {
  const result = assertAllowedMountPrefix("/workspace/chats/c1/out.txt", makeCtx());
  assert.equal(result.role.kind, "workspace");
  assert.equal(result.absolutePath, "/workspace/chats/c1/out.txt");
  assert.equal(result.relativePath, "chats/c1/out.txt");
});

test("assertAllowedMountPrefix: /shared/<wsid>/input/... → kind=shared_input", () => {
  const result = assertAllowedMountPrefix(`/shared/${WS_ID}/input/data.csv`, makeCtx());
  assert.equal(result.role.kind, "shared_input");
  assert.equal(result.relativePath, "data.csv");
});

test("assertAllowedMountPrefix: /shared/<wsid>/outbound/<self-handle>/... → kind=shared_outbound_self", () => {
  const result = assertAllowedMountPrefix(
    `/shared/${WS_ID}/outbound/${SELF_HANDLE}/out.png`,
    makeCtx()
  );
  assert.equal(result.role.kind, "shared_outbound_self");
  if (result.role.kind === "shared_outbound_self") {
    assert.equal(result.role.handle, SELF_HANDLE);
  }
});

test("assertAllowedMountPrefix: /shared/<wsid>/outbound/<sibling>/... → kind=shared_outbound_other", () => {
  const ctx = makeCtx({ siblingHandles: new Set([OTHER_HANDLE]) });
  const result = assertAllowedMountPrefix(
    `/shared/${WS_ID}/outbound/${OTHER_HANDLE}/file.csv`,
    ctx
  );
  assert.equal(result.role.kind, "shared_outbound_other");
  if (result.role.kind === "shared_outbound_other") {
    assert.equal(result.role.handle, OTHER_HANDLE);
  }
});

test("assertAllowedMountPrefix: /shared/<wsid>/outbound/<unknown> → throws outside_allowed_mount", () => {
  assert.throws(
    () => assertAllowedMountPrefix(`/shared/${WS_ID}/outbound/ghost-bot/x.txt`, makeCtx()),
    (e: unknown) => e instanceof WorkspacePathError && e.code === "outside_allowed_mount"
  );
});

test("assertAllowedMountPrefix: /shared/<wsid>/outbound/self → kind=shared_outbound_self (symlink target)", () => {
  const result = assertAllowedMountPrefix(`/shared/${WS_ID}/outbound/self`, makeCtx());
  assert.equal(result.role.kind, "shared_outbound_self");
});

test("assertAllowedMountPrefix: /shared/<wsid>/outbound/self/file → kind=shared_outbound_self", () => {
  const result = assertAllowedMountPrefix(`/shared/${WS_ID}/outbound/self/report.pdf`, makeCtx());
  assert.equal(result.role.kind, "shared_outbound_self");
  if (result.role.kind === "shared_outbound_self") {
    assert.equal(result.role.handle, SELF_HANDLE);
  }
});

test("assertAllowedMountPrefix: /etc/passwd → throws outside_allowed_mount", () => {
  assert.throws(
    () => assertAllowedMountPrefix("/etc/passwd", makeCtx()),
    (e: unknown) => e instanceof WorkspacePathError && e.code === "outside_allowed_mount"
  );
});

// ─── builder helpers ──────────────────────────────────────────────────────────

test("buildSharedRoot returns canonical /shared/<workspaceId>", () => {
  assert.equal(buildSharedRoot(WS_ID), `/shared/${WS_ID}`);
});

test("buildWorkspaceRoot returns /workspace", () => {
  assert.equal(buildWorkspaceRoot(), "/workspace");
});

// ─── WorkspacePathError ───────────────────────────────────────────────────────

test("WorkspacePathError carries typed code field and is instanceof Error", () => {
  const err = new WorkspacePathError("invalid_path", "test message");
  assert.equal(err.code, "invalid_path");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof WorkspacePathError);
  assert.equal(err.name, "WorkspacePathError");
});
