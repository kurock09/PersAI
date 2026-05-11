import { Injectable } from "@nestjs/common";
import type { RuntimeTrace } from "@persai/runtime-contract";

type HistogramBucket = {
  le: number;
  value: number;
};

type RuntimeStreamMetricKey = {
  status: RuntimeTrace["status"];
};

type RuntimeStreamMetricSeries = {
  key: RuntimeStreamMetricKey;
  count: number;
  durationMsTotal: number;
  maxDurationMs: number;
  buckets: HistogramBucket[];
};

type RuntimeStreamStageMetricKey = {
  stage: string;
  status: RuntimeTrace["status"];
};

type RuntimeStreamStageMetricSeries = {
  key: RuntimeStreamStageMetricKey;
  count: number;
  durationMsTotal: number;
  maxDurationMs: number;
  buckets: HistogramBucket[];
};

const LATENCY_BUCKETS_MS = [50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000];

function createBuckets(): HistogramBucket[] {
  return LATENCY_BUCKETS_MS.map((bucket) => ({ le: bucket, value: 0 }));
}

function runtimeStreamSeriesKeyOf(key: RuntimeStreamMetricKey): string {
  return key.status;
}

function runtimeStreamStageSeriesKeyOf(key: RuntimeStreamStageMetricKey): string {
  return `${key.stage} ${key.status}`;
}

export interface RuntimeObservabilitySnapshot {
  warmRequests: number;
  warmReplacements: number;
  invalidateRequests: number;
  invalidatedBundles: number;
  evictedBundles: number;
  lastWarmedAt: string | null;
  lastInvalidatedAt: string | null;
  streamTurnsInFlight: number;
  peakStreamTurnsInFlight: number;
  streamTurnSeries: RuntimeStreamMetricSeries[];
  streamStageSeries: RuntimeStreamStageMetricSeries[];
}

type RecordWarmInput = {
  replaced: boolean;
  evictedCount: number;
  warmedAt: string;
};

type RecordInvalidationInput = {
  invalidatedCount: number;
  invalidatedAt: string;
};

@Injectable()
export class RuntimeObservabilityService {
  private warmRequests = 0;
  private warmReplacements = 0;
  private invalidateRequests = 0;
  private invalidatedBundles = 0;
  private evictedBundles = 0;
  private lastWarmedAt: string | null = null;
  private lastInvalidatedAt: string | null = null;
  private streamTurnsInFlight = 0;
  private peakStreamTurnsInFlight = 0;
  private readonly streamTurnSeries = new Map<string, RuntimeStreamMetricSeries>();
  private readonly streamStageSeries = new Map<string, RuntimeStreamStageMetricSeries>();

  recordWarm(input: RecordWarmInput): void {
    this.warmRequests += 1;
    if (input.replaced) {
      this.warmReplacements += 1;
    }
    this.evictedBundles += input.evictedCount;
    this.lastWarmedAt = input.warmedAt;
  }

  recordInvalidation(input: RecordInvalidationInput): void {
    this.invalidateRequests += 1;
    this.invalidatedBundles += input.invalidatedCount;
    this.lastInvalidatedAt = input.invalidatedAt;
  }

  beginStreamTurn(): void {
    this.streamTurnsInFlight += 1;
    if (this.streamTurnsInFlight > this.peakStreamTurnsInFlight) {
      this.peakStreamTurnsInFlight = this.streamTurnsInFlight;
    }
  }

  endStreamTurn(): void {
    if (this.streamTurnsInFlight > 0) {
      this.streamTurnsInFlight -= 1;
    }
  }

  recordStreamTurn(trace: RuntimeTrace): void {
    const key: RuntimeStreamMetricKey = {
      status: trace.status
    };
    const seriesKey = runtimeStreamSeriesKeyOf(key);
    const series = this.streamTurnSeries.get(seriesKey) ?? {
      key,
      count: 0,
      durationMsTotal: 0,
      maxDurationMs: 0,
      buckets: createBuckets()
    };

    series.count += 1;
    series.durationMsTotal += trace.totalMs;
    series.maxDurationMs = Math.max(series.maxDurationMs, trace.totalMs);
    for (const bucket of series.buckets) {
      if (trace.totalMs <= bucket.le) {
        bucket.value += 1;
      }
    }
    this.streamTurnSeries.set(seriesKey, series);

    for (const stage of trace.stages) {
      const stageKey: RuntimeStreamStageMetricKey = {
        stage: stage.key,
        status: trace.status
      };
      const stageSeriesKey = runtimeStreamStageSeriesKeyOf(stageKey);
      const stageSeries = this.streamStageSeries.get(stageSeriesKey) ?? {
        key: stageKey,
        count: 0,
        durationMsTotal: 0,
        maxDurationMs: 0,
        buckets: createBuckets()
      };

      stageSeries.count += 1;
      stageSeries.durationMsTotal += stage.durationMs;
      stageSeries.maxDurationMs = Math.max(stageSeries.maxDurationMs, stage.durationMs);
      for (const bucket of stageSeries.buckets) {
        if (stage.durationMs <= bucket.le) {
          bucket.value += 1;
        }
      }
      this.streamStageSeries.set(stageSeriesKey, stageSeries);
    }
  }

  getSnapshot(): RuntimeObservabilitySnapshot {
    return {
      warmRequests: this.warmRequests,
      warmReplacements: this.warmReplacements,
      invalidateRequests: this.invalidateRequests,
      invalidatedBundles: this.invalidatedBundles,
      evictedBundles: this.evictedBundles,
      lastWarmedAt: this.lastWarmedAt,
      lastInvalidatedAt: this.lastInvalidatedAt,
      streamTurnsInFlight: this.streamTurnsInFlight,
      peakStreamTurnsInFlight: this.peakStreamTurnsInFlight,
      streamTurnSeries: Array.from(this.streamTurnSeries.values()).sort((left, right) => {
        return runtimeStreamSeriesKeyOf(left.key).localeCompare(
          runtimeStreamSeriesKeyOf(right.key)
        );
      }),
      streamStageSeries: Array.from(this.streamStageSeries.values()).sort((left, right) => {
        return runtimeStreamStageSeriesKeyOf(left.key).localeCompare(
          runtimeStreamStageSeriesKeyOf(right.key)
        );
      })
    };
  }
}
