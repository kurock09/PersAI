import assert from "node:assert/strict";
import { computeRetryBackoffMs } from "../src/modules/workspace-management/application/persai-scheduled-action-scheduler.service";

// ADR-074 F1: regression coverage for the new exponential backoff curve. The
// scheduler used to retry every 30 s and saturate via a receipt-count sentinel
// at ~1.5 min wall-clock; the unified curve is 30 s → 1 m → 2 m → 4 m → 8 m
// (capped at 1 h on absurd attempt numbers we should never reach).
function runBackoffCurveTest(): void {
  assert.equal(computeRetryBackoffMs(1), 30_000);
  assert.equal(computeRetryBackoffMs(2), 60_000);
  assert.equal(computeRetryBackoffMs(3), 120_000);
  assert.equal(computeRetryBackoffMs(4), 240_000);
  assert.equal(computeRetryBackoffMs(5), 480_000);
}

function runBackoffCapTest(): void {
  // 30 s * 2^9 = 256 m → must cap at the 60 m ceiling.
  assert.equal(computeRetryBackoffMs(10), 60 * 60_000);
  assert.equal(computeRetryBackoffMs(99), 60 * 60_000);
}

function runBackoffMinAttemptTest(): void {
  // Defensive normalisation: scheduler should never call us with 0 or
  // negative values, but we floor to attempt=1 just in case.
  assert.equal(computeRetryBackoffMs(0), 30_000);
  assert.equal(computeRetryBackoffMs(-3), 30_000);
}

async function main(): Promise<void> {
  runBackoffCurveTest();
  runBackoffCapTest();
  runBackoffMinAttemptTest();
  console.log("scheduled-action retry backoff curve OK");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
