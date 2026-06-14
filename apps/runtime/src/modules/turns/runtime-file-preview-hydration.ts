import { FILE_PREVIEW_ABSOLUTE_MAX_BYTES } from "@persai/config";
import type {
  ProviderGatewayImageContentBlock,
  ProviderGatewayMessageContentBlock,
  ProviderGatewayPdfContentBlock
} from "@persai/runtime-contract";
import type { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";

export type FilePreviewCapSource = "plan" | "default" | "clamped";

export type FilePreviewHydrationFailureReason =
  | "preview_size_limit"
  | "preview_unsupported"
  | "preview_download_failed";

export function resolveFilePreviewCapSource(
  planBytes: number | null | undefined
): FilePreviewCapSource {
  if (planBytes === null || planBytes === undefined) {
    return "default";
  }
  if (planBytes > FILE_PREVIEW_ABSOLUTE_MAX_BYTES) {
    return "clamped";
  }
  return "plan";
}

export type FilePreviewHydrationInput = {
  mediaObjectStorage: PersaiMediaObjectStorageService;
  objectKey: string;
  mimeType: string;
  filename: string | null;
  sizeBytes: number;
  effectiveMaxPreviewBytes: number;
  effectiveMaxPreviewEdgePx: number;
  alias: string | null;
  instruction: string | null;
};

export type FilePreviewHydrationResult =
  | {
      ok: true;
      blocks: ProviderGatewayMessageContentBlock[];
      bytes: number;
      visualKind: "image" | "pdf";
    }
  | {
      ok: false;
      reason: FilePreviewHydrationFailureReason;
    };

async function normalizePreviewImageBuffer(
  buffer: Buffer,
  mimeType: string,
  maxEdgePx: number
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
    if (width === null || height === null || (width <= maxEdgePx && height <= maxEdgePx)) {
      return { buffer, mimeType };
    }
    const resized = await sharp(buffer)
      .rotate()
      .resize(maxEdgePx, maxEdgePx, {
        fit: "inside",
        withoutEnlargement: true
      })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { buffer: resized, mimeType: "image/jpeg" };
  } catch {
    return { buffer, mimeType };
  }
}

export async function buildFilePreviewBlocks(
  input: FilePreviewHydrationInput
): Promise<FilePreviewHydrationResult> {
  const normalizedMime = input.mimeType.trim().toLowerCase();
  const isImage = normalizedMime.startsWith("image/");
  const isPdf = normalizedMime === "application/pdf" || normalizedMime === "application/x-pdf";
  if (!isImage && !isPdf) {
    return { ok: false, reason: "preview_unsupported" };
  }
  if (
    !Number.isFinite(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > input.effectiveMaxPreviewBytes
  ) {
    return { ok: false, reason: "preview_size_limit" };
  }

  const downloaded = await input.mediaObjectStorage.downloadObject(input.objectKey);
  if (downloaded === null || downloaded.length === 0) {
    return { ok: false, reason: "preview_download_failed" };
  }
  if (downloaded.length > input.effectiveMaxPreviewBytes) {
    return { ok: false, reason: "preview_size_limit" };
  }

  const label = input.alias ?? input.filename ?? "file";
  const instruction = input.instruction?.trim() ?? "";
  const intro =
    instruction.length > 0 ? `File preview (${label}): ${instruction}` : `File preview (${label})`;
  const blocks: ProviderGatewayMessageContentBlock[] = [{ type: "text", text: intro }];

  if (isImage) {
    const normalized = await normalizePreviewImageBuffer(
      downloaded,
      normalizedMime,
      input.effectiveMaxPreviewEdgePx
    );
    blocks.push({
      type: "image",
      mimeType: normalized.mimeType,
      dataBase64: normalized.buffer.toString("base64"),
      filename: input.filename
    } satisfies ProviderGatewayImageContentBlock);
    return {
      ok: true,
      blocks,
      bytes: normalized.buffer.length,
      visualKind: "image"
    };
  }

  blocks.push({
    type: "pdf",
    mimeType: "application/pdf",
    dataBase64: downloaded.toString("base64"),
    filename: input.filename
  } satisfies ProviderGatewayPdfContentBlock);
  return {
    ok: true,
    blocks,
    bytes: downloaded.length,
    visualKind: "pdf"
  };
}
