import { Injectable } from "@nestjs/common";

type HistogramBucket = {
  le: number;
  value: number;
};

type ProviderStreamRequestMetricKey = {
  provider: string;
  classification: string;
  status: "completed" | "failed" | "interrupted";
};

type ProviderStreamRequestMetricSeries = {
  key: ProviderStreamRequestMetricKey;
  count: number;
  durationMsTotal: number;
  maxDurationMs: number;
  buckets: HistogramBucket[];
};

type ProviderStreamStageMetricKey = {
  provider: string;
  classification: string;
  stage: string;
  status: "completed" | "failed" | "interrupted";
};

type ProviderStreamStageMetricSeries = {
  key: ProviderStreamStageMetricKey;
  count: number;
  durationMsTotal: number;
  maxDurationMs: number;
  buckets: HistogramBucket[];
};

export interface ProviderStreamObservabilitySnapshot {
  inFlightStreamRequests: number;
  peakInFlightStreamRequests: number;
  requestSeries: ProviderStreamRequestMetricSeries[];
  stageSeries: ProviderStreamStageMetricSeries[];
}

const LATENCY_BUCKETS_MS = [50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000];

function createBuckets(): HistogramBucket[] {
  return LATENCY_BUCKETS_MS.map((bucket) => ({ le: bucket, value: 0 }));
}

function requestSeriesKeyOf(key: ProviderStreamRequestMetricKey): string {
  return `${key.provider} ${key.classification} ${key.status}`;
}

function stageSeriesKeyOf(key: ProviderStreamStageMetricKey): string {
  return `${key.provider} ${key.classification} ${key.stage} ${key.status}`;
}

@Injectable()
export class ProviderStreamObservabilityService {
  private inFlightStreamRequests = 0;
  private peakInFlightStreamRequests = 0;
  private readonly requestSeries = new Map<string, ProviderStreamRequestMetricSeries>();
  private readonly stageSeries = new Map<string, ProviderStreamStageMetricSeries>();

  beginStreamRequest(): void {
    this.inFlightStreamRequests += 1;
    if (this.inFlightStreamRequests > this.peakInFlightStreamRequests) {
      this.peakInFlightStreamRequests = this.inFlightStreamRequests;
    }
  }

  endStreamRequest(): void {
    if (this.inFlightStreamRequests > 0) {
      this.inFlightStreamRequests -= 1;
    }
  }

  recordStreamRequest(input: {
    provider: string;
    classification: string;
    status: "completed" | "failed" | "interrupted";
    totalMs: number;
    stageDurations: Array<{ stage: string; durationMs: number }>;
  }): void {
    const requestKey: ProviderStreamRequestMetricKey = {
      provider: input.provider,
      classification: input.classification,
      status: input.status
    };
    const requestSeriesKey = requestSeriesKeyOf(requestKey);
    const requestSeries = this.requestSeries.get(requestSeriesKey) ?? {
      key: requestKey,
      count: 0,
      durationMsTotal: 0,
      maxDurationMs: 0,
      buckets: createBuckets()
    };
    requestSeries.count += 1;
    requestSeries.durationMsTotal += input.totalMs;
    requestSeries.maxDurationMs = Math.max(requestSeries.maxDurationMs, input.totalMs);
    for (const bucket of requestSeries.buckets) {
      if (input.totalMs <= bucket.le) {
        bucket.value += 1;
      }
    }
    this.requestSeries.set(requestSeriesKey, requestSeries);

    for (const stage of input.stageDurations) {
      const stageKey: ProviderStreamStageMetricKey = {
        provider: input.provider,
        classification: input.classification,
        stage: stage.stage,
        status: input.status
      };
      const stageSeriesKey = stageSeriesKeyOf(stageKey);
      const stageSeries = this.stageSeries.get(stageSeriesKey) ?? {
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
      this.stageSeries.set(stageSeriesKey, stageSeries);
    }
  }

  getSnapshot(): ProviderStreamObservabilitySnapshot {
    return {
      inFlightStreamRequests: this.inFlightStreamRequests,
      peakInFlightStreamRequests: this.peakInFlightStreamRequests,
      requestSeries: Array.from(this.requestSeries.values()).sort((left, right) =>
        requestSeriesKeyOf(left.key).localeCompare(requestSeriesKeyOf(right.key))
      ),
      stageSeries: Array.from(this.stageSeries.values()).sort((left, right) =>
        stageSeriesKeyOf(left.key).localeCompare(stageSeriesKeyOf(right.key))
      )
    };
  }
}
