import type { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";

/**
 * ADR-128 Slice 4 — flat workspace storage paths.
 *
 * Every persisted workspace file (user upload, model artefact, anything
 * else) lives directly under `/workspace/<basename>`. This module sanitises
 * the basename and resolves macOS-style numeric collision suffixes against
 * the canonical `workspace_file_metadata` manifest. There is no role-based
 * subdir carve-out.
 */

export function sanitizeWorkspaceFilename(filename: string): string {
  const trimmed = filename.trim();
  const collapsed = trimmed.replace(/[\\/]+/g, "-");
  return collapsed.length > 0 ? collapsed : "file";
}

export function deriveFilenameFromMime(referenceId: string, mimeType: string): string {
  if (mimeType === "application/pdf") {
    return `${referenceId}.pdf`;
  }
  if (mimeType.startsWith("image/")) {
    const subtype = mimeType.slice("image/".length).replace(/[^a-z0-9]+/gi, "");
    return `${referenceId}.${subtype || "img"}`;
  }
  if (mimeType.startsWith("audio/")) {
    const subtype = mimeType.slice("audio/".length).replace(/[^a-z0-9]+/gi, "");
    return `${referenceId}.${subtype || "audio"}`;
  }
  if (mimeType.startsWith("video/")) {
    const subtype = mimeType.slice("video/".length).replace(/[^a-z0-9]+/gi, "");
    return `${referenceId}.${subtype || "video"}`;
  }
  return `${referenceId}.bin`;
}

/**
 * Build the pod-absolute storage path for a workspace file. After ADR-128
 * Slice 4 this is simply `/workspace/<basename>` — there is no role-based
 * subdirectory carve-out.
 */
export function buildWorkspaceStoragePath(
  filename: string | null,
  mimeType: string,
  referenceId: string
): string {
  const basename = sanitizeWorkspaceFilename(
    filename ?? deriveFilenameFromMime(referenceId, mimeType)
  );
  return `/workspace/${basename}`;
}

function applyNumericSuffix(basename: string, index: number): string {
  const dot = basename.lastIndexOf(".");
  if (dot <= 0) {
    return `${basename} (${index})`;
  }
  const stem = basename.slice(0, dot);
  const ext = basename.slice(dot);
  return `${stem} (${index})${ext}`;
}

/**
 * Resolve a unique flat workspace storage path with macOS-style numeric
 * collision suffix. The manifest is the source of truth for "which basenames
 * already exist under `/workspace/`".
 */
export async function resolveUniqueWorkspaceStoragePath(input: {
  workspaceId: string;
  filename: string | null;
  mimeType: string;
  referenceId: string;
  workspaceFileMetadataService: WorkspaceFileMetadataService;
}): Promise<string> {
  const preferredBasename = sanitizeWorkspaceFilename(
    input.filename ?? deriveFilenameFromMime(input.referenceId, input.mimeType)
  );
  let candidate = `/workspace/${preferredBasename}`;
  let suffix = 2;
  while (
    await input.workspaceFileMetadataService.get({
      workspaceId: input.workspaceId,
      path: candidate
    })
  ) {
    candidate = `/workspace/${applyNumericSuffix(preferredBasename, suffix)}`;
    suffix += 1;
  }
  return candidate;
}
