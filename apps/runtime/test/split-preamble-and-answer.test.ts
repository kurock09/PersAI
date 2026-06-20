import assert from "node:assert/strict";
import { splitPreambleAndAnswer } from "../src/modules/turns/turn-execution.service";

/**
 * Tool-loop preamble/answer split unit tests (spec item 6).
 *
 * Regression guard for the ADR-120-era tool-loop persistence bug: the runtime
 * used to set `answerText = providerResult.text` (the FULL preamble+answer
 * text) and `assistantText = preamble + "\n\n" + answerText` (doubling the
 * preamble). The correct contract is:
 *   - assistantText === fullText (the canonical corrected text, single preamble)
 *   - answerText   === fullText with the leading preamble stripped
 *
 * These assertions FAIL on the old inline logic and PASS after the fix.
 */
export async function runSplitPreambleAndAnswerTest(): Promise<void> {
  // ── Invariant 1: tool-loop turn with preamble P + final answer A ──
  // The full text is the merged "P\n\nA"; assistantText is that verbatim and
  // answerText is the answer ONLY. The OLD code produced
  // answerText="P\n\nA" and assistantText="P\n\nP\n\nA" — both rejected here.
  {
    const { answerText, assistantText } = splitPreambleAndAnswer("P\n\nA", "P");
    assert.equal(
      assistantText,
      "P\n\nA",
      "tool-loop split regression: assistantText must equal the full corrected text (single preamble, never reconstructed)."
    );
    assert.equal(
      answerText,
      "A",
      "tool-loop split regression: answerText must be the answer WITHOUT the preamble."
    );
  }

  // Same invariant with the real inline (space) merge separator the runtime
  // actually produces ("P A"), to prove the split is separator-agnostic.
  {
    const { answerText, assistantText } = splitPreambleAndAnswer("P A", "P");
    assert.equal(assistantText, "P A");
    assert.equal(answerText, "A");
  }

  // Multi-sentence preamble + answer.
  {
    const { answerText, assistantText } = splitPreambleAndAnswer(
      "Сейчас проверю документацию. Готовый ответ здесь.",
      "Сейчас проверю документацию."
    );
    assert.equal(assistantText, "Сейчас проверю документацию. Готовый ответ здесь.");
    assert.equal(answerText, "Готовый ответ здесь.");
  }

  // ── Invariant 2: no tools ran → preamble is null → answer === full text ──
  {
    const { answerText, assistantText } = splitPreambleAndAnswer(
      "Full answer with no tools.",
      null
    );
    assert.equal(assistantText, "Full answer with no tools.");
    assert.equal(
      answerText,
      "Full answer with no tools.",
      "no-tools regression: answerText must equal the full text when there is no preamble."
    );
  }

  // ── Invariant 3a: empty answer after tools → answerText "" , assistantText = P ──
  {
    const { answerText, assistantText } = splitPreambleAndAnswer("P", "P");
    assert.equal(
      assistantText,
      "P",
      "empty-answer split: assistantText is the full text (just the preamble)."
    );
    assert.equal(answerText, "", "empty-answer split: answerText collapses to empty.");
  }

  // ── Invariant 3b: whitespace-only preamble is treated as no preamble ──
  {
    const { answerText, assistantText } = splitPreambleAndAnswer("Answer only.", "   \n  ");
    assert.equal(assistantText, "Answer only.");
    assert.equal(answerText, "Answer only.");
  }

  // ── Fallback: preamble cannot be located at the start → keep full text as
  // answer rather than silently dropping content (no startsWith data loss). ──
  {
    const { answerText, assistantText } = splitPreambleAndAnswer(
      "Completely different corrected text.",
      "Original preamble"
    );
    assert.equal(assistantText, "Completely different corrected text.");
    assert.equal(
      answerText,
      "Completely different corrected text.",
      "split fallback: when the preamble is not a prefix, answerText must keep the full text (never silently empty/lossy)."
    );
  }

  console.log("split-preamble-and-answer.test.ts: ok");
}
