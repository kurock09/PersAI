import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { HealthController } from "./interface/http/health.controller";
import { MetricsController } from "./interface/http/metrics.controller";
import { ReadyController } from "./interface/http/ready.controller";
import { AppLoggerService } from "./infrastructure/logging/app-logger.service";
import { RequestContextStore } from "./infrastructure/request-context/request-context.store";
import { RequestIdMiddleware } from "./interface/http/request-id.middleware";
import { RequestLoggingMiddleware } from "./interface/http/request-logging.middleware";

@Module({
  controllers: [HealthController, ReadyController, MetricsController],
  providers: [AppLoggerService, RequestContextStore, RequestIdMiddleware, RequestLoggingMiddleware],
  exports: [AppLoggerService, RequestContextStore]
})
export class PlatformCoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, RequestLoggingMiddleware).forRoutes("*");
  }
}
