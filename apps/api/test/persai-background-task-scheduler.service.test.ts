import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PersaiBackgroundTaskSchedulerService } from "../src/modules/workspace-management/application/persai-background-task-scheduler.service";

class FakeSchedulerLeaseService {
  acquireResult: { token: string } | null = { token: "lease-task-1" };
  heartbeatResults: boolean[] = [];
  releaseCalls: Array<{ key: string; token: string }> = [];
  leaseState: { holderId: string; expiresAt: Date } | null = {
    holderId: "",
    expiresAt: new Date(Date.now() - 1)
  };

  async getLeaseState() {
    return this.leaseState;
  }

  async acquire() {
    return this.acquireResult;
  }

  async heartbeat() {
    return this.heartbeatResults.shift() ?? true;
  }

  async release(key: string, token: string) {
    this.releaseCalls.push({ key, token });
  }
}

class FakeBackgroundSchedulerMetricsService {
  tickAcquired: Array<{ key: string; durationMs: number; candidatesProcessed: number }> = [];
  tickSkipped: string[] = [];
  leaseLost: string[] = [];

  recordTickAcquired(key: string, durationMs: number, candidatesProcessed: number): void {
    this.tickAcquired.push({ key, durationMs, candidatesProcessed });
  }

  recordTickSkipped(key: string): void {
    this.tickSkipped.push(key);
  }

  recordLeaseLost(key: string): void {
    this.leaseLost.push(key);
  }

  recordLeaseExpiredRecovered(): void {}
}

function createService(
  leaseService: FakeSchedulerLeaseService,
  metricsService: FakeBackgroundSchedulerMetricsService
): PersaiBackgroundTaskSchedulerService {
  return new PersaiBackgroundTaskSchedulerService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    leaseService as never,
    metricsService as never
  );
}

describe("PersaiBackgroundTaskSchedulerService", () => {
  test("tick exits silently when another leader owns the lease", async () => {
    const leaseService = new FakeSchedulerLeaseService();
    leaseService.acquireResult = null;
    const metricsService = new FakeBackgroundSchedulerMetricsService();
    const service = createService(leaseService, metricsService);

    (service as unknown as { scheduleNext: (delayMs: number) => void }).scheduleNext = () =>
      undefined;
    (service as unknown as { processDueTasksBatch: () => Promise<number> }).processDueTasksBatch =
      async () => {
        throw new Error("tick should not process tasks when another leader holds the lease");
      };

    await (service as unknown as { tick: () => Promise<void> }).tick();

    assert.deepEqual(metricsService.tickSkipped, ["background_task"]);
    assert.equal(leaseService.releaseCalls.length, 0);
  });

  test("tick aborts further drain after lease loss", async () => {
    const leaseService = new FakeSchedulerLeaseService();
    leaseService.acquireResult = { token: "lease-task-1" };
    leaseService.heartbeatResults = [false];
    const metricsService = new FakeBackgroundSchedulerMetricsService();
    const service = createService(leaseService, metricsService);
    let batchCalls = 0;

    (service as unknown as { scheduleNext: (delayMs: number) => void }).scheduleNext = () =>
      undefined;
    (service as unknown as { processDueTasksBatch: () => Promise<number> }).processDueTasksBatch =
      async () => {
        batchCalls += 1;
        if (batchCalls === 1) {
          (
            service as unknown as {
              leaseLost: boolean;
            }
          ).leaseLost = true;
          metricsService.recordLeaseLost("background_task");
        }
        return 12;
      };

    await (service as unknown as { tick: () => Promise<void> }).tick();

    assert.equal(batchCalls, 1);
    assert.deepEqual(metricsService.leaseLost, ["background_task"]);
    assert.equal(metricsService.tickAcquired[0]?.candidatesProcessed, 12);
    assert.deepEqual(leaseService.releaseCalls, [
      { key: "background_task", token: "lease-task-1" }
    ]);
  });
});
