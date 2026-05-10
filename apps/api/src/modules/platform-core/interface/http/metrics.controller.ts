import { Controller, Get, Res } from "@nestjs/common";
import { PlatformHttpMetricsService } from "../../application/platform-http-metrics.service";
import { PlatformReadinessService } from "../../application/platform-readiness.service";
import { getBackgroundSchedulerMetricsSnapshot } from "../../../workspace-management/application/background-scheduler-metrics.service";

interface MetricsResponseHeaders {
  setHeader(name: string, value: string): void;
}

function escapeMetricLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function buildBackgroundSchedulerMetricLines(): string[] {
  const snapshot = getBackgroundSchedulerMetricsSnapshot();
  const lines: string[] = [];

  const counterHelp: Record<keyof typeof snapshot.counters, string> = {
    scheduler_tick_total: "Total scheduler ticks attempted",
    scheduler_tick_acquired_total: "Scheduler ticks that acquired leadership",
    scheduler_tick_skipped_total: "Scheduler ticks skipped because another leader was active",
    scheduler_drain_candidates_total: "Scheduler candidates or jobs processed during leader ticks",
    scheduler_lease_lost_total: "Scheduler drains aborted after lease loss",
    scheduler_lease_expired_recovered_total: "Scheduler ticks that recovered an expired lease"
  };

  for (const [metric, values] of Object.entries(snapshot.counters)) {
    lines.push(`# HELP ${metric} ${counterHelp[metric as keyof typeof snapshot.counters]}`);
    lines.push(`# TYPE ${metric} counter`);
    for (const [schedulerKey, value] of Object.entries(values)) {
      lines.push(`${metric}{scheduler="${escapeMetricLabel(schedulerKey)}"} ${value ?? 0}`);
    }
  }

  lines.push("# HELP scheduler_tick_duration_ms Scheduler leader tick duration in milliseconds");
  lines.push("# TYPE scheduler_tick_duration_ms histogram");
  for (const [schedulerKey, values] of Object.entries(
    snapshot.histograms.scheduler_tick_duration_ms
  )) {
    const samples = values ?? [];
    const sum = samples.reduce((total, value) => total + value, 0);
    const sortedSamples = [...samples].sort((left, right) => left - right);
    sortedSamples.forEach((value, index) => {
      lines.push(
        `scheduler_tick_duration_ms_bucket{scheduler="${escapeMetricLabel(schedulerKey)}",le="${value}"} ${index + 1}`
      );
    });
    lines.push(
      `scheduler_tick_duration_ms_bucket{scheduler="${escapeMetricLabel(schedulerKey)}",le="+Inf"} ${samples.length}`
    );
    lines.push(
      `scheduler_tick_duration_ms_sum{scheduler="${escapeMetricLabel(schedulerKey)}"} ${sum}`
    );
    lines.push(
      `scheduler_tick_duration_ms_count{scheduler="${escapeMetricLabel(schedulerKey)}"} ${samples.length}`
    );
  }

  return lines;
}

@Controller()
export class MetricsController {
  constructor(
    private readonly platformReadinessService: PlatformReadinessService,
    private readonly platformHttpMetricsService: PlatformHttpMetricsService
  ) {}

  @Get("metrics")
  async getMetrics(@Res({ passthrough: true }) res: MetricsResponseHeaders): Promise<string> {
    const readiness = await this.platformReadinessService.getSnapshot();
    const httpMetrics = this.platformHttpMetricsService.getSnapshot();
    const memoryUsage = process.memoryUsage();

    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");

    const lines = [
      "# HELP app_up API process up status",
      "# TYPE app_up gauge",
      "app_up 1",
      "# HELP app_ready API readiness status",
      "# TYPE app_ready gauge",
      `app_ready ${readiness.ready ? 1 : 0}`,
      "# HELP app_dependency_ready Dependency readiness status",
      "# TYPE app_dependency_ready gauge",
      ...readiness.dependencies.map(
        (dependency) =>
          `app_dependency_ready{dependency="${dependency.name}"} ${dependency.ready ? 1 : 0}`
      ),
      "# HELP app_dependency_check_duration_ms Dependency readiness check duration in milliseconds",
      "# TYPE app_dependency_check_duration_ms gauge",
      ...readiness.dependencies.map(
        (dependency) =>
          `app_dependency_check_duration_ms{dependency="${dependency.name}"} ${dependency.durationMs}`
      ),
      "# HELP http_requests_total Total completed HTTP requests",
      "# TYPE http_requests_total counter",
      `http_requests_total ${httpMetrics.requestsTotal}`,
      "# HELP http_requests_in_flight Current in-flight HTTP requests",
      "# TYPE http_requests_in_flight gauge",
      `http_requests_in_flight ${httpMetrics.inFlightRequests}`,
      "# HELP http_error_requests_total Total completed HTTP 5xx requests",
      "# TYPE http_error_requests_total counter",
      `http_error_requests_total ${httpMetrics.errorRequestsTotal}`,
      "# HELP http_requests_by_status_total Completed HTTP requests by method route and status code",
      "# TYPE http_requests_by_status_total counter",
      ...httpMetrics.series.map(
        (series) =>
          `http_requests_by_status_total{method="${series.key.method}",route="${series.key.route}",status_code="${series.key.statusCode}",status_class="${Math.floor(series.key.statusCode / 100)}xx"} ${series.count}`
      ),
      "# HELP http_request_duration_ms HTTP request duration in milliseconds",
      "# TYPE http_request_duration_ms histogram",
      "# HELP http_request_duration_ms_max Maximum observed HTTP request duration in milliseconds",
      "# TYPE http_request_duration_ms_max gauge",
      ...httpMetrics.series.map(
        (series) =>
          `http_request_duration_ms_max{method="${series.key.method}",route="${series.key.route}",status_code="${series.key.statusCode}",status_class="${Math.floor(series.key.statusCode / 100)}xx"} ${series.maxDurationMs.toFixed(2)}`
      ),
      ...httpMetrics.series.flatMap((series) => [
        ...series.buckets.map(
          (bucket) =>
            `http_request_duration_ms_bucket{method="${series.key.method}",route="${series.key.route}",status_code="${series.key.statusCode}",status_class="${Math.floor(series.key.statusCode / 100)}xx",le="${bucket.le}"} ${bucket.value}`
        ),
        `http_request_duration_ms_bucket{method="${series.key.method}",route="${series.key.route}",status_code="${series.key.statusCode}",status_class="${Math.floor(series.key.statusCode / 100)}xx",le="+Inf"} ${series.count}`,
        `http_request_duration_ms_sum{method="${series.key.method}",route="${series.key.route}",status_code="${series.key.statusCode}",status_class="${Math.floor(series.key.statusCode / 100)}xx"} ${series.durationMsTotal.toFixed(2)}`,
        `http_request_duration_ms_count{method="${series.key.method}",route="${series.key.route}",status_code="${series.key.statusCode}",status_class="${Math.floor(series.key.statusCode / 100)}xx"} ${series.count}`
      ]),
      "# HELP media_stage_operations_total Total media-stage operations by stage channel and outcome",
      "# TYPE media_stage_operations_total counter",
      ...httpMetrics.mediaStageSeries.map(
        (series) =>
          `media_stage_operations_total{stage="${series.key.stage}",channel="${series.key.channel}",outcome="${series.key.outcome}"} ${series.count}`
      ),
      "# HELP media_stage_duration_ms Media-stage operation duration in milliseconds",
      "# TYPE media_stage_duration_ms histogram",
      "# HELP media_stage_duration_ms_max Maximum observed media-stage operation duration in milliseconds",
      "# TYPE media_stage_duration_ms_max gauge",
      ...httpMetrics.mediaStageSeries.map(
        (series) =>
          `media_stage_duration_ms_max{stage="${series.key.stage}",channel="${series.key.channel}",outcome="${series.key.outcome}"} ${series.maxDurationMs.toFixed(2)}`
      ),
      ...httpMetrics.mediaStageSeries.flatMap((series) => [
        ...series.buckets.map(
          (bucket) =>
            `media_stage_duration_ms_bucket{stage="${series.key.stage}",channel="${series.key.channel}",outcome="${series.key.outcome}",le="${bucket.le}"} ${bucket.value}`
        ),
        `media_stage_duration_ms_bucket{stage="${series.key.stage}",channel="${series.key.channel}",outcome="${series.key.outcome}",le="+Inf"} ${series.count}`,
        `media_stage_duration_ms_sum{stage="${series.key.stage}",channel="${series.key.channel}",outcome="${series.key.outcome}"} ${series.durationMsTotal.toFixed(2)}`,
        `media_stage_duration_ms_count{stage="${series.key.stage}",channel="${series.key.channel}",outcome="${series.key.outcome}"} ${series.count}`
      ]),
      "# HELP process_uptime_seconds Process uptime in seconds",
      "# TYPE process_uptime_seconds gauge",
      `process_uptime_seconds ${process.uptime().toFixed(2)}`,
      "# HELP process_resident_memory_bytes Resident process memory in bytes",
      "# TYPE process_resident_memory_bytes gauge",
      `process_resident_memory_bytes ${memoryUsage.rss}`,
      "# HELP nodejs_heap_used_bytes Used heap memory in bytes",
      "# TYPE nodejs_heap_used_bytes gauge",
      `nodejs_heap_used_bytes ${memoryUsage.heapUsed}`,
      "# HELP nodejs_heap_total_bytes Total heap memory in bytes",
      "# TYPE nodejs_heap_total_bytes gauge",
      `nodejs_heap_total_bytes ${memoryUsage.heapTotal}`,
      "# HELP nodejs_external_memory_bytes External memory in bytes",
      "# TYPE nodejs_external_memory_bytes gauge",
      `nodejs_external_memory_bytes ${memoryUsage.external}`,
      // ADR-091 audit: expose scheduler lease and drain health on the shared metrics surface.
      ...buildBackgroundSchedulerMetricLines()
    ];

    return `${lines.join("\n")}\n`;
  }
}
