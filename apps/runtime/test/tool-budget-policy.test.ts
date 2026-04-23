import assert from "node:assert/strict";
import {
  TOOL_HARD_CAP_PER_TURN,
  TOOL_LOOP_LIMIT_BY_MODE,
  ToolBudgetPolicy,
  createToolBudgetExhaustedResult
} from "../src/modules/turns/tool-budget-policy";

/**
 * ADR-074 Slice L1 — Tool budget policy unit tests.
 *
 * The failure messages on each `assert` deliberately name the bug class so
 * a future regression points the reader straight at the correct slice. Do
 * not weaken these messages.
 */
export async function runToolBudgetPolicyTest(): Promise<void> {
  // ── Loop limits per execution mode (founder-confirmed Q9-C part 1) ──
  assert.equal(
    TOOL_LOOP_LIMIT_BY_MODE.normal,
    2,
    "ADR-074 L1 regression: TOOL_LOOP_LIMIT_BY_MODE.normal must be 2 (founder-confirmed in Q9-C part 1; do not weaken without re-asking)."
  );
  assert.equal(
    TOOL_LOOP_LIMIT_BY_MODE.premium,
    4,
    "ADR-074 L1 regression: TOOL_LOOP_LIMIT_BY_MODE.premium must be 4 (founder-confirmed in Q9-C part 1)."
  );
  assert.equal(
    TOOL_LOOP_LIMIT_BY_MODE.reasoning,
    8,
    "ADR-074 L1 regression: TOOL_LOOP_LIMIT_BY_MODE.reasoning must be 8 (founder-confirmed in Q9-C part 1)."
  );

  // ── Per-tool hard caps per turn (founder-confirmed Q9-C part 1) ──
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["web_fetch"],
    5,
    "ADR-074 L1 regression: TOOL_HARD_CAP_PER_TURN.web_fetch must be 5."
  );
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["web_search"],
    3,
    "ADR-074 L1 regression: TOOL_HARD_CAP_PER_TURN.web_search must be 3."
  );
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["image_generate"],
    1,
    "ADR-074 L1 regression: TOOL_HARD_CAP_PER_TURN.image_generate must be 1."
  );
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["image_edit"],
    1,
    "ADR-074 L1 regression: TOOL_HARD_CAP_PER_TURN.image_edit must be 1."
  );
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["video_generate"],
    1,
    "ADR-074 L1 regression: TOOL_HARD_CAP_PER_TURN.video_generate must be 1."
  );
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["memory_write"],
    undefined,
    "ADR-074 L1 regression: memory_write MUST NOT have a per-turn cap (memory writes are unlimited within the loop budget)."
  );
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["compact_context"],
    undefined,
    "ADR-074 L1 regression: compact_context MUST NOT have a per-turn cap."
  );
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["summarize_context"],
    undefined,
    "ADR-074 L1 regression: summarize_context MUST NOT have a per-turn cap."
  );

  // ── ToolBudgetPolicy.loopLimit() reflects the resolved mode ──
  assert.equal(new ToolBudgetPolicy("normal").loopLimit(), 2);
  assert.equal(new ToolBudgetPolicy("premium").loopLimit(), 4);
  assert.equal(new ToolBudgetPolicy("reasoning").loopLimit(), 8);

  // ── perToolCap returns null for tools without an explicit cap ──
  const normalPolicy = new ToolBudgetPolicy("normal");
  assert.equal(normalPolicy.perToolCap("web_fetch"), 5);
  assert.equal(normalPolicy.perToolCap("memory_write"), null);
  assert.equal(normalPolicy.perToolCap("knowledge_search"), null);

  // ── Per-tool cap exhausts after `cap` successful reservations ──
  const webFetchPolicy = new ToolBudgetPolicy("reasoning"); // big loop budget so it is not the limiter
  for (let index = 0; index < 5; index += 1) {
    const reservation = webFetchPolicy.reserve("web_fetch", 0);
    assert.equal(
      reservation.exhausted,
      false,
      `ADR-074 L1 regression: web_fetch call #${String(index + 1)} must reserve cleanly (cap is 5).`
    );
  }
  const sixthFetch = webFetchPolicy.reserve("web_fetch", 0);
  assert.equal(sixthFetch.exhausted, true);
  if (sixthFetch.exhausted === true) {
    assert.equal(
      sixthFetch.reason,
      "per_tool_cap",
      "ADR-074 L1 regression: 6th web_fetch reservation must be rejected as per_tool_cap, not loop_limit."
    );
    assert.equal(sixthFetch.limit, 5);
    assert.equal(sixthFetch.observed, 6);
  }
  // Once exhausted, the per-tool counter does NOT keep growing — repeat
  // calls keep reporting the same `observed = limit + 1` snapshot rather
  // than inflating to limit+2, +3, etc. Without this, the smoke harness
  // would over-count the model's "budget exhausted" attempts.
  const seventhFetch = webFetchPolicy.reserve("web_fetch", 0);
  if (seventhFetch.exhausted === true) {
    assert.equal(
      seventhFetch.observed,
      6,
      "ADR-074 L1 regression: an exhausted reservation must NOT mutate the per-tool counter (got >cap+1, which means the counter kept growing)."
    );
  }

  // ── Loop limit exhausts on iteration index >= mode limit ──
  const loopPolicy = new ToolBudgetPolicy("normal"); // loopLimit = 2
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const reservation = loopPolicy.reserve("memory_write", iteration);
    assert.equal(
      reservation.exhausted,
      false,
      `ADR-074 L1 regression: iteration ${String(iteration)} must execute (loopLimit=2 means iterations 0..1 are real).`
    );
  }
  const wrapUpReservation = loopPolicy.reserve("memory_write", 2);
  assert.equal(wrapUpReservation.exhausted, true);
  if (wrapUpReservation.exhausted === true) {
    assert.equal(
      wrapUpReservation.reason,
      "loop_limit",
      "ADR-074 L1 regression: iteration index 2 in normal mode (loopLimit=2) must be rejected as loop_limit, NOT per_tool_cap (memory_write has no per-tool cap)."
    );
    assert.equal(wrapUpReservation.limit, 2);
    assert.equal(wrapUpReservation.observed, 3);
  }

  // ── Loop-limit exhaustion does NOT bump per-tool counters either ──
  // (memory_write would otherwise look like it was called when it wasn't.)
  const carry = new ToolBudgetPolicy("normal");
  carry.reserve("web_fetch", 0); // observed=1
  const afterLoopExhaustion = carry.reserve("web_fetch", 5);
  if (afterLoopExhaustion.exhausted === true) {
    assert.equal(afterLoopExhaustion.reason, "loop_limit");
  }
  // If the observed counter was bumped on exhaustion, the next legitimate
  // reservation in iteration 0 would see `observed >= cap` prematurely.
  const nextWebFetch = carry.reserve("web_fetch", 0);
  assert.equal(
    nextWebFetch.exhausted,
    false,
    "ADR-074 L1 regression: a loop-limit exhaustion must not mutate per-tool counters (the next in-budget call must still be allowed)."
  );

  // ── createToolBudgetExhaustedResult shape (smoke-harness contract) ──
  const exhausted = createToolBudgetExhaustedResult({
    toolName: "web_search",
    reservation: {
      exhausted: true,
      reason: "per_tool_cap",
      limit: 3,
      observed: 4
    }
  });
  assert.equal(exhausted.toolCode, "web_search");
  assert.equal(exhausted.action, "skipped");
  assert.equal(exhausted.reason, "tool_budget_exhausted");
  assert.equal(exhausted.budgetReason, "per_tool_cap");
  assert.equal(exhausted.limit, 3);
  assert.equal(exhausted.observed, 4);
  assert.match(
    exhausted.hint,
    /per-tool cap.*web_search/i,
    "ADR-074 L1 regression: per_tool_cap exhaustion hint must name the tool so the model wraps up correctly."
  );

  const loopExhausted = createToolBudgetExhaustedResult({
    toolName: "knowledge_search",
    reservation: {
      exhausted: true,
      reason: "loop_limit",
      limit: 2,
      observed: 3
    }
  });
  assert.equal(loopExhausted.budgetReason, "loop_limit");
  assert.match(
    loopExhausted.hint,
    /tool loop budget reached/i,
    "ADR-074 L1 regression: loop_limit exhaustion hint must surface 'tool loop budget reached'."
  );

  // ── ADR-074 L1: per-assistant overrides via bundle/tool-policy ──
  // A bundle that says "normal mode gets 5 iterations" must override the
  // code default of 2 — that's the whole point of making this configurable
  // (founder Q9-C revision: numbers are tuned per model, not hard-coded).
  const overriddenLoop = new ToolBudgetPolicy("normal", {
    loopLimitOverrides: { normal: 5, premium: null, reasoning: null }
  });
  assert.equal(
    overriddenLoop.loopLimit(),
    5,
    "ADR-074 L1 regression: bundle override loopLimitByMode.normal=5 must replace the code default of 2."
  );

  // A `null`, missing, or non-positive override is rejected and the code
  // default applies. Without this guard a misconfigured bundle could turn
  // the tool loop off (loopLimit=0) and silently break every tool-using turn.
  assert.equal(
    new ToolBudgetPolicy("normal", { loopLimitOverrides: { normal: null } }).loopLimit(),
    2,
    "ADR-074 L1 regression: a null override must fall back to the code default."
  );
  assert.equal(
    new ToolBudgetPolicy("normal", { loopLimitOverrides: { normal: 0 } }).loopLimit(),
    2,
    "ADR-074 L1 regression: a non-positive override must be ignored so a misconfigured bundle cannot disable the tool loop."
  );
  assert.equal(
    new ToolBudgetPolicy("normal", { loopLimitOverrides: { normal: -3 } }).loopLimit(),
    2,
    "ADR-074 L1 regression: a negative override must be ignored."
  );
  assert.equal(
    new ToolBudgetPolicy("normal", { loopLimitOverrides: null }).loopLimit(),
    2,
    "ADR-074 L1 regression: a null overrides bag must fall back to code defaults."
  );

  // Per-tool cap override on a normally-capped tool: bundle wants web_fetch
  // with a higher cap of 10 on this assistant.
  const liftedCapPolicy = new ToolBudgetPolicy("reasoning", {
    perToolCapOverrides: new Map([["web_fetch", 10]])
  });
  assert.equal(
    liftedCapPolicy.perToolCap("web_fetch"),
    10,
    "ADR-074 L1 regression: RuntimeToolPolicy.perTurnCap=10 must replace the code default of 5 for web_fetch."
  );
  for (let index = 0; index < 10; index += 1) {
    const reservation = liftedCapPolicy.reserve("web_fetch", 0);
    assert.equal(
      reservation.exhausted,
      false,
      `ADR-074 L1 regression: lifted web_fetch cap (10) must allow call #${String(index + 1)}.`
    );
  }
  const eleventhFetch = liftedCapPolicy.reserve("web_fetch", 0);
  assert.equal(eleventhFetch.exhausted, true);
  if (eleventhFetch.exhausted === true) {
    assert.equal(eleventhFetch.limit, 10);
  }

  // Per-tool override can ADD a cap to a tool that had no code default.
  // (Bundles can choose to throttle e.g. memory_write or knowledge_search.)
  const cappedKnowledge = new ToolBudgetPolicy("reasoning", {
    perToolCapOverrides: new Map([["knowledge_search", 2]])
  });
  assert.equal(cappedKnowledge.perToolCap("knowledge_search"), 2);
  cappedKnowledge.reserve("knowledge_search", 0);
  cappedKnowledge.reserve("knowledge_search", 0);
  const thirdKnowledge = cappedKnowledge.reserve("knowledge_search", 0);
  if (thirdKnowledge.exhausted === true) {
    assert.equal(thirdKnowledge.reason, "per_tool_cap");
    assert.equal(thirdKnowledge.limit, 2);
  } else {
    assert.fail(
      "ADR-074 L1 regression: a bundle override of perTurnCap=2 on knowledge_search must rate-limit it even though there is no code default."
    );
  }

  // A non-positive per-tool override is ignored and the code default (or
  // null) applies. Same defensive reason as the loop-limit override above.
  const ignoredCap = new ToolBudgetPolicy("reasoning", {
    perToolCapOverrides: new Map([["web_fetch", 0]])
  });
  assert.equal(
    ignoredCap.perToolCap("web_fetch"),
    5,
    "ADR-074 L1 regression: a non-positive perTurnCap override must be ignored so the code default still applies."
  );

  // To genuinely "uncap" a normally-capped tool, the bundle must set a very
  // large positive number (Number.MAX_SAFE_INTEGER is the documented sentinel).
  const uncapped = new ToolBudgetPolicy("reasoning", {
    perToolCapOverrides: new Map([["image_generate", Number.MAX_SAFE_INTEGER]])
  });
  for (let index = 0; index < 50; index += 1) {
    const reservation = uncapped.reserve("image_generate", 0);
    assert.equal(
      reservation.exhausted,
      false,
      `ADR-074 L1 regression: image_generate uncapped via Number.MAX_SAFE_INTEGER override must allow call #${String(index + 1)} without per-tool exhaustion.`
    );
  }
}
