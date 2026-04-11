import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { RuntimeReadinessService, type RuntimeReadySnapshot } from "../../application/runtime-readiness.service";

interface ReadyResponseStatus {
  status(code: number): ReadyResponseStatus;
}

@Controller()
export class ReadyController {
  constructor(private readonly runtimeReadinessService: RuntimeReadinessService) {}

  @Get("ready")
  async getReady(
    @Res({ passthrough: true }) res: ReadyResponseStatus
  ): Promise<RuntimeReadySnapshot> {
    const snapshot = await this.runtimeReadinessService.getSnapshot();
    if (!snapshot.ready) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return snapshot;
  }
}
