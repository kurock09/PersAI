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

type CloudpaymentsConstructorPayload = {
  schema: "persai.billing.cloudpaymentsConstructorCheckout.v1";
  initializationParams: {
    publicTerminalId: string;
    paymentSchema: "Single" | "Dual";
    description: string;
    amount: number;
    currency: string;
    externalId: string;
    accountId?: string;
    emailBehavior: "Required" | "Hidden" | "Optional";
    language: "ru-RU";
    tokenize?: boolean;
    metadata: Record<string, unknown>;
  };
  customizationParams: {
    appearance: {
      colors?: {
        primaryButtonColor?: string;
        primaryHoverButtonColor?: string;
        primaryButtonTextColor?: string;
        primaryButtonHoverTextColor?: string;
        activeInputColor?: string;
        inputBackground?: string;
        inputColor?: string;
        inputBorderColor?: string;
        titleColor?: string;
        textColor?: string;
        errorColor?: string;
        skeletonBackground?: string;
      };
      borders: {
        radius: string;
      };
    };
    components: {
      paymentButton: {
        text: string;
      };
      paymentForm: {
        labelFontSize: string;
        activeLabelFontSize: string;
        fontSize: string;
      };
    };
  };
  expiresAt: string;
};

function toMajorCurrencyUnits(amountMinor: number): number {
  return Number((amountMinor / 100).toFixed(2));
}

@Injectable()
export class CloudpaymentsConstructorBillingProviderAdapter implements BillingProviderPort {
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
    const amount = toMajorCurrencyUnits(input.amountMinor);
    const payload: CloudpaymentsConstructorPayload = {
      schema: "persai.billing.cloudpaymentsConstructorCheckout.v1",
      initializationParams: {
        publicTerminalId: publicTerminalId.trim(),
        paymentSchema: "Single",
        description: `PersAI subscription ${input.planCode.toUpperCase()}`,
        amount,
        currency: input.currency,
        externalId: input.paymentIntentId,
        emailBehavior: "Optional",
        language: "ru-RU",
        tokenize: input.paymentMethodClass === "card",
        ...(input.providerCustomerRef !== null ? { accountId: input.providerCustomerRef } : {}),
        metadata: {
          paymentIntentId: input.paymentIntentId,
          workspaceId: input.workspaceId,
          userId: input.userId,
          planCode: input.planCode,
          action: input.action,
          billingPeriod: input.billingPeriod,
          paymentMethodClass: input.paymentMethodClass,
          recurringReady: false,
          recurringPolicy: "disabled_until_trusted_recurrent_lifecycle_support",
          providerCustomerRef: input.providerCustomerRef,
          ...input.metadata
        }
      },
      customizationParams: {
        appearance: {
          borders: {
            radius: "18px"
          }
        },
        components: {
          paymentButton: {
            text: "Оплатить подписку"
          },
          paymentForm: {
            labelFontSize: "14px",
            activeLabelFontSize: "13px",
            fontSize: "18px"
          }
        }
      },
      expiresAt
    };

    return {
      providerKey: "cloudpayments",
      providerSessionRef: input.paymentIntentId,
      providerPaymentRef: null,
      mode: "embedded",
      expiresAt,
      payload
    };
  }
}
