import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type {
  BillingProviderCheckoutSession,
  BillingProviderCheckoutSessionRequest,
  BillingProviderPort
} from "../../application/billing-provider.port";
import {
  CLOUDPAYMENTS_API_SECRET_STORAGE_KEY,
  CLOUDPAYMENTS_PUBLIC_TERMINAL_ID_STORAGE_KEY
} from "../../application/billing-provider-credential-settings";
import { PlatformRuntimeProviderSecretStoreService } from "../../application/platform-runtime-provider-secret-store.service";

@Injectable()
export class CloudpaymentsWidgetBillingProviderAdapter implements BillingProviderPort {
  constructor(
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService
  ) {}

  async createCheckoutSession(
    input: BillingProviderCheckoutSessionRequest
  ): Promise<BillingProviderCheckoutSession> {
    const [apiSecret, publicTerminalId] = await Promise.all([
      this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        CLOUDPAYMENTS_API_SECRET_STORAGE_KEY
      ),
      this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        CLOUDPAYMENTS_PUBLIC_TERMINAL_ID_STORAGE_KEY
      )
    ]);
    if (apiSecret === null || apiSecret.trim().length === 0) {
      throw new ServiceUnavailableException("CloudPayments API Secret is not configured.");
    }
    if (publicTerminalId === null || publicTerminalId.trim().length === 0) {
      throw new ServiceUnavailableException("CloudPayments Public Terminal ID is not configured.");
    }

    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    return {
      providerKey: "cloudpayments",
      providerSessionRef: input.paymentIntentId,
      providerPaymentRef: null,
      mode: "widget",
      expiresAt,
      payload: {
        schema: "persai.billing.cloudpaymentsWidgetCheckout.v1",
        publicTerminalId: publicTerminalId.trim(),
        amount: Number((input.amountMinor / 100).toFixed(2)),
        currency: input.currency,
        culture: "ru-RU",
        description: `PersAI plan ${input.planCode}`,
        externalId: input.paymentIntentId,
        paymentSchema: "Single",
        accountId: input.userId,
        emailBehavior: "Optional",
        retryPayment: false,
        autoClose: 3,
        metadata: {
          paymentIntentId: input.paymentIntentId,
          workspaceId: input.workspaceId,
          userId: input.userId,
          planCode: input.planCode,
          action: input.action,
          billingPeriod: input.billingPeriod,
          paymentMethodClass: input.paymentMethodClass,
          providerCustomerRef: input.providerCustomerRef,
          ...input.metadata
        },
        expiresAt
      }
    };
  }
}
