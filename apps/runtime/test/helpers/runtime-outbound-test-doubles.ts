export function createOutboundManifestApiStub(): {
  sumWorkspaceFileStorageBytes(): Promise<number>;
  upsertWorkspaceFileMetadata(): Promise<{ documentRegistration: null }>;
} {
  return {
    async sumWorkspaceFileStorageBytes() {
      return 0;
    },
    async upsertWorkspaceFileMetadata() {
      return { documentRegistration: null };
    }
  };
}

export function createFakeMediaObjectStorageForOutboundWrite(
  workspaceRelPath = "/workspace/assistants/assistant-handle/sessions/session-id/test-artefact.bin"
): {
  buildWorkspaceObjectKey(input: { workspaceId: string; workspaceRelPath: string }): string;
  saveObject(input: { objectKey: string; buffer: Buffer; mimeType: string }): Promise<{
    objectKey: string;
    sizeBytes: number;
    mimeType: string;
  }>;
} {
  return {
    buildWorkspaceObjectKey(input) {
      return `fake-prefix/workspaces/${input.workspaceId}/workspace/${input.workspaceRelPath.replace(/^\/workspace\//, "")}`;
    },
    async saveObject(input) {
      return {
        objectKey: input.objectKey,
        sizeBytes: input.buffer.length,
        mimeType: input.mimeType
      };
    }
  };
}

export function createFakeMediaObjectStorageForRead(
  buffer: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])
): {
  downloadByWorkspacePath(): Promise<Buffer>;
  downloadObject(): Promise<Buffer>;
} {
  return {
    async downloadByWorkspacePath() {
      return buffer;
    },
    async downloadObject() {
      return buffer;
    }
  };
}
