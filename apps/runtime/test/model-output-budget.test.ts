import assert from "node:assert/strict";
import {
  resolveModelOutputBudget,
  OUTPUT_BUDGET_MAX,
  OUTPUT_BUDGET_FALLBACK,
  OUTPUT_BUDGET_FLOOR,
  CONTEXT_SAFETY_RESERVE
} from "../src/modules/turns/model-output-budget";

/**
 * ADR-122 Slice 2 — resolveModelOutputBudget unit tests (corrected formula).
 *
 * The resolver returns the ANSWER budget; the Anthropic gateway adds the
 * thinking budget on top so that `answer + thinkingBudget` fits both the model
 * output ceiling and the context window. Cases mirror the corrective brief:
 *   (a) thinking subtracted so answer+thinking == totalCeiling
 *   (b) null maxOutputTokens → OUTPUT_BUDGET_FALLBACK governs
 *   (c) context-window binding subtracts input + reserve
 *   (d) floor when totalRoom - thinking is tiny/negative
 *   (e) OUTPUT_BUDGET_MAX clamps an absurd admin maxOutputTokens
 */
export async function runModelOutputBudgetTest(): Promise<void> {
  // ── Case (a): thinking subtracted; answer + thinking == totalCeiling ────
  // opus maxOutputTokens=128_000, thinkingBudget=32_768, no context guard.
  // totalCeiling = min(128_000, 128_000) = 128_000; answer = 128_000 - 32_768 = 95_232.
  {
    const answer = resolveModelOutputBudget(
      { maxOutputTokens: 128_000, contextWindow: 200_000 },
      { inputTokensEstimate: null, thinkingBudget: 32_768 }
    );
    assert.equal(
      answer,
      95_232,
      "Case (a): opus(128k) + thinking(32768) → answer 95232 (so answer+thinking == 128000 ceiling)"
    );
    assert.equal(
      answer + 32_768,
      128_000,
      "Case (a): answer + thinkingBudget must equal the 128k total ceiling (no overflow)"
    );
  }

  // ── Case (b): null maxOutputTokens → OUTPUT_BUDGET_FALLBACK governs ──────
  {
    const answer = resolveModelOutputBudget(
      { maxOutputTokens: null, contextWindow: null },
      { inputTokensEstimate: null, thinkingBudget: 0 }
    );
    assert.equal(
      answer,
      OUTPUT_BUDGET_FALLBACK,
      "Case (b): null maxOutputTokens with no thinking must return OUTPUT_BUDGET_FALLBACK (8192)"
    );
  }

  // null maxOutputTokens + thinking subtracted from the fallback base.
  {
    const answer = resolveModelOutputBudget(
      { maxOutputTokens: null, contextWindow: null },
      { inputTokensEstimate: null, thinkingBudget: 2_000 }
    );
    assert.equal(
      answer,
      OUTPUT_BUDGET_FALLBACK - 2_000,
      "Case (b'): fallback base minus thinking budget (8192 - 2000 = 6192)"
    );
  }

  // ── Case (c): context-window binding subtracts input + reserve ──────────
  // contextWindow=100_000, input=40_000, maxOutputTokens=80_000, no thinking.
  // totalCeiling = min(80_000, 128_000) = 80_000.
  // ctxRoom = 100_000 - 40_000 - 4_096 = 55_904 < 80_000 → totalRoom = 55_904.
  // answer = 55_904 - 0 = 55_904.
  {
    const answer = resolveModelOutputBudget(
      { maxOutputTokens: 80_000, contextWindow: 100_000 },
      { inputTokensEstimate: 40_000, thinkingBudget: 0 }
    );
    const expected = 100_000 - 40_000 - CONTEXT_SAFETY_RESERVE;
    assert.equal(
      answer,
      expected,
      "Case (c): context-window guard binds (totalRoom = contextWindow - input - reserve)"
    );
  }

  // context-window binding WITH thinking also subtracted.
  // ctxRoom = 100_000 - 40_000 - 4_096 = 55_904; answer = 55_904 - 10_000 = 45_904.
  {
    const thinkingBudget = 10_000;
    const answer = resolveModelOutputBudget(
      { maxOutputTokens: 80_000, contextWindow: 100_000 },
      { inputTokensEstimate: 40_000, thinkingBudget }
    );
    const expected = 100_000 - 40_000 - CONTEXT_SAFETY_RESERVE - thinkingBudget;
    assert.equal(
      answer,
      expected,
      "Case (c'): thinking is also subtracted after the context-window guard"
    );
  }

  // ── Case (d): floor when totalRoom - thinking is tiny / negative ────────
  // Very small context window → negative totalRoom → floor clamp.
  {
    const answer = resolveModelOutputBudget(
      { maxOutputTokens: 128_000, contextWindow: 8_000 },
      { inputTokensEstimate: 7_000, thinkingBudget: 0 }
    );
    // ctxRoom = 8_000 - 7_000 - 4_096 = -3_096 → floor
    assert.equal(
      answer,
      OUTPUT_BUDGET_FLOOR,
      "Case (d): degenerate negative totalRoom must clamp to OUTPUT_BUDGET_FLOOR"
    );
  }

  // floor when thinking budget swallows the whole total room.
  {
    const answer = resolveModelOutputBudget(
      { maxOutputTokens: 8_192, contextWindow: null },
      { inputTokensEstimate: null, thinkingBudget: 8_192 }
    );
    // answer = 8_192 - 8_192 = 0 → floor
    assert.equal(
      answer,
      OUTPUT_BUDGET_FLOOR,
      "Case (d'): thinking budget consuming the whole ceiling must clamp to floor"
    );
  }

  // ── Case (e): OUTPUT_BUDGET_MAX clamps an absurd admin maxOutputTokens ──
  {
    const answer = resolveModelOutputBudget(
      { maxOutputTokens: 999_999, contextWindow: null },
      { inputTokensEstimate: null, thinkingBudget: 0 }
    );
    assert.equal(
      answer,
      OUTPUT_BUDGET_MAX,
      "Case (e): maxOutputTokens above OUTPUT_BUDGET_MAX must be clamped down to 128000"
    );
  }

  // ── Edge: inputTokensEstimate null → context guard skipped ──────────────
  {
    const answer = resolveModelOutputBudget(
      { maxOutputTokens: 16_384, contextWindow: 128_000 },
      { inputTokensEstimate: null, thinkingBudget: 0 }
    );
    assert.equal(
      answer,
      16_384,
      "Edge: null inputTokensEstimate skips the context guard; totalCeiling governs"
    );
  }

  // ── Edge: normal sonnet long answer, no thinking, plenty of context room ─
  // sonnet maxOutputTokens=64_000, contextWindow=200_000, input=2_000.
  // ctxRoom = 200_000 - 2_000 - 4_096 = 193_904 >> 64_000 → totalRoom = 64_000.
  {
    const answer = resolveModelOutputBudget(
      { maxOutputTokens: 64_000, contextWindow: 200_000 },
      { inputTokensEstimate: 2_000, thinkingBudget: 0 }
    );
    assert.equal(
      answer,
      64_000,
      "Edge: sonnet long answer returns its 64k ceiling when context has room and no thinking"
    );
  }

  console.log("model-output-budget.test.ts: ok");
}
