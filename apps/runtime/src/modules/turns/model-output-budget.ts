/**
 * ADR-122 Slice 2 — Unified output-budget resolver.
 *
 * A single pure function that computes the effective max-output-tokens for any
 * provider request, given admin-managed model capability fields and the
 * per-request context parameters.
 *
 * This is the one seat for output-budget logic. Every generation path in the
 * runtime delegates here instead of scattering magic constants.
 *
 * The resolver returns the **answer** budget. The Anthropic gateway adds the
 * thinking budget on top (`max_tokens = answer + thinkingBudget`), and Anthropic
 * counts thinking tokens INSIDE `max_tokens` against the model's published output
 * ceiling. The formula therefore reserves room for the thinking tokens out of the
 * total output ceiling so that `answer + thinkingBudget` can never exceed either
 * the model ceiling or the available context window.
 */

/**
 * Absolute upper bound on the FINAL provider output budget (answer + thinking).
 * Equals the largest real model output ceiling currently in the catalog
 * (Claude Opus / GPT-5: 128k). No current model accepts more, so clamping the
 * total here guarantees we never 400 a model with an admin value set too high.
 */
export const OUTPUT_BUDGET_MAX = 128_000;

/**
 * Base total-output budget used when `capability.maxOutputTokens` is null
 * (unknown / unseeded model). Conservative so it never 400s on any mainstream
 * chat model (gpt-4o family ceiling 16_384; claude 64_000; gpt-5 128_000 — all
 * ≥ 8_192) while being 8× the old hardcoded 1_024 fallback. Admin-tunable via the
 * runtime UI by setting an explicit `maxOutputTokens`.
 */
export const OUTPUT_BUDGET_FALLBACK = 8_192;

/**
 * Minimum effective answer budget.
 * Prevents a degenerate small total room (tiny/negative after subtracting input,
 * thinking, and reserve) from producing 0 or a negative token count.
 */
export const OUTPUT_BUDGET_FLOOR = 1_024;

/**
 * Conservative safety margin subtracted from the context window before computing
 * the available output room, to leave headroom for model-internal overhead and
 * char-based input-estimate rounding.
 */
export const CONTEXT_SAFETY_RESERVE = 4_096;

/**
 * Approximate bytes per token for the cheap char-based input-token estimator
 * (≈3 bytes/token for English; intentionally conservative for Russian/CJK so
 * the safety reserve stays effective).
 */
export const APPROX_BYTES_PER_TOKEN = 3;

/**
 * Compute the effective answer-token budget for a provider request.
 *
 * Returns the **answer** budget only. On the Anthropic path the gateway sends
 * `max_tokens = answer + thinkingBudget`, where Anthropic counts the thinking
 * tokens inside `max_tokens` against the model ceiling — so the thinking budget
 * is reserved out of the total output room here, guaranteeing
 * `answer + thinkingBudget = totalRoom ≤ totalCeiling ≤ model ceiling` and
 * `≤ contextWindow - input - reserve`.
 *
 * Formula:
 *   totalCeiling = min(capability.maxOutputTokens ?? OUTPUT_BUDGET_FALLBACK, OUTPUT_BUDGET_MAX)
 *   totalRoom    = totalCeiling
 *   if contextWindow and inputTokensEstimate are known:
 *     totalRoom = min(totalRoom, contextWindow - inputTokensEstimate - CONTEXT_SAFETY_RESERVE)
 *   answer = totalRoom - thinkingBudget
 *   return clamp(answer, OUTPUT_BUDGET_FLOOR, OUTPUT_BUDGET_MAX)
 *
 * @param capability Admin-managed model capability fields from the catalog slot.
 *   `maxOutputTokens` null → OUTPUT_BUDGET_FALLBACK governs.
 *   `contextWindow` null → context-window guard is skipped.
 * @param ctx Per-request context parameters.
 *   `inputTokensEstimate` null → context-window guard is skipped.
 *   `thinkingBudget` is the SAME value the gateway will emit on this path (0 when
 *   no thinking is applied), reserved out of the total output room.
 */
export function resolveModelOutputBudget(
  capability: { maxOutputTokens: number | null; contextWindow: number | null },
  ctx: { inputTokensEstimate: number | null; thinkingBudget: number }
): number {
  const totalCeiling = Math.min(
    capability.maxOutputTokens ?? OUTPUT_BUDGET_FALLBACK,
    OUTPUT_BUDGET_MAX
  );
  let totalRoom = totalCeiling;
  if (capability.contextWindow != null && ctx.inputTokensEstimate != null) {
    totalRoom = Math.min(
      totalRoom,
      capability.contextWindow - ctx.inputTokensEstimate - CONTEXT_SAFETY_RESERVE
    );
  }
  const answer = totalRoom - ctx.thinkingBudget;
  return Math.max(OUTPUT_BUDGET_FLOOR, Math.min(answer, OUTPUT_BUDGET_MAX));
}

/**
 * D2a DeepSeek trace dispatch is stricter than the ordinary output allocator:
 * a durable append-only trace cannot enter generic overflow recovery. It must
 * have an explicit admin-owned context window and output reserve, and the
 * complete resolved input plus that reserve must fit before provider dispatch.
 */
export function assessDeepSeekAppendTraceDispatchBudget(
  capability: { maxOutputTokens: number | null; contextWindow: number | null },
  inputTokensEstimate: number,
  outputTokensReserve: number | undefined
):
  | { outcome: "fits"; inputTokensEstimate: number; outputTokensReserve: number }
  | { outcome: "capability_unavailable" | "exceeded" } {
  if (
    capability.contextWindow === null ||
    capability.maxOutputTokens === null ||
    !Number.isFinite(inputTokensEstimate) ||
    inputTokensEstimate < 0 ||
    outputTokensReserve === undefined ||
    !Number.isFinite(outputTokensReserve) ||
    outputTokensReserve <= 0
  ) {
    return { outcome: "capability_unavailable" };
  }
  return inputTokensEstimate + outputTokensReserve <= capability.contextWindow
    ? { outcome: "fits", inputTokensEstimate, outputTokensReserve }
    : { outcome: "exceeded" };
}

/**
 * An append-only DeepSeek trace may not use generic overflow recovery. A
 * request that does not fit gets exactly one no-more-tools finalization retry;
 * a final-only request that still does not fit fails closed before dispatch.
 */
export function resolveDeepSeekAppendTraceOverflowAction(input: {
  budgetFits: boolean;
  hasTools: boolean;
  finalizationRequested: boolean;
}): "dispatch" | "finalize_no_more_tools" | "fail_closed" {
  if (input.budgetFits) return "dispatch";
  return input.hasTools && !input.finalizationRequested ? "finalize_no_more_tools" : "fail_closed";
}
