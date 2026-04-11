import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { ProviderGatewayReadinessService } from "../../application/provider-gateway-readiness.service";
import type { ProviderReadinessSnapshot } from "../../../providers/provider-client.types";

interface ReadyResponseStatus {
  status(code: number): ReadyResponseStatus;
}

@Controller()
export class ReadyController {
  constructor(
    private readonly providerGatewayReadinessService: ProviderGatewayReadinessService
  ) {}

  @Get("ready")
  getReady(@Res({ passthrough: true }) res: ReadyResponseStatus): ProviderReadinessSnapshot {
    const snapshot = this.providerGatewayReadinessService.getSnapshot();
    if (!snapshot.ready) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return snapshot;
  }
}
