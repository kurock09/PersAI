import { Module } from "@nestjs/common";
import { ObservabilityModule } from "../observability/observability.module";
import { RuntimeStateModule } from "../runtime-state/runtime-state.module";
import { BundleInvalidateController } from "./interface/http/bundle-invalidate.controller";
import { BundleWarmController } from "./interface/http/bundle-warm.controller";
import { RuntimeBundleCoordinatorService } from "./runtime-bundle-coordinator.service";
import { RuntimeBundleRegistryService } from "./runtime-bundle-registry.service";

@Module({
  imports: [ObservabilityModule, RuntimeStateModule],
  controllers: [BundleWarmController, BundleInvalidateController],
  providers: [RuntimeBundleRegistryService, RuntimeBundleCoordinatorService],
  exports: [RuntimeBundleRegistryService, RuntimeBundleCoordinatorService]
})
export class BundlesModule {}
