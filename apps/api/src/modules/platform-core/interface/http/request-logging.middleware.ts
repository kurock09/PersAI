import { Injectable, NestMiddleware } from "@nestjs/common";
import { AppLoggerService } from "../../infrastructure/logging/app-logger.service";
import { RequestContextStore } from "../../infrastructure/request-context/request-context.store";
import { NextRequestFunction, RequestWithPlatformContext, ResponseWithPlatformContext } from "./request-http.types";

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(
    private readonly requestContextStore: RequestContextStore,
    private readonly appLoggerService: AppLoggerService
  ) {}

  use(req: RequestWithPlatformContext, res: ResponseWithPlatformContext, next: NextRequestFunction): void {
    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
      const context = this.requestContextStore.get();
      const endedAt = process.hrtime.bigint();
      const latencyMs = Number(endedAt - startedAt) / 1_000_000;

      this.appLoggerService.requestCompleted({
        requestId: context?.requestId ?? req.requestId ?? "unknown",
        userId: context?.userId ?? req.userId ?? null,
        workspaceId: context?.workspaceId ?? req.workspaceId ?? null,
        path: req.originalUrl ?? req.url ?? "unknown",
        method: req.method ?? "UNKNOWN",
        status: res.statusCode,
        latencyMs: Number(latencyMs.toFixed(2))
      });
    });

    next();
  }
}
