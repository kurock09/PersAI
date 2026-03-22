import { Controller, Get } from "@nestjs/common";
import { RequestContextStore } from "../../infrastructure/request-context/request-context.store";

@Controller()
export class HealthController {
  constructor(private readonly requestContextStore: RequestContextStore) {}

  @Get("health")
  getHealth(): { status: "ok"; requestId: string | null } {
    return {
      status: "ok",
      requestId: this.requestContextStore.get()?.requestId ?? null
    };
  }
}
