/**
 * ADR-108 Slice 1 — pure helper that converts a USD-micros amount (the
 * canonical unit used by the model cost ledger, see ADR-099) into a
 * non-negative integer number of Vcoin (VC) at the platform exchange rate.
 *
 * Conversion math (ADR-108 lines 47-52):
 *
 *   `1 USD = rate VC`   (platform default `rate = 20` ⇒ `1 VC = $0.05`).
 *
 *   Given `micros` in USD micros (i.e. `1 USD = 1_000_000` micros), the
 *   fractional VC value is `vcReal = (micros * rate) / 1_000_000`.
 *
 *   This helper applies **round-half-up** rounding at the half-VC midpoint
 *   (ADR-108 explicit decision: "fractional VC is rounded HALF-UP at the
 *   midpoint"). ADR-108 also mentions a separate **ceil** rounding rule for
 *   settlement debits (line 53); that ceil belongs to the Slice 2 settle
 *   path and intentionally wraps around this helper — it is NOT applied
 *   here.
 *
 *   The function is a pure conversion primitive. No I/O. No side effects.
 *   No domain decisions (debit / credit / refund / settlement) live here.
 *
 * Behavior at the boundaries:
 *
 *   - `micros = 0n` → `0` regardless of `rate`.
 *   - `micros < 0n` → throws. VC settlement is non-negative end-to-end
 *     (cross-slice invariant 1 in ADR-108: integer VC, never fractional;
 *     the wallet balance can only go just-below-zero on the one-shot
 *     settle path which is Slice 2 territory, not negative inputs to this
 *     helper).
 *   - `rate <= 0` or non-integer `rate` → throws. The platform exchange
 *     rate is enforced as a positive integer on the admin save path; an
 *     invalid runtime value is a programming error, not a silent zero.
 *
 * Rounding implementation:
 *
 *   We avoid `Number` floating-point entirely. Work in bigint:
 *
 *     numerator = micros * BigInt(rate)
 *     denominator = 1_000_000n
 *     // round-half-up at 0.5 increment:
 *     vc = (numerator + denominator / 2n) / denominator
 *
 *   Because `numerator` is non-negative and `denominator / 2n` is exactly
 *   `500_000n` (`1_000_000n` is even), the `+ denominator/2n` then
 *   floor-divide pattern produces correct round-half-up for non-negative
 *   inputs. (For signed inputs this pattern rounds half-away-from-zero,
 *   but we reject negative inputs above, so the asymmetry never matters
 *   here.)
 *
 *   The final cast to `Number` is safe because realistic VC amounts (and
 *   even pathological ones) easily fit in `Number.MAX_SAFE_INTEGER` for
 *   plausible USD-micros and exchange rates.
 *
 * Test contract (see apps/api/test/convert-usd-micros-to-vcoin.test.ts):
 *
 *   - `(0n, 20)` → `0`
 *   - `(10_000n, 20)` (= $0.01) → `0`         (0.2 VC rounds down)
 *   - `(25_000n, 20)` (= $0.025, half-VC) → `1` (round-half-UP midpoint)
 *   - `(40_000n, 20)` (= $0.04) → `1`         (0.8 VC rounds up)
 *   - `(50_000n, 20)` (= $0.05) → `1`         (exactly 1 VC)
 *   - `(60_000n, 20)` (= $0.06) → `1`         (1.2 VC rounds down)
 *   - `(75_000n, 20)` (= $0.075, half-VC) → `2` (round-half-UP midpoint)
 *   - negative `micros` → throws
 *   - `rate <= 0` or non-integer `rate` → throws
 */
export function convertUsdMicrosToVcoin(micros: bigint, rate: number): number {
  if (typeof micros !== "bigint") {
    throw new TypeError(`convertUsdMicrosToVcoin: micros must be a bigint (got ${typeof micros}).`);
  }
  if (micros < 0n) {
    throw new RangeError(
      `convertUsdMicrosToVcoin: micros must be non-negative (got ${micros.toString()}).`
    );
  }
  if (typeof rate !== "number" || !Number.isInteger(rate) || rate <= 0) {
    throw new RangeError(
      `convertUsdMicrosToVcoin: rate must be a positive integer (got ${String(rate)}).`
    );
  }
  if (micros === 0n) {
    return 0;
  }
  const ONE_USD_IN_MICROS = 1_000_000n;
  const HALF = ONE_USD_IN_MICROS / 2n;
  const numerator = micros * BigInt(rate);
  const vc = (numerator + HALF) / ONE_USD_IN_MICROS;
  return Number(vc);
}
