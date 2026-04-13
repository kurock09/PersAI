import { Module } from "@nestjs/common";
import { BundlesModule } from "../bundles/bundles.module";
import { SessionsModule } from "../sessions/sessions.module";
import { RuntimeStateModule } from "../runtime-state/runtime-state.module";
import { TurnsController } from "./interface/http/turns.controller";
import { IdempotencyService } from "./idempotency.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import { RuntimeBrowserToolService } from "./runtime-browser-tool.service";
import { RuntimeReminderTaskToolService } from "./runtime-reminder-task-tool.service";
import { SessionCompactionService } from "./session-compaction.service";
import { TurnContextHydrationService } from "./turn-context-hydration.service";
import { TurnAcceptanceService } from "./turn-acceptance.service";
import { TurnExecutionService } from "./turn-execution.service";
import { TurnFinalizationService } from "./turn-finalization.service";
import { TurnLeaseHeartbeatService } from "./turn-lease-heartbeat.service";

@Module({
  imports: [BundlesModule, RuntimeStateModule, SessionsModule],
  controllers: [TurnsController],
  providers: [
    PersaiInternalApiClientService,
    ProviderGatewayClientService,
    RuntimeBrowserToolService,
    RuntimeReminderTaskToolService,
    IdempotencyService,
    PersaiMediaObjectStorageService,
    TurnContextHydrationService,
    SessionCompactionService,
    TurnAcceptanceService,
    TurnExecutionService,
    TurnFinalizationService,
    TurnLeaseHeartbeatService
  ],
  exports: [
    PersaiInternalApiClientService,
    ProviderGatewayClientService,
    RuntimeBrowserToolService,
    RuntimeReminderTaskToolService,
    IdempotencyService,
    PersaiMediaObjectStorageService,
    TurnContextHydrationService,
    SessionCompactionService,
    TurnAcceptanceService,
    TurnExecutionService,
    TurnFinalizationService,
    TurnLeaseHeartbeatService
  ]
})
export class TurnsModule {}
