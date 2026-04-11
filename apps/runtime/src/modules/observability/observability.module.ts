import { Module } from "@nestjs/common";
import { RuntimeObservabilityService } from "./runtime-observability.service";

@Module({
  providers: [RuntimeObservabilityService],
  exports: [RuntimeObservabilityService]
})
export class ObservabilityModule {}
