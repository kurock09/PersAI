import { Injectable } from "@nestjs/common";

type RequestMetricKey = {
  method: string;
  route: string;
  statusCode: number;
};

type HistogramBucket = {
  le: number;
  value: number;
};

type RequestMetricSeries = {
  key: RequestMetricKey;
  count: number;
  errorCount: number;
  durationMsTotal: number;
  maxDurationMs: number;
  buckets: HistogramBucket[];
};

type MediaStageMetricKey = {
  stage: string;
  channel: string;
  outcome: string;
};

type MediaStageMetricSeries = {
  key: MediaStageMetricKey;
  count: number;
  durationMsTotal: number;
  maxDurationMs: number;
  buckets: HistogramBucket[];
};

export type PlatformHttpMetricsSnapshot = {
  requestsTotal: number;
  errorRequestsTotal: number;
  inFlightRequests: number;
  peakInFlightRequests: number;
  processStartedAt: string;
  series: RequestMetricSeries[];
  mediaStageSeries: MediaStageMetricSeries[];
};

const LATENCY_BUCKETS_MS = [50, 100, 250, 500, 1_000, 2_500, 5_000];

function createBuckets(): HistogramBucket[] {
  return LATENCY_BUCKETS_MS.map((bucket) => ({ le: bucket, value: 0 }));
}

function normalizeMethod(method: string | undefined): string {
  return (method ?? "UNKNOWN").toUpperCase();
}

function stripQuery(path: string): string {
  return path.split("?")[0]?.trim() || "";
}

function joinRoute(baseUrl: string | undefined, routePath: string): string {
  const normalizedBase = stripQuery(baseUrl ?? "").replace(/\/$/, "");
  const normalizedRoute = stripQuery(routePath).replace(/^\//, "");

  if (!normalizedBase) {
    return `/${normalizedRoute}`.replace(/\/+/g, "/");
  }

  if (!normalizedRoute) {
    return normalizedBase || "unknown";
  }

  return `${normalizedBase}/${normalizedRoute}`.replace(/\/+/g, "/");
}

function normalizeFallbackRoute(path: string | undefined): string {
  if (!path || path.trim().length === 0) {
    return "unknown";
  }

  const pathname = stripQuery(path);
  if (!pathname) {
    return "unknown";
  }

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "unknown";
  }

  const [first, second] = segments;
  if (first === "health" || first === "ready" || first === "metrics") {
    return `/${first}`;
  }

  if (first === "api" && second === "v1") {
    return "/api/v1/*";
  }

  if (first === "api") {
    return "/api/*";
  }

  return `/${first}/*`;
}

function normalizeRoute(input: {
  path?: string;
  routePath?: string | string[];
  baseUrl?: string;
}): string {
  const routePath = Array.isArray(input.routePath) ? input.routePath[0] : input.routePath;
  if (routePath && routePath.trim().length > 0) {
    return joinRoute(input.baseUrl, routePath.trim());
  }

  return normalizeFallbackRoute(input.path);
}

function seriesKeyOf(key: RequestMetricKey): string {
  return `${key.method} ${key.route} ${key.statusCode}`;
}

function mediaSeriesKeyOf(key: MediaStageMetricKey): string {
  return `${key.stage} ${key.channel} ${key.outcome}`;
}

@Injectable()
export class PlatformHttpMetricsService {
  private inFlightRequests = 0;
  private peakInFlightRequests = 0;
  private requestsTotal = 0;
  private errorRequestsTotal = 0;
  private readonly processStartedAt = new Date().toISOString();
  private readonly series = new Map<string, RequestMetricSeries>();
  private readonly mediaStageSeries = new Map<string, MediaStageMetricSeries>();

  beginRequest(): void {
    this.inFlightRequests += 1;
    if (this.inFlightRequests > this.peakInFlightRequests) {
      this.peakInFlightRequests = this.inFlightRequests;
    }
  }

  endInFlightRequest(): void {
    if (this.inFlightRequests > 0) {
      this.inFlightRequests -= 1;
    }
  }

  recordCompletedRequest(input: {
    method?: string;
    path?: string;
    routePath?: string | string[];
    baseUrl?: string;
    statusCode: number;
    latencyMs: number;
  }): void {
    const key: RequestMetricKey = {
      method: normalizeMethod(input.method),
      route: normalizeRoute(input),
      statusCode: input.statusCode
    };
    const seriesKey = seriesKeyOf(key);
    const series = this.series.get(seriesKey) ?? {
      key,
      count: 0,
      errorCount: 0,
      durationMsTotal: 0,
      maxDurationMs: 0,
      buckets: createBuckets()
    };

    series.count += 1;
    series.durationMsTotal += input.latencyMs;
    series.maxDurationMs = Math.max(series.maxDurationMs, input.latencyMs);
    if (input.statusCode >= 500) {
      series.errorCount += 1;
      this.errorRequestsTotal += 1;
    }

    for (const bucket of series.buckets) {
      if (input.latencyMs <= bucket.le) {
        bucket.value += 1;
      }
    }

    this.requestsTotal += 1;
    this.series.set(seriesKey, series);
  }

  recordMediaStage(input: {
    stage: string;
    channel?: string;
    outcome: "success" | "failure";
    latencyMs: number;
  }): void {
    const key: MediaStageMetricKey = {
      stage: input.stage.trim(),
      channel: (input.channel ?? "unknown").trim(),
      outcome: input.outcome
    };
    const seriesKey = mediaSeriesKeyOf(key);
    const series = this.mediaStageSeries.get(seriesKey) ?? {
      key,
      count: 0,
      durationMsTotal: 0,
      maxDurationMs: 0,
      buckets: createBuckets()
    };

    series.count += 1;
    series.durationMsTotal += input.latencyMs;
    series.maxDurationMs = Math.max(series.maxDurationMs, input.latencyMs);

    for (const bucket of series.buckets) {
      if (input.latencyMs <= bucket.le) {
        bucket.value += 1;
      }
    }

    this.mediaStageSeries.set(seriesKey, series);
  }

  getSnapshot(): PlatformHttpMetricsSnapshot {
    return {
      requestsTotal: this.requestsTotal,
      errorRequestsTotal: this.errorRequestsTotal,
      inFlightRequests: this.inFlightRequests,
      peakInFlightRequests: this.peakInFlightRequests,
      processStartedAt: this.processStartedAt,
      series: Array.from(this.series.values()).sort((left, right) => {
        return seriesKeyOf(left.key).localeCompare(seriesKeyOf(right.key));
      }),
      mediaStageSeries: Array.from(this.mediaStageSeries.values()).sort((left, right) => {
        return mediaSeriesKeyOf(left.key).localeCompare(mediaSeriesKeyOf(right.key));
      })
    };
  }
}
