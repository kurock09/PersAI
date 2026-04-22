import assert from "node:assert/strict";
import { ProactivePushPolicyService } from "../src/modules/workspace-management/application/proactive-push-policy.service";
import {
  ANSWERED_WINDOW_HOURS,
  AUTO_MUTE_AFTER_UNANSWERED,
  AUTO_MUTE_DURATION_DAYS,
  MIN_INTERVAL_HOURS,
  QUIET_HOURS_END_LOCAL,
  QUIET_HOURS_START_LOCAL
} from "../src/modules/workspace-management/application/proactive-push-policy.constants";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const TIMEZONE = "Europe/Moscow"; // UTC+3 (no DST since 2014).

function makeService(): ProactivePushPolicyService {
  return new ProactivePushPolicyService();
}

// 12:00 UTC = 15:00 Moscow → middle of the awake window.
const AWAKE_NOW = new Date("2026-04-22T12:00:00.000Z");

// 21:00 UTC = 00:00 Moscow next day → inside the late-night quiet half.
const QUIET_LATE_NIGHT_NOW = new Date("2026-04-22T21:00:00.000Z");

// 03:00 UTC = 06:00 Moscow → inside the pre-09:00 quiet half.
const QUIET_EARLY_MORNING_NOW = new Date("2026-04-22T03:00:00.000Z");

async function runAudienceAssistantAlwaysAllow(): Promise<void> {
  // Hard constraint #11: gate is for audience="user". Service defensively
  // returns "allow" for assistant audience.
  const service = makeService();
  const result = service.evaluateProactivePush({
    now: AWAKE_NOW,
    audience: "assistant",
    timezone: TIMEZONE,
    lastFiredAt: new Date(AWAKE_NOW.getTime() - 60_000),
    lastAnsweredCheckAt: null,
    consecutiveUnanswered: 99,
    latestUserMessageAt: null
  });
  assert.equal(result.action, "allow", "assistant audience always allowed by service");
}

async function runFirstEverPushAllowedDuringAwakeHours(): Promise<void> {
  const service = makeService();
  const result = service.evaluateProactivePush({
    now: AWAKE_NOW,
    audience: "user",
    timezone: TIMEZONE,
    lastFiredAt: null,
    lastAnsweredCheckAt: null,
    consecutiveUnanswered: 0,
    latestUserMessageAt: null
  });
  assert.equal(result.action, "allow", "first-ever push during awake hours is allowed");
  assert.equal(result.consecutiveUnansweredAfter, 0);
  assert.equal(result.lastAnsweredCheckAtAfter, null);
}

async function runIntervalBlockDefersTo48hAfterLastFired(): Promise<void> {
  const service = makeService();
  // 24h since last fire — well inside the 48h interval.
  const lastFiredAt = new Date(AWAKE_NOW.getTime() - 24 * HOUR_MS);
  const result = service.evaluateProactivePush({
    now: AWAKE_NOW,
    audience: "user",
    timezone: TIMEZONE,
    lastFiredAt,
    lastAnsweredCheckAt: null,
    consecutiveUnanswered: 0,
    latestUserMessageAt: null
  });
  assert.equal(result.action, "defer", "interval defers");
  if (result.action !== "defer") return;
  assert.equal(result.reason, "interval");
  assert.equal(
    result.deferUntil.getTime(),
    lastFiredAt.getTime() + MIN_INTERVAL_HOURS * HOUR_MS,
    "defers exactly to lastFiredAt + MIN_INTERVAL_HOURS"
  );
}

async function runQuietHoursLateNightDeferToNext09Local(): Promise<void> {
  const service = makeService();
  // 23:00 UTC = 02:00 Moscow next day, deep quiet — defer to 09:00 Moscow same calendar day.
  const now = new Date("2026-04-22T23:00:00.000Z");
  const result = service.evaluateProactivePush({
    now,
    audience: "user",
    timezone: TIMEZONE,
    lastFiredAt: null,
    lastAnsweredCheckAt: null,
    consecutiveUnanswered: 0,
    latestUserMessageAt: null
  });
  assert.equal(result.action, "defer");
  if (result.action !== "defer") return;
  assert.equal(result.reason, "quiet_hours");
  // Expected: 2026-04-23 09:00 Moscow = 2026-04-23 06:00 UTC.
  assert.equal(
    result.deferUntil.toISOString(),
    "2026-04-23T06:00:00.000Z",
    "23:00 UTC → defer to next 09:00 Moscow (2026-04-23 06:00 UTC)"
  );
}

async function runQuietHoursLateEveningRollsToTomorrow(): Promise<void> {
  const service = makeService();
  // 21:00 UTC = 00:00 Moscow already past midnight local → still in quiet
  // window but the "next 09:00 local" lands later that same calendar day.
  const result = service.evaluateProactivePush({
    now: QUIET_LATE_NIGHT_NOW,
    audience: "user",
    timezone: TIMEZONE,
    lastFiredAt: null,
    lastAnsweredCheckAt: null,
    consecutiveUnanswered: 0,
    latestUserMessageAt: null
  });
  assert.equal(result.action, "defer");
  if (result.action !== "defer") return;
  assert.equal(result.reason, "quiet_hours");
  assert.equal(
    result.deferUntil.toISOString(),
    "2026-04-23T06:00:00.000Z",
    "00:00 Moscow defers to 09:00 Moscow same local day = 06:00 UTC"
  );
}

async function runQuietHoursPreNineDefersToTodayNineLocal(): Promise<void> {
  const service = makeService();
  // 03:00 UTC = 06:00 Moscow → defer to 09:00 Moscow same day = 06:00 UTC.
  const result = service.evaluateProactivePush({
    now: QUIET_EARLY_MORNING_NOW,
    audience: "user",
    timezone: TIMEZONE,
    lastFiredAt: null,
    lastAnsweredCheckAt: null,
    consecutiveUnanswered: 0,
    latestUserMessageAt: null
  });
  assert.equal(result.action, "defer");
  if (result.action !== "defer") return;
  assert.equal(result.reason, "quiet_hours");
  assert.equal(result.deferUntil.toISOString(), "2026-04-22T06:00:00.000Z");
}

async function runAutoMuteDefersToFourteenDays(): Promise<void> {
  const service = makeService();
  // 49h since last fire (past interval), but counter is at the threshold AND
  // no user reply since.
  const lastFiredAt = new Date(AWAKE_NOW.getTime() - 49 * HOUR_MS);
  const result = service.evaluateProactivePush({
    now: AWAKE_NOW,
    audience: "user",
    timezone: TIMEZONE,
    lastFiredAt,
    lastAnsweredCheckAt: new Date(lastFiredAt.getTime() + ANSWERED_WINDOW_HOURS * HOUR_MS),
    consecutiveUnanswered: AUTO_MUTE_AFTER_UNANSWERED,
    latestUserMessageAt: null
  });
  assert.equal(result.action, "defer");
  if (result.action !== "defer") return;
  assert.equal(result.reason, "auto_mute");
  assert.equal(
    result.deferUntil.getTime(),
    lastFiredAt.getTime() + AUTO_MUTE_DURATION_DAYS * DAY_MS,
    "defers to lastFiredAt + AUTO_MUTE_DURATION_DAYS"
  );
}

async function runAutoMuteReleasesOnAnyUserMessage(): Promise<void> {
  const service = makeService();
  // Counter at threshold but the user replied AFTER lastFiredAt → mute released.
  const lastFiredAt = new Date(AWAKE_NOW.getTime() - 49 * HOUR_MS);
  const userMessageAt = new Date(lastFiredAt.getTime() + 5 * HOUR_MS);
  const result = service.evaluateProactivePush({
    now: AWAKE_NOW,
    audience: "user",
    timezone: TIMEZONE,
    lastFiredAt,
    lastAnsweredCheckAt: null,
    consecutiveUnanswered: AUTO_MUTE_AFTER_UNANSWERED,
    latestUserMessageAt: userMessageAt
  });
  assert.equal(result.action, "allow", "any user message after lastFiredAt releases auto-mute");
  assert.equal(result.consecutiveUnansweredAfter, 0, "counter reset to 0");
}

async function runUnansweredWindowBumpsCounterExactlyOnce(): Promise<void> {
  const service = makeService();
  // Past interval (49h ago), counter at 0, no user reply → window elapsed,
  // counter should bump to 1, lastAnsweredCheckAt should be set to
  // lastFiredAt + ANSWERED_WINDOW_HOURS.
  const lastFiredAt = new Date(AWAKE_NOW.getTime() - 49 * HOUR_MS);
  const first = service.evaluateProactivePush({
    now: AWAKE_NOW,
    audience: "user",
    timezone: TIMEZONE,
    lastFiredAt,
    lastAnsweredCheckAt: null,
    consecutiveUnanswered: 0,
    latestUserMessageAt: null
  });
  assert.equal(first.action, "allow", "past interval and counter under threshold → allow");
  assert.equal(first.consecutiveUnansweredAfter, 1, "first unanswered bump");
  assert.ok(
    first.lastAnsweredCheckAtAfter !== null &&
      first.lastAnsweredCheckAtAfter.getTime() ===
        lastFiredAt.getTime() + ANSWERED_WINDOW_HOURS * HOUR_MS,
    "lastAnsweredCheckAt set to window end so the bump fires exactly once"
  );

  // Idempotency: a second evaluation immediately after with the new
  // bookkeeping must NOT double-bump.
  const second = service.evaluateProactivePush({
    now: AWAKE_NOW,
    audience: "user",
    timezone: TIMEZONE,
    lastFiredAt,
    lastAnsweredCheckAt: first.lastAnsweredCheckAtAfter,
    consecutiveUnanswered: first.consecutiveUnansweredAfter,
    latestUserMessageAt: null
  });
  assert.equal(second.consecutiveUnansweredAfter, 1, "second evaluation does not double-bump");
}

async function runAllSafeguardsClearAllowsPush(): Promise<void> {
  const service = makeService();
  // 60h since last fire (past interval), past mute window, user replied,
  // awake hours → allow.
  const lastFiredAt = new Date(AWAKE_NOW.getTime() - 60 * HOUR_MS);
  const result = service.evaluateProactivePush({
    now: AWAKE_NOW,
    audience: "user",
    timezone: TIMEZONE,
    lastFiredAt,
    lastAnsweredCheckAt: new Date(lastFiredAt.getTime() + ANSWERED_WINDOW_HOURS * HOUR_MS),
    consecutiveUnanswered: 0,
    latestUserMessageAt: new Date(lastFiredAt.getTime() + 12 * HOUR_MS)
  });
  assert.equal(result.action, "allow");
  assert.equal(result.consecutiveUnansweredAfter, 0);
}

async function runConstantsAreShipValues(): Promise<void> {
  // The five constants are part of the contract — lock the values so
  // accidental edits surface in tests.
  assert.equal(MIN_INTERVAL_HOURS, 48);
  assert.equal(QUIET_HOURS_START_LOCAL, 22);
  assert.equal(QUIET_HOURS_END_LOCAL, 9);
  assert.equal(AUTO_MUTE_AFTER_UNANSWERED, 2);
  assert.equal(AUTO_MUTE_DURATION_DAYS, 14);
  assert.equal(ANSWERED_WINDOW_HOURS, 24);
}

async function runUnknownTimezoneFallsBackToUtc(): Promise<void> {
  const service = makeService();
  // 23:00 UTC + bad TZ → quiet-hours math runs on UTC (23:00 = quiet).
  const result = service.evaluateProactivePush({
    now: new Date("2026-04-22T23:00:00.000Z"),
    audience: "user",
    timezone: "Not/A_Real_Zone",
    lastFiredAt: null,
    lastAnsweredCheckAt: null,
    consecutiveUnanswered: 0,
    latestUserMessageAt: null
  });
  assert.equal(result.action, "defer");
  if (result.action !== "defer") return;
  assert.equal(result.reason, "quiet_hours");
  // Next 09:00 UTC.
  assert.equal(result.deferUntil.toISOString(), "2026-04-23T09:00:00.000Z");
}

async function runIntervalBeatsQuietHours(): Promise<void> {
  const service = makeService();
  // Inside quiet window AND inside interval → interval wins (it's the larger
  // defer in this case, but the ordering is also locked: auto_mute > interval > quiet_hours).
  const lastFiredAt = new Date(QUIET_EARLY_MORNING_NOW.getTime() - 12 * HOUR_MS);
  const result = service.evaluateProactivePush({
    now: QUIET_EARLY_MORNING_NOW,
    audience: "user",
    timezone: TIMEZONE,
    lastFiredAt,
    lastAnsweredCheckAt: null,
    consecutiveUnanswered: 0,
    latestUserMessageAt: null
  });
  assert.equal(result.action, "defer");
  if (result.action !== "defer") return;
  assert.equal(result.reason, "interval", "interval check fires before quiet hours");
}

async function run(): Promise<void> {
  await runAudienceAssistantAlwaysAllow();
  await runFirstEverPushAllowedDuringAwakeHours();
  await runIntervalBlockDefersTo48hAfterLastFired();
  await runQuietHoursLateNightDeferToNext09Local();
  await runQuietHoursLateEveningRollsToTomorrow();
  await runQuietHoursPreNineDefersToTodayNineLocal();
  await runAutoMuteDefersToFourteenDays();
  await runAutoMuteReleasesOnAnyUserMessage();
  await runUnansweredWindowBumpsCounterExactlyOnce();
  await runAllSafeguardsClearAllowsPush();
  await runConstantsAreShipValues();
  await runUnknownTimezoneFallsBackToUtc();
  await runIntervalBeatsQuietHours();
}

void run();
