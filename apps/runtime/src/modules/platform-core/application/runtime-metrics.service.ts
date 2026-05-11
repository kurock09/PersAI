import { Injectable } from "@nestjs/common";
import { RuntimeBundleRegistryService } from "../../bundles/runtime-bundle-registry.service";
import { RuntimeObservabilityService } from "../../observability/runtime-observability.service";
import { RuntimeReadinessService } from "./runtime-readiness.service";

@Injectable()
export class RuntimeMetricsService {
  constructor(
    private readonly runtimeReadinessService: RuntimeReadinessService,
    private readonly runtimeBundleRegistryService: RuntimeBundleRegistryService,
    private readonly runtimeObservabilityService: RuntimeObservabilityService
  ) {}

  async renderMetrics(): Promise<string> {
    const readiness = await this.runtimeReadinessService.getSnapshot();
    const bundleRegistry = this.runtimeBundleRegistryService.getSnapshot();
    const observability = this.runtimeObservabilityService.getSnapshot();

    const lines = [
      "# HELP runtime_service_up Runtime service process up status",
      "# TYPE runtime_service_up gauge",
      "runtime_service_up 1",
      "# HELP runtime_service_ready Runtime service readiness status",
      "# TYPE runtime_service_ready gauge",
      `runtime_service_ready ${readiness.ready ? 1 : 0}`,
      "# HELP runtime_service_execution_enabled Runtime execution cutover enabled status",
      "# TYPE runtime_service_execution_enabled gauge",
      `runtime_service_execution_enabled ${readiness.executionEnabled ? 1 : 0}`,
      "# HELP runtime_bundle_cache_ready Runtime bundle cache readiness status",
      "# TYPE runtime_bundle_cache_ready gauge",
      `runtime_bundle_cache_ready ${readiness.bundleCacheReady ? 1 : 0}`,
      "# HELP runtime_provider_cache_ready Provider cache readiness status for runtime execution dependencies",
      "# TYPE runtime_provider_cache_ready gauge",
      `runtime_provider_cache_ready ${readiness.providerCacheReady ? 1 : 0}`,
      "# HELP runtime_bundle_cache_entries Runtime bundle cache entry count",
      "# TYPE runtime_bundle_cache_entries gauge",
      `runtime_bundle_cache_entries ${bundleRegistry.entries}`,
      "# HELP runtime_bundle_cache_max_entries Runtime bundle cache max entry limit",
      "# TYPE runtime_bundle_cache_max_entries gauge",
      `runtime_bundle_cache_max_entries ${bundleRegistry.maxEntries}`,
      "# HELP runtime_bundle_warm_requests_total Total runtime bundle warm requests",
      "# TYPE runtime_bundle_warm_requests_total counter",
      `runtime_bundle_warm_requests_total ${observability.warmRequests}`,
      "# HELP runtime_bundle_warm_replacements_total Total runtime bundle warm requests that replaced an existing bundle",
      "# TYPE runtime_bundle_warm_replacements_total counter",
      `runtime_bundle_warm_replacements_total ${observability.warmReplacements}`,
      "# HELP runtime_bundle_evictions_total Total runtime bundle cache evictions",
      "# TYPE runtime_bundle_evictions_total counter",
      `runtime_bundle_evictions_total ${observability.evictedBundles}`,
      "# HELP runtime_bundle_invalidate_requests_total Total runtime bundle invalidation requests",
      "# TYPE runtime_bundle_invalidate_requests_total counter",
      `runtime_bundle_invalidate_requests_total ${observability.invalidateRequests}`,
      "# HELP runtime_bundle_invalidated_entries_total Total runtime bundle cache entries invalidated",
      "# TYPE runtime_bundle_invalidated_entries_total counter",
      `runtime_bundle_invalidated_entries_total ${observability.invalidatedBundles}`,
      "# HELP runtime_stream_turns_in_flight Current in-flight runtime stream turns",
      "# TYPE runtime_stream_turns_in_flight gauge",
      `runtime_stream_turns_in_flight ${observability.streamTurnsInFlight}`,
      "# HELP runtime_stream_turns_total Total runtime stream-turn outcomes",
      "# TYPE runtime_stream_turns_total counter",
      ...observability.streamTurnSeries.map(
        (series) => `runtime_stream_turns_total{status="${series.key.status}"} ${series.count}`
      ),
      "# HELP runtime_stream_duration_ms Runtime stream-turn end-to-end duration in milliseconds",
      "# TYPE runtime_stream_duration_ms histogram",
      "# HELP runtime_stream_duration_ms_max Maximum observed runtime stream-turn duration in milliseconds",
      "# TYPE runtime_stream_duration_ms_max gauge",
      ...observability.streamTurnSeries.map(
        (series) =>
          `runtime_stream_duration_ms_max{status="${series.key.status}"} ${series.maxDurationMs.toFixed(2)}`
      ),
      ...observability.streamTurnSeries.flatMap((series) => [
        ...series.buckets.map(
          (bucket) =>
            `runtime_stream_duration_ms_bucket{status="${series.key.status}",le="${bucket.le}"} ${bucket.value}`
        ),
        `runtime_stream_duration_ms_bucket{status="${series.key.status}",le="+Inf"} ${series.count}`,
        `runtime_stream_duration_ms_sum{status="${series.key.status}"} ${series.durationMsTotal.toFixed(2)}`,
        `runtime_stream_duration_ms_count{status="${series.key.status}"} ${series.count}`
      ]),
      "# HELP runtime_stream_stage_duration_ms Runtime stream hot-path stage duration in milliseconds",
      "# TYPE runtime_stream_stage_duration_ms histogram",
      "# HELP runtime_stream_stage_duration_ms_max Maximum observed runtime stream hot-path stage duration in milliseconds",
      "# TYPE runtime_stream_stage_duration_ms_max gauge",
      ...observability.streamStageSeries.map(
        (series) =>
          `runtime_stream_stage_duration_ms_max{stage="${series.key.stage}",status="${series.key.status}"} ${series.maxDurationMs.toFixed(2)}`
      ),
      ...observability.streamStageSeries.flatMap((series) => [
        ...series.buckets.map(
          (bucket) =>
            `runtime_stream_stage_duration_ms_bucket{stage="${series.key.stage}",status="${series.key.status}",le="${bucket.le}"} ${bucket.value}`
        ),
        `runtime_stream_stage_duration_ms_bucket{stage="${series.key.stage}",status="${series.key.status}",le="+Inf"} ${series.count}`,
        `runtime_stream_stage_duration_ms_sum{stage="${series.key.stage}",status="${series.key.status}"} ${series.durationMsTotal.toFixed(2)}`,
        `runtime_stream_stage_duration_ms_count{stage="${series.key.stage}",status="${series.key.status}"} ${series.count}`
      ])
    ];

    return `${lines.join("\n")}\n`;
  }
}
