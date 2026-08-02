import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveNoteDisplay } from "../src/modules/turns/note-display";

/**
 * ADR-170 D10 — `resolveNoteDisplay` is a verbatim behavioural port of the
 * client-side `isContentBlock` classifier previously at
 * `apps/web/app/app/_components/chat-message.tsx` (~lines 940-957). These
 * tests cover every branch (table, heading, fenced code, 3+ list lines) plus
 * the negative cases the port must preserve exactly.
 */
describe("resolveNoteDisplay", () => {
  test("a markdown table row renders as content", () => {
    assert.equal(resolveNoteDisplay("Here is the plan:\n| a | b | c |\n| - | - | - |"), "content");
  });

  test("a `##` heading renders as content", () => {
    assert.equal(resolveNoteDisplay("## Summary\nSome detail follows."), "content");
  });

  test("a single `#` heading (not `##`) does NOT render as content on its own", () => {
    assert.equal(resolveNoteDisplay("# Just a single hash heading"), "step");
  });

  test("a fenced code block renders as content", () => {
    assert.equal(resolveNoteDisplay("Running this:\n```\nconsole.log(1);\n```"), "content");
  });

  test("three or more consecutive list lines render as content", () => {
    assert.equal(resolveNoteDisplay("- one\n- two\n- three"), "content");
  });

  test("a numbered list of three or more lines renders as content", () => {
    assert.equal(resolveNoteDisplay("1. one\n2. two\n3. three"), "content");
  });

  test("a list interrupted by a blank line still counts consecutively (content)", () => {
    assert.equal(resolveNoteDisplay("- one\n\n- two\n- three"), "content");
  });

  test("a list interrupted by non-blank text resets the consecutive count (step)", () => {
    assert.equal(resolveNoteDisplay("- one\nsome text breaks the run\n- two\n- three"), "step");
  });

  // ── Negative cases ──

  test("a short connective note with no structural markers stays step", () => {
    assert.equal(resolveNoteDisplay("Let me check that file for you."), "step");
  });

  test("exactly two list lines (below the three-line threshold) stays step", () => {
    assert.equal(resolveNoteDisplay("- one\n- two"), "step");
  });

  test("empty text stays step", () => {
    assert.equal(resolveNoteDisplay(""), "step");
  });

  test("plain multi-sentence prose with no markers stays step", () => {
    assert.equal(
      resolveNoteDisplay("I will look through the workspace now. This should take a moment."),
      "step"
    );
  });
});
