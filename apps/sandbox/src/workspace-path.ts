/**
 * ADR-128 Slice 1 — pod-side path containment.
 *
 * Every model-supplied path in the unified files contract is checked here
 * before it ever reaches the pod. The two helpers are intentionally narrow:
 *
 *   * {@link normalizeAndClampPath}: takes a model-supplied path and a
 *     declared mount root, returns the absolute pod path iff the supplied
 *     path resolves strictly inside the mount root.
 *   * {@link assertAllowedMountPrefix}: validates that a model-supplied path
 *     (already normalized) starts with one of the allow-listed mount-root
 *     prefixes for the (assistantId, workspaceId) pair. This is the only
 *     place that knows the canonical roots the model can touch.
 *
 * The helpers are POSIX-only by construction — they manipulate the
 * forward-slash pod namespace, not the host filesystem. Any backslash in the
 * input is normalised to `/` so Windows-typed paths from the model still
 * resolve correctly.
 *
 * The pod-side directory layout is now a single namespace:
 *
 *   /workspace/                       — single writable user mount
 *     /workspace/input/               — uploaded attachments (RO)
 *     /workspace/outbound/<handle>/   — this assistant's outbound (RW)
 *     /workspace/outbound/<other>/    — sibling outbound (R-X)
 *     /workspace/outbound/self        — symlink → outbound/<handle>
 *     /workspace/<free area>          — assistant scratch
 */

const POSIX_SEPARATOR = "/";
const PARENT_SEGMENT = "..";
const CURRENT_SEGMENT = ".";

export type WorkspaceMountRoots = {
  /** `/workspace` — the single writable user mount in the pod. */
  workspaceRoot: string;
};

export type WorkspaceMountRole =
  | { kind: "workspace_input" }
  | {
      kind: "workspace_outbound_self";
      handle: string;
    }
  | {
      kind: "workspace_outbound_other";
      handle: string;
    }
  | { kind: "workspace_scratch" };

export type ResolvedWorkspacePath = {
  /** Absolute POSIX path inside the pod. */
  absolutePath: string;
  /** Mount-relative path (e.g. `chats/<id>/file.txt` for /workspace). */
  relativePath: string;
  role: WorkspaceMountRole;
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
        // `..` above the root is a hard reject — it can never resolve to a
        // legal pod path even after clamping.
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
 * Validate that `input` lives inside one of the legal mount roots for this
 * assistant/workspace and classify which role it falls under (so callers
 * can apply role-specific behaviour, e.g. RO input, RW self-outbound,
 * read-execute sibling outbound, /workspace scratch).
 */
export function assertAllowedMountPrefix(
  input: string,
  context: {
    roots: WorkspaceMountRoots;
    assistantHandle: string;
    siblingHandles: ReadonlySet<string>;
  }
): ResolvedWorkspacePath {
  const workspaceRoot = normalizePosixPath(context.roots.workspaceRoot);
  const normalizedInput = normalizePosixPath(input);

  if (
    normalizedInput !== workspaceRoot &&
    !normalizedInput.startsWith(`${workspaceRoot}${POSIX_SEPARATOR}`)
  ) {
    throw new WorkspacePathError(
      "outside_allowed_mount",
      `Path "${input}" is not inside the allowed /workspace mount.`
    );
  }

  const { relativePath } = normalizeAndClampPath(workspaceRoot, normalizedInput);

  const inputRoot = `${workspaceRoot}/input`;
  if (
    normalizedInput === inputRoot ||
    normalizedInput.startsWith(`${inputRoot}${POSIX_SEPARATOR}`)
  ) {
    return {
      absolutePath: normalizedInput,
      relativePath,
      role: { kind: "workspace_input" }
    };
  }

  const outboundRoot = `${workspaceRoot}/outbound`;
  if (
    normalizedInput === outboundRoot ||
    normalizedInput.startsWith(`${outboundRoot}${POSIX_SEPARATOR}`)
  ) {
    const handlePart = normalizedInput
      .slice(`${outboundRoot}${POSIX_SEPARATOR}`.length)
      .split(POSIX_SEPARATOR)[0];

    if (normalizedInput === outboundRoot) {
      throw new WorkspacePathError(
        "invalid_path",
        `Path "${input}" lives directly under /workspace/outbound which is not addressable.`
      );
    }

    // Special-case the self symlink: `outbound/self` resolves to the
    // assistant's own outbound, so treat it as the self-role.
    if (handlePart === "self") {
      return {
        absolutePath: normalizedInput,
        relativePath,
        role: {
          kind: "workspace_outbound_self",
          handle: context.assistantHandle
        }
      };
    }

    if (handlePart === undefined || handlePart.length === 0) {
      throw new WorkspacePathError(
        "invalid_path",
        `Path "${input}" lives directly under /workspace/outbound which is not addressable.`
      );
    }

    if (handlePart === context.assistantHandle) {
      return {
        absolutePath: normalizedInput,
        relativePath,
        role: { kind: "workspace_outbound_self", handle: handlePart }
      };
    }
    if (context.siblingHandles.has(handlePart)) {
      return {
        absolutePath: normalizedInput,
        relativePath,
        role: { kind: "workspace_outbound_other", handle: handlePart }
      };
    }
    throw new WorkspacePathError(
      "outside_allowed_mount",
      `Path "${input}" references unknown assistant handle "${handlePart}".`
    );
  }

  return {
    absolutePath: normalizedInput,
    relativePath,
    role: { kind: "workspace_scratch" }
  };
}

/** Build the canonical `/workspace` mount root for an assistant. */
export function buildWorkspaceRoot(): string {
  return "/workspace";
}
