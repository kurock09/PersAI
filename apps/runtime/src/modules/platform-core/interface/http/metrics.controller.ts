import { Controller, Get, Res } from "@nestjs/common";
import { RuntimeMetricsService } from "../../application/runtime-metrics.service";

interface MetricsResponseHeaders {
  setHeader(name: string, value: string): void;
}

@Controller()
export class MetricsController {
  constructor(private readonly runtimeMetricsService: RuntimeMetricsService) {}

  @Get("metrics")
  getMetrics(@Res({ passthrough: true }) res: MetricsResponseHeaders): Promise<string> {
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return this.runtimeMetricsService.renderMetrics();
  }
}
