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
  // ADR-074 F4 (2026-04-23): normal raised 2 → 3 to give the model one
  // free self-repair iteration after a structured invalid_arguments error
  // (live trigger: scheduled_action with a malformed actionPayload would
  // exhaust the 2-iteration normal loop and force the model to either lie
  // to the user or surface a generic budget-exhausted message).
  assert.equal(
    TOOL_LOOP_LIMIT_BY_MODE.normal,
    3,
    "ADR-074 F4 regression: TOOL_LOOP_LIMIT_BY_MODE.normal must be 3 (raised from 2 on 2026-04-23 to give one self-repair iteration)."
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

  // ── Per-tool hard caps per turn (L1 founder-confirmed + L1.1 revisions) ──
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
  // ── L1.1 additions (founder-confirmed 2026-04-23 «делай FIX L1.1») ──
  // These caps close the spam holes left open by the original L1 (where
  // tts / browser / exec / shell / files / knowledge_* / memory_write
  // had NO code default and could be invoked unboundedly per turn).
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["tts"],
    3,
    "ADR-074 L1.1 regression: tts default cap must be 3 (cost: per-audio billing)."
  );
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["browser"],
    3,
    "ADR-074 L1.1 regression: browser default cap must be 3 (cost: per-session billing)."
  );
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["exec"],
    5,
    "ADR-074 L1.1 regression: exec default cap must be 5 (cost: sandbox CPU minutes)."
  );
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["shell"],
    5,
    "ADR-074 L1.1 regression: shell default cap must be 5 (cost: sandbox CPU minutes)."
  );
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["files"],
    10,
    "ADR-074 L1.1 regression: files default cap must be 10 (anti-spam, low cost)."
  );
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["scheduled_action"],
    5,
    "ADR-074 L1.1 regression: scheduled_action default cap must be 5 (anti-spam)."
  );
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["knowledge_search"],
    5,
    "ADR-074 L1.1 regression: knowledge_search default cap must be 5 (revises original L1 anchor — generous enough that normal knowledge loops finish unhindered)."
  );
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["knowledge_fetch"],
    10,
    "ADR-074 L1.1 regression: knowledge_fetch default cap must be 10."
  );
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["memory_write"],
    10,
    "ADR-074 L1.1 regression: memory_write default cap must be 10 (revises original L1 anchor — large enough for normal durable-memory writes, tight enough to block runaway loops)."
  );
  // The shared-compaction tools remain absent because the runtime drives
  // them (not the model) at most once per turn — capping them would only
  // complicate the loop without adding cost protection.
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["compact_context"],
    undefined,
    "ADR-074 L1 regression: compact_context MUST NOT have a per-turn cap (runtime-driven, at most once per turn)."
  );
  assert.equal(
    TOOL_HARD_CAP_PER_TURN["summarize_context"],
    undefined,
    "ADR-074 L1 regression: summarize_context MUST NOT have a per-turn cap (runtime-driven, at most once per turn)."
  );

  // ── ToolBudgetPolicy.loopLimit() reflects the resolved mode ──
  assert.equal(new ToolBudgetPolicy("normal").loopLimit(), 3);
  assert.equal(new ToolBudgetPolicy("premium").loopLimit(), 4);
  assert.equal(new ToolBudgetPolicy("reasoning").loopLimit(), 8);

  // ── perToolCap returns the L1.1 default for known tools, null for the rest ──
  const normalPolicy = new ToolBudgetPolicy("normal");
  assert.equal(normalPolicy.perToolCap("web_fetch"), 5);
  assert.equal(
    normalPolicy.perToolCap("memory_write"),
    10,
    "ADR-074 L1.1: memory_write now has a default cap of 10 (revised L1 anchor)."
  );
  assert.equal(
    normalPolicy.perToolCap("knowledge_search"),
    5,
    "ADR-074 L1.1: knowledge_search now has a default cap of 5 (revised L1 anchor)."
  );
  assert.equal(
    normalPolicy.perToolCap("compact_context"),
    null,
    "ADR-074 L1: shared-compaction tools remain uncapped (runtime-driven)."
  );
  assert.equal(
    normalPolicy.perToolCap("never_seen_tool"),
    null,
    "ADR-074 L1: tools absent from the cap table return null (no cap, only loop-limit applies)."
  );

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
  const loopPolicy = new ToolBudgetPolicy("normal"); // loopLimit = 3 (ADR-074 F4)
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const reservation = loopPolicy.reserve("memory_write", iteration);
    assert.equal(
      reservation.exhausted,
      false,
      `ADR-074 F4 regression: iteration ${String(iteration)} must execute (loopLimit=3 means iterations 0..2 are real).`
    );
  }
  const wrapUpReservation = loopPolicy.reserve("memory_write", 3);
  assert.equal(wrapUpReservation.exhausted, true);
  if (wrapUpReservation.exhausted === true) {
    assert.equal(
      wrapUpReservation.reason,
      "loop_limit",
      "ADR-074 F4 regression: iteration index 3 in normal mode (loopLimit=3) must be rejected as loop_limit, NOT per_tool_cap (memory_write has no per-tool cap)."
    );
    assert.equal(wrapUpReservation.limit, 3);
    assert.equal(wrapUpReservation.observed, 4);
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
    "ADR-074 L1 regression: bundle override loopLimitByMode.normal=5 must replace the code default."
  );

  // A `null`, missing, or non-positive override is rejected and the code
  // default applies. Without this guard a misconfigured bundle could turn
  // the tool loop off (loopLimit=0) and silently break every tool-using turn.
  assert.equal(
    new ToolBudgetPolicy("normal", { loopLimitOverrides: { normal: null } }).loopLimit(),
    3,
    "ADR-074 F4 regression: a null override must fall back to the code default (normal=3)."
  );
  assert.equal(
    new ToolBudgetPolicy("normal", { loopLimitOverrides: { normal: 0 } }).loopLimit(),
    3,
    "ADR-074 F4 regression: a non-positive override must be ignored so a misconfigured bundle cannot disable the tool loop."
  );
  assert.equal(
    new ToolBudgetPolicy("normal", { loopLimitOverrides: { normal: -3 } }).loopLimit(),
    3,
    "ADR-074 F4 regression: a negative override must be ignored."
  );
  assert.equal(
    new ToolBudgetPolicy("normal", { loopLimitOverrides: null }).loopLimit(),
    3,
    "ADR-074 F4 regression: a null overrides bag must fall back to code defaults (normal=3)."
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

  // ── ADR-105 Slice 2 — unit-aware per-turn media budgeting ──
  // §3 "no silent split / no silent trim": a single request for N result
  // units is accepted whole if (observed + N ≤ cap), or rejected whole if
  // (observed + N > cap). The per-tool counter advances by N on acceptance
  // and does NOT advance at all on rejection.

  // Case 1: cap=4, request exactly 4 units — the whole batch fits in one
  // call, so the reservation must succeed; a follow-up single-unit request
  // then exhausts the tool for this turn.
  const unitCapPolicy4 = new ToolBudgetPolicy("reasoning", {
    perToolCapOverrides: new Map([["image_generate", 4]])
  });
  const batchOf4 = unitCapPolicy4.reserve("image_generate", 0, 4);
  assert.equal(
    batchOf4.exhausted,
    false,
    "ADR-105 Slice 2: reserve(image_generate, 0, 4) with cap=4 must succeed (0+4 ≤ 4, no silent trim)."
  );
  const afterBatchOf4 = unitCapPolicy4.reserve("image_generate", 0, 1);
  assert.equal(
    afterBatchOf4.exhausted,
    true,
    "ADR-105 Slice 2: reserve(image_generate, 0, 1) after consuming 4/4 units must be exhausted."
  );
  if (afterBatchOf4.exhausted === true) {
    assert.equal(
      afterBatchOf4.reason,
      "per_tool_cap",
      "ADR-105 Slice 2: post-batch exhaustion reason must be per_tool_cap, not loop_limit."
    );
    assert.equal(
      afterBatchOf4.limit,
      4,
      "ADR-105 Slice 2: exhaustion limit must reflect the overridden cap of 4."
    );
    assert.equal(
      afterBatchOf4.observed,
      5,
      "ADR-105 Slice 2: observed must be 4 (consumed) + 1 (requested) = 5."
    );
  }

  // Case 2: cap=1, request 4 units — the whole batch exceeds the cap so it
  // must be rejected whole. Critically, the per-tool counter must NOT
  // advance on rejection, so a subsequent reserve(units=1) is evaluated
  // against observed=0 and succeeds (the single unit fits).
  const unitCapPolicy1 = new ToolBudgetPolicy("reasoning", {
    perToolCapOverrides: new Map([["image_generate", 1]])
  });
  const oversizedRequest = unitCapPolicy1.reserve("image_generate", 0, 4);
  assert.equal(
    oversizedRequest.exhausted,
    true,
    "ADR-105 Slice 2: reserve(image_generate, 0, 4) with cap=1 must be rejected whole (0+4 > 1)."
  );
  if (oversizedRequest.exhausted === true) {
    assert.equal(
      oversizedRequest.reason,
      "per_tool_cap",
      "ADR-105 Slice 2: oversized request rejection reason must be per_tool_cap."
    );
    assert.equal(
      oversizedRequest.limit,
      1,
      "ADR-105 Slice 2: oversized request rejection must report the actual cap as limit."
    );
    assert.equal(
      oversizedRequest.observed,
      4,
      "ADR-105 Slice 2: oversized request rejection must report 0+4=4 as observed."
    );
  }
  // Counter must NOT have advanced — next reserve(1) is still evaluated
  // against observed=0 and must succeed (no silent trim / no partial reserve).
  const singleAfterRejection = unitCapPolicy1.reserve("image_generate", 0, 1);
  assert.equal(
    singleAfterRejection.exhausted,
    false,
    "ADR-105 Slice 2: a rejected oversized request must not advance the per-tool counter (reserve(1) after rejection must still succeed with cap=1, observed=0)."
  );

  // Case 3: requestedUnits default still behaves as 1 for non-media tools
  // (regression guard — the ADR-105 unit parameter must not change existing
  // one-call-one-unit accounting for tools that omit it).
  const defaultUnitsPolicy = new ToolBudgetPolicy("reasoning", {
    perToolCapOverrides: new Map([["web_fetch", 3]])
  });
  for (let index = 0; index < 3; index += 1) {
    const res = defaultUnitsPolicy.reserve("web_fetch", 0);
    assert.equal(
      res.exhausted,
      false,
      `ADR-105 Slice 2 regression: web_fetch call #${String(index + 1)} without explicit units must count as 1 (default).`
    );
  }
  const fourthDefaultFetch = defaultUnitsPolicy.reserve("web_fetch", 0);
  assert.equal(
    fourthDefaultFetch.exhausted,
    true,
    "ADR-105 Slice 2 regression: 4th web_fetch call (cap=3, default units=1) must be exhausted."
  );
  if (fourthDefaultFetch.exhausted === true) {
    assert.equal(
      fourthDefaultFetch.reason,
      "per_tool_cap",
      "ADR-105 Slice 2 regression: default-units exhaustion must report per_tool_cap."
    );
    assert.equal(
      fourthDefaultFetch.observed,
      4,
      "ADR-105 Slice 2 regression: default-units observed must be 3 (consumed) + 1 (requested) = 4."
    );
  }
}
