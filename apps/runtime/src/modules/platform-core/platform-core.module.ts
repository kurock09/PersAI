import { Module } from "@nestjs/common";
import { BundlesModule } from "../bundles/bundles.module";
import { ObservabilityModule } from "../observability/observability.module";
import { TurnsModule } from "../turns/turns.module";
import { RuntimeMetricsService } from "./application/runtime-metrics.service";
import { RuntimeReadinessService } from "./application/runtime-readiness.service";
import { AppLoggerService } from "./infrastructure/logging/app-logger.service";
import { HealthController } from "./interface/http/health.controller";
import { MetricsController } from "./interface/http/metrics.controller";
import { ReadyController } from "./interface/http/ready.controller";

@Module({
  imports: [ObservabilityModule, BundlesModule, TurnsModule],
  controllers: [HealthController, ReadyController, MetricsController],
  providers: [AppLoggerService, RuntimeReadinessService, RuntimeMetricsService],
  exports: [AppLoggerService, RuntimeReadinessService, RuntimeMetricsService]
})
export class PlatformCoreModule {}
