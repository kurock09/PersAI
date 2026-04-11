import { Module } from "@nestjs/common";
import { ProviderGatewayModule } from "../providers/provider-gateway.module";
import { HealthController } from "./interface/http/health.controller";
import { MetricsController } from "./interface/http/metrics.controller";
import { ReadyController } from "./interface/http/ready.controller";
import { ProviderGatewayMetricsService } from "./application/provider-gateway-metrics.service";
import { ProviderGatewayReadinessService } from "./application/provider-gateway-readiness.service";
import { AppLoggerService } from "./infrastructure/logging/app-logger.service";

@Module({
  imports: [ProviderGatewayModule],
  controllers: [HealthController, ReadyController, MetricsController],
  providers: [AppLoggerService, ProviderGatewayReadinessService, ProviderGatewayMetricsService],
  exports: [AppLoggerService, ProviderGatewayReadinessService, ProviderGatewayMetricsService]
})
export class PlatformCoreModule {}
