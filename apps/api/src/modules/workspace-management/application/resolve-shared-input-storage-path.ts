import type { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";

export function sanitizeSharedFilename(filename: string): string {
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

export function buildSharedInputStoragePath(
  filename: string | null,
  mimeType: string,
  referenceId: string
): string {
  const basename = sanitizeSharedFilename(
    filename ?? deriveFilenameFromMime(referenceId, mimeType)
  );
  return `/shared/input/${basename}`;
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

/** ADR-126 v3 — macOS-style collision suffix for `/shared/input/` uploads. */
export async function resolveUniqueSharedInputStoragePath(input: {
  workspaceId: string;
  filename: string | null;
  mimeType: string;
  referenceId: string;
  workspaceFileMetadataService: WorkspaceFileMetadataService;
}): Promise<string> {
  const preferredBasename = sanitizeSharedFilename(
    input.filename ?? deriveFilenameFromMime(input.referenceId, input.mimeType)
  );
  let candidate = `/shared/input/${preferredBasename}`;
  let suffix = 2;
  while (
    await input.workspaceFileMetadataService.get({
      workspaceId: input.workspaceId,
      path: candidate
    })
  ) {
    candidate = `/shared/input/${applyNumericSuffix(preferredBasename, suffix)}`;
    suffix += 1;
  }
  return candidate;
}
