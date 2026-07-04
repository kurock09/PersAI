import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, join } from "node:path";
import type { RuntimeSandboxProducedFile } from "@persai/runtime-contract";

export type WorkspaceDocumentOutputSnapshot = {
  sizeBytes: number;
  contentHash: string;
};

export function isWorkspaceDocumentOutputChanged(input: {
  before: WorkspaceDocumentOutputSnapshot | undefined;
  after: WorkspaceDocumentOutputSnapshot;
}): boolean {
  if (input.before === undefined) {
    return true;
  }
  return (
    input.before.sizeBytes !== input.after.sizeBytes ||
    input.before.contentHash !== input.after.contentHash
  );
}

export function buildShellProducedFilesFromDocumentDiff(input: {
  workspaceMountRoot: string;
  before: Map<string, WorkspaceDocumentOutputSnapshot>;
  after: Map<string, WorkspaceDocumentOutputSnapshot>;
  inferMimeType: (workspacePath: string) => string;
}): RuntimeSandboxProducedFile[] {
  const producedFiles: RuntimeSandboxProducedFile[] = [];
  for (const [workspacePath, afterSnapshot] of input.after.entries()) {
    if (
      !isWorkspaceDocumentOutputChanged({
        before: input.before.get(workspacePath),
        after: afterSnapshot
      })
    ) {
      continue;
    }
    const mountRelative =
      workspacePath === input.workspaceMountRoot
        ? ""
        : workspacePath.slice(input.workspaceMountRoot.length + 1);
    producedFiles.push({
      relativePath: mountRelative,
      displayName: basename(workspacePath),
      mimeType: input.inferMimeType(workspacePath),
      sizeBytes: afterSnapshot.sizeBytes,
      logicalSizeBytes: afterSnapshot.sizeBytes,
      storagePath: workspacePath,
      contentHash: afterSnapshot.contentHash
    });
  }
  return producedFiles;
}

export async function collectWorkspaceDocumentOutputSnapshots(input: {
  workspaceRoot: string;
  scanRoot: string;
  workspaceMountRoot: string;
  isVisibleDocumentPath: (workspacePath: string) => boolean;
  toVisibleWorkspaceAbsolutePath: (workspaceRoot: string, absolutePath: string) => string;
}): Promise<Map<string, WorkspaceDocumentOutputSnapshot>> {
  const snapshots = new Map<string, WorkspaceDocumentOutputSnapshot>();
  const visit = async (currentDir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolutePath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      const workspacePath = input.toVisibleWorkspaceAbsolutePath(input.workspaceRoot, absolutePath);
      if (!input.isVisibleDocumentPath(workspacePath)) {
        continue;
      }
      const bytes = await fs.readFile(absolutePath);
      snapshots.set(workspacePath, {
        sizeBytes: bytes.byteLength,
        contentHash: createHash("sha256").update(bytes).digest("hex")
      });
    }
  };
  await visit(input.scanRoot);
  return snapshots;
}
