import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createCadenceWatchdog,
  type CadenceWatchdogStallReport
} from "../src/modules/workspace-management/application/cadence-watchdog";

interface FakeClock {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  advance: (ms: number) => void;
  pendingCount: () => number;
}

function createFakeClock(start: number = 1_000_000): FakeClock {
  let nowMs = start;
  let nextId = 1;
  const pending = new Map<number, { fireAt: number; fn: () => void }>();
  return {
    now: () => nowMs,
    setTimer: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { fireAt: nowMs + ms, fn });
      return id;
    },
    clearTimer: (handle) => {
      pending.delete(handle as number);
    },
    advance: (ms) => {
      const target = nowMs + ms;
      for (;;) {
        let nextEntry: { id: number; fireAt: number; fn: () => void } | null = null;
        for (const [id, entry] of pending.entries()) {
          if (entry.fireAt <= target) {
            if (nextEntry === null || entry.fireAt < nextEntry.fireAt) {
              nextEntry = { id, ...entry };
            }
          }
        }
        if (nextEntry === null) {
          break;
        }
        nowMs = nextEntry.fireAt;
        pending.delete(nextEntry.id);
        nextEntry.fn();
      }
      nowMs = target;
    },
    pendingCount: () => pending.size
  };
}

describe("CadenceWatchdog", () => {
  test("fires silent stall when no delta arrives within silentMs after arm", () => {
    const clock = createFakeClock();
    const reports: CadenceWatchdogStallReport[] = [];
    const wd = createCadenceWatchdog(
      {
        silentMs: 5000,
        avgWindow: 8,
        avgThresholdMs: 200,
        avgMinSamples: 8,
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer
      },
      (r) => reports.push(r)
    );
    wd.arm();
    assert.equal(reports.length, 0);
    clock.advance(4999);
    assert.equal(reports.length, 0);
    clock.advance(2);
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.reason, "silent");
    assert.equal(reports[0]?.silentMs, 5000);
    assert.ok(wd.hasStalled());
    wd.dispose();
  });

  test("delta arrival resets the silent timer", () => {
    const clock = createFakeClock();
    const reports: CadenceWatchdogStallReport[] = [];
    const wd = createCadenceWatchdog(
      {
        silentMs: 5000,
        avgWindow: 8,
        avgThresholdMs: 200,
        avgMinSamples: 8,
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer
      },
      (r) => reports.push(r)
    );
    wd.arm();
    clock.advance(4000);
    wd.recordDelta();
    clock.advance(4000);
    wd.recordDelta();
    clock.advance(4999);
    assert.equal(reports.length, 0);
    clock.advance(2);
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.reason, "silent");
    wd.dispose();
  });

  test("fires slow_avg when rolling average exceeds threshold after min samples", () => {
    const clock = createFakeClock();
    const reports: CadenceWatchdogStallReport[] = [];
    const wd = createCadenceWatchdog(
      {
        silentMs: 60_000,
        avgWindow: 5,
        avgThresholdMs: 200,
        avgMinSamples: 5,
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer
      },
      (r) => reports.push(r)
    );
    wd.arm();
    wd.recordDelta();
    for (let i = 0; i < 5; i++) {
      clock.advance(300);
      wd.recordDelta();
    }
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.reason, "slow_avg");
    assert.equal(reports[0]?.rollingWindow, 5);
    assert.ok((reports[0]?.rollingAvgMs ?? 0) >= 290 && (reports[0]?.rollingAvgMs ?? 0) <= 310);
    wd.dispose();
  });

  test("does not fire slow_avg when cadence is healthy", () => {
    const clock = createFakeClock();
    const reports: CadenceWatchdogStallReport[] = [];
    const wd = createCadenceWatchdog(
      {
        silentMs: 60_000,
        avgWindow: 8,
        avgThresholdMs: 200,
        avgMinSamples: 5,
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer
      },
      (r) => reports.push(r)
    );
    wd.arm();
    wd.recordDelta();
    for (let i = 0; i < 30; i++) {
      clock.advance(40);
      wd.recordDelta();
    }
    assert.equal(reports.length, 0);
    assert.equal(wd.hasStalled(), false);
    wd.dispose();
  });

  test("does not fire slow_avg before reaching avgMinSamples", () => {
    const clock = createFakeClock();
    const reports: CadenceWatchdogStallReport[] = [];
    const wd = createCadenceWatchdog(
      {
        silentMs: 60_000,
        avgWindow: 10,
        avgThresholdMs: 100,
        avgMinSamples: 6,
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer
      },
      (r) => reports.push(r)
    );
    wd.arm();
    wd.recordDelta();
    for (let i = 0; i < 4; i++) {
      clock.advance(500);
      wd.recordDelta();
    }
    assert.equal(reports.length, 0);
    clock.advance(500);
    wd.recordDelta();
    clock.advance(500);
    wd.recordDelta();
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.reason, "slow_avg");
    wd.dispose();
  });

  test("fires only once even if multiple stall conditions are met", () => {
    const clock = createFakeClock();
    const reports: CadenceWatchdogStallReport[] = [];
    const wd = createCadenceWatchdog(
      {
        silentMs: 1000,
        avgWindow: 4,
        avgThresholdMs: 200,
        avgMinSamples: 4,
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer
      },
      (r) => reports.push(r)
    );
    wd.arm();
    wd.recordDelta();
    for (let i = 0; i < 5; i++) {
      clock.advance(300);
      wd.recordDelta();
    }
    assert.equal(reports.length, 1);
    clock.advance(5000);
    assert.equal(reports.length, 1);
    wd.dispose();
  });

  test("dispose clears pending timers and prevents future firings", () => {
    const clock = createFakeClock();
    const reports: CadenceWatchdogStallReport[] = [];
    const wd = createCadenceWatchdog(
      {
        silentMs: 5000,
        avgWindow: 8,
        avgThresholdMs: 200,
        avgMinSamples: 8,
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer
      },
      (r) => reports.push(r)
    );
    wd.arm();
    assert.equal(clock.pendingCount(), 1);
    wd.dispose();
    assert.equal(clock.pendingCount(), 0);
    clock.advance(10_000);
    assert.equal(reports.length, 0);
  });

  test("swallows errors thrown from the onStall callback", () => {
    const clock = createFakeClock();
    const wd = createCadenceWatchdog(
      {
        silentMs: 1000,
        avgWindow: 4,
        avgThresholdMs: 200,
        avgMinSamples: 4,
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer
      },
      () => {
        throw new Error("synthetic stall handler crash");
      }
    );
    wd.arm();
    assert.doesNotThrow(() => clock.advance(1100));
    assert.ok(wd.hasStalled());
    wd.dispose();
  });
});
