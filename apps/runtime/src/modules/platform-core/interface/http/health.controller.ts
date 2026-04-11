import { Controller, Get } from "@nestjs/common";
import type { RuntimeHealthStatus } from "@persai/runtime-contract";
import { RuntimeReadinessService } from "../../application/runtime-readiness.service";

@Controller()
export class HealthController {
  constructor(private readonly runtimeReadinessService: RuntimeReadinessService) {}

  @Get("health")
  async getHealth(): Promise<RuntimeHealthStatus> {
    const readiness = await this.runtimeReadinessService.getSnapshot();
    return {
      checkedAt: readiness.checkedAt,
      live: true,
      ready: readiness.ready
    };
  }
}
