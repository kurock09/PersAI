import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DEFAULT_THINKING_BUDGET_BY_LEVEL,
  resolveExecutionProfile
} from "../src/modules/turns/execution-profile-resolver";

describe("execution-profile-resolver", () => {
  describe("default grid — all four levels", () => {
    test("light → normal_reply / normal / thinkingBudget 0", () => {
      const profile = resolveExecutionProfile("light");
      assert.equal(profile.level, "light");
      assert.equal(profile.modelRole, "normal_reply");
      assert.equal(profile.executionMode, "normal");
      assert.equal(profile.thinkingBudget, 0);
    });

    test("medium → premium_reply / premium / thinkingBudget 0", () => {
      const profile = resolveExecutionProfile("medium");
      assert.equal(profile.level, "medium");
      assert.equal(profile.modelRole, "premium_reply");
      assert.equal(profile.executionMode, "premium");
      assert.equal(profile.thinkingBudget, 0);
    });

    test("heavy → premium_reply / premium / thinkingBudget 8192", () => {
      const profile = resolveExecutionProfile("heavy");
      assert.equal(profile.level, "heavy");
      assert.equal(profile.modelRole, "premium_reply");
      assert.equal(profile.executionMode, "premium");
      assert.equal(profile.thinkingBudget, 8192);
    });

    test("deep → reasoning / reasoning / thinkingBudget 32768", () => {
      const profile = resolveExecutionProfile("deep");
      assert.equal(profile.level, "deep");
      assert.equal(profile.modelRole, "reasoning");
      assert.equal(profile.executionMode, "reasoning");
      assert.equal(profile.thinkingBudget, 32768);
    });
  });

  describe("medium vs heavy — same modelRole, different thinkingBudget", () => {
    test("medium and heavy share premium_reply modelRole", () => {
      const medium = resolveExecutionProfile("medium");
      const heavy = resolveExecutionProfile("heavy");
      assert.equal(medium.modelRole, "premium_reply");
      assert.equal(heavy.modelRole, "premium_reply");
    });

    test("medium and heavy share premium executionMode", () => {
      const medium = resolveExecutionProfile("medium");
      const heavy = resolveExecutionProfile("heavy");
      assert.equal(medium.executionMode, "premium");
      assert.equal(heavy.executionMode, "premium");
    });

    test("medium thinkingBudget is 0, heavy thinkingBudget is 8192", () => {
      const medium = resolveExecutionProfile("medium");
      const heavy = resolveExecutionProfile("heavy");
      assert.equal(medium.thinkingBudget, 0);
      assert.equal(heavy.thinkingBudget, 8192);
      assert.notEqual(medium.thinkingBudget, heavy.thinkingBudget);
    });
  });

  describe("override path", () => {
    test("overrides change thinkingBudget for heavy and deep but not modelRole/executionMode", () => {
      const heavy = resolveExecutionProfile("heavy", { heavy: 12000, deep: 40000 });
      assert.equal(heavy.thinkingBudget, 12000);
      assert.equal(heavy.modelRole, "premium_reply");
      assert.equal(heavy.executionMode, "premium");

      const deep = resolveExecutionProfile("deep", { heavy: 12000, deep: 40000 });
      assert.equal(deep.thinkingBudget, 40000);
      assert.equal(deep.modelRole, "reasoning");
      assert.equal(deep.executionMode, "reasoning");
    });

    test("override of 0 is accepted as a valid budget", () => {
      const heavy = resolveExecutionProfile("heavy", { heavy: 0 });
      assert.equal(heavy.thinkingBudget, 0);
    });

    test("levels not in the override map use the default budget", () => {
      const light = resolveExecutionProfile("light", { heavy: 12000 });
      assert.equal(light.thinkingBudget, DEFAULT_THINKING_BUDGET_BY_LEVEL["light"]);

      const medium = resolveExecutionProfile("medium", { heavy: 12000 });
      assert.equal(medium.thinkingBudget, DEFAULT_THINKING_BUDGET_BY_LEVEL["medium"]);
    });
  });

  describe("invalid override values fall back to default", () => {
    test("negative override is ignored — falls back to default", () => {
      const heavy = resolveExecutionProfile("heavy", { heavy: -1 });
      assert.equal(heavy.thinkingBudget, DEFAULT_THINKING_BUDGET_BY_LEVEL["heavy"]);
    });

    test("NaN override is ignored — falls back to default", () => {
      const deep = resolveExecutionProfile("deep", { deep: NaN });
      assert.equal(deep.thinkingBudget, DEFAULT_THINKING_BUDGET_BY_LEVEL["deep"]);
    });

    test("Infinity override is ignored — falls back to default", () => {
      const heavy = resolveExecutionProfile("heavy", { heavy: Infinity });
      assert.equal(heavy.thinkingBudget, DEFAULT_THINKING_BUDGET_BY_LEVEL["heavy"]);
    });
  });

  describe("level is echoed back on the profile", () => {
    test("all four levels are echoed", () => {
      for (const level of ["light", "medium", "heavy", "deep"] as const) {
        const profile = resolveExecutionProfile(level);
        assert.equal(profile.level, level);
      }
    });
  });
});
