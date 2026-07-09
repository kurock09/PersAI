/**
 * Pre-prod polish 2026 / FIX 2 — tool-result filename hygiene.
 *
 * Background. After a worker tool such as `image_generate`, `image_edit`,
 * `video_generate`, or `tts` produces a `RuntimeOutputArtifact`, the
 * runtime serializes the entire tool-result payload to JSON and feeds it
 * back into the model's tool-history channel as the next provider call's
 * `toolResult.content`. The model then writes its assistant turn referring
 * to that result. Empirically, models that see `"filename": "interesting_scene.png"`
 * in the JSON like to quote it back literally — leading to an assistant
 * bubble that reads `Готово, держи interesting_scene.png` while the actual
 * image is *also* attached to the same message. The filename appears twice:
 * once as inline text inside the speech bubble, once as the attachment
 * label. Founder flagged it as user-visible noise during pre-prod gating.
 *
 * Fix scope. This module narrows the sanitization to the model-visible
 * surface only. The internal `outcome.payload` (used by observability and
 * runtime accounting) and `outcome.artifacts` (used by the API layer to
 * persist attachment metadata into Postgres + object storage) flow
 * unchanged with the full filename / objectKey / sizeBytes / artifactId.
 * Only the JSON the model sees in its next tool-result message gets the
 * redaction.
 *
 * Detection. We strip presentation-only fields exclusively from objects
 * that carry the unique `RuntimeOutputArtifact` shape signature — both a
 * string `artifactId` AND a string `kind`. That distinguishes them from
 * the user-uploaded `RuntimeAttachmentRef` objects (which use
 * `attachmentId`, not `artifactId`, and which legitimately carry a
 * filename the model already saw in the user's message context). It also
 * means non-artifact payload fields (e.g., `prompt`, `revisedPrompt`,
 * `provider`, `usage`) pass through verbatim, so the model still receives
 * everything semantically meaningful for its next response.
 *
 * Fields kept for the model: `kind`, `mimeType`, `voiceNote`, `caption`.
 * Fields stripped from the model-visible JSON: `artifactId`, `objectKey`,
 * `filename`, `sizeBytes`, `storagePath`. `caption` is kept because if the runtime ever
 * synthesizes a caption (e.g., a tool says "cropped to focus on subject"),
 * that caption is meaningful for the next reasoning step and not a
 * presentation-only token.
 */

import { PERSAI_WEB_BROWSER_LOGIN_CONTINUE_URL } from "@persai/runtime-contract";

const MODEL_VISIBLE_ARTIFACT_FIELDS = new Set(["kind", "mimeType", "voiceNote", "caption"]);
export const MAX_MODEL_VISIBLE_FILES_CONTENT_CHARS = 16_000;

function isRuntimeOutputArtifactShape(value: Record<string, unknown>): boolean {
  return typeof value.artifactId === "string" && typeof value.kind === "string";
}

function isRuntimeFilesToolResultShape(value: Record<string, unknown>): boolean {
  return value.toolCode === "files" && value.executionMode === "inline";
}

export function isLikelyBinaryContent(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  if (value.startsWith("%PDF-") || value.includes("\u0000") || value.includes("\uFFFD")) {
    return true;
  }
  const sample = value.slice(0, 4096);
  let controlChars = 0;
  for (let index = 0; index < sample.length; index += 1) {
    const code = sample.charCodeAt(index);
    const allowedWhitespace = code === 9 || code === 10 || code === 13;
    if ((code < 32 && !allowedWhitespace) || (code >= 127 && code <= 159)) {
      controlChars += 1;
    }
  }
  return controlChars / sample.length > 0.02;
}

function sanitizeFilesContentForModel(
  value: unknown,
  existingCharCount: number | null | undefined
): {
  content: string | null;
  charCount: number | null;
  truncated: boolean;
} {
  if (typeof value !== "string") {
    return {
      content: null,
      charCount: existingCharCount ?? null,
      truncated: false
    };
  }
  const originalCharCount = existingCharCount ?? value.length;
  if (isLikelyBinaryContent(value)) {
    return {
      content: "[binary file content omitted from model context]",
      charCount: originalCharCount,
      truncated: false
    };
  }
  if (value.length > MAX_MODEL_VISIBLE_FILES_CONTENT_CHARS) {
    return {
      content: `${value.slice(0, MAX_MODEL_VISIBLE_FILES_CONTENT_CHARS)}\n\n[content truncated for model context: ${String(value.length - MAX_MODEL_VISIBLE_FILES_CONTENT_CHARS)} characters omitted]`,
      charCount: originalCharCount,
      truncated: true
    };
  }
  return {
    content: value,
    charCount: originalCharCount,
    truncated: false
  };
}

function sanitizeFilesToolResultForModel(value: Record<string, unknown>): Record<string, unknown> {
  const item = value.item ?? null;
  const items = Array.isArray(value.items) ? value.items : [];

  const existingCharCount =
    typeof value.charCount === "number" && Number.isFinite(value.charCount)
      ? value.charCount
      : null;
  const sanitizedContent = sanitizeFilesContentForModel(value.content, existingCharCount);
  const readNote =
    typeof value.readNote === "string"
      ? value.readNote
      : value.readNote === null
        ? null
        : undefined;
  const extractionQuality =
    value.extractionQuality !== undefined ? value.extractionQuality : undefined;
  const extractionCached = value.extractionCached === true ? true : undefined;

  return {
    toolCode: "files",
    executionMode: value.executionMode,
    requestedAction: value.requestedAction,
    action: value.action,
    reason: value.reason,
    warning: value.warning,
    item,
    items,
    content: sanitizedContent.content,
    charCount: sanitizedContent.charCount,
    truncated: sanitizedContent.truncated,
    ...(typeof value.path === "string" ? { path: value.path } : {}),
    ...(typeof value.sizeBytes === "number" ? { sizeBytes: value.sizeBytes } : {}),
    ...(typeof value.mimeType === "string" ? { mimeType: value.mimeType } : {}),
    ...(typeof value.displayName === "string" ? { displayName: value.displayName } : {}),
    ...(readNote !== undefined ? { note: readNote } : {}),
    ...(extractionQuality !== undefined ? { extractionQuality } : {}),
    ...(extractionCached === true ? { extractionCached: true } : {}),
    job: null,
    queuedArtifacts: value.queuedArtifacts ?? 0
  };
}

function modelFacingReplacer(_key: string, value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const candidate = value as Record<string, unknown>;
  if (isRuntimeFilesToolResultShape(candidate)) {
    return sanitizeFilesToolResultForModel(candidate);
  }
  if (isRuntimeBrowserToolResultShape(candidate)) {
    return sanitizeBrowserToolResultForModel(candidate);
  }
  if (!isRuntimeOutputArtifactShape(candidate)) {
    return value;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(candidate)) {
    if (MODEL_VISIBLE_ARTIFACT_FIELDS.has(k)) {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

function isRuntimeBrowserToolResultShape(value: Record<string, unknown>): boolean {
  return value.toolCode === "browser" && value.executionMode === "worker";
}

function sanitizeBrowserToolResultForModel(
  value: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = { ...value };

  const pending =
    sanitized.pendingBrowserLogin !== null &&
    typeof sanitized.pendingBrowserLogin === "object" &&
    !Array.isArray(sanitized.pendingBrowserLogin)
      ? (sanitized.pendingBrowserLogin as Record<string, unknown>)
      : sanitized.login !== null &&
          typeof sanitized.login === "object" &&
          !Array.isArray(sanitized.login)
        ? (sanitized.login as Record<string, unknown>)
        : null;
  const displayName =
    typeof pending?.displayName === "string" && pending.displayName.trim().length > 0
      ? pending.displayName.trim()
      : typeof sanitized.displayName === "string" && sanitized.displayName.trim().length > 0
        ? sanitized.displayName.trim()
        : null;
  const shouldAttachWebLoginDelivery =
    sanitized.action === "login" ||
    sanitized.action === "opened_live" ||
    sanitized.requestedAction === "open_live" ||
    sanitized.pendingBrowserLogin !== null;
  if (shouldAttachWebLoginDelivery) {
    // By the time `action` reaches "login"/"opened_live" here, the caller
    // (runtime-browser-tool.service's `isTelegramSurface` gate) has already
    // diverted any Telegram-surface request to a "skipped"/"open_in_app"
    // result instead. So this branch only ever runs for non-Telegram
    // surfaces — the delivery text must not name Telegram, or the model
    // reads it verbatim and starts talking about Telegram in web replies.
    sanitized.webBrowserLogin = {
      continueUrl: PERSAI_WEB_BROWSER_LOGIN_CONTINUE_URL,
      ...(displayName === null ? {} : { displayName }),
      delivery:
        "Tell the user to continue at continueUrl in the PersAI app on this same surface, where the local browser bridge can open the login view."
    };
  }
  return sanitized;
}

/**
 * Serialize a tool-result payload to the JSON string the model will see.
 */
export function stringifyToolResultPayloadForModel(payload: unknown): string {
  return JSON.stringify(payload, modelFacingReplacer);
}
