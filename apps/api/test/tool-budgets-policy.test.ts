import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import {
  PERSAI_PLAN_TOOL_BUDGETS_SCHEMA,
  createDefaultPlanToolBudgets,
  hasAnyToolBudgetOverride,
  parsePlanToolBudgets,
  resolveStoredPlanToolBudgets,
  toPlanToolBudgetsDocument
} from "../src/modules/workspace-management/application/tool-budgets-policy";

function run(): void {
  // Default = all nulls; absence-of-override is detected.
  const def = createDefaultPlanToolBudgets();
  assert.deepEqual(def, {
    loopLimitByMode: { normal: null, premium: null, reasoning: null }
  });
  assert.equal(hasAnyToolBudgetOverride(def), false);

  // Round-trip: serialize → resolveStored → identical struct.
  const doc = toPlanToolBudgetsDocument({
    loopLimitByMode: { normal: 3, premium: 6, reasoning: 12 }
  });
  assert.equal(
    (doc as { schema: string }).schema,
    PERSAI_PLAN_TOOL_BUDGETS_SCHEMA,
    "schema marker is emitted so future readers can branch on version"
  );
  const reread = resolveStoredPlanToolBudgets(doc);
  assert.deepEqual(reread.loopLimitByMode, { normal: 3, premium: 6, reasoning: 12 });
  assert.equal(hasAnyToolBudgetOverride(reread), true);

  // Strict parser accepts nulls (= "use code default") on every leaf.
  const parsedAllNull = parsePlanToolBudgets({
    loopLimitByMode: { normal: null, premium: null, reasoning: null }
  });
  assert.deepEqual(parsedAllNull, def);

  // Strict parser accepts a partial-override (other modes default).
  const parsedPartial = parsePlanToolBudgets({
    loopLimitByMode: { normal: 2, premium: null, reasoning: null }
  });
  assert.deepEqual(parsedPartial.loopLimitByMode, {
    normal: 2,
    premium: null,
    reasoning: null
  });

  // Strict parser rejects non-positive ints (zero, negative, fractional, NaN).
  for (const bad of [0, -1, 1.5, Number.NaN, "5", true]) {
    assert.throws(
      () =>
        parsePlanToolBudgets({
          loopLimitByMode: { normal: bad as unknown as number, premium: null, reasoning: null }
        }),
      (err) => err instanceof BadRequestException && err.message.includes("loopLimitByMode.normal"),
      `expected rejection for normal=${String(bad)}`
    );
  }

  // Strict parser rejects malformed top-level shapes.
  assert.throws(
    () => parsePlanToolBudgets("not-an-object"),
    (err) => err instanceof BadRequestException && err.message.includes("must be an object")
  );
  assert.throws(
    () => parsePlanToolBudgets({ loopLimitByMode: "nope" }),
    (err) =>
      err instanceof BadRequestException &&
      err.message.includes("loopLimitByMode must be an object")
  );

  // Lenient resolver: garbage in → defaults out (never throws, never blocks compile).
  assert.deepEqual(resolveStoredPlanToolBudgets(null), def);
  assert.deepEqual(resolveStoredPlanToolBudgets(undefined), def);
  assert.deepEqual(resolveStoredPlanToolBudgets("string"), def);
  assert.deepEqual(resolveStoredPlanToolBudgets({ loopLimitByMode: "string" }), def);
  // Mixed garbage: valid leaves survive, broken leaves degrade to null.
  const mixed = resolveStoredPlanToolBudgets({
    loopLimitByMode: { normal: 4, premium: "oops", reasoning: 0 }
  });
  assert.deepEqual(mixed.loopLimitByMode, { normal: 4, premium: null, reasoning: null });
  assert.equal(hasAnyToolBudgetOverride(mixed), true);
}

run();
