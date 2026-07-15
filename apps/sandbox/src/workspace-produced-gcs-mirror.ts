import type { RuntimeSandboxProducedFile } from "@persai/runtime-contract";
import { isSessionInstallLayerPath } from "@persai/runtime-contract";

export type WorkspaceProducedGcsMirrorStorage = {
  buildWorkspaceObjectKey(input: { workspaceId: string; workspaceRelPath: string }): string;
  saveObject(input: { objectKey: string; buffer: Buffer; mimeType: string }): Promise<unknown>;
};

/**
 * ADR-137 — mirror shell/exec produced `/workspace/...` bytes to the workspace GCS
 * prefix so runtime manifest upsert + files.attach can resolve committed bytes.
 * ADR-150 — never mirror session install-layer paths.
 */
export async function mirrorVisibleWorkspaceProducedFilesToGcs(input: {
  workspaceId: string;
  workspaceRoot: string;
  workspaceMountRoot: string;
  producedFiles: readonly RuntimeSandboxProducedFile[];
  resolveLocalAbsolutePath: (workspaceRoot: string, visiblePath: string) => string;
  objectStorage: WorkspaceProducedGcsMirrorStorage;
  readFile: (absolutePath: string) => Promise<Buffer>;
}): Promise<void> {
  for (const file of input.producedFiles) {
    const visiblePath = file.storagePath;
    if (
      visiblePath.length === 0 ||
      (!visiblePath.startsWith(`${input.workspaceMountRoot}/`) &&
        visiblePath !== input.workspaceMountRoot)
    ) {
      continue;
    }
    if (isSessionInstallLayerPath(visiblePath)) {
      continue;
    }
    const localAbsolute = input.resolveLocalAbsolutePath(input.workspaceRoot, visiblePath);
    let buffer: Buffer;
    try {
      buffer = await input.readFile(localAbsolute);
    } catch (error) {
      throw new Error(
        `shell_produced_gcs_mirror_read_failed path=${visiblePath} reason=${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (buffer.length === 0) {
      continue;
    }
    try {
      await input.objectStorage.saveObject({
        objectKey: input.objectStorage.buildWorkspaceObjectKey({
          workspaceId: input.workspaceId,
          workspaceRelPath: visiblePath
        }),
        buffer,
        mimeType: file.mimeType
      });
    } catch (error) {
      throw new Error(
        `shell_produced_gcs_mirror_failed path=${visiblePath} reason=${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
