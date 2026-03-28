import {
  Body,
  Controller,
  HttpCode,
  Post,
  Query,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import { HandleInternalCronFireService } from "../../application/handle-internal-cron-fire.service";

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
    const rawAuthHeader = req.headers.authorization;
    const authHeader = Array.isArray(rawAuthHeader) ? rawAuthHeader[0] : rawAuthHeader;
    const token =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length).trim()
        : "";
    const configured = loadApiConfig(process.env).OPENCLAW_GATEWAY_TOKEN?.trim() ?? "";
    if (configured.length === 0) {
      throw new UnauthorizedException(
        "OPENCLAW_GATEWAY_TOKEN must be configured for internal cron callbacks."
      );
    }
    if (token.length === 0 || token !== configured) {
      throw new UnauthorizedException("Internal cron callback authorization failed.");
    }
  }
}
