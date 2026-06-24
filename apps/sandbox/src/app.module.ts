import { Module } from "@nestjs/common";
import { SandboxConfigModule } from "./sandbox-config.module";
import { SandboxController } from "./sandbox.controller";
import { ExecPodBridgeService } from "./exec-pod-bridge.service";
import { SandboxMetricsService } from "./sandbox-metrics.service";
import { SandboxObjectStorageService } from "./sandbox-object-storage.service";
import { SandboxObservabilityService } from "./sandbox-observability.service";
import { SandboxPrismaService } from "./sandbox-prisma.service";
import { SandboxService } from "./sandbox.service";
import { WorkspaceAuditService } from "./workspace-audit.service";
import { WorkspaceFileBridgeService } from "./workspace-file-bridge.service";
import { WorkspaceGcService } from "./workspace-gc.service";

@Module({
  imports: [SandboxConfigModule],
  controllers: [SandboxController],
  providers: [
    SandboxPrismaService,
    SandboxObjectStorageService,
    SandboxObservabilityService,
    SandboxMetricsService,
    ExecPodBridgeService,
    WorkspaceAuditService,
    WorkspaceFileBridgeService,
    WorkspaceGcService,
    SandboxService
  ]
})
export class AppModule {}
