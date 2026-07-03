import { buildAssistantSessionRoot } from "@persai/runtime-contract";
import type { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";

/**
 * ADR-133 Slice 3 — API-owned uploads and persisted media now default to the
 * current assistant session root.
 *
 * Callers must pass the real runtime session id for the current conversation.
 * `chat.id` is provenance only and must never be used as the session path
 * segment.
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
 * Build the pod-absolute storage path for a workspace file. Under ADR-133 the
 * default visible write root is the current assistant session subtree:
 * `/workspace/assistants/<assistantStableKey>/sessions/<sessionId>/<basename>`.
 */
export function buildWorkspaceStoragePath(
  filename: string | null,
  mimeType: string,
  referenceId: string,
  assistantStableKey: string,
  sessionId: string
): string {
  const basename = sanitizeWorkspaceFilename(
    filename ?? deriveFilenameFromMime(referenceId, mimeType)
  );
  return `${buildAssistantSessionRoot(assistantStableKey, sessionId)}/${basename}`;
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
 * Resolve a unique session-root workspace storage path with macOS-style
 * numeric collision suffix. The manifest is the source of truth for "which
 * basenames already exist under the current assistant session root".
 */
export async function resolveUniqueWorkspaceStoragePath(input: {
  workspaceId: string;
  assistantStableKey: string;
  sessionId: string;
  filename: string | null;
  mimeType: string;
  referenceId: string;
  workspaceFileMetadataService: WorkspaceFileMetadataService;
}): Promise<string> {
  const preferredBasename = sanitizeWorkspaceFilename(
    input.filename ?? deriveFilenameFromMime(input.referenceId, input.mimeType)
  );
  const sessionRoot = buildAssistantSessionRoot(input.assistantStableKey, input.sessionId);
  let candidate = `${sessionRoot}/${preferredBasename}`;
  let suffix = 2;
  while (
    await input.workspaceFileMetadataService.get({
      workspaceId: input.workspaceId,
      path: candidate
    })
  ) {
    candidate = `${sessionRoot}/${applyNumericSuffix(preferredBasename, suffix)}`;
    suffix += 1;
  }
  return candidate;
}
