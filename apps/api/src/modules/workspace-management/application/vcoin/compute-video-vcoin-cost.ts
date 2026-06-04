import type { RuntimeBillingFacts } from "@persai/runtime-contract";
import type { RuntimeProviderModelProfile } from "../runtime-provider-profile";

/**
 * ADR-108 Slice 2 — pure helper that computes the Vcoin (VC) cost of a
 * single successful `video_generate` artifact at settle time.
 *
 * Formula (ADR-108 Decision §51-53, Slice 9 pricing math correctness):
 *
 *   `usdMicros = round(durationSeconds * pricePerUnitUsd * 1_000_000)`
 *   `vcCost    = ceil(usdMicros * vcoinExchangeRate / 1_000_000)`
 *
 * `pricePerUnit` is stored in the catalog as **plain USD per second/minute**
 * (e.g. `0.14` = $0.14/sec, the way the operator types it in `Admin >
 * Runtime`). The `* 1_000_000` factor converts USD → USD micros so the
 * result lines up with `model_cost_ledger_events.actual_cost_micros`.
 *
 * The USD-micros leg is intentionally computed the same way as
 * `record-model-cost-ledger.service.ts::calculateTimeMeteredCostMicros`
 * (USD COGS ledger). Cross-slice invariant 2 of ADR-108 requires the USD
 * COGS ledger shape stays exactly as today; this helper does NOT touch
 * the ledger, but mirrors its USD-micros calculation so admins can audit
 * the VC debit against `model_cost_ledger_events.actualCostMicros` for
 * the same job (Slice 2's transitional double-write window).
 *
 * The final VC count is rounded **up** per ADR-108 §53 (per-job ceil):
 * "ceil($/sec * seconds * VCOIN_PER_USD)". `convertUsdMicrosToVcoin`
 * (Slice 1) uses round-half-up and is intentionally not used here —
 * ADR-108 §51-52 (round-half-up) describes the conversion primitive
 * available for generic USD→VC rendering, while §53 (per-job ceil)
 * describes the settle-time charge. Settle is what this helper owns, so
 * ceil is the binding rule.
 *
 * Behavior contract:
 *   - `billingFacts.metering.meteringKind !== "time_metered"` → throws.
 *     Silent fallback to 0 VC is FORBIDDEN by ADR-108 Slice 2 "Forbidden
 *     patterns" — the caller catches and triggers reconciliation honestly.
 *   - `durationSeconds <= 0` → throws (a zero / negative duration is a
 *     billing-fact bug, not a free video).
 *   - `profile.billingMode !== "time_metered"` → throws. The catalog row
 *     and the billing fact must agree on metering kind; mismatch means the
 *     catalog was edited mid-flight and the settle must be rolled back +
 *     reconciled rather than silently mispriced.
 *   - `vcoinExchangeRate` non-positive-integer → throws. Mirrors the
 *     `convertUsdMicrosToVcoin` Slice 1 contract.
 *   - Otherwise returns `{ vcCost, usdMicros }` where `vcCost` is a
 *     non-negative integer VC amount and `usdMicros` is the bigint USD
 *     micros that the same `time_metered` profile would yield on the USD
 *     COGS ledger.
 *
 * Pure: no I/O, no side effects, no DI. Safe to call from any seam.
 */
export type ComputeVideoVcoinCostInput = {
  billingFacts: RuntimeBillingFacts;
  profile: RuntimeProviderModelProfile;
  vcoinExchangeRate: number;
};

export type ComputeVideoVcoinCostResult = {
  vcCost: number;
  usdMicros: bigint;
};

const ONE_USD_IN_MICROS = 1_000_000n;

export function computeVideoVcoinCost(
  input: ComputeVideoVcoinCostInput
): ComputeVideoVcoinCostResult {
  if (
    typeof input.vcoinExchangeRate !== "number" ||
    !Number.isInteger(input.vcoinExchangeRate) ||
    input.vcoinExchangeRate <= 0
  ) {
    throw new RangeError(
      `computeVideoVcoinCost: vcoinExchangeRate must be a positive integer (got ${String(input.vcoinExchangeRate)}).`
    );
  }
  if (input.billingFacts.metering.meteringKind !== "time_metered") {
    throw new Error(
      `computeVideoVcoinCost: billingFacts.metering.meteringKind must be "time_metered" for video_generate settle, got "${input.billingFacts.metering.meteringKind}". Silent zero-VC fallback is forbidden by ADR-108 Slice 2; the settle path must surface this for reconciliation.`
    );
  }
  const metering = input.billingFacts.metering;
  if (!Number.isFinite(metering.durationSeconds) || metering.durationSeconds <= 0) {
    throw new RangeError(
      `computeVideoVcoinCost: billingFacts.metering.durationSeconds must be > 0 (got ${String(metering.durationSeconds)}).`
    );
  }
  if (input.profile.billingMode !== "time_metered") {
    throw new Error(
      `computeVideoVcoinCost: catalog profile billingMode must be "time_metered" to match a time_metered billing fact (got "${input.profile.billingMode}"). Catalog/runtime drift detected for ${input.billingFacts.providerKey}/${input.profile.model}.`
    );
  }

  const pricing = input.profile.providerPriceMetadata.timePricing;
  const billableUnits =
    pricing.unit === "minute" ? metering.durationSeconds / 60 : metering.durationSeconds;
  // Same shape as record-model-cost-ledger.service.ts::calculateTimeMeteredCostMicros
  // (cross-slice invariant 2: USD ledger calculation stays the source of truth).
  // Catalog stores `pricePerUnit` as plain USD per second/minute; multiply by
  // 1_000_000 to lift it into USD micros (ADR-108 Slice 9 — pricing math
  // correctness; before the fix this read raw `pricePerUnit` as if it were
  // already in micros and produced a sub-cent ledger row + 1-VC dust debit
  // for every video, regardless of provider catalog truth).
  const MICROS_PER_USD_NUM = 1_000_000;
  const usdMicros = BigInt(
    Math.max(0, Math.round(billableUnits * pricing.pricePerUnit * MICROS_PER_USD_NUM))
  );
  if (usdMicros === 0n) {
    return { vcCost: 0, usdMicros };
  }

  // Per-job ceil at the VC level — ADR-108 §53.
  // ceilDiv(numerator, denominator) using BigInt: (a + b - 1) / b for a > 0.
  const rate = BigInt(input.vcoinExchangeRate);
  const numerator = usdMicros * rate;
  const vcCostBig = (numerator + ONE_USD_IN_MICROS - 1n) / ONE_USD_IN_MICROS;
  return { vcCost: Number(vcCostBig), usdMicros };
}
