import assert from "node:assert/strict";
import { convertUsdMicrosToVcoin } from "../src/modules/workspace-management/application/vcoin/convert-usd-micros-to-vcoin";

/**
 * ADR-108 Slice 1 — unit tests for `convertUsdMicrosToVcoin`.
 *
 * The contract is "round-half-up at the half-VC midpoint" with the
 * platform default rate `1 USD = 20 VC`. The settle path's `ceil`
 * rounding (ADR-108 line 53) is Slice 2 territory and must NOT be
 * applied here.
 */
async function run(): Promise<void> {
  // Zero in, zero out — independent of rate.
  assert.equal(convertUsdMicrosToVcoin(0n, 20), 0);
  assert.equal(convertUsdMicrosToVcoin(0n, 1), 0);
  assert.equal(convertUsdMicrosToVcoin(0n, 1_000_000), 0);

  // $0.01 = 0.2 VC at rate 20 → rounds DOWN to 0.
  assert.equal(convertUsdMicrosToVcoin(10_000n, 20), 0);

  // $0.025 = 0.5 VC at rate 20 → half-VC midpoint → round-half-UP → 1.
  assert.equal(convertUsdMicrosToVcoin(25_000n, 20), 1);

  // $0.04 = 0.8 VC at rate 20 → rounds UP to 1.
  assert.equal(convertUsdMicrosToVcoin(40_000n, 20), 1);

  // $0.05 = exactly 1.0 VC at rate 20.
  assert.equal(convertUsdMicrosToVcoin(50_000n, 20), 1);

  // $0.06 = 1.2 VC at rate 20 → rounds DOWN to 1.
  assert.equal(convertUsdMicrosToVcoin(60_000n, 20), 1);

  // $0.075 = 1.5 VC at rate 20 → half-VC midpoint → round-half-UP → 2.
  assert.equal(convertUsdMicrosToVcoin(75_000n, 20), 2);

  // $1.00 at rate 20 → exactly 20 VC.
  assert.equal(convertUsdMicrosToVcoin(1_000_000n, 20), 20);

  // Round-half-up holds at higher magnitudes:
  //   $0.125 = 2.5 VC at rate 20 → rounds UP to 3.
  assert.equal(convertUsdMicrosToVcoin(125_000n, 20), 3);
  //   $0.175 = 3.5 VC at rate 20 → rounds UP to 4.
  assert.equal(convertUsdMicrosToVcoin(175_000n, 20), 4);

  // Different rate: $0.01 at rate 100 = 1.0 VC.
  assert.equal(convertUsdMicrosToVcoin(10_000n, 100), 1);
  // Different rate: $0.005 at rate 100 = 0.5 VC → round-half-UP → 1.
  assert.equal(convertUsdMicrosToVcoin(5_000n, 100), 1);
  // Different rate: $0.001 at rate 100 = 0.1 VC → rounds DOWN to 0.
  assert.equal(convertUsdMicrosToVcoin(1_000n, 100), 0);

  // Very large input still yields an integer.
  const huge = convertUsdMicrosToVcoin(1_000_000_000_000n, 20);
  assert.equal(huge, 20_000_000);

  // Negative micros throws — VC settlement is non-negative end-to-end.
  assert.throws(() => convertUsdMicrosToVcoin(-1n, 20), /must be non-negative/);
  assert.throws(() => convertUsdMicrosToVcoin(-1_000_000n, 20), /must be non-negative/);

  // Rate <= 0 throws — exchange rate must be a positive integer.
  assert.throws(() => convertUsdMicrosToVcoin(50_000n, 0), /must be a positive integer/);
  assert.throws(() => convertUsdMicrosToVcoin(50_000n, -20), /must be a positive integer/);

  // Non-integer rate throws — exchange rate is integer VC per USD.
  assert.throws(() => convertUsdMicrosToVcoin(50_000n, 1.5), /must be a positive integer/);
  assert.throws(() => convertUsdMicrosToVcoin(50_000n, Number.NaN), /must be a positive integer/);
  assert.throws(
    () => convertUsdMicrosToVcoin(50_000n, Number.POSITIVE_INFINITY),
    /must be a positive integer/
  );

  // Wrong micros type throws (defensive — TS callers wouldn't hit this,
  // but the helper is a public-ish boundary and JSON loaders are sloppy).
  assert.throws(
    () => convertUsdMicrosToVcoin(50_000 as unknown as bigint, 20),
    /micros must be a bigint/
  );

  console.log("convert-usd-micros-to-vcoin: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
