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
 *      default (they are still bounded by the iteration limit). The L1.1
 *      default shape (revised from the original L1 anchor — see the table
 *      docstring below for the founder-confirmed reasoning) is:
 *      `web_fetch ≤ 5`, `web_search ≤ 3`, `image_generate ≤ 1`,
 *      `image_edit ≤ 1`, `video_generate ≤ 1`, `tts ≤ 3`, `browser ≤ 3`,
 *      `exec ≤ 5`, `shell ≤ 5`, `files ≤ 10`, `scheduled_action ≤ 5`,
 *      `background_task ≤ 5`,
 *      `knowledge_search ≤ 5`, `knowledge_fetch ≤ 10`, `memory_write ≤
 *      10`. The shared-compaction tools (`summarize_context`,
 *      `compact_context`) remain intentionally absent because the runtime
 *      drives them (not the model) at most once per turn.
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

// ADR-074 F4: bumped `normal` from 2 → 3 to give the model one free
// self-repair iteration after a structured tool-call validation error
// (notably `scheduled_action invalid_arguments`). With limit=2 a single
// malformed `actionPayload` immediately exhausted the loop and forced the
// model to either lie to the user ("я поставил") or surface a generic
// "tool budget" message — both observed live on 2026-04-23.
export const TOOL_LOOP_LIMIT_BY_MODE: Readonly<Record<ToolBudgetExecutionMode, number>> = {
  normal: 3,
  premium: 4,
  reasoning: 8
};

/**
 * ADR-074 Slice L1.1 — extended defaults closing the cost-spam holes the
 * original L1 left open (founder live observation: «я сказал сделай 3
 * картинки, он сделал, хотя per-turn cap=1»). The 2026-04-23 audit found
 * three classes of leak:
 *
 *   1. **count-batched tools** — `image_generate.count: 1..4` lets the
 *      model produce N artifacts per single tool call, billed per artifact
 *      by OpenAI but counted as ONE budget unit. Closed in L1.1 by:
 *        - clamping the model-facing schema `count.maximum` to the
 *          effective per-turn cap (so cap=1 ⇒ count=1 mechanically),
 *        - and threading a `units` weight through `consumeToolDailyLimit`
 *          so the daily counter advances by the requested count, not by
 *          the number of tool invocations.
 *
 *   2. **uncapped cost tools** — `tts`, `browser`, `exec`, `shell`, and
 *      `files` had **no** code default at all. A single iteration could
 *      legitimately emit dozens of parallel tool calls (one OpenAI tts
 *      audio each, one Browserbase session each, one Daytona sandbox
 *      command each). L1.1 adds founder-confirmed defaults so an empty
 *      `/admin/plans` per-turn cap means "use the safe default", not
 *      "unlimited".
 *
 *   3. **founder-anchor revision (memory_write / knowledge_search /
 *      knowledge_fetch).** The original L1 deliberately left these
 *      uncapped so durable memory work would not be choked off by the cap
 *      on browse/media tools. L1.1 keeps this *spirit* by setting
 *      generous defaults (memory_write ≤ 10, knowledge_search ≤ 5,
 *      knowledge_fetch ≤ 10) — large enough that normal memory/knowledge
 *      loops finish unhindered, but tight enough that a runaway loop
 *      cannot fan out to hundreds of writes/queries in one iteration.
 *      Re-asked the founder in the 2026-04-23 interview ("делай FIX
 *      L1.1") and got an explicit ack to revise. Documented as a
 *      conscious revision of the original L1 anchor in ADR-074 §L1.1.
 *
 * `summarize_context` and `compact_context` remain absent from the cap
 * table by design — these run at most once per turn from the runtime
 * itself (not driven by the model), so capping them here would only
 * complicate the loop without adding cost protection.
 */
export const TOOL_HARD_CAP_PER_TURN: Readonly<Record<string, number>> = {
  web_fetch: 5,
  web_search: 3,
  image_generate: 1,
  image_edit: 1,
  video_generate: 1,
  tts: 3,
  browser: 3,
  exec: 5,
  shell: 5,
  files: 10,
  scheduled_action: 5,
  background_task: 5,
  knowledge_search: 5,
  knowledge_fetch: 10,
  memory_write: 10
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
