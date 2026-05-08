/**
 * ADR-088 Slice 1 closeout — NotificationRoutingService focused tests.
 * Covers: quiet-hours deferral logic, immediate override, source filtering,
 * disabled quiet hours, no config, outside window, respectQuietHours=false.
 */
import assert from "node:assert/strict";
import { NotificationRoutingService } from "../src/modules/workspace-management/application/notifications/notification-routing.service";

// ── Helpers ────────────────────────────────────────────────────────────────

function activeQuietHours(appliesToSources: string[]) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  // Use UTC hours because the service compares against defaultTimezone="UTC"
  const h = now.getUTCHours();
  return {
    enabled: true,
    startLocal: `${pad(h)}:00`,
    endLocal: `${pad((h + 2) % 24)}:00`,
    timezoneMode: "workspace_default" as const,
    defaultTimezone: "UTC",
    appliesToSources
  };
}

function inactiveQuietHours(appliesToSources: string[]) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  // Use UTC hours because the service compares against defaultTimezone="UTC"
  const h = now.getUTCHours();
  return {
    enabled: true,
    startLocal: `${pad((h - 4 + 24) % 24)}:00`,
    endLocal: `${pad((h - 2 + 24) % 24)}:00`,
    timezoneMode: "workspace_default" as const,
    defaultTimezone: "UTC",
    appliesToSources
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const svc = new NotificationRoutingService();

  // 1. skippable intent during active quiet hours → deferred
  {
    const deferUntil = svc.computeQuietHoursDeferral({
      intent: { priority: "skippable", respectQuietHours: true },
      quietHours: activeQuietHours(["idle_reengagement"]),
      source: "idle_reengagement"
    });
    assert.ok(deferUntil instanceof Date, "deferUntil is a Date");
    assert.ok(deferUntil.getTime() > Date.now(), "deferUntil is in the future");
    console.log("✓ skippable intent in active quiet hours → deferred");
  }

  // 2. immediate intent during active quiet hours → NOT deferred
  {
    const deferUntil = svc.computeQuietHoursDeferral({
      intent: { priority: "immediate", respectQuietHours: true },
      quietHours: activeQuietHours(["idle_reengagement"]),
      source: "idle_reengagement"
    });
    assert.equal(deferUntil, null, "immediate priority never deferred");
    console.log("✓ immediate intent in active quiet hours → not deferred");
  }

  // 3. source not in appliesToSources → NOT deferred
  {
    const deferUntil = svc.computeQuietHoursDeferral({
      intent: { priority: "skippable", respectQuietHours: true },
      quietHours: activeQuietHours(["billing_lifecycle"]),
      source: "idle_reengagement"
    });
    assert.equal(deferUntil, null, "source not in list → not deferred");
    console.log("✓ source not in appliesToSources → not deferred");
  }

  // 4. quiet hours disabled → NOT deferred
  {
    const deferUntil = svc.computeQuietHoursDeferral({
      intent: { priority: "skippable", respectQuietHours: true },
      quietHours: { ...activeQuietHours(["idle_reengagement"]), enabled: false },
      source: "idle_reengagement"
    });
    assert.equal(deferUntil, null, "quiet hours disabled → not deferred");
    console.log("✓ quiet hours disabled → not deferred");
  }

  // 5. no quiet hours config → NOT deferred
  {
    const deferUntil = svc.computeQuietHoursDeferral({
      intent: { priority: "skippable", respectQuietHours: true },
      quietHours: null,
      source: "idle_reengagement"
    });
    assert.equal(deferUntil, null, "no config → not deferred");
    console.log("✓ no quiet hours config → not deferred");
  }

  // 6. outside quiet hours window → NOT deferred
  {
    const deferUntil = svc.computeQuietHoursDeferral({
      intent: { priority: "skippable", respectQuietHours: true },
      quietHours: inactiveQuietHours(["idle_reengagement"]),
      source: "idle_reengagement"
    });
    assert.equal(deferUntil, null, "outside window → not deferred");
    console.log("✓ outside quiet hours window → not deferred");
  }

  // 7. respectQuietHours: false → NOT deferred even if in window (reminders)
  {
    const deferUntil = svc.computeQuietHoursDeferral({
      intent: { priority: "scheduled", respectQuietHours: false },
      quietHours: activeQuietHours(["reminder"]),
      source: "reminder"
    });
    assert.equal(deferUntil, null, "respectQuietHours=false → not deferred");
    console.log("✓ respectQuietHours=false (reminders) → not deferred");
  }

  console.log("\n✅ All notification-routing.service tests passed");
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
