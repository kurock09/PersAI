/**
 * ADR-074 Slice L1 — Adaptive tool loop limits per execution mode.
 *
 * Two budgets compose per turn:
 *
 *   1. `TOOL_LOOP_LIMIT_BY_MODE` — the maximum number of *iterations* of the
 *      native tool loop that are allowed to execute model-emitted tool calls.
 *      The runtime always grants additional "wrap-up" iterations after the
 *      limit is hit so the model can read the synthesized
 *      `tool_budget_exhausted` results and reply honestly. This replaces the
 *      pre-L1 universal `MAX_NATIVE_TOOL_LOOP_ITERATIONS = 4`, which failed
 *      the whole turn with `native_tool_loop_exhausted` instead of giving the
 *      model a graceful exit.
 *
 *   2. `TOOL_HARD_CAP_PER_TURN` — the *default* maximum number of times a
 *      specific tool may execute within a single turn, regardless of the
 *      iteration limit. Tools not listed here have no per-tool cap by
 *      default (they are still bounded by the iteration limit). The
 *      founder-confirmed default shape is: `web_fetch ≤ 5`, `web_search ≤
 *      3`, `image_generate ≤ 1`, `image_edit ≤ 1`, `video_generate ≤ 1`.
 *      Memory and shared-compaction tools (`memory_write`,
 *      `summarize_context`, `compact_context`) and knowledge tools are
 *      intentionally absent so durable memory work cannot be choked off by
 *      the cap on browse/media tools.
 *
 * **Both budgets are now overridable per assistant.** The runtime treats the
 * constants in this file as last-resort defaults; the actual values used at
 * runtime come from (in resolution order):
 *
 *   - **Loop limit per mode**: `bundle.runtime.toolBudgets.loopLimitByMode[mode]`
 *     (per-assistant, set by the API-side bundle compile pipeline) →
 *     `TOOL_LOOP_LIMIT_BY_MODE[mode]` code default.
 *   - **Per-tool cap**: `RuntimeToolPolicy.perTurnCap` (per-tool override on
 *     the assistant's tool policy) → `TOOL_HARD_CAP_PER_TURN[toolName]`
 *     code default → no cap.
 *
 * This layering keeps "tune, don't rebuild" (Q9-C part 1, Principle 3) but
 * lets different plans/models/assistants ship different numbers without a
 * runtime code change.
 *
 * When either budget would be exceeded for a given tool call, the runtime
 * substitutes its execution with a structured `tool_budget_exhausted` tool
 * result containing the cap reason, the limit, and the observed count. The
 * model sees that result on the next iteration and is expected to wrap up
 * the turn with an honest user-facing reply ("I hit my budget for X — here
 * is what I have so far"). This is the L1 founder anchor (Principle 3 —
 * tune, don't rebuild) from Q9-C part 1 in ADR-074.
 */

export type ToolBudgetExecutionMode = "normal" | "premium" | "reasoning";

export const TOOL_LOOP_LIMIT_BY_MODE: Readonly<Record<ToolBudgetExecutionMode, number>> = {
  normal: 2,
  premium: 4,
  reasoning: 8
};

export const TOOL_HARD_CAP_PER_TURN: Readonly<Record<string, number>> = {
  web_fetch: 5,
  web_search: 3,
  image_generate: 1,
  image_edit: 1,
  video_generate: 1
};

export type ToolBudgetExhaustionReason = "loop_limit" | "per_tool_cap";

export type ToolBudgetReservation =
  | { exhausted: false }
  | {
      exhausted: true;
      reason: ToolBudgetExhaustionReason;
      limit: number;
      observed: number;
    };

/**
 * Optional per-mode loop-limit override that comes from
 * `bundle.runtime.toolBudgets.loopLimitByMode`. A `null` (or omitted) leaf
 * means "fall back to the code default for this mode". A positive number
 * replaces the default. Non-positive numbers are rejected by
 * `resolveLoopLimit` and the default is used instead, so a misconfigured
 * bundle cannot accidentally turn the loop off (which would silently break
 * every tool-using turn).
 */
export type ToolLoopLimitOverrideByMode = Partial<
  Record<ToolBudgetExecutionMode, number | null>
> | null;

/**
 * Optional per-tool cap overrides keyed by tool code. Sourced from each
 * `RuntimeToolPolicy.perTurnCap` at policy-build time. A non-positive
 * number is rejected and the code default (or "no cap") applies. To set a
 * normally-capped tool to effectively unlimited on this assistant, use
 * `Number.MAX_SAFE_INTEGER`.
 */
export type ToolPerTurnCapOverrides = ReadonlyMap<string, number | null> | null;

export interface ToolBudgetPolicyOptions {
  /** Per-assistant override sourced from the runtime bundle. */
  loopLimitOverrides?: ToolLoopLimitOverrideByMode;
  /** Per-tool overrides sourced from the assistant's tool policies. */
  perToolCapOverrides?: ToolPerTurnCapOverrides;
}

function resolveLoopLimit(
  mode: ToolBudgetExecutionMode,
  overrides: ToolLoopLimitOverrideByMode
): number {
  const override = overrides?.[mode];
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }
  return TOOL_LOOP_LIMIT_BY_MODE[mode];
}

function resolvePerToolCap(toolName: string, overrides: ToolPerTurnCapOverrides): number | null {
  const override = overrides?.get(toolName) ?? null;
  if (override !== null && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }
  const codeDefault = TOOL_HARD_CAP_PER_TURN[toolName];
  return codeDefault === undefined ? null : codeDefault;
}

/**
 * Per-turn mutable budget tracker. One instance lives for one runtime turn.
 * Methods are deliberately small and side-effect-light so the turn-execution
 * loop can stay readable.
 *
 * Construction takes the resolved `executionMode` plus optional override
 * inputs from the bundle and tool policies; the policy itself does not
 * reach into the bundle at runtime — the call site (`createToolBudgetPolicy`
 * in `turn-execution.service.ts`) is responsible for collecting the
 * overrides once at turn start and handing them in.
 */
export class ToolBudgetPolicy {
  readonly executionMode: ToolBudgetExecutionMode;
  private readonly loopLimitOverrides: ToolLoopLimitOverrideByMode;
  private readonly perToolCapOverrides: ToolPerTurnCapOverrides;
  private readonly perToolCounts: Map<string, number>;

  constructor(executionMode: ToolBudgetExecutionMode, options?: ToolBudgetPolicyOptions) {
    this.executionMode = executionMode;
    this.loopLimitOverrides = options?.loopLimitOverrides ?? null;
    this.perToolCapOverrides = options?.perToolCapOverrides ?? null;
    this.perToolCounts = new Map<string, number>();
  }

  loopLimit(): number {
    return resolveLoopLimit(this.executionMode, this.loopLimitOverrides);
  }

  executionModeName(): ToolBudgetExecutionMode {
    return this.executionMode;
  }

  perToolCap(toolName: string): number | null {
    return resolvePerToolCap(toolName, this.perToolCapOverrides);
  }

  observedToolCount(toolName: string): number {
    return this.perToolCounts.get(toolName) ?? 0;
  }

  /**
   * Decide whether a tool call should execute or be substituted with a
   * `tool_budget_exhausted` outcome. The `iterationIndex` is 0-based, so
   * `iterationIndex >= loopLimit()` means "we are in the wrap-up window
   * after the iteration cap has already been used".
   *
   * On a non-exhausted reservation the per-tool counter is incremented so
   * subsequent calls in the same turn see the new total. On an exhausted
   * reservation no counter mutates (the call did not actually run).
   */
  reserve(toolName: string, iterationIndex: number): ToolBudgetReservation {
    const limit = this.loopLimit();
    if (iterationIndex >= limit) {
      return {
        exhausted: true,
        reason: "loop_limit",
        limit,
        observed: iterationIndex + 1
      };
    }
    const cap = this.perToolCap(toolName);
    const observed = this.observedToolCount(toolName);
    if (cap !== null && observed >= cap) {
      return {
        exhausted: true,
        reason: "per_tool_cap",
        limit: cap,
        observed: observed + 1
      };
    }
    this.perToolCounts.set(toolName, observed + 1);
    return { exhausted: false };
  }
}

/**
 * Resolve the effective per-tool cap a *projection* layer (or any caller)
 * should advertise for a tool, given the optional per-tool overrides. Used
 * by `native-tool-projection.ts` so the model-facing tool description shows
 * the cap that will actually apply at runtime, not the bare code default.
 */
export function resolveAdvertisedPerTurnCap(
  toolName: string,
  overrides: ToolPerTurnCapOverrides
): number | null {
  return resolvePerToolCap(toolName, overrides);
}

/**
 * Shape of the structured tool result the runtime returns when a tool call
 * is rejected by the budget policy. Kept stable so the smoke harness
 * (S0 / `scripts/smoke/run-scenario.ts`) and downstream slices (R1
 * `requestedBudget`, R2 parallel calls, R3 compound tools) can detect and
 * report the event without a contract change.
 */
export interface ToolBudgetExhaustedResult {
  toolCode: string;
  action: "skipped";
  reason: "tool_budget_exhausted";
  budgetReason: ToolBudgetExhaustionReason;
  limit: number;
  observed: number;
  hint: string;
}

export function createToolBudgetExhaustedResult(input: {
  toolName: string;
  reservation: Extract<ToolBudgetReservation, { exhausted: true }>;
}): ToolBudgetExhaustedResult {
  return {
    toolCode: input.toolName,
    action: "skipped",
    reason: "tool_budget_exhausted",
    budgetReason: input.reservation.reason,
    limit: input.reservation.limit,
    observed: input.reservation.observed,
    hint:
      input.reservation.reason === "loop_limit"
        ? "Tool loop budget reached for this turn; respond honestly with what you already have."
        : `Per-tool cap of ${String(input.reservation.limit)} reached for ${input.toolName} this turn; respond honestly with what you already have.`
  };
}
