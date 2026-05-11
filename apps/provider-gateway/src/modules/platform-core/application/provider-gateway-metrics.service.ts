import { Injectable } from "@nestjs/common";
import { ProviderGatewayReadinessService } from "./provider-gateway-readiness.service";
import { ProviderWarmupService } from "../../providers/provider-warmup.service";
import { ProviderStreamObservabilityService } from "../../providers/provider-stream-observability.service";

@Injectable()
export class ProviderGatewayMetricsService {
  constructor(
    private readonly providerGatewayReadinessService: ProviderGatewayReadinessService,
    private readonly providerWarmupService: ProviderWarmupService,
    private readonly providerStreamObservabilityService: ProviderStreamObservabilityService
  ) {}

  renderMetrics(): string {
    const readiness = this.providerGatewayReadinessService.getSnapshot();
    const warmup = this.providerWarmupService.getSnapshot();
    const observability = this.providerStreamObservabilityService.getSnapshot();

    const lines = [
      "# HELP provider_gateway_up Provider gateway process up status",
      "# TYPE provider_gateway_up gauge",
      "provider_gateway_up 1",
      "# HELP provider_gateway_ready Provider gateway readiness status",
      "# TYPE provider_gateway_ready gauge",
      `provider_gateway_ready ${readiness.ready ? 1 : 0}`,
      "# HELP provider_gateway_provider_cache_ready Provider cache readiness status",
      "# TYPE provider_gateway_provider_cache_ready gauge",
      `provider_gateway_provider_cache_ready ${readiness.providerCacheReady ? 1 : 0}`,
      "# HELP provider_gateway_warmup_runs_total Total provider warmup runs",
      "# TYPE provider_gateway_warmup_runs_total counter",
      `provider_gateway_warmup_runs_total ${warmup.runs}`,
      "# HELP provider_gateway_warmup_failures_total Total provider warmup runs with failures",
      "# TYPE provider_gateway_warmup_failures_total counter",
      `provider_gateway_warmup_failures_total ${warmup.failures}`,
      "# HELP provider_gateway_warmup_last_duration_ms Last warmup duration in milliseconds",
      "# TYPE provider_gateway_warmup_last_duration_ms gauge",
      `provider_gateway_warmup_last_duration_ms ${warmup.lastDurationMs ?? 0}`,
      "# HELP provider_gateway_provider_configured Provider configured status",
      "# TYPE provider_gateway_provider_configured gauge",
      ...warmup.providers.map(
        (provider) =>
          `provider_gateway_provider_configured{provider="${provider.provider}"} ${provider.configured ? 1 : 0}`
      ),
      "# HELP provider_gateway_provider_ready Provider ready status",
      "# TYPE provider_gateway_provider_ready gauge",
      ...warmup.providers.map(
        (provider) =>
          `provider_gateway_provider_ready{provider="${provider.provider}"} ${provider.state === "ready" ? 1 : 0}`
      ),
      "# HELP provider_gateway_provider_models Declared provider catalog model count",
      "# TYPE provider_gateway_provider_models gauge",
      ...warmup.providers.map(
        (provider) =>
          `provider_gateway_provider_models{provider="${provider.provider}"} ${provider.catalogModels.length}`
      ),
      "# HELP provider_gateway_provider_state Provider warm state as a one-hot gauge",
      "# TYPE provider_gateway_provider_state gauge",
      ...warmup.providers.flatMap((provider) =>
        ["pending", "unconfigured", "warming", "ready", "failed"].map((state) => {
          return `provider_gateway_provider_state{provider="${provider.provider}",state="${state}"} ${provider.state === state ? 1 : 0}`;
        })
      ),
      "# HELP provider_gateway_stream_requests_in_flight Current in-flight provider stream-text requests",
      "# TYPE provider_gateway_stream_requests_in_flight gauge",
      `provider_gateway_stream_requests_in_flight ${observability.inFlightStreamRequests}`,
      "# HELP provider_gateway_stream_requests_total Total provider stream-text request outcomes",
      "# TYPE provider_gateway_stream_requests_total counter",
      ...observability.requestSeries.map(
        (series) =>
          `provider_gateway_stream_requests_total{provider="${series.key.provider}",classification="${series.key.classification}",status="${series.key.status}"} ${series.count}`
      ),
      "# HELP provider_gateway_stream_duration_ms Provider stream-text total duration in milliseconds",
      "# TYPE provider_gateway_stream_duration_ms histogram",
      "# HELP provider_gateway_stream_duration_ms_max Maximum observed provider stream-text duration in milliseconds",
      "# TYPE provider_gateway_stream_duration_ms_max gauge",
      ...observability.requestSeries.map(
        (series) =>
          `provider_gateway_stream_duration_ms_max{provider="${series.key.provider}",classification="${series.key.classification}",status="${series.key.status}"} ${series.maxDurationMs.toFixed(2)}`
      ),
      ...observability.requestSeries.flatMap((series) => [
        ...series.buckets.map(
          (bucket) =>
            `provider_gateway_stream_duration_ms_bucket{provider="${series.key.provider}",classification="${series.key.classification}",status="${series.key.status}",le="${bucket.le}"} ${bucket.value}`
        ),
        `provider_gateway_stream_duration_ms_bucket{provider="${series.key.provider}",classification="${series.key.classification}",status="${series.key.status}",le="+Inf"} ${series.count}`,
        `provider_gateway_stream_duration_ms_sum{provider="${series.key.provider}",classification="${series.key.classification}",status="${series.key.status}"} ${series.durationMsTotal.toFixed(2)}`,
        `provider_gateway_stream_duration_ms_count{provider="${series.key.provider}",classification="${series.key.classification}",status="${series.key.status}"} ${series.count}`
      ]),
      "# HELP provider_gateway_stream_stage_duration_ms Provider stream-text hot-path stage duration in milliseconds",
      "# TYPE provider_gateway_stream_stage_duration_ms histogram",
      "# HELP provider_gateway_stream_stage_duration_ms_max Maximum observed provider stream-text hot-path stage duration in milliseconds",
      "# TYPE provider_gateway_stream_stage_duration_ms_max gauge",
      ...observability.stageSeries.map(
        (series) =>
          `provider_gateway_stream_stage_duration_ms_max{provider="${series.key.provider}",classification="${series.key.classification}",stage="${series.key.stage}",status="${series.key.status}"} ${series.maxDurationMs.toFixed(2)}`
      ),
      ...observability.stageSeries.flatMap((series) => [
        ...series.buckets.map(
          (bucket) =>
            `provider_gateway_stream_stage_duration_ms_bucket{provider="${series.key.provider}",classification="${series.key.classification}",stage="${series.key.stage}",status="${series.key.status}",le="${bucket.le}"} ${bucket.value}`
        ),
        `provider_gateway_stream_stage_duration_ms_bucket{provider="${series.key.provider}",classification="${series.key.classification}",stage="${series.key.stage}",status="${series.key.status}",le="+Inf"} ${series.count}`,
        `provider_gateway_stream_stage_duration_ms_sum{provider="${series.key.provider}",classification="${series.key.classification}",stage="${series.key.stage}",status="${series.key.status}"} ${series.durationMsTotal.toFixed(2)}`,
        `provider_gateway_stream_stage_duration_ms_count{provider="${series.key.provider}",classification="${series.key.classification}",stage="${series.key.stage}",status="${series.key.status}"} ${series.count}`
      ])
    ];

    return `${lines.join("\n")}\n`;
  }
}
