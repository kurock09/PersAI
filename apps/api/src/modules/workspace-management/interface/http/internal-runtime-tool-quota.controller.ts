import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { ConsumeInternalRuntimeToolDailyLimitService } from "../../application/consume-internal-runtime-tool-daily-limit.service";
import { ReadInternalRuntimeQuotaStatusService } from "../../application/read-internal-runtime-quota-status.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime/tools")
export class InternalRuntimeToolQuotaController {
  constructor(
    private readonly consumeInternalRuntimeToolDailyLimitService: ConsumeInternalRuntimeToolDailyLimitService,
    private readonly readInternalRuntimeQuotaStatusService: ReadInternalRuntimeQuotaStatusService
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
    buckets: Array<{
      bucketCode: string;
      displayName: string;
      unit: string;
      used: number | null;
      limit: number | null;
      percent: number | null;
      usageAvailable: boolean;
      status: string;
    }>;
  }> {
    this.assertAuthorized(req);
    const input = this.readInternalRuntimeQuotaStatusService.parseInput(body);
    return this.readInternalRuntimeQuotaStatusService.execute(input);
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal tool quota endpoints.",
      "Internal tool quota authorization failed."
    );
  }
}
