import { Controller, Get, Res } from "@nestjs/common";

interface MetricsResponseHeaders {
  setHeader(name: string, value: string): void;
}

@Controller()
export class MetricsController {
  @Get("metrics")
  getMetrics(@Res({ passthrough: true }) res: MetricsResponseHeaders): string {
    const memoryUsage = process.memoryUsage();

    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");

    const lines = [
      "# HELP app_up API process up status",
      "# TYPE app_up gauge",
      "app_up 1",
      "# HELP app_ready API readiness status",
      "# TYPE app_ready gauge",
      "app_ready 1",
      "# HELP process_uptime_seconds Process uptime in seconds",
      "# TYPE process_uptime_seconds gauge",
      `process_uptime_seconds ${process.uptime().toFixed(2)}`,
      "# HELP nodejs_heap_used_bytes Used heap memory in bytes",
      "# TYPE nodejs_heap_used_bytes gauge",
      `nodejs_heap_used_bytes ${memoryUsage.heapUsed}`
    ];

    return `${lines.join("\n")}\n`;
  }
}
