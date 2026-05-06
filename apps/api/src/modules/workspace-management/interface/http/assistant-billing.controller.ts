import { Body, Controller, Get, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import {
  ManageAssistantPaymentIntentsService,
  type AssistantPaymentIntentState
} from "../../application/manage-assistant-payment-intents.service";
import {
  ManageAssistantBillingSubscriptionService,
  type AssistantBillingSubscriptionManagementState
} from "../../application/manage-assistant-billing-subscription.service";

@Controller("api/v1/assistant/billing")
export class AssistantBillingController {
  constructor(
    private readonly manageAssistantPaymentIntentsService: ManageAssistantPaymentIntentsService,
    private readonly manageAssistantBillingSubscriptionService: ManageAssistantBillingSubscriptionService
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

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
