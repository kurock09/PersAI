import assert from "node:assert/strict";
import { assembleWorkingNotesAndAnswer } from "../src/modules/turns/turn-execution.service";

/**
 * Multi-step working-notes assembly unit tests.
 *
 * Contract (Variant 2 — multi-step working notes):
 *   - workingNotes  = the per-step pre-tool texts, trimmed, non-empty, in order
 *     (each note exactly once; whitespace-only steps dropped).
 *   - answerText    = the final-iteration answer ONLY (no notes).
 *   - assistantText = the cumulative corrected full text verbatim (each note
 *     once + the answer), never reconstructed from notes + answer.
 *
 * These assertions encode the anti-duplication invariant: the answer is fed
 * from the final-iteration text, NEVER the cumulative text that already
 * contains every note.
 */
export async function runAssembleWorkingNotesAndAnswerTest(): Promise<void> {
  // ── Invariant 1: two tool steps + final answer ──
  // notes are captured per-step; the answer is the final-iteration text only;
  // the full text carries each note exactly once followed by the answer.
  {
    const { workingNotes, answerText, assistantText } = assembleWorkingNotesAndAnswer({
      toolStepTexts: ["First plan.", "Second plan."],
      finalAnswerText: "Final answer.",
      fullAssistantText: "First plan. Second plan. Final answer."
    });
    assert.deepEqual(workingNotes, ["First plan.", "Second plan."]);
    assert.equal(
      answerText,
      "Final answer.",
      "answerText must be the final-iteration answer ONLY — never re-contain the working notes."
    );
    assert.equal(assistantText, "First plan. Second plan. Final answer.");
    // No note is duplicated into the answer.
    assert.equal(answerText.includes("First plan."), false);
    assert.equal(answerText.includes("Second plan."), false);
    // Each note appears exactly once in the full text.
    assert.equal(assistantText.split("First plan.").length - 1, 1);
    assert.equal(assistantText.split("Second plan.").length - 1, 1);
  }

  // ── Invariant 2: no tools ran → no notes; answer === full text ──
  {
    const { workingNotes, answerText, assistantText } = assembleWorkingNotesAndAnswer({
      toolStepTexts: [],
      finalAnswerText: "Full answer with no tools.",
      fullAssistantText: "Full answer with no tools."
    });
    assert.deepEqual(workingNotes, []);
    assert.equal(answerText, "Full answer with no tools.");
    assert.equal(assistantText, "Full answer with no tools.");
  }

  // ── Invariant 3: empty final answer after tools → answerText "" ──
  // assistantText keeps the cumulative notes (already trimmed upstream).
  {
    const { workingNotes, answerText, assistantText } = assembleWorkingNotesAndAnswer({
      toolStepTexts: ["First plan.", "Second plan."],
      finalAnswerText: "",
      fullAssistantText: "First plan. Second plan."
    });
    assert.deepEqual(workingNotes, ["First plan.", "Second plan."]);
    assert.equal(answerText, "");
    assert.equal(assistantText, "First plan. Second plan.");
  }

  // ── Invariant 4: whitespace-only step note is dropped ──
  {
    const { workingNotes } = assembleWorkingNotesAndAnswer({
      toolStepTexts: ["Real note.", "   \n  ", "Another note."],
      finalAnswerText: "Done.",
      fullAssistantText: "Real note. Another note. Done."
    });
    assert.deepEqual(
      workingNotes,
      ["Real note.", "Another note."],
      "whitespace-only step text must not become a working note."
    );
  }

  // ── Invariant 5: notes are trimmed but order is preserved ──
  {
    const { workingNotes } = assembleWorkingNotesAndAnswer({
      toolStepTexts: ["  Step zero.  ", "\nStep one.\n"],
      finalAnswerText: "Answer.",
      fullAssistantText: "Step zero. Step one. Answer."
    });
    assert.deepEqual(workingNotes, ["Step zero.", "Step one."]);
  }

  console.log("assemble-working-notes-and-answer.test.ts: ok");
}
