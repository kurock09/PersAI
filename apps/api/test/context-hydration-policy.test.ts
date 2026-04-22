import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import {
  DEFAULT_CROSS_SESSION_CARRY_OVER_TTL_DAYS,
  MAX_CROSS_SESSION_CARRY_OVER_TTL_DAYS,
  MIN_CROSS_SESSION_CARRY_OVER_TTL_DAYS
} from "@persai/runtime-contract";
import {
  createDefaultPlanContextHydrationPolicy,
  parsePlanContextHydrationPolicy,
  resolveStoredPlanContextHydrationPolicy,
  toPlanContextHydrationPolicyDocument
} from "../src/modules/workspace-management/application/context-hydration-policy";

function run(): void {
  // Default policy contains the default TTL.
  const def = createDefaultPlanContextHydrationPolicy();
  assert.equal(def.crossSessionCarryOverTtlDays, DEFAULT_CROSS_SESSION_CARRY_OVER_TTL_DAYS);

  // Round-trip: serialize → parse → identical TTL.
  const doc = toPlanContextHydrationPolicyDocument(def);
  assert.equal(doc.crossSessionCarryOverTtlDays, DEFAULT_CROSS_SESSION_CARRY_OVER_TTL_DAYS);

  const parsed = parsePlanContextHydrationPolicy({
    ...doc,
    crossSessionCarryOverTtlDays: 14
  });
  assert.equal(parsed.crossSessionCarryOverTtlDays, 14);

  // Lower / upper boundary accepted.
  const min = parsePlanContextHydrationPolicy({
    ...doc,
    crossSessionCarryOverTtlDays: MIN_CROSS_SESSION_CARRY_OVER_TTL_DAYS
  });
  assert.equal(min.crossSessionCarryOverTtlDays, MIN_CROSS_SESSION_CARRY_OVER_TTL_DAYS);
  const max = parsePlanContextHydrationPolicy({
    ...doc,
    crossSessionCarryOverTtlDays: MAX_CROSS_SESSION_CARRY_OVER_TTL_DAYS
  });
  assert.equal(max.crossSessionCarryOverTtlDays, MAX_CROSS_SESSION_CARRY_OVER_TTL_DAYS);

  // Below min rejected.
  assert.throws(
    () =>
      parsePlanContextHydrationPolicy({
        ...doc,
        crossSessionCarryOverTtlDays: 0
      }),
    (err) => err instanceof BadRequestException
  );

  // Above max rejected.
  assert.throws(
    () =>
      parsePlanContextHydrationPolicy({
        ...doc,
        crossSessionCarryOverTtlDays: MAX_CROSS_SESSION_CARRY_OVER_TTL_DAYS + 1
      }),
    (err) => err instanceof BadRequestException
  );

  // Wrong type rejected (parsePositiveInteger triggers).
  assert.throws(
    () =>
      parsePlanContextHydrationPolicy({
        ...doc,
        crossSessionCarryOverTtlDays: "seven"
      }),
    (err) => err instanceof BadRequestException
  );

  // resolveStoredPlanContextHydrationPolicy clamps out-of-bounds stored values
  // (forward-compat: never crash on legacy DB rows).
  const clampedHigh = resolveStoredPlanContextHydrationPolicy({
    ...doc,
    crossSessionCarryOverTtlDays: 365
  });
  assert.equal(clampedHigh.crossSessionCarryOverTtlDays, MAX_CROSS_SESSION_CARRY_OVER_TTL_DAYS);

  const clampedLow = resolveStoredPlanContextHydrationPolicy({
    ...doc,
    crossSessionCarryOverTtlDays: -5
  });
  // toLoosePositiveInteger drops -5 → falls back to base default
  assert.equal(clampedLow.crossSessionCarryOverTtlDays, DEFAULT_CROSS_SESSION_CARRY_OVER_TTL_DAYS);
}

run();
