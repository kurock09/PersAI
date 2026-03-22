import { Controller, Get } from "@nestjs/common";
import { RequestContextStore } from "../../infrastructure/request-context/request-context.store";

@Controller()
export class ReadyController {
  constructor(private readonly requestContextStore: RequestContextStore) {}

  @Get("ready")
  getReady(): { status: "ready"; requestId: string | null } {
    return {
      status: "ready",
      requestId: this.requestContextStore.get()?.requestId ?? null
    };
  }
}
