/**
 * ADR-128 Slice 4 — pod-side path containment for the single `/workspace`
 * namespace.
 *
 * Every model-supplied path in the unified files contract is validated here
 * before it reaches the pod. The helpers are intentionally narrow:
 *
 *   * {@link normalizeAndClampPath}: takes a model-supplied path and a
 *     declared mount root, returns the absolute pod path iff the supplied
 *     path resolves strictly inside the mount root.
 *   * {@link assertAllowedMountPrefix}: validates that a model-supplied path
 *     lives inside `/workspace` (or is the root itself). There are no roles,
 *     no input/outbound subdirs, no handle classification — the workspace is
 *     flat by design.
 *
 * The helpers are POSIX-only by construction — they manipulate the
 * forward-slash pod namespace, not the host filesystem. Any backslash in the
 * input is normalised to `/` so Windows-typed paths from the model still
 * resolve correctly.
 */

const POSIX_SEPARATOR = "/";
const PARENT_SEGMENT = "..";
const CURRENT_SEGMENT = ".";

export const WORKSPACE_MOUNT_ROOT = "/workspace";

export type ResolvedWorkspacePath = {
  /** Absolute POSIX path inside the pod. */
  absolutePath: string;
  /** Mount-relative path (e.g. `notes.md` for `/workspace/notes.md`). */
  relativePath: string;
};

export class WorkspacePathError extends Error {
  readonly code:
    | "invalid_path"
    | "absolute_path_required"
    | "outside_allowed_mount"
    | "outside_mount_root";

  constructor(
    code:
      | "invalid_path"
      | "absolute_path_required"
      | "outside_allowed_mount"
      | "outside_mount_root",
    message: string
  ) {
    super(message);
    this.name = "WorkspacePathError";
    this.code = code;
  }
}

/**
 * Pure POSIX path normalisation: collapses `.` segments, resolves `..` to
 * the parent (without escaping above the root), and strips repeated `/`. The
 * caller passes a known-good leading slash; the returned string keeps it.
 */
export function normalizePosixPath(input: string): string {
  const cleaned = input.replace(/\\+/g, POSIX_SEPARATOR);
  if (!cleaned.startsWith(POSIX_SEPARATOR)) {
    throw new WorkspacePathError(
      "absolute_path_required",
      `Path must be absolute (start with '/'): got "${input}"`
    );
  }
  const segments = cleaned.split(POSIX_SEPARATOR);
  const out: string[] = [];
  for (const segment of segments) {
    if (segment.length === 0 || segment === CURRENT_SEGMENT) {
      continue;
    }
    if (segment === PARENT_SEGMENT) {
      if (out.length === 0) {
        throw new WorkspacePathError("invalid_path", `Path escapes filesystem root: ${input}`);
      }
      out.pop();
      continue;
    }
    if (segment.includes("\0")) {
      throw new WorkspacePathError("invalid_path", "Path contains NUL byte.");
    }
    out.push(segment);
  }
  return `${POSIX_SEPARATOR}${out.join(POSIX_SEPARATOR)}`;
}

/**
 * Normalise `input` and confirm the result is rooted at `mountRoot` (or
 * equals it). The returned absolute path is suitable for direct use in pod
 * shell commands; the relative form is convenient for audit/log lines and
 * `workspace_file_metadata.path`.
 */
export function normalizeAndClampPath(
  mountRoot: string,
  input: string
): { absolutePath: string; relativePath: string } {
  const normalizedRoot = normalizePosixPath(mountRoot);
  const normalizedInput = normalizePosixPath(input);
  if (normalizedInput === normalizedRoot) {
    return { absolutePath: normalizedRoot, relativePath: "" };
  }
  const rootPrefix = normalizedRoot.endsWith(POSIX_SEPARATOR)
    ? normalizedRoot
    : `${normalizedRoot}${POSIX_SEPARATOR}`;
  if (!normalizedInput.startsWith(rootPrefix)) {
    throw new WorkspacePathError(
      "outside_mount_root",
      `Path "${input}" escapes mount root "${mountRoot}"`
    );
  }
  return {
    absolutePath: normalizedInput,
    relativePath: normalizedInput.slice(rootPrefix.length)
  };
}

/**
 * Validate that `input` lives inside the single `/workspace` mount root.
 * Throws {@link WorkspacePathError} with code `outside_allowed_mount` when
 * the input resolves anywhere else (including `/tmp/` and `/`).
 */
export function assertAllowedMountPrefix(input: string): ResolvedWorkspacePath {
  const normalizedInput = normalizePosixPath(input);
  if (
    normalizedInput !== WORKSPACE_MOUNT_ROOT &&
    !normalizedInput.startsWith(`${WORKSPACE_MOUNT_ROOT}${POSIX_SEPARATOR}`)
  ) {
    throw new WorkspacePathError(
      "outside_allowed_mount",
      `Path "${input}" is not inside the allowed /workspace mount.`
    );
  }
  return normalizeAndClampPath(WORKSPACE_MOUNT_ROOT, normalizedInput);
}

/** The canonical `/workspace` mount root. */
export function buildWorkspaceRoot(): string {
  return WORKSPACE_MOUNT_ROOT;
}
