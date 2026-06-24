import type { RuntimeFilesReadExtractionQuality } from "@persai/runtime-contract";
import { MAX_MODEL_VISIBLE_FILES_CONTENT_CHARS } from "./sanitize-tool-result-for-model";

type DocumentReadExtractionOutcome = {
  extracted: true;
  text: string;
  note: string | null;
  quality: unknown;
  cached?: boolean;
};

export function normalizeRuntimeFilesReadExtractionQuality(
  quality: unknown
): RuntimeFilesReadExtractionQuality | null {
  if (quality === null || typeof quality !== "object" || Array.isArray(quality)) {
    return null;
  }
  const row = quality as Record<string, unknown>;
  const status = row.status;
  if (status !== "ok" && status !== "poor" && status !== "needs_review") {
    return null;
  }
  const textChars = row.textChars;
  if (typeof textChars !== "number" || !Number.isFinite(textChars) || textChars < 0) {
    return null;
  }
  const score = row.score;
  const reasonCodes = Array.isArray(row.reasonCodes)
    ? row.reasonCodes.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    status,
    score:
      score === null || (typeof score === "number" && Number.isFinite(score))
        ? (score as number | null)
        : null,
    reasonCodes,
    textChars
  };
}

export function buildDocumentReadMetadata(extraction: DocumentReadExtractionOutcome): {
  charCount: number;
  truncated: boolean;
  readNote: string | null;
  extractionQuality: RuntimeFilesReadExtractionQuality | null;
  extractionCached: boolean;
} {
  return {
    charCount: extraction.text.length,
    truncated: extraction.text.length > MAX_MODEL_VISIBLE_FILES_CONTENT_CHARS,
    readNote: extraction.note,
    extractionQuality: normalizeRuntimeFilesReadExtractionQuality(extraction.quality),
    extractionCached: extraction.cached === true
  };
}

export function buildTextReadMetadata(content: string | null): {
  charCount: number | null;
  truncated: boolean;
} {
  const charCount = typeof content === "string" ? content.length : null;
  return {
    charCount,
    truncated: charCount !== null && charCount > MAX_MODEL_VISIBLE_FILES_CONTENT_CHARS
  };
}
