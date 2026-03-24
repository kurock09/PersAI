import assert from "node:assert/strict";
import {
  resolveTelegramSecretLifecycleState,
  rotateTelegramBotSecretRef
} from "../src/modules/workspace-management/application/assistant-secret-refs-lifecycle";

function run(): void {
  const now = new Date("2026-03-24T12:00:00.000Z");
  const rotated = rotateTelegramBotSecretRef(null, {
    assistantId: "assistant-1",
    tokenFingerprintPrefix: "abcdef123456",
    tokenLastFour: "1234",
    ttlDays: 1,
    now
  });
  const active = resolveTelegramSecretLifecycleState(rotated, {
    now: new Date("2026-03-24T18:00:00.000Z")
  });
  assert.equal(active.status, "active");
  const expired = resolveTelegramSecretLifecycleState(rotated, {
    now: new Date("2026-03-26T12:00:00.000Z")
  });
  assert.equal(expired.status, "expired");
}

run();
