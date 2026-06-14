import type { RuntimeToolPolicy } from "@persai/runtime-contract";
import {
  resolveEffectiveMaxFilePreviewBytes,
  resolveEffectiveMaxFilePreviewEdgePx
} from "@persai/config";
import type { RuntimeFileCapability } from "@persai/runtime-contract";

const DOCUMENT_EXTRACTABLE_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

const TEXT_READABLE_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/x-ndjson",
  "application/yaml",
  "application/yml",
  "text/csv",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values",
  "text/xml"
]);

const INTERNAL_RUNTIME_FILE_EXTRACTION_CACHE_KEY = "internalRuntimeFileExtractionCache";
const INTERNAL_RUNTIME_FILE_EXTRACTION_CACHE_SCHEMA =
  "persai.internalRuntimeFileExtractionCache.v1";

export function readFilesToolEffectivePreviewLimits(policy: RuntimeToolPolicy | null | undefined): {
  effectiveMaxPreviewBytes: number;
  effectiveMaxPreviewEdgePx: number;
} {
  return {
    effectiveMaxPreviewBytes: resolveEffectiveMaxFilePreviewBytes(
      policy?.maxFilePreviewBytes ?? null
    ),
    effectiveMaxPreviewEdgePx: resolveEffectiveMaxFilePreviewEdgePx(
      policy?.maxFilePreviewEdgePx ?? null
    )
  };
}

export function resolveFileCapabilities(
  mimeType: string,
  sizeBytes: number,
  effectiveMaxPreviewBytes: number
): RuntimeFileCapability[] {
  const normalizedMime = mimeType.trim().toLowerCase();
  const capabilities: RuntimeFileCapability[] = [];

  if (
    normalizedMime.startsWith("text/") ||
    TEXT_READABLE_MIME_TYPES.has(normalizedMime) ||
    DOCUMENT_EXTRACTABLE_MIME_TYPES.has(normalizedMime)
  ) {
    capabilities.push("text");
  }

  const withinPreviewBudget =
    Number.isFinite(sizeBytes) && sizeBytes > 0 && sizeBytes <= effectiveMaxPreviewBytes;

  if (withinPreviewBudget) {
    if (normalizedMime.startsWith("image/")) {
      capabilities.push("visual");
    } else if (normalizedMime === "application/pdf" || normalizedMime === "application/x-pdf") {
      capabilities.push("visual");
    }
  }

  return capabilities;
}

export function hasInternalRuntimeFileExtractionCache(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  if (metadata === null || metadata === undefined) {
    return false;
  }
  const cache = metadata[INTERNAL_RUNTIME_FILE_EXTRACTION_CACHE_KEY];
  if (cache === null || typeof cache !== "object" || Array.isArray(cache)) {
    return false;
  }
  return (
    (cache as Record<string, unknown>).schema === INTERNAL_RUNTIME_FILE_EXTRACTION_CACHE_SCHEMA
  );
}

export function buildFilesInspectContent(input: {
  mimeType: string;
  sizeBytes: number;
  policy: RuntimeToolPolicy | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
}): string {
  const limits = readFilesToolEffectivePreviewLimits(input.policy);
  const capabilities = resolveFileCapabilities(
    input.mimeType,
    input.sizeBytes,
    limits.effectiveMaxPreviewBytes
  );
  const payload: Record<string, unknown> = {
    capabilities,
    effectiveMaxPreviewBytes: limits.effectiveMaxPreviewBytes,
    effectiveMaxPreviewEdgePx: limits.effectiveMaxPreviewEdgePx
  };
  if (hasInternalRuntimeFileExtractionCache(input.metadata)) {
    payload.extractionCached = true;
  }
  return JSON.stringify(payload);
}
