import type {
  ProviderGatewayImageContentBlock,
  ProviderGatewayMessageContentBlock
} from "@persai/runtime-contract";
import type { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";

export const MEDIA_JOB_COMPLETION_VISION_MAX_IMAGES = 10;

const VISION_MAX_IMAGE_DIMENSION = 2048;

export type MediaJobCompletionVisionArtifactRef = {
  storagePath: string;
  mimeType: string;
  filename: string | null;
  role: "output" | "source_reference";
};

async function normalizeVisionImageBuffer(
  buffer: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!mimeType.startsWith("image/")) {
    return { buffer, mimeType };
  }
  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default;
    const metadata = await sharp(buffer).metadata();
    const width = typeof metadata.width === "number" ? metadata.width : null;
    const height = typeof metadata.height === "number" ? metadata.height : null;
    if (
      width === null ||
      height === null ||
      (width <= VISION_MAX_IMAGE_DIMENSION && height <= VISION_MAX_IMAGE_DIMENSION)
    ) {
      return { buffer, mimeType };
    }
    const resized = await sharp(buffer)
      .rotate()
      .resize(VISION_MAX_IMAGE_DIMENSION, VISION_MAX_IMAGE_DIMENSION, {
        fit: "inside",
        withoutEnlargement: true
      })
      .toBuffer();
    return { buffer: resized, mimeType };
  } catch {
    return { buffer, mimeType };
  }
}

export async function hydrateMediaJobCompletionVisionContent(input: {
  workspaceId: string;
  mediaObjectStorage: PersaiMediaObjectStorageService;
  artifacts: MediaJobCompletionVisionArtifactRef[];
}): Promise<ProviderGatewayMessageContentBlock[]> {
  const blocks: ProviderGatewayMessageContentBlock[] = [];
  const capped = input.artifacts.slice(0, MEDIA_JOB_COMPLETION_VISION_MAX_IMAGES);
  for (const [index, artifact] of capped.entries()) {
    if (!artifact.mimeType.startsWith("image/")) {
      continue;
    }
    const downloaded = await input.mediaObjectStorage.downloadByWorkspacePath({
      workspaceId: input.workspaceId,
      storagePath: artifact.storagePath
    });
    if (downloaded === null) {
      continue;
    }
    const normalized = await normalizeVisionImageBuffer(downloaded, artifact.mimeType);
    const label =
      artifact.role === "source_reference"
        ? `Source reference image ${String(index + 1)}`
        : `Produced output image ${String(index + 1)}`;
    blocks.push({
      type: "text",
      text: `[${label}${artifact.filename ? `: ${artifact.filename}` : ""}]`
    });
    blocks.push({
      type: "image",
      mimeType: normalized.mimeType,
      dataBase64: normalized.buffer.toString("base64"),
      filename: artifact.filename
    } satisfies ProviderGatewayImageContentBlock);
  }
  return blocks;
}
