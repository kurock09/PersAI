import { Body, Controller, HttpCode, Post, Req, UnauthorizedException } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import { CheckInternalRuntimeToolDailyLimitService } from "../../application/check-internal-runtime-tool-daily-limit.service";
import { ConsumeInternalRuntimeToolDailyLimitService } from "../../application/consume-internal-runtime-tool-daily-limit.service";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime/tools")
export class InternalRuntimeToolQuotaController {
  constructor(
    private readonly consumeInternalRuntimeToolDailyLimitService: ConsumeInternalRuntimeToolDailyLimitService,
    private readonly checkInternalRuntimeToolDailyLimitService: CheckInternalRuntimeToolDailyLimitService
  ) {}

  @HttpCode(200)
  @Post("consume")
  async consumeToolDailyLimit(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{ ok: true; currentCount: number; limit: number }> {
    this.assertAuthorized(req);
    const input = this.consumeInternalRuntimeToolDailyLimitService.parseInput(body);
    return this.consumeInternalRuntimeToolDailyLimitService.execute(input);
  }

  @HttpCode(200)
  @Post("check")
  async checkToolDailyQuota(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{
    ok: true;
    planCode: string | null;
    tools: Array<{
      toolCode: string;
      activationStatus: string;
      dailyCallLimit: number | null;
      currentCount: number;
      allowed: boolean;
    }>;
  }> {
    this.assertAuthorized(req);
    const input = this.checkInternalRuntimeToolDailyLimitService.parseInput(body);
    return this.checkInternalRuntimeToolDailyLimitService.execute(input);
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
        "OPENCLAW_GATEWAY_TOKEN must be configured for internal tool quota endpoints."
      );
    }
    if (token.length === 0 || token !== configured) {
      throw new UnauthorizedException("Internal tool quota authorization failed.");
    }
  }
}
