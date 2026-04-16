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
import { RuntimeImageEditToolService } from "./runtime-image-edit-tool.service";
import { RuntimeImageGenerateToolService } from "./runtime-image-generate-tool.service";
import { RuntimeKnowledgeToolService } from "./runtime-knowledge-tool.service";
import { RuntimeMemoryWriteToolService } from "./runtime-memory-write-tool.service";
import { RuntimeQuotaStatusToolService } from "./runtime-quota-status-tool.service";
import { RuntimeScheduledActionToolService } from "./runtime-scheduled-action-tool.service";
import { RuntimeTtsToolService } from "./runtime-tts-tool.service";
import { RuntimeVideoGenerateToolService } from "./runtime-video-generate-tool.service";
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
    RuntimeImageEditToolService,
    RuntimeImageGenerateToolService,
    RuntimeKnowledgeToolService,
    RuntimeMemoryWriteToolService,
    RuntimeQuotaStatusToolService,
    RuntimeVideoGenerateToolService,
    RuntimeScheduledActionToolService,
    RuntimeTtsToolService,
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
    RuntimeImageEditToolService,
    RuntimeImageGenerateToolService,
    RuntimeKnowledgeToolService,
    RuntimeMemoryWriteToolService,
    RuntimeQuotaStatusToolService,
    RuntimeVideoGenerateToolService,
    RuntimeScheduledActionToolService,
    RuntimeTtsToolService,
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
