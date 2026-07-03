import { randomUUID } from "node:crypto";
import type { RuntimeOutputArtifact } from "@persai/runtime-contract";
import { buildOutboundBasename, extensionFromFilenameOrMime } from "./build-outbound-basename";
import type { SandboxClientService } from "./sandbox-client.service";

export async function writeRuntimeOutboundArtifact(input: {
  sandboxClient: SandboxClientService;
  assistantId: string;
  workspaceId: string;
  handle: string;
  siblingHandles: readonly string[];
  sessionId: string;
  buffer: Buffer;
  mimeType: string;
  slugSourceText: string;
  filenameHint: string | null;
  kind: RuntimeOutputArtifact["kind"];
  sourceToolCode: NonNullable<RuntimeOutputArtifact["sourceToolCode"]>;
  billingFacts?: RuntimeOutputArtifact["billingFacts"];
  voiceNote?: boolean;
  caption?: string | null;
  downloadUrl?: string | null;
  workspaceQuotaBytes?: number | null;
  sharedQuotaBytes?: number | null;
}): Promise<RuntimeOutputArtifact> {
  const extension = extensionFromFilenameOrMime(input.filenameHint, input.mimeType);
  const basename = buildOutboundBasename({
    slugSourceText: input.slugSourceText,
    extension
  });
  const writeResult = await input.sandboxClient.writeWorkspaceFile({
    assistantId: input.assistantId,
    workspaceId: input.workspaceId,
    handle: input.handle,
    siblingHandles: input.siblingHandles,
    runtimeSessionId: input.sessionId,
    basename,
    contentBase64: input.buffer.toString("base64"),
    mimeType: input.mimeType,
    collisionStrategy: "numeric_suffix",
    ...(input.workspaceQuotaBytes !== undefined
      ? { workspaceQuotaBytes: input.workspaceQuotaBytes }
      : {}),
    ...(input.sharedQuotaBytes !== undefined ? { sharedQuotaBytes: input.sharedQuotaBytes } : {})
  });

  return {
    artifactId: randomUUID(),
    storagePath: writeResult.workspaceRelPath,
    kind: input.kind,
    sourceToolCode: input.sourceToolCode,
    mimeType: input.mimeType,
    filename: input.filenameHint,
    sizeBytes: writeResult.sizeBytes,
    voiceNote: input.voiceNote ?? false,
    ...(input.caption !== undefined ? { caption: input.caption } : {}),
    ...(input.downloadUrl ? { downloadUrl: input.downloadUrl } : {}),
    ...(input.billingFacts !== undefined ? { billingFacts: input.billingFacts } : {})
  };
}
