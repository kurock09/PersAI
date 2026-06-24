import type { RuntimeToolPolicy } from "@persai/runtime-contract";
import {
  resolveEffectiveMaxFilePreviewBytes,
  resolveEffectiveMaxFilePreviewEdgePx
} from "@persai/config";

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
