/**
 * Provider-facing prompt fragments for media generation tools.
 *
 * These constants and builders are appended to provider prompts ONLY — they are
 * never shown to the model/assistant. They enforce provider output hygiene
 * (anti-collage, standalone-image, and reference-guidance rules) and are the
 * single source of truth consumed by both `@persai/runtime` composers and
 * `@persai/provider-gateway` builders. Any wording change must be made here and
 * propagates to all consumers automatically.
 */

/**
 * Rule A — prevents the provider from returning a multi-panel composition when
 * individual standalone images were requested. Uses the most complete gateway-
 * facing variant that names diptych/triptych so all composition types are covered.
 */
export const ANTI_COLLAGE_RULE =
  "Do not make a collage, grid, contact sheet, diptych, triptych, or multi-panel composition unless the user explicitly asked for that format.";

/**
 * Rule B — asserts that every image in a multi-image response is a self-contained
 * final result faithful to the overall request. Used in gateway-level prompts where
 * the cardinality framing precedes this sentence.
 */
export const STANDALONE_IMAGE_RULE =
  "Each returned image must be one standalone final image that stays faithful to the overall request.";

/**
 * Rule B variant for runtime series-item prompts (provider-facing, per-item) when
 * the tool is image_generate. Append ANTI_COLLAGE_RULE after this constant in the
 * series item prompt.
 */
export const STANDALONE_GENERATED_IMAGE_RULE = "Return one final image for this item only.";

/**
 * Rule B variant for runtime series-item prompts (provider-facing, per-item) when
 * the tool is image_edit. Append ANTI_COLLAGE_RULE after this constant in the
 * series item prompt.
 */
export const STANDALONE_EDITED_IMAGE_RULE = "Return one final edited image for this item only.";

/**
 * Rule C — communicates that reference images are styling guidance only; the
 * provider must keep the output rooted in the source image, not edit or reproduce
 * the reference image as its own output.
 *
 * @param opts.multiple - true when two or more reference images are provided.
 */
export function referenceGuidanceRule(opts: { multiple: boolean }): string {
  return opts.multiple
    ? "Use the additional reference images only as visual guidance for style, appearance, makeup, color palette, lighting, environment, background, or similar attributes unless the user explicitly asks to borrow a concrete object from them."
    : "Use the second/reference image only as visual guidance for style, appearance, makeup, color palette, lighting, environment, or similar attributes unless the user explicitly asks to borrow a concrete object from it.";
}

/**
 * Rule D header — the per-item label the runtime composers emit at the top of each
 * provider prompt for a series-mode multi-image job.
 *
 * @param index - 0-based item index.
 * @param total - total number of items in the series.
 */
export function seriesItemHeaderLine(index: number, total: number): string {
  return `Series item ${String(index + 1)} of ${String(total)}.`;
}
