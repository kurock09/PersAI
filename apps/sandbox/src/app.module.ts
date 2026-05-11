import { Module } from "@nestjs/common";
import { SandboxConfigModule } from "./sandbox-config.module";
import { SandboxController } from "./sandbox.controller";
import { SandboxMetricsService } from "./sandbox-metrics.service";
import { SandboxObjectStorageService } from "./sandbox-object-storage.service";
import { SandboxObservabilityService } from "./sandbox-observability.service";
import { SandboxPrismaService } from "./sandbox-prisma.service";
import { SandboxService } from "./sandbox.service";

@Module({
  imports: [SandboxConfigModule],
  controllers: [SandboxController],
  providers: [
    SandboxPrismaService,
    SandboxObjectStorageService,
    SandboxObservabilityService,
    SandboxMetricsService,
    SandboxService
  ]
})
export class AppModule {}
