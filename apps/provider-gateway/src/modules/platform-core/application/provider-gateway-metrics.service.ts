import { Injectable } from "@nestjs/common";
import { ProviderGatewayReadinessService } from "./provider-gateway-readiness.service";
import { ProviderWarmupService } from "../../providers/provider-warmup.service";

@Injectable()
export class ProviderGatewayMetricsService {
  constructor(
    private readonly providerGatewayReadinessService: ProviderGatewayReadinessService,
    private readonly providerWarmupService: ProviderWarmupService
  ) {}

  renderMetrics(): string {
    const readiness = this.providerGatewayReadinessService.getSnapshot();
    const warmup = this.providerWarmupService.getSnapshot();

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
      )
    ];

    return `${lines.join("\n")}\n`;
  }
}
