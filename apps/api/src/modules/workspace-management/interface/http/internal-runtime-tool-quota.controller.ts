import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { CreateInternalRuntimeQuotaCheckoutService } from "../../application/create-internal-runtime-quota-checkout.service";
import { ConsumeInternalRuntimeToolDailyLimitService } from "../../application/consume-internal-runtime-tool-daily-limit.service";
import { MutateInternalRuntimeMonthlyMediaQuotaService } from "../../application/mutate-internal-runtime-monthly-media-quota.service";
import { ReadInternalRuntimeQuotaStatusService } from "../../application/read-internal-runtime-quota-status.service";
import { ReserveInternalRuntimeMonthlyMediaQuotaService } from "../../application/reserve-internal-runtime-monthly-media-quota.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime/tools")
export class InternalRuntimeToolQuotaController {
  constructor(
    private readonly consumeInternalRuntimeToolDailyLimitService: ConsumeInternalRuntimeToolDailyLimitService,
    private readonly reserveInternalRuntimeMonthlyMediaQuotaService: ReserveInternalRuntimeMonthlyMediaQuotaService,
    private readonly mutateInternalRuntimeMonthlyMediaQuotaService: MutateInternalRuntimeMonthlyMediaQuotaService,
    private readonly readInternalRuntimeQuotaStatusService: ReadInternalRuntimeQuotaStatusService,
    private readonly createInternalRuntimeQuotaCheckoutService: CreateInternalRuntimeQuotaCheckoutService
  ) {}

  @HttpCode(200)
  @Post("consume")
  async consumeToolDailyLimit(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{ ok: true; currentCount: number; limit: number | null }> {
    this.assertAuthorized(req);
    const input = this.consumeInternalRuntimeToolDailyLimitService.parseInput(body);
    return this.consumeInternalRuntimeToolDailyLimitService.execute(input);
  }

  @HttpCode(200)
  @Post("media-monthly/reserve")
  async reserveMonthlyMediaQuota(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{
    ok: true;
    allowed: boolean;
    currentUsedUnits: number;
    limitUnits: number | null;
    periodStartedAt: string;
    periodEndsAt: string;
    periodSource: "subscription_period" | "calendar_month_fallback";
  }> {
    this.assertAuthorized(req);
    const input = this.reserveInternalRuntimeMonthlyMediaQuotaService.parseInput(body);
    return this.reserveInternalRuntimeMonthlyMediaQuotaService.execute(input);
  }

  @HttpCode(200)
  @Post("media-monthly/release")
  async releaseMonthlyMediaQuota(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{ ok: true }> {
    this.assertAuthorized(req);
    const input = this.mutateInternalRuntimeMonthlyMediaQuotaService.parseInput(body);
    return this.mutateInternalRuntimeMonthlyMediaQuotaService.release(input);
  }

  @HttpCode(200)
  @Post("media-monthly/reconcile")
  async markMonthlyMediaQuotaReconciliationRequired(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{ ok: true }> {
    this.assertAuthorized(req);
    const input = this.mutateInternalRuntimeMonthlyMediaQuotaService.parseInput(body);
    return this.mutateInternalRuntimeMonthlyMediaQuotaService.markReconciliationRequired(input);
  }

  @HttpCode(200)
  @Post("check")
  async checkToolDailyQuota(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{
    ok: true;
    planCode: string | null;
    currentPlan: {
      code: string | null;
      displayName: string | null;
    };
    visiblePlans: Array<{
      code: string;
      displayName: string;
      highlighted: boolean;
      isCurrent: boolean;
      amountMinor: number | null;
      currency: string | null;
      billingPeriod: "month" | "year" | null;
    }>;
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
    monthlyMediaQuotas: {
      planCode: string | null;
      periodStartedAt: string;
      periodEndsAt: string;
      periodSource: "subscription_period" | "calendar_month_fallback";
      tools: Array<{
        toolCode: string;
        displayName: string;
        usedUnits: number;
        reservedUnits: number;
        settledUnits: number;
        releasedUnits: number;
        reconciliationRequiredUnits: number;
        limitUnits: number | null;
        remainingUnits: number | null;
        usageAvailable: boolean;
        status: string;
      }>;
    };
  }> {
    this.assertAuthorized(req);
    const input = this.readInternalRuntimeQuotaStatusService.parseInput(body);
    return this.readInternalRuntimeQuotaStatusService.execute(input);
  }

  @HttpCode(200)
  @Post("quota-status/checkout")
  async createQuotaStatusCheckout(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{
    ok: true;
    paymentIntentId: string;
    targetPlanCode: string;
    paymentMethodClass: "card" | "sbp_qr";
    checkoutMode: "widget" | "redirect" | "payment_link" | "qr_code" | "manual_test" | null;
    checkoutPagePath: string;
  }> {
    this.assertAuthorized(req);
    const input = this.createInternalRuntimeQuotaCheckoutService.parseInput(body);
    return this.createInternalRuntimeQuotaCheckoutService.execute(input);
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal tool quota endpoints.",
      "Internal tool quota authorization failed."
    );
  }
}
