import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DEFAULT_THINKING_BUDGET_BY_LEVEL,
  resolveExecutionProfile
} from "../src/modules/turns/execution-profile-resolver";
import type { ExecutionProfile } from "../src/modules/turns/execution-profile-resolver";

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

// ─── ADR-121 Slice 5 — golden grid ───────────────────────────────────────────
// Exhaustive table: 4 levels × 3 plan-override configs → expected full profile.
// Config 1: no override (default grid).
// Config 2: partial override — heavy=4096 only; other three keep defaults.
// Config 3: full override — all four levels overridden; modelRole/executionMode
//           must remain unchanged (overrides control only thinkingBudget).
describe("ADR-121 Slice 5 — golden grid", () => {
  type LevelKey = "light" | "medium" | "heavy" | "deep";

  type GoldenRow = {
    label: string;
    level: LevelKey;
    overrides?: Partial<Record<LevelKey, number>>;
    expected: Pick<ExecutionProfile, "executionMode" | "modelRole" | "thinkingBudget">;
  };

  const goldenGrid: GoldenRow[] = [
    // ── Config 1: no override ──────────────────────────────────────────────
    {
      label: "no-override|light",
      level: "light",
      expected: { executionMode: "normal", modelRole: "normal_reply", thinkingBudget: 0 }
    },
    {
      label: "no-override|medium",
      level: "medium",
      expected: { executionMode: "premium", modelRole: "premium_reply", thinkingBudget: 0 }
    },
    {
      label: "no-override|heavy",
      level: "heavy",
      expected: { executionMode: "premium", modelRole: "premium_reply", thinkingBudget: 8192 }
    },
    {
      label: "no-override|deep",
      level: "deep",
      expected: { executionMode: "reasoning", modelRole: "reasoning", thinkingBudget: 32768 }
    },
    // ── Config 2: partial override — heavy=4096, others keep defaults ─────
    {
      label: "partial(heavy=4096)|light",
      level: "light",
      overrides: { heavy: 4096 },
      expected: {
        executionMode: "normal",
        modelRole: "normal_reply",
        thinkingBudget: DEFAULT_THINKING_BUDGET_BY_LEVEL.light
      }
    },
    {
      label: "partial(heavy=4096)|medium",
      level: "medium",
      overrides: { heavy: 4096 },
      expected: {
        executionMode: "premium",
        modelRole: "premium_reply",
        thinkingBudget: DEFAULT_THINKING_BUDGET_BY_LEVEL.medium
      }
    },
    {
      label: "partial(heavy=4096)|heavy",
      level: "heavy",
      overrides: { heavy: 4096 },
      expected: { executionMode: "premium", modelRole: "premium_reply", thinkingBudget: 4096 }
    },
    {
      label: "partial(heavy=4096)|deep",
      level: "deep",
      overrides: { heavy: 4096 },
      expected: {
        executionMode: "reasoning",
        modelRole: "reasoning",
        thinkingBudget: DEFAULT_THINKING_BUDGET_BY_LEVEL.deep
      }
    },
    // ── Config 3: full override — all four levels custom-budgeted ─────────
    {
      label: "full-override|light",
      level: "light",
      overrides: { light: 100, medium: 200, heavy: 300, deep: 400 },
      expected: { executionMode: "normal", modelRole: "normal_reply", thinkingBudget: 100 }
    },
    {
      label: "full-override|medium",
      level: "medium",
      overrides: { light: 100, medium: 200, heavy: 300, deep: 400 },
      expected: { executionMode: "premium", modelRole: "premium_reply", thinkingBudget: 200 }
    },
    {
      label: "full-override|heavy",
      level: "heavy",
      overrides: { light: 100, medium: 200, heavy: 300, deep: 400 },
      expected: { executionMode: "premium", modelRole: "premium_reply", thinkingBudget: 300 }
    },
    {
      label: "full-override|deep",
      level: "deep",
      overrides: { light: 100, medium: 200, heavy: 300, deep: 400 },
      expected: { executionMode: "reasoning", modelRole: "reasoning", thinkingBudget: 400 }
    }
  ];

  for (const row of goldenGrid) {
    test(row.label, () => {
      const profile = resolveExecutionProfile(row.level, row.overrides);
      assert.equal(profile.level, row.level, `[${row.label}] level`);
      // derivedExecutionMode === profile.executionMode (resolver's output)
      assert.equal(
        profile.executionMode,
        row.expected.executionMode,
        `[${row.label}] executionMode (derivedExecutionMode)`
      );
      assert.equal(profile.modelRole, row.expected.modelRole, `[${row.label}] modelRole`);
      assert.equal(
        profile.thinkingBudget,
        row.expected.thinkingBudget,
        `[${row.label}] thinkingBudget`
      );
    });
  }

  test("overrides change only thinkingBudget — executionMode and modelRole are invariant", () => {
    const fullOverrides: Partial<Record<LevelKey, number>> = {
      light: 100,
      medium: 200,
      heavy: 300,
      deep: 400
    };
    for (const level of ["light", "medium", "heavy", "deep"] as const) {
      const baseline = resolveExecutionProfile(level);
      const overridden = resolveExecutionProfile(level, fullOverrides);
      assert.equal(
        overridden.executionMode,
        baseline.executionMode,
        `[${level}] executionMode must be invariant under override`
      );
      assert.equal(
        overridden.modelRole,
        baseline.modelRole,
        `[${level}] modelRole must be invariant under override`
      );
      assert.equal(
        overridden.thinkingBudget,
        fullOverrides[level],
        `[${level}] thinkingBudget must use override value`
      );
    }
  });
});

// Exported so run-suite-isolated.ts can load and run this file as an isolated
// test. The describe/test blocks above register with node:test and execute
// automatically after this no-op resolves; node:test keeps the process alive
// until all tests complete.
export async function runExecutionProfileResolverTest(): Promise<void> {}
