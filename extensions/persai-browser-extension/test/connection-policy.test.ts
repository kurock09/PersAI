import assert from "node:assert/strict";
import test from "node:test";
import {
  isAllowedBridgeWebSocketUrl,
  shouldAttemptBridgeDial,
  shouldCountBridgeConnectFailure,
  shouldKeepBridgeConnection
} from "../src/connection-policy.js";
import { REGISTRATION_TOKEN_SAFE_AGE_MS } from "../src/constants.js";

const NOW = 1_000_000;
const MAX_AGE_MS = REGISTRATION_TOKEN_SAFE_AGE_MS;

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

test("bridge dial requires online and stays under the failure budget", () => {
  assert.equal(
    shouldAttemptBridgeDial({
      desiredConnection: true,
      online: true,
      consecutiveFailures: 0,
      maxConsecutiveFailures: 5
    }),
    true
  );
  assert.equal(
    shouldAttemptBridgeDial({
      desiredConnection: true,
      online: false,
      consecutiveFailures: 0,
      maxConsecutiveFailures: 5
    }),
    false
  );
  assert.equal(
    shouldAttemptBridgeDial({
      desiredConnection: true,
      online: true,
      consecutiveFailures: 5,
      maxConsecutiveFailures: 5
    }),
    false
  );
  assert.equal(
    shouldAttemptBridgeDial({
      desiredConnection: false,
      online: true,
      consecutiveFailures: 0,
      maxConsecutiveFailures: 5
    }),
    false
  );
});

test("connect-failure budget counts only pre-open dials", () => {
  assert.equal(shouldCountBridgeConnectFailure(false), true);
  assert.equal(shouldCountBridgeConnectFailure(true), false);
});

test("registration safe age stays under a multi-hour device token TTL", () => {
  assert.ok(MAX_AGE_MS >= 3 * 60 * 60 * 1000);
  assert.ok(MAX_AGE_MS < 4 * 60 * 60 * 1000);
});

test("bridge websocket URL allowlist accepts PersAI and local only", () => {
  assert.equal(
    isAllowedBridgeWebSocketUrl("wss://api.persai.dev/api/v1/assistant/browser-bridge/ws"),
    true
  );
  assert.equal(isAllowedBridgeWebSocketUrl("ws://localhost:3001/ws"), true);
  assert.equal(isAllowedBridgeWebSocketUrl("wss://evil.example/ws"), false);
  assert.equal(isAllowedBridgeWebSocketUrl("https://api.persai.dev/ws"), false);
  assert.equal(isAllowedBridgeWebSocketUrl("not-a-url"), false);
});
