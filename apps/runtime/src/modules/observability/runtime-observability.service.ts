import { Injectable } from "@nestjs/common";
import type { RuntimeTrace } from "@persai/runtime-contract";
import type {
  RuntimeExecutionAdmissionPolicy,
  RuntimeExecutionClass
} from "../turns/runtime-execution-admission.service";

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

type RuntimeExecutionWaitMetricSeries = {
  key: {
    executionClass: RuntimeExecutionClass;
  };
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
  executionAdmissionPolicy: RuntimeExecutionAdmissionPolicy | null;
  executionInFlightSeries: Array<{
    executionClass: RuntimeExecutionClass;
    inFlight: number;
    peakInFlight: number;
  }>;
  executionQueueSeries: Array<{
    executionClass: RuntimeExecutionClass;
    queued: number;
    peakQueued: number;
    rejected: number;
    timedOut: number;
    admitted: number;
  }>;
  executionWaitSeries: RuntimeExecutionWaitMetricSeries[];
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
  private executionAdmissionPolicy: RuntimeExecutionAdmissionPolicy | null = null;
  private readonly executionInFlight = new Map<RuntimeExecutionClass, number>();
  private readonly executionPeakInFlight = new Map<RuntimeExecutionClass, number>();
  private readonly executionQueued = new Map<RuntimeExecutionClass, number>();
  private readonly executionPeakQueued = new Map<RuntimeExecutionClass, number>();
  private readonly executionRejected = new Map<RuntimeExecutionClass, number>();
  private readonly executionTimedOut = new Map<RuntimeExecutionClass, number>();
  private readonly executionAdmitted = new Map<RuntimeExecutionClass, number>();
  private readonly executionWaitSeries = new Map<string, RuntimeExecutionWaitMetricSeries>();

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

  setExecutionAdmissionPolicy(policy: RuntimeExecutionAdmissionPolicy): void {
    this.executionAdmissionPolicy = policy;
  }

  recordExecutionAdmissionQueued(executionClass: RuntimeExecutionClass, queued: number): void {
    this.executionQueued.set(executionClass, queued);
    this.executionPeakQueued.set(
      executionClass,
      Math.max(this.executionPeakQueued.get(executionClass) ?? 0, queued)
    );
  }

  recordExecutionAdmissionRejected(executionClass: RuntimeExecutionClass): void {
    this.executionRejected.set(
      executionClass,
      (this.executionRejected.get(executionClass) ?? 0) + 1
    );
  }

  recordExecutionAdmissionTimedOut(executionClass: RuntimeExecutionClass, waitMs: number): void {
    const queued = Math.max(0, (this.executionQueued.get(executionClass) ?? 0) - 1);
    this.executionQueued.set(executionClass, queued);
    this.executionTimedOut.set(
      executionClass,
      (this.executionTimedOut.get(executionClass) ?? 0) + 1
    );
    this.recordExecutionWait(executionClass, waitMs);
  }

  recordExecutionAdmissionStarted(executionClass: RuntimeExecutionClass, waitMs: number): void {
    const queued = Math.max(0, (this.executionQueued.get(executionClass) ?? 0) - 1);
    this.executionQueued.set(executionClass, queued);
    const nextInFlight = (this.executionInFlight.get(executionClass) ?? 0) + 1;
    this.executionInFlight.set(executionClass, nextInFlight);
    this.executionPeakInFlight.set(
      executionClass,
      Math.max(this.executionPeakInFlight.get(executionClass) ?? 0, nextInFlight)
    );
    this.executionAdmitted.set(
      executionClass,
      (this.executionAdmitted.get(executionClass) ?? 0) + 1
    );
    this.recordExecutionWait(executionClass, waitMs);
  }

  recordExecutionAdmissionFinished(executionClass: RuntimeExecutionClass): void {
    const current = this.executionInFlight.get(executionClass) ?? 0;
    if (current > 0) {
      this.executionInFlight.set(executionClass, current - 1);
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
      }),
      executionAdmissionPolicy: this.executionAdmissionPolicy,
      executionInFlightSeries: this.sortedExecutionClasses().map((executionClass) => ({
        executionClass,
        inFlight: this.executionInFlight.get(executionClass) ?? 0,
        peakInFlight: this.executionPeakInFlight.get(executionClass) ?? 0
      })),
      executionQueueSeries: this.sortedExecutionClasses().map((executionClass) => ({
        executionClass,
        queued: this.executionQueued.get(executionClass) ?? 0,
        peakQueued: this.executionPeakQueued.get(executionClass) ?? 0,
        rejected: this.executionRejected.get(executionClass) ?? 0,
        timedOut: this.executionTimedOut.get(executionClass) ?? 0,
        admitted: this.executionAdmitted.get(executionClass) ?? 0
      })),
      executionWaitSeries: Array.from(this.executionWaitSeries.values()).sort((left, right) => {
        return left.key.executionClass.localeCompare(right.key.executionClass);
      })
    };
  }

  private recordExecutionWait(executionClass: RuntimeExecutionClass, waitMs: number): void {
    const key = executionClass;
    const durationMs = Math.max(0, waitMs);
    const series = this.executionWaitSeries.get(key) ?? {
      key: { executionClass },
      count: 0,
      durationMsTotal: 0,
      maxDurationMs: 0,
      buckets: createBuckets()
    };
    series.count += 1;
    series.durationMsTotal += durationMs;
    series.maxDurationMs = Math.max(series.maxDurationMs, durationMs);
    for (const bucket of series.buckets) {
      if (durationMs <= bucket.le) {
        bucket.value += 1;
      }
    }
    this.executionWaitSeries.set(key, series);
  }

  private sortedExecutionClasses(): RuntimeExecutionClass[] {
    return ["background", "interactive_heavy", "interactive_light"];
  }
}
