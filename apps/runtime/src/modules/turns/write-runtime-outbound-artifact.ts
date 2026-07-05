import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "@nestjs/common";
import type { RuntimeOutputArtifact } from "@persai/runtime-contract";
import { buildAssistantSessionRoot } from "@persai/runtime-contract";
import { buildOutboundBasename, extensionFromFilenameOrMime } from "./build-outbound-basename";
import { buildGeneratedFileSemanticSummary } from "./generated-file-semantic-summary";
import type { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import type { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";

export type RuntimeOutboundManifestContext = {
  persaiInternalApiClient: Pick<
    PersaiInternalApiClientService,
    "upsertWorkspaceFileMetadata" | "sumWorkspaceFileStorageBytes"
  >;
  workspaceId: string;
  assistantId: string;
  originChatId?: string | null;
  sourceUserMessageText?: string | null;
  sourceUserMessageCreatedAt?: string | null;
  replace?: boolean;
};

export type RuntimeOutboundQuotaContext = {
  workspaceQuotaBytes: number | null;
  sharedQuotaBytes: number | null;
};

async function assertWorkspaceQuotaBeforeOutboundWrite(input: {
  persaiInternalApiClient: Pick<PersaiInternalApiClientService, "sumWorkspaceFileStorageBytes">;
  workspaceId: string;
  workspaceQuotaBytes: number | null;
  sharedQuotaBytes: number | null;
  newBytes: number;
}): Promise<void> {
  const candidateCaps = [input.workspaceQuotaBytes, input.sharedQuotaBytes].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  if (candidateCaps.length === 0) {
    return;
  }
  const cap = candidateCaps.reduce(
    (minimum, value) => Math.min(minimum, value),
    Number.POSITIVE_INFINITY
  );
  const usedBytes = await input.persaiInternalApiClient.sumWorkspaceFileStorageBytes({
    workspaceId: input.workspaceId
  });
  if (usedBytes + input.newBytes > cap) {
    throw new Error("workspace_quota_exhausted");
  }
}

/** Worker media artifacts (image/tts/video) persist directly to GCS — no sandbox HTTP body limit. */
export async function writeRuntimeOutboundArtifact(input: {
  mediaObjectStorage: PersaiMediaObjectStorageService;
  assistantId: string;
  workspaceId: string;
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
  manifest?: RuntimeOutboundManifestContext;
  quota?: RuntimeOutboundQuotaContext;
  logger?: Logger;
}): Promise<RuntimeOutputArtifact> {
  if (input.manifest !== undefined && input.quota !== undefined) {
    await assertWorkspaceQuotaBeforeOutboundWrite({
      persaiInternalApiClient: input.manifest.persaiInternalApiClient,
      workspaceId: input.manifest.workspaceId,
      workspaceQuotaBytes: input.quota.workspaceQuotaBytes,
      sharedQuotaBytes: input.quota.sharedQuotaBytes,
      newBytes: input.buffer.length
    });
  }

  const extension = extensionFromFilenameOrMime(input.filenameHint, input.mimeType);
  const basename = buildOutboundBasename({
    slugSourceText: input.slugSourceText,
    extension
  });
  const storagePath = `${buildAssistantSessionRoot(input.assistantId, input.sessionId)}/${basename}`;
  const objectKey = input.mediaObjectStorage.buildWorkspaceObjectKey({
    workspaceId: input.workspaceId,
    workspaceRelPath: storagePath
  });
  const stored = await input.mediaObjectStorage.saveObject({
    objectKey,
    buffer: input.buffer,
    mimeType: input.mimeType
  });

  if (input.manifest !== undefined) {
    const shortDescription = buildGeneratedFileSemanticSummary({
      requestText: input.manifest.sourceUserMessageText ?? null,
      requestedName: input.filenameHint ?? basename,
      allowWeakRequestFallback: false
    });
    try {
      await input.manifest.persaiInternalApiClient.upsertWorkspaceFileMetadata({
        workspaceId: input.manifest.workspaceId,
        path: storagePath,
        mimeType: input.mimeType,
        sizeBytes: stored.sizeBytes,
        contentHash: createHash("sha256").update(input.buffer).digest("hex"),
        replace: input.manifest.replace ?? false,
        ...(shortDescription === null ? {} : { shortDescription }),
        ...(input.manifest.sourceUserMessageText === undefined ||
        input.manifest.sourceUserMessageText === null
          ? {}
          : { sourceUserMessageText: input.manifest.sourceUserMessageText }),
        ...(input.manifest.sourceUserMessageCreatedAt === undefined ||
        input.manifest.sourceUserMessageCreatedAt === null
          ? {}
          : { sourceUserMessageCreatedAt: input.manifest.sourceUserMessageCreatedAt }),
        ...(input.manifest.originChatId === undefined || input.manifest.originChatId === null
          ? { originAssistantId: input.manifest.assistantId }
          : {
              originChatId: input.manifest.originChatId,
              originAssistantId: input.manifest.assistantId
            })
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      input.logger?.warn(
        `outbound_artifact_manifest_upsert_failed path=${storagePath} reason=${detail}`
      );
      throw new Error(`Outbound artifact manifest upsert failed for ${storagePath}: ${detail}`);
    }
  }

  return {
    artifactId: randomUUID(),
    storagePath,
    kind: input.kind,
    sourceToolCode: input.sourceToolCode,
    mimeType: input.mimeType,
    filename: input.filenameHint,
    sizeBytes: stored.sizeBytes,
    voiceNote: input.voiceNote ?? false,
    ...(input.caption !== undefined ? { caption: input.caption } : {}),
    ...(input.downloadUrl ? { downloadUrl: input.downloadUrl } : {}),
    ...(input.billingFacts !== undefined ? { billingFacts: input.billingFacts } : {})
  };
}
