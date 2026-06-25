export function createFakeSandboxClientForOutboundWrite(
  workspaceRelPath = "/workspace/outbound/self/test-artefact.bin"
): {
  writeWorkspaceOutbound(input: {
    contentBase64: string;
    workspaceQuotaBytes?: number | null;
    sharedQuotaBytes?: number | null;
  }): Promise<{
    workspaceRelPath: string;
    sizeBytes: number;
  }>;
} {
  return {
    async writeWorkspaceOutbound(input: {
      contentBase64: string;
      workspaceQuotaBytes?: number | null;
      sharedQuotaBytes?: number | null;
    }) {
      return {
        workspaceRelPath,
        sizeBytes: Buffer.from(input.contentBase64, "base64").length
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
