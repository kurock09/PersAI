import { Injectable } from "@nestjs/common";
import type { SchedulerKey } from "./scheduler-lease.constants";

type CounterMetricName =
  | "scheduler_tick_total"
  | "scheduler_tick_acquired_total"
  | "scheduler_tick_skipped_total"
  | "scheduler_drain_candidates_total"
  | "scheduler_lease_lost_total"
  | "scheduler_lease_expired_recovered_total";

type HistogramMetricName = "scheduler_tick_duration_ms";

export type BackgroundSchedulerMetricsSnapshot = {
  counters: Record<CounterMetricName, Partial<Record<SchedulerKey, number>>>;
  histograms: Record<HistogramMetricName, Partial<Record<SchedulerKey, number[]>>>;
};

export interface BackgroundSchedulerMetricsExporter {
  incrementCounter(metric: CounterMetricName, key: SchedulerKey, value?: number): void;
  observeHistogram(metric: HistogramMetricName, key: SchedulerKey, value: number): void;
  snapshot(): BackgroundSchedulerMetricsSnapshot;
}

class InMemoryBackgroundSchedulerMetricsExporter implements BackgroundSchedulerMetricsExporter {
  private readonly counters: BackgroundSchedulerMetricsSnapshot["counters"] = {
    scheduler_tick_total: {},
    scheduler_tick_acquired_total: {},
    scheduler_tick_skipped_total: {},
    scheduler_drain_candidates_total: {},
    scheduler_lease_lost_total: {},
    scheduler_lease_expired_recovered_total: {}
  };

  private readonly histograms: BackgroundSchedulerMetricsSnapshot["histograms"] = {
    scheduler_tick_duration_ms: {}
  };

  incrementCounter(metric: CounterMetricName, key: SchedulerKey, value = 1): void {
    const current = this.counters[metric][key] ?? 0;
    this.counters[metric][key] = current + value;
  }

  observeHistogram(metric: HistogramMetricName, key: SchedulerKey, value: number): void {
    const existing = this.histograms[metric][key] ?? [];
    this.histograms[metric][key] = [...existing, value];
  }

  snapshot(): BackgroundSchedulerMetricsSnapshot {
    return {
      counters: {
        scheduler_tick_total: { ...this.counters.scheduler_tick_total },
        scheduler_tick_acquired_total: { ...this.counters.scheduler_tick_acquired_total },
        scheduler_tick_skipped_total: { ...this.counters.scheduler_tick_skipped_total },
        scheduler_drain_candidates_total: { ...this.counters.scheduler_drain_candidates_total },
        scheduler_lease_lost_total: { ...this.counters.scheduler_lease_lost_total },
        scheduler_lease_expired_recovered_total: {
          ...this.counters.scheduler_lease_expired_recovered_total
        }
      },
      histograms: {
        scheduler_tick_duration_ms: Object.fromEntries(
          Object.entries(this.histograms.scheduler_tick_duration_ms).map(([key, values]) => [
            key,
            [...values]
          ])
        ) as Partial<Record<SchedulerKey, number[]>>
      }
    };
  }
}

const DEFAULT_BACKGROUND_SCHEDULER_METRICS_EXPORTER =
  new InMemoryBackgroundSchedulerMetricsExporter();

export function getBackgroundSchedulerMetricsSnapshot(): BackgroundSchedulerMetricsSnapshot {
  // ADR-091 audit: expose one process-wide scheduler snapshot to operator surfaces.
  return DEFAULT_BACKGROUND_SCHEDULER_METRICS_EXPORTER.snapshot();
}

@Injectable()
export class BackgroundSchedulerMetricsService {
  private readonly exporter: BackgroundSchedulerMetricsExporter =
    DEFAULT_BACKGROUND_SCHEDULER_METRICS_EXPORTER;

  recordTickAcquired(key: SchedulerKey, durationMs: number, candidatesProcessed: number): void {
    this.exporter.incrementCounter("scheduler_tick_total", key);
    this.exporter.incrementCounter("scheduler_tick_acquired_total", key);
    this.exporter.incrementCounter(
      "scheduler_drain_candidates_total",
      key,
      Math.max(0, Math.floor(candidatesProcessed))
    );
    this.exporter.observeHistogram("scheduler_tick_duration_ms", key, durationMs);
  }

  recordTickSkipped(key: SchedulerKey): void {
    this.exporter.incrementCounter("scheduler_tick_total", key);
    this.exporter.incrementCounter("scheduler_tick_skipped_total", key);
  }

  recordLeaseLost(key: SchedulerKey): void {
    this.exporter.incrementCounter("scheduler_lease_lost_total", key);
  }

  recordLeaseExpiredRecovered(key: SchedulerKey): void {
    this.exporter.incrementCounter("scheduler_lease_expired_recovered_total", key);
  }

  snapshot(): BackgroundSchedulerMetricsSnapshot {
    return this.exporter.snapshot();
  }
}
