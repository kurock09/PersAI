import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import {
  PERSAI_PLAN_THINKING_BUDGET_BY_LEVEL_SCHEMA,
  createDefaultPlanThinkingBudgetByLevel,
  hasAnyThinkingBudgetOverride,
  parsePlanThinkingBudgetByLevel,
  resolveStoredPlanThinkingBudgetByLevel,
  toPlanThinkingBudgetByLevelDocument
} from "../src/modules/workspace-management/application/thinking-budgets-policy";

function run(): void {
  // Default = all nulls; absence-of-override is detected.
  const def = createDefaultPlanThinkingBudgetByLevel();
  assert.deepEqual(def, { light: null, medium: null, heavy: null, deep: null });
  assert.equal(hasAnyThinkingBudgetOverride(def), false);

  // Round-trip: serialize → resolveStored → identical struct.
  const doc = toPlanThinkingBudgetByLevelDocument({
    light: 0,
    medium: 0,
    heavy: 4096,
    deep: 16384
  });
  assert.equal(
    (doc as { schema: string }).schema,
    PERSAI_PLAN_THINKING_BUDGET_BY_LEVEL_SCHEMA,
    "schema marker is emitted so future readers can branch on version"
  );
  const reread = resolveStoredPlanThinkingBudgetByLevel(doc);
  assert.deepEqual(reread, { light: 0, medium: 0, heavy: 4096, deep: 16384 });
  assert.equal(hasAnyThinkingBudgetOverride(reread), true);

  // hasAnyThinkingBudgetOverride: 0 is a non-null leaf → override present.
  assert.equal(
    hasAnyThinkingBudgetOverride({ light: 0, medium: null, heavy: null, deep: null }),
    true
  );

  // Strict parser accepts null on every leaf (= "use resolver default").
  const parsedAllNull = parsePlanThinkingBudgetByLevel({
    light: null,
    medium: null,
    heavy: null,
    deep: null
  });
  assert.deepEqual(parsedAllNull, def);

  // Strict parser accepts 0 on every leaf (= "thinking off").
  const parsedAllZero = parsePlanThinkingBudgetByLevel({
    light: 0,
    medium: 0,
    heavy: 0,
    deep: 0
  });
  assert.deepEqual(parsedAllZero, { light: 0, medium: 0, heavy: 0, deep: 0 });

  // Strict parser accepts a partial override.
  const parsedPartial = parsePlanThinkingBudgetByLevel({
    light: null,
    medium: null,
    heavy: 8192,
    deep: null
  });
  assert.deepEqual(parsedPartial, { light: null, medium: null, heavy: 8192, deep: null });

  // Strict parser rejects negatives.
  for (const bad of [-1, -100]) {
    assert.throws(
      () =>
        parsePlanThinkingBudgetByLevel({
          light: bad as unknown as number,
          medium: null,
          heavy: null,
          deep: null
        }),
      (err) => err instanceof BadRequestException && err.message.includes("light"),
      `expected rejection for light=${String(bad)}`
    );
  }

  // Strict parser rejects non-integers (fractional, NaN, string, boolean).
  for (const bad of [1.5, Number.NaN, "5", true]) {
    assert.throws(
      () =>
        parsePlanThinkingBudgetByLevel({
          light: null,
          medium: null,
          heavy: bad as unknown as number,
          deep: null
        }),
      (err) => err instanceof BadRequestException && err.message.includes("heavy"),
      `expected rejection for heavy=${String(bad)}`
    );
  }

  // Strict parser rejects malformed top-level shape.
  assert.throws(
    () => parsePlanThinkingBudgetByLevel("not-an-object"),
    (err) => err instanceof BadRequestException && err.message.includes("must be an object")
  );

  // Lenient resolver: garbage in → defaults out (never throws).
  assert.deepEqual(resolveStoredPlanThinkingBudgetByLevel(null), def);
  assert.deepEqual(resolveStoredPlanThinkingBudgetByLevel(undefined), def);
  assert.deepEqual(resolveStoredPlanThinkingBudgetByLevel("string"), def);
  assert.deepEqual(resolveStoredPlanThinkingBudgetByLevel({ byLevel: "string" }), def);

  // Lenient resolver: valid leaves survive, broken/negative leaves degrade to null.
  const mixed = resolveStoredPlanThinkingBudgetByLevel({
    byLevel: { light: 0, medium: "oops", heavy: -1, deep: 32768 }
  });
  assert.deepEqual(mixed, { light: 0, medium: null, heavy: null, deep: 32768 });
  assert.equal(hasAnyThinkingBudgetOverride(mixed), true);

  // Lenient resolver: byLevel absent → default.
  assert.deepEqual(resolveStoredPlanThinkingBudgetByLevel({ schema: "persai.v1" }), def);
}

run();
