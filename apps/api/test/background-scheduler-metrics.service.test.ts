import assert from "node:assert/strict";
import { BackgroundSchedulerMetricsService } from "../src/modules/workspace-management/application/background-scheduler-metrics.service";

async function runTickAcquiredMetricsTest(): Promise<void> {
  const metrics = new BackgroundSchedulerMetricsService();

  metrics.recordTickAcquired("idle_reengagement", 125, 3);

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.counters.scheduler_tick_total.idle_reengagement, 1);
  assert.equal(snapshot.counters.scheduler_tick_acquired_total.idle_reengagement, 1);
  assert.equal(snapshot.counters.scheduler_drain_candidates_total.idle_reengagement, 3);
  assert.deepEqual(snapshot.histograms.scheduler_tick_duration_ms.idle_reengagement, [125]);
}

async function runTickSkippedMetricsTest(): Promise<void> {
  const metrics = new BackgroundSchedulerMetricsService();

  metrics.recordTickSkipped("background_task");

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.counters.scheduler_tick_total.background_task, 1);
  assert.equal(snapshot.counters.scheduler_tick_skipped_total.background_task, 1);
}

async function runLeaseLostMetricTest(): Promise<void> {
  const metrics = new BackgroundSchedulerMetricsService();

  metrics.recordLeaseLost("background_compaction");

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.counters.scheduler_lease_lost_total.background_compaction, 1);
}

async function runExpiredLeaseRecoveredMetricTest(): Promise<void> {
  const metrics = new BackgroundSchedulerMetricsService();

  metrics.recordLeaseExpiredRecovered("media_job");

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.counters.scheduler_lease_expired_recovered_total.media_job, 1);
}

async function run(): Promise<void> {
  await runTickAcquiredMetricsTest();
  await runTickSkippedMetricsTest();
  await runLeaseLostMetricTest();
  await runExpiredLeaseRecoveredMetricTest();
  console.log("background scheduler metrics tests passed (ADR-091 Session 1)");
}

void run();
