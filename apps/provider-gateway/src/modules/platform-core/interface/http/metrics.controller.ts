import { Controller, Get, Res } from "@nestjs/common";
import { ProviderGatewayMetricsService } from "../../application/provider-gateway-metrics.service";

interface MetricsResponseHeaders {
  setHeader(name: string, value: string): void;
}

@Controller()
export class MetricsController {
  constructor(private readonly providerGatewayMetricsService: ProviderGatewayMetricsService) {}

  @Get("metrics")
  getMetrics(@Res({ passthrough: true }) res: MetricsResponseHeaders): string {
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return this.providerGatewayMetricsService.renderMetrics();
  }
}
