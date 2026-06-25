import type { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";

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

export function buildWorkspaceInputStoragePath(
  filename: string | null,
  mimeType: string,
  referenceId: string
): string {
  const basename = sanitizeWorkspaceFilename(
    filename ?? deriveFilenameFromMime(referenceId, mimeType)
  );
  return `/workspace/input/${basename}`;
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

/** ADR-128 Slice 2 — macOS-style collision suffix for `/workspace/input/` uploads. */
export async function resolveUniqueWorkspaceInputStoragePath(input: {
  workspaceId: string;
  filename: string | null;
  mimeType: string;
  referenceId: string;
  workspaceFileMetadataService: WorkspaceFileMetadataService;
}): Promise<string> {
  const preferredBasename = sanitizeWorkspaceFilename(
    input.filename ?? deriveFilenameFromMime(input.referenceId, input.mimeType)
  );
  let candidate = `/workspace/input/${preferredBasename}`;
  let suffix = 2;
  while (
    await input.workspaceFileMetadataService.get({
      workspaceId: input.workspaceId,
      path: candidate
    })
  ) {
    candidate = `/workspace/input/${applyNumericSuffix(preferredBasename, suffix)}`;
    suffix += 1;
  }
  return candidate;
}
