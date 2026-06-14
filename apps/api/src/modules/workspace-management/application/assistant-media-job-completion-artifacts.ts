import type { RuntimeAttachmentRef, RuntimeOutputArtifact } from "@persai/runtime-contract";

export type MediaJobCompletionToolCode = "image_generate" | "image_edit";

export function resolveMediaJobCompletionToolCode(
  requestJson: unknown
): MediaJobCompletionToolCode | null {
  if (requestJson === null || typeof requestJson !== "object" || Array.isArray(requestJson)) {
    return null;
  }
  const directToolExecution = (requestJson as Record<string, unknown>).directToolExecution;
  if (
    directToolExecution === null ||
    typeof directToolExecution !== "object" ||
    Array.isArray(directToolExecution)
  ) {
    return null;
  }
  const toolCode = (directToolExecution as Record<string, unknown>).toolCode;
  return toolCode === "image_generate" || toolCode === "image_edit" ? toolCode : null;
}

function isImageAttachmentRef(value: unknown): value is RuntimeAttachmentRef {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.objectKey === "string" &&
    row.objectKey.trim().length > 0 &&
    typeof row.mimeType === "string" &&
    row.mimeType.startsWith("image/")
  );
}

export function buildMediaJobCompletionArtifacts(input: {
  toolCode: MediaJobCompletionToolCode | null;
  outputArtifacts: RuntimeOutputArtifact[];
  requestAttachments: unknown[];
}): NonNullable<
  import("@persai/runtime-contract").RuntimeMediaJobCompletionRequest["workerResult"]
>["artifacts"] {
  const sourceReferences =
    input.toolCode === "image_edit"
      ? input.requestAttachments.filter(isImageAttachmentRef).map((attachment) => ({
          type: "image" as const,
          filename: attachment.filename,
          fileRef: attachment.fileRef ?? null,
          objectKey: attachment.objectKey,
          mimeType: attachment.mimeType,
          role: "source_reference" as const
        }))
      : [];

  const outputs = input.outputArtifacts
    .filter((artifact) => artifact.kind === "image")
    .map((artifact) => ({
      type: "image" as const,
      filename: artifact.filename,
      fileRef: artifact.fileRef ?? null,
      objectKey: artifact.objectKey,
      mimeType: artifact.mimeType,
      role: "output" as const
    }));

  return [...sourceReferences, ...outputs];
}
