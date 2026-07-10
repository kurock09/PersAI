import assert from "node:assert/strict";
import test from "node:test";
import { shouldKeepBridgeConnection } from "../src/connection-policy.js";

const NOW = 1_000_000;
const MAX_AGE_MS = 14 * 60 * 1_000;

test("fresh registration keeps bridge connected without a page port", () => {
  assert.equal(
    shouldKeepBridgeConnection({
      keepalivePortCount: 0,
      activeCommandCount: 0,
      registrationUpdatedAt: NOW - 1_000,
      now: NOW,
      registrationMaxAgeMs: MAX_AGE_MS
    }),
    true
  );
});

test("idle stale registration allows bridge disconnect", () => {
  assert.equal(
    shouldKeepBridgeConnection({
      keepalivePortCount: 0,
      activeCommandCount: 0,
      registrationUpdatedAt: NOW - MAX_AGE_MS - 1,
      now: NOW,
      registrationMaxAgeMs: MAX_AGE_MS
    }),
    false
  );
});

test("active ports and commands keep bridge connected without registration", () => {
  assert.equal(
    shouldKeepBridgeConnection({
      keepalivePortCount: 1,
      activeCommandCount: 0,
      registrationUpdatedAt: null,
      now: NOW,
      registrationMaxAgeMs: MAX_AGE_MS
    }),
    true
  );
  assert.equal(
    shouldKeepBridgeConnection({
      keepalivePortCount: 0,
      activeCommandCount: 1,
      registrationUpdatedAt: null,
      now: NOW,
      registrationMaxAgeMs: MAX_AGE_MS
    }),
    true
  );
});
