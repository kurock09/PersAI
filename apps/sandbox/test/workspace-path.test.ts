import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertAllowedMountPrefix,
  buildWorkspaceRoot,
  normalizeAndClampPath,
  normalizePosixPath,
  WorkspacePathError
} from "../src/workspace-path";

const SELF_HANDLE = "bob";
const OTHER_HANDLE = "alice";

function makeCtx(opts?: { siblingHandles?: ReadonlySet<string> }) {
  return {
    roots: {
      workspaceRoot: buildWorkspaceRoot()
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

test("assertAllowedMountPrefix: /workspace/input/x.txt → workspace_input", () => {
  const result = assertAllowedMountPrefix("/workspace/input/x.txt", makeCtx());
  assert.equal(result.role.kind, "workspace_input");
  assert.equal(result.absolutePath, "/workspace/input/x.txt");
  assert.equal(result.relativePath, "input/x.txt");
});

test("assertAllowedMountPrefix: /workspace/outbound/self/y.txt → workspace_outbound_self", () => {
  const result = assertAllowedMountPrefix("/workspace/outbound/self/y.txt", makeCtx());
  assert.equal(result.role.kind, "workspace_outbound_self");
  if (result.role.kind === "workspace_outbound_self") {
    assert.equal(result.role.handle, SELF_HANDLE);
  }
});

test("assertAllowedMountPrefix: /workspace/outbound/alice/z.txt → workspace_outbound_other", () => {
  const ctx = makeCtx({ siblingHandles: new Set([OTHER_HANDLE]) });
  const result = assertAllowedMountPrefix("/workspace/outbound/alice/z.txt", ctx);
  assert.equal(result.role.kind, "workspace_outbound_other");
  if (result.role.kind === "workspace_outbound_other") {
    assert.equal(result.role.handle, OTHER_HANDLE);
  }
});

test("assertAllowedMountPrefix: /workspace/scratch/notes.md → workspace_scratch", () => {
  const result = assertAllowedMountPrefix("/workspace/scratch/notes.md", makeCtx());
  assert.equal(result.role.kind, "workspace_scratch");
  assert.equal(result.relativePath, "scratch/notes.md");
});

test("assertAllowedMountPrefix: /workspace/outbound directly → invalid_path", () => {
  assert.throws(
    () => assertAllowedMountPrefix("/workspace/outbound", makeCtx()),
    (e: unknown) => e instanceof WorkspacePathError && e.code === "invalid_path"
  );
});

test("assertAllowedMountPrefix: /workspace/outbound/unknown/x.txt → outside_allowed_mount", () => {
  assert.throws(
    () => assertAllowedMountPrefix("/workspace/outbound/unknown/x.txt", makeCtx()),
    (e: unknown) => e instanceof WorkspacePathError && e.code === "outside_allowed_mount"
  );
});

test("assertAllowedMountPrefix: retired shared path → throws outside_allowed_mount", () => {
  const retiredPath = "/shared" + "/input/x.txt";
  assert.throws(
    () => assertAllowedMountPrefix(retiredPath, makeCtx()),
    (e: unknown) => e instanceof WorkspacePathError && e.code === "outside_allowed_mount"
  );
});

test("assertAllowedMountPrefix: /etc/passwd → throws outside_allowed_mount", () => {
  assert.throws(
    () => assertAllowedMountPrefix("/etc/passwd", makeCtx()),
    (e: unknown) => e instanceof WorkspacePathError && e.code === "outside_allowed_mount"
  );
});

// ─── builder helpers ──────────────────────────────────────────────────────────

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
