/** ADR-116 — code defaults for plan-owned file visual preview limits. */
export const DEFAULT_MAX_FILE_PREVIEW_BYTES = 8_388_608 as const;

/** ADR-116 — default longest image edge when resizing for provider preview. */
export const DEFAULT_MAX_FILE_PREVIEW_EDGE_PX = 2048 as const;

/**
 * Platform absolute ceiling for one visual preview (image or native PDF).
 * Plans may only configure values at or below this limit.
 */
export const FILE_PREVIEW_ABSOLUTE_MAX_BYTES = 8_388_608 as const;

export function clampPlanMaxFilePreviewBytes(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("maxFilePreviewBytes must be a positive integer.");
  }
  return Math.min(value, FILE_PREVIEW_ABSOLUTE_MAX_BYTES);
}

export function resolveEffectiveMaxFilePreviewBytes(planBytes: number | null | undefined): number {
  const candidate =
    planBytes === null || planBytes === undefined ? DEFAULT_MAX_FILE_PREVIEW_BYTES : planBytes;
  return Math.min(candidate, FILE_PREVIEW_ABSOLUTE_MAX_BYTES);
}

export function resolveEffectiveMaxFilePreviewEdgePx(
  planEdgePx: number | null | undefined
): number {
  if (planEdgePx === null || planEdgePx === undefined) {
    return DEFAULT_MAX_FILE_PREVIEW_EDGE_PX;
  }
  return planEdgePx;
}
