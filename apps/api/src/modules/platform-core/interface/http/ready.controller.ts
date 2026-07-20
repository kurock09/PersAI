import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { PlatformReadinessService } from "../../application/platform-readiness.service";
import { RequestContextStore } from "../../infrastructure/request-context/request-context.store";

interface ReadyResponseStatus {
  status(code: number): ReadyResponseStatus;
}

type ReadyResponseBody = {
  status: "ready" | "not_ready";
  requestId: string | null;
  checkedAt: string;
  capabilities: {
    asyncJobHandles: "v1";
  };
  dependencies: Array<{
    name: string;
    status: "up" | "down";
    durationMs: number;
    error: string | null;
  }>;
};

@Controller()
export class ReadyController {
  constructor(
    private readonly requestContextStore: RequestContextStore,
    private readonly platformReadinessService: PlatformReadinessService
  ) {}

  @Get("ready")
  async getReady(@Res({ passthrough: true }) res: ReadyResponseStatus): Promise<ReadyResponseBody> {
    const snapshot = await this.platformReadinessService.getSnapshot();
    if (!snapshot.ready) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return {
      status: snapshot.ready ? "ready" : "not_ready",
      requestId: this.requestContextStore.get()?.requestId ?? null,
      checkedAt: snapshot.checkedAt,
      capabilities: {
        asyncJobHandles: "v1"
      },
      dependencies: snapshot.dependencies.map((dependency) => ({
        name: dependency.name,
        status: dependency.ready ? "up" : "down",
        durationMs: dependency.durationMs,
        error: dependency.error
      }))
    };
  }
}
