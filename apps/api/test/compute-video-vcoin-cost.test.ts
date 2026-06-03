import assert from "node:assert/strict";
import type { RuntimeBillingFacts } from "@persai/runtime-contract";
import { computeVideoVcoinCost } from "../src/modules/workspace-management/application/vcoin/compute-video-vcoin-cost";
import type {
  RuntimeProviderModelProfile,
  RuntimeProviderTimeMeteredModelProfile
} from "../src/modules/workspace-management/application/runtime-provider-profile";

/**
 * ADR-108 Slice 2 — pure helper: settle-time VC cost for a successful
 * `video_generate` artifact. The math is intentionally aligned with
 * `record-model-cost-ledger.service.ts::calculateTimeMeteredCostMicros`
 * for the USD-micros leg (cross-slice invariant 2: USD COGS ledger
 * shape stays the source of truth) and uses per-job `ceil` at the VC
 * level (ADR-108 §53). Failures throw deliberately — silent zero-VC
 * fallback is forbidden by ADR-108 Slice 2 "Forbidden patterns".
 */

function buildTimeMeteredProfile(overrides?: {
  pricePerUnit?: number;
  unit?: "second" | "minute";
  model?: string;
  billingMode?: RuntimeProviderModelProfile["billingMode"];
}): RuntimeProviderTimeMeteredModelProfile {
  return {
    model: overrides?.model ?? "runway-gen4-720p",
    capabilities: ["video"],
    active: true,
    effectiveFrom: null,
    effectiveTo: null,
    inputTokenWeight: 1,
    cachedInputTokenWeight: 1,
    outputTokenWeight: 1,
    displayLabel: null,
    notes: null,
    billingMode: "time_metered",
    providerPriceMetadata: {
      currency: "USD",
      timePricing: {
        unit: overrides?.unit ?? "second",
        pricePerUnit: overrides?.pricePerUnit ?? 50_000
      }
    }
  };
}

function buildTimeMeteredFacts(overrides?: {
  durationSeconds?: number;
  providerKey?: string;
  modelKey?: string;
  occurredAt?: string;
}): RuntimeBillingFacts {
  const seconds = overrides?.durationSeconds ?? 5;
  return {
    providerKey: overrides?.providerKey ?? "runway",
    modelKey: overrides?.modelKey ?? "runway-gen4-720p",
    capability: "video",
    occurredAt: overrides?.occurredAt ?? "2026-06-03T19:00:00.000Z",
    metering: {
      meteringKind: "time_metered",
      durationMs: seconds * 1000,
      durationSeconds: seconds
    }
  };
}

async function runHappyPathSecondsUnit(): Promise<void> {
  const result = computeVideoVcoinCost({
    billingFacts: buildTimeMeteredFacts({ durationSeconds: 5 }),
    profile: buildTimeMeteredProfile({ pricePerUnit: 50_000, unit: "second" }),
    vcoinExchangeRate: 20
  });
  assert.equal(result.usdMicros, 250_000n, "5s × $0.05/s = $0.25 = 250_000 micros");
  assert.equal(result.vcCost, 5, "ceil(250_000 × 20 / 1_000_000) = ceil(5) = 5 VC");
}

async function runHappyPathMinuteUnit(): Promise<void> {
  const result = computeVideoVcoinCost({
    billingFacts: buildTimeMeteredFacts({ durationSeconds: 30 }),
    profile: buildTimeMeteredProfile({ pricePerUnit: 1_200_000, unit: "minute" }),
    vcoinExchangeRate: 20
  });
  assert.equal(result.usdMicros, 600_000n, "30s × $1.20/min = $0.60 = 600_000 micros");
  assert.equal(result.vcCost, 12, "ceil(600_000 × 20 / 1_000_000) = ceil(12) = 12 VC");
}

async function runPerJobCeilRoundsUp(): Promise<void> {
  // Construct a duration that forces a non-integer VC value before ceiling.
  // 7s × $0.07/s = $0.49 = 490_000 micros; × rate 20 / 1M = 9.8 → ceil = 10.
  const result = computeVideoVcoinCost({
    billingFacts: buildTimeMeteredFacts({ durationSeconds: 7 }),
    profile: buildTimeMeteredProfile({ pricePerUnit: 70_000, unit: "second" }),
    vcoinExchangeRate: 20
  });
  assert.equal(result.usdMicros, 490_000n);
  assert.equal(result.vcCost, 10, "9.8 VC must ceil up to 10 (per-job ceil — ADR-108 §53)");
}

async function runUsdMicrosZeroIsZeroVc(): Promise<void> {
  const result = computeVideoVcoinCost({
    billingFacts: buildTimeMeteredFacts({ durationSeconds: 5 }),
    profile: buildTimeMeteredProfile({ pricePerUnit: 0, unit: "second" }),
    vcoinExchangeRate: 20
  });
  assert.equal(result.usdMicros, 0n);
  assert.equal(result.vcCost, 0, "USD micros 0 must yield 0 VC, not ceil(0)+1");
}

async function runRejectsNonTimeMeteredFact(): Promise<void> {
  const tokenFact: RuntimeBillingFacts = {
    providerKey: "runway",
    modelKey: "runway-gen4-720p",
    capability: "video",
    occurredAt: "2026-06-03T19:00:00.000Z",
    metering: {
      meteringKind: "operation_metered",
      operationCount: 1,
      dimensions: null
    }
  };
  assert.throws(
    () =>
      computeVideoVcoinCost({
        billingFacts: tokenFact,
        profile: buildTimeMeteredProfile(),
        vcoinExchangeRate: 20
      }),
    /must be "time_metered"/,
    "non-time-metered fact must throw — silent 0-VC fallback is forbidden"
  );
}

async function runRejectsNonTimeMeteredProfile(): Promise<void> {
  const fixedProfile = {
    model: "x",
    capabilities: ["video"],
    active: true,
    effectiveFrom: null,
    effectiveTo: null,
    inputTokenWeight: 1,
    cachedInputTokenWeight: 1,
    outputTokenWeight: 1,
    displayLabel: null,
    notes: null,
    billingMode: "fixed_operation",
    providerPriceMetadata: {
      currency: "USD",
      fixedOperationPricing: { unitLabel: "image", pricePerOperation: 50_000 }
    }
  } as unknown as RuntimeProviderModelProfile;
  assert.throws(
    () =>
      computeVideoVcoinCost({
        billingFacts: buildTimeMeteredFacts(),
        profile: fixedProfile,
        vcoinExchangeRate: 20
      }),
    /catalog profile billingMode must be "time_metered"/,
    "catalog/runtime drift must trip an explicit error so reconciliation runs"
  );
}

async function runRejectsNonPositiveDuration(): Promise<void> {
  assert.throws(
    () =>
      computeVideoVcoinCost({
        billingFacts: buildTimeMeteredFacts({ durationSeconds: 0 }),
        profile: buildTimeMeteredProfile(),
        vcoinExchangeRate: 20
      }),
    /durationSeconds must be > 0/,
    "zero duration must throw — that is a billing-fact bug, not a free video"
  );
  assert.throws(
    () =>
      computeVideoVcoinCost({
        billingFacts: buildTimeMeteredFacts({ durationSeconds: -3 }),
        profile: buildTimeMeteredProfile(),
        vcoinExchangeRate: 20
      }),
    /durationSeconds must be > 0/
  );
}

async function runRejectsNonPositiveExchangeRate(): Promise<void> {
  for (const rate of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () =>
        computeVideoVcoinCost({
          billingFacts: buildTimeMeteredFacts(),
          profile: buildTimeMeteredProfile(),
          vcoinExchangeRate: rate
        }),
      /vcoinExchangeRate must be a positive integer/,
      `rate=${String(rate)} must throw`
    );
  }
}

async function run(): Promise<void> {
  await runHappyPathSecondsUnit();
  await runHappyPathMinuteUnit();
  await runPerJobCeilRoundsUp();
  await runUsdMicrosZeroIsZeroVc();
  await runRejectsNonTimeMeteredFact();
  await runRejectsNonTimeMeteredProfile();
  await runRejectsNonPositiveDuration();
  await runRejectsNonPositiveExchangeRate();
  console.log("compute-video-vcoin-cost: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
