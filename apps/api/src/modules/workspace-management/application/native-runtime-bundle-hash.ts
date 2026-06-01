import { createHash } from "node:crypto";
import type { AssistantMaterializedSpec } from "../domain/assistant-materialized-spec.entity";
import { AssistantRuntimeError } from "./assistant-runtime.facade";

export function hashNativeRuntimeBundleDocument(document: string): string {
  return createHash("sha256").update(document).digest("hex");
}

export function resolveMaterializedNativeRuntimeBundle(input: {
  materializedSpec: AssistantMaterializedSpec;
  context: string;
}): { bundleDocument: string; bundleHash: string } {
  const bundleDocument = input.materializedSpec.runtimeBundleDocument?.trim() ?? "";
  if (!bundleDocument) {
    throw new AssistantRuntimeError(
      "runtime_degraded",
      `${input.context} runtime bundle document is missing.`
    );
  }

  return {
    bundleDocument,
    bundleHash: hashNativeRuntimeBundleDocument(bundleDocument)
  };
}
