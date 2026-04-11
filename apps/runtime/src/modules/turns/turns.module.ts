import { Module } from "@nestjs/common";
import { BundlesModule } from "../bundles/bundles.module";
import { SessionsModule } from "../sessions/sessions.module";
import { RuntimeStateModule } from "../runtime-state/runtime-state.module";
import { TurnsController } from "./interface/http/turns.controller";
import { IdempotencyService } from "./idempotency.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import { TurnAcceptanceService } from "./turn-acceptance.service";
import { TurnExecutionService } from "./turn-execution.service";
import { TurnFinalizationService } from "./turn-finalization.service";
import { TurnLeaseHeartbeatService } from "./turn-lease-heartbeat.service";

@Module({
  imports: [BundlesModule, RuntimeStateModule, SessionsModule],
  controllers: [TurnsController],
  providers: [
    ProviderGatewayClientService,
    IdempotencyService,
    TurnAcceptanceService,
    TurnExecutionService,
    TurnFinalizationService,
    TurnLeaseHeartbeatService
  ],
  exports: [
    ProviderGatewayClientService,
    IdempotencyService,
    TurnAcceptanceService,
    TurnExecutionService,
    TurnFinalizationService,
    TurnLeaseHeartbeatService
  ]
})
export class TurnsModule {}
