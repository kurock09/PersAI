import assert from "node:assert/strict";
import {
  isTelegramSecretConnectedLifecycle,
  isTelegramSecretUsable,
  renewTelegramBotSecretRefTtl,
  resolveTelegramSecretLifecycleState,
  rotateTelegramBotSecretRef,
  shouldRenewTelegramBotSecretRefTtl
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
  assert.equal(isTelegramSecretConnectedLifecycle("expired"), true);
  assert.equal(
    isTelegramSecretUsable(rotated, { now: new Date("2026-03-26T12:00:00.000Z") }),
    true
  );

  assert.equal(
    shouldRenewTelegramBotSecretRefTtl(rotated, {
      now: new Date("2026-03-24T18:00:00.000Z"),
      renewLeadDays: 7
    }),
    true
  );
  assert.equal(
    shouldRenewTelegramBotSecretRefTtl(rotated, {
      now: new Date("2026-03-17T12:00:00.000Z"),
      renewLeadDays: 7
    }),
    false
  );

  const renewed = renewTelegramBotSecretRefTtl(rotated, {
    ttlDays: 90,
    now: new Date("2026-03-26T12:00:00.000Z")
  });
  const afterRenew = resolveTelegramSecretLifecycleState(renewed, {
    now: new Date("2026-03-26T12:00:00.000Z")
  });
  assert.equal(afterRenew.status, "active");
  assert.equal(afterRenew.version, 1);
  assert.equal(afterRenew.expiresAt, "2026-06-24T12:00:00.000Z");
  assert.equal(
    renewed.refs.telegram_bot_token?.rotatedAt,
    rotated.refs.telegram_bot_token?.rotatedAt
  );
}

run();
