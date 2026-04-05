import { Injectable, NestMiddleware } from "@nestjs/common";
import { PlatformHttpMetricsService } from "../../application/platform-http-metrics.service";
import { AppLoggerService } from "../../infrastructure/logging/app-logger.service";
import { RequestContextStore } from "../../infrastructure/request-context/request-context.store";
import {
  NextRequestFunction,
  RequestWithPlatformContext,
  ResponseWithPlatformContext
} from "./request-http.types";

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(
    private readonly requestContextStore: RequestContextStore,
    private readonly appLoggerService: AppLoggerService,
    private readonly platformHttpMetricsService: PlatformHttpMetricsService
  ) {}

  use(
    req: RequestWithPlatformContext,
    res: ResponseWithPlatformContext,
    next: NextRequestFunction
  ): void {
    const startedAt = process.hrtime.bigint();
    this.platformHttpMetricsService.beginRequest();
    let metricsClosed = false;

    const closeInFlightRequest = (): void => {
      if (metricsClosed) {
        return;
      }

      metricsClosed = true;
      this.platformHttpMetricsService.endInFlightRequest();
    };

    res.on("finish", () => {
      const context = this.requestContextStore.get();
      const endedAt = process.hrtime.bigint();
      const latencyMs = Number(endedAt - startedAt) / 1_000_000;
      const normalizedLatencyMs = Number(latencyMs.toFixed(2));
      const path = req.originalUrl ?? req.url ?? "unknown";
      const method = req.method ?? "UNKNOWN";
      const statusCode = res.statusCode;
      const requestMetricInput = {
        path,
        method,
        statusCode,
        latencyMs: normalizedLatencyMs,
        ...(req.route?.path !== undefined ? { routePath: req.route.path } : {}),
        ...(req.baseUrl !== undefined ? { baseUrl: req.baseUrl } : {})
      };

      this.platformHttpMetricsService.recordCompletedRequest(requestMetricInput);
      closeInFlightRequest();

      this.appLoggerService.requestCompleted({
        requestId: context?.requestId ?? req.requestId ?? "unknown",
        userId: context?.userId ?? req.userId ?? null,
        workspaceId: context?.workspaceId ?? req.workspaceId ?? null,
        path,
        method,
        status: statusCode,
        latencyMs: normalizedLatencyMs
      });
    });
    res.on("close", closeInFlightRequest);

    next();
  }
}
