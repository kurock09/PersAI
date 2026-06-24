import type { RuntimeOutputArtifact } from "@persai/runtime-contract";

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

export function buildMediaJobCompletionArtifacts(input: {
  outputArtifacts: RuntimeOutputArtifact[];
}): NonNullable<
  import("@persai/runtime-contract").RuntimeMediaJobCompletionRequest["workerResult"]
>["artifacts"] {
  return input.outputArtifacts
    .filter((artifact) => artifact.kind === "image")
    .map((artifact) => ({
      type: "image" as const,
      filename: artifact.filename,
      storagePath: artifact.storagePath,
      mimeType: artifact.mimeType,
      role: "output" as const
    }));
}
