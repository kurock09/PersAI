import { Module } from "@nestjs/common";
import { RuntimeConfigModule } from "./runtime-config.module";
import { BundlesModule } from "./modules/bundles/bundles.module";
import { ObservabilityModule } from "./modules/observability/observability.module";
import { PlatformCoreModule } from "./modules/platform-core/platform-core.module";
import { RuntimeMediaModule } from "./modules/media/runtime-media.module";
import { RuntimeStateModule } from "./modules/runtime-state/runtime-state.module";
import { SessionsModule } from "./modules/sessions/sessions.module";
import { TurnsModule } from "./modules/turns/turns.module";

@Module({
  imports: [
    RuntimeConfigModule,
    ObservabilityModule,
    BundlesModule,
    PlatformCoreModule,
    RuntimeMediaModule,
    RuntimeStateModule,
    SessionsModule,
    TurnsModule
  ]
})
export class AppModule {}
