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

type InternalRuntimeQuotaStatusResponse = Awaited<
  ReturnType<ReadInternalRuntimeQuotaStatusService["execute"]>
>;

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
  ): Promise<InternalRuntimeQuotaStatusResponse> {
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
    action: "checkout_created" | "subscription_updated";
    checkout: {
      paymentIntentId: string;
      targetPlanCode: string;
      paymentMethodClass: "card" | "sbp_qr";
      checkoutMode: "embedded" | "redirect" | "payment_link" | "qr_code" | "manual_test" | null;
      recurringCheckoutKind: "one_time" | "recurring_start";
      recurringSupportedBySelectedMethod: boolean;
      recurringUnsupportedReason: string | null;
      checkoutPagePath: string;
      checkoutPageUrl: string | null;
      checkoutSignInUrl: string | null;
    } | null;
    subscriptionUpdate: {
      targetPlanCode: string;
      targetPlanDisplayName: string | null;
      effectiveAt: string | null;
      nextChargeAt: string | null;
      changeKind: "free" | "downgrade" | null;
    } | null;
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
