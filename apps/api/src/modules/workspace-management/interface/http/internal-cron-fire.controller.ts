import { Body, Controller, HttpCode, Post, Query, Req } from "@nestjs/common";
import { HandleInternalCronFireService } from "../../application/handle-internal-cron-fire.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal")
export class InternalCronFireController {
  constructor(private readonly handleInternalCronFireService: HandleInternalCronFireService) {}

  @HttpCode(200)
  @Post("cron-fire")
  async handleCronFire(
    @Req() req: InternalRequestLike,
    @Query("assistantId") assistantId: string | undefined,
    @Body() body: unknown
  ): Promise<{ ok: true; deliveredTo: "telegram" | "web" | "fallback_web" | "none" }> {
    this.assertAuthorized(req);
    const input = this.handleInternalCronFireService.parseInput(assistantId ?? "", body);
    return this.handleInternalCronFireService.execute(input);
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal cron callbacks.",
      "Internal cron callback authorization failed."
    );
  }
}
