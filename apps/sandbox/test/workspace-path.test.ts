import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertAllowedMountPrefix,
  buildWorkspaceRoot,
  normalizeAndClampPath,
  normalizePosixPath,
  WorkspacePathError
} from "../src/workspace-path";

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
    "/workspace/assistants/my-bot/sessions/session-1/out.csv"
  );
  assert.equal(absolutePath, "/workspace/assistants/my-bot/sessions/session-1/out.csv");
  assert.equal(relativePath, "assistants/my-bot/sessions/session-1/out.csv");
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

test("assertAllowedMountPrefix: root-level /workspace file path still normalizes as a valid raw mount path", () => {
  const result = assertAllowedMountPrefix("/workspace/x.txt");
  assert.equal(result.absolutePath, "/workspace/x.txt");
  assert.equal(result.relativePath, "x.txt");
});

test("assertAllowedMountPrefix: nested subdirectory under /workspace/ is allowed", () => {
  const result = assertAllowedMountPrefix(
    "/workspace/assistants/my-bot/sessions/session-1/notes/2026/today.md"
  );
  assert.equal(
    result.absolutePath,
    "/workspace/assistants/my-bot/sessions/session-1/notes/2026/today.md"
  );
  assert.equal(result.relativePath, "assistants/my-bot/sessions/session-1/notes/2026/today.md");
});

test("assertAllowedMountPrefix: bare /workspace returns empty relative path", () => {
  const result = assertAllowedMountPrefix("/workspace");
  assert.equal(result.absolutePath, "/workspace");
  assert.equal(result.relativePath, "");
});

test("assertAllowedMountPrefix: retired shared path → throws outside_allowed_mount", () => {
  const retiredPath = "/shared" + "/x.txt";
  assert.throws(
    () => assertAllowedMountPrefix(retiredPath),
    (e: unknown) => e instanceof WorkspacePathError && e.code === "outside_allowed_mount"
  );
});

test("assertAllowedMountPrefix: /tmp paths are rejected (use exec/shell for ephemeral state)", () => {
  assert.throws(
    () => assertAllowedMountPrefix("/tmp/notes.md"),
    (e: unknown) => e instanceof WorkspacePathError && e.code === "outside_allowed_mount"
  );
});

test("assertAllowedMountPrefix: /etc/passwd → throws outside_allowed_mount", () => {
  assert.throws(
    () => assertAllowedMountPrefix("/etc/passwd"),
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
