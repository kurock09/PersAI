import { Body, Controller, Get, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import {
  ManageAssistantPaymentIntentsService,
  type AssistantPaymentIntentState
} from "../../application/manage-assistant-payment-intents.service";
import {
  ManageAssistantBillingSubscriptionService,
  type AssistantBillingSubscriptionActionResult,
  type AssistantBillingSubscriptionManagementState
} from "../../application/manage-assistant-billing-subscription.service";
import { ManageMediaPackageCatalogService } from "../../application/manage-media-package-catalog.service";
import { ManageMediaPackagePurchaseService } from "../../application/manage-media-package-purchase.service";
import type { MediaPackageCatalogItemState } from "../../application/media-package.types";

@Controller("api/v1/assistant/billing")
export class AssistantBillingController {
  constructor(
    private readonly manageAssistantPaymentIntentsService: ManageAssistantPaymentIntentsService,
    private readonly manageAssistantBillingSubscriptionService: ManageAssistantBillingSubscriptionService,
    private readonly manageMediaPackageCatalogService: ManageMediaPackageCatalogService,
    private readonly manageMediaPackagePurchaseService: ManageMediaPackagePurchaseService
  ) {}

  @Post("payment-intents")
  async createPaymentIntent(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    paymentIntent: AssistantPaymentIntentState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAssistantPaymentIntentsService.parseCreateInput(body);
    return {
      requestId: req.requestId ?? null,
      paymentIntent: await this.manageAssistantPaymentIntentsService.createPaymentIntent(
        userId,
        input
      )
    };
  }

  @Get("payment-intents/:paymentIntentId")
  async getPaymentIntent(
    @Req() req: RequestWithPlatformContext,
    @Param("paymentIntentId") paymentIntentId: string
  ): Promise<{
    requestId: string | null;
    paymentIntent: AssistantPaymentIntentState;
  }> {
    const userId = this.resolveRequestUserId(req);
    return {
      requestId: req.requestId ?? null,
      paymentIntent: await this.manageAssistantPaymentIntentsService.getPaymentIntent(
        userId,
        paymentIntentId
      )
    };
  }

  @Get("subscription")
  async getSubscriptionState(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    subscription: AssistantBillingSubscriptionManagementState;
  }> {
    const userId = this.resolveRequestUserId(req);
    return {
      requestId: req.requestId ?? null,
      subscription: await this.manageAssistantBillingSubscriptionService.getState(userId)
    };
  }

  @Post("subscription/disable-auto-renew")
  async disableAutoRenew(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    subscription: AssistantBillingSubscriptionManagementState;
  }> {
    const userId = this.resolveRequestUserId(req);
    return {
      requestId: req.requestId ?? null,
      subscription: await this.manageAssistantBillingSubscriptionService.disableAutoRenew(userId)
    };
  }

  @Post("subscription/enable-auto-renew")
  async enableAutoRenew(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    result: AssistantBillingSubscriptionActionResult;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAssistantBillingSubscriptionService.parseEnableAutoRenewInput(body);
    return {
      requestId: req.requestId ?? null,
      result: await this.manageAssistantBillingSubscriptionService.enableAutoRenew(userId, input)
    };
  }

  @Post("subscription/change-plan")
  async changePlan(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    result: AssistantBillingSubscriptionActionResult;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAssistantBillingSubscriptionService.parseChangePlanInput(body);
    return {
      requestId: req.requestId ?? null,
      result: await this.manageAssistantBillingSubscriptionService.changePlan(userId, input)
    };
  }

  // ── Media packages ────────────────────────────────────────────────────────

  @Get("packages/catalog")
  async listPackageCatalog(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    packages: MediaPackageCatalogItemState[];
  }> {
    this.resolveRequestUserId(req);
    return {
      requestId: req.requestId ?? null,
      packages: await this.manageMediaPackageCatalogService.listPublic()
    };
  }

  @Post("packages/payment-intents")
  async createPackagePaymentIntent(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{ requestId: string | null; paymentIntent: AssistantPaymentIntentState }> {
    const userId = this.resolveRequestUserId(req);
    const input = body as {
      packageItemIds: string[];
      paymentMethodClass: "card" | "sbp_qr";
      idempotencyKey: string;
      returnUrl: string;
    };
    const paymentIntent = await this.manageMediaPackagePurchaseService.createPackagePaymentIntent(
      userId,
      input
    );
    return { requestId: req.requestId ?? null, paymentIntent };
  }

  private resolveUser(req: RequestWithPlatformContext): { userId: string; workspaceId: string } {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    const workspaceId = (req as unknown as Record<string, unknown>).resolvedWorkspaceId as
      | string
      | undefined;
    return {
      userId: req.resolvedAppUser.id,
      workspaceId: workspaceId ?? req.resolvedAppUser.id
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
