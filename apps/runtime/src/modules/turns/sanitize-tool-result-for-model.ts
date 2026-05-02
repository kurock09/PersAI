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
 * Fields kept for the model: `fileRef`, `kind`, `mimeType`, `voiceNote`, `caption`.
 * Fields stripped from the model-visible JSON: `artifactId`, `objectKey`,
 * `filename`, `sizeBytes`. `caption` is kept because if the runtime ever
 * synthesizes a caption (e.g., a tool says "cropped to focus on subject"),
 * that caption is meaningful for the next reasoning step and not a
 * presentation-only token.
 */

const MODEL_VISIBLE_ARTIFACT_FIELDS = new Set([
  "fileRef",
  "kind",
  "mimeType",
  "voiceNote",
  "caption"
]);

function isSuccessfulFilesDeliveryResult(value: Record<string, unknown>): boolean {
  if (value.toolCode !== "files" || value.executionMode !== "inline") {
    return false;
  }
  if (value.requestedAction !== "send" && value.requestedAction !== "write_and_send") {
    return false;
  }
  if (value.action !== "queued" && value.action !== "written_and_queued") {
    return false;
  }
  return typeof value.queuedArtifacts === "number" && value.queuedArtifacts > 0;
}

function isRuntimeOutputArtifactShape(value: Record<string, unknown>): boolean {
  return typeof value.artifactId === "string" && typeof value.kind === "string";
}

function modelFacingReplacer(_key: string, value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const candidate = value as Record<string, unknown>;
  if (isSuccessfulFilesDeliveryResult(candidate)) {
    return {
      toolCode: "files",
      requestedAction: candidate.requestedAction,
      action: candidate.action,
      delivered: true,
      queuedAttachments: candidate.queuedArtifacts,
      instruction:
        "The file delivery succeeded and will be shown as an attachment card. Do not print fileRef, raw tool output, or attachment metadata. Briefly tell the user the file was sent."
    };
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

/**
 * Serialize a tool-result payload to the JSON string the model will see.
 * Equivalent to `JSON.stringify(payload)` for every payload field except
 * `RuntimeOutputArtifact`-shaped objects (anywhere in the tree), where
 * presentation-only fields are stripped so the model cannot quote them.
 *
 * Returns the same string `JSON.stringify(payload)` would have returned
 * if the payload contains no artifact-shaped objects, so call sites that
 * use this helper can be refactored from `JSON.stringify(payload)` with
 * no behavior change for non-artifact-bearing tool results.
 */
export function stringifyToolResultPayloadForModel(payload: unknown): string {
  return JSON.stringify(payload, modelFacingReplacer);
}
