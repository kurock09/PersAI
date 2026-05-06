import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type {
  BillingProviderCheckoutSession,
  BillingProviderCheckoutSessionRequest,
  BillingProviderManagedSubscription,
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
    data?: Record<string, unknown>;
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

type CloudpaymentsApiEnvelope<TModel> = {
  Model?: TModel;
  Success?: boolean;
  Message?: string | null;
};

type CloudpaymentsSubscriptionModel = {
  Id?: string;
  Status?: string;
  Amount?: number;
  Currency?: string;
  Interval?: "Day" | "Week" | "Month" | string;
  Period?: number;
  NextTransactionDateIso?: string | null;
};

function toMajorCurrencyUnits(amountMinor: number): number {
  return Number((amountMinor / 100).toFixed(2));
}

function toMinorCurrencyUnits(amountMajor: number): number {
  return Math.round(amountMajor * 100);
}

function buildCloudpaymentsRecurringData(
  input: BillingProviderCheckoutSessionRequest
): Record<string, unknown> | null {
  if (input.checkoutKind !== "recurring_start" || input.recurringPlan === null) {
    return null;
  }
  return {
    cloudPayments: {
      recurrent: {
        interval: input.recurringPlan.interval,
        period: input.recurringPlan.period,
        ...(input.recurringPlan.maxPeriods !== null
          ? { maxPeriods: input.recurringPlan.maxPeriods }
          : {}),
        ...(input.recurringPlan.amountMinor !== null
          ? { amount: toMajorCurrencyUnits(input.recurringPlan.amountMinor) }
          : {}),
        ...(input.recurringPlan.startDate !== null
          ? { startDate: input.recurringPlan.startDate }
          : {})
      }
    },
    // The docs are inconsistent about `cloudPayments` vs `CloudPayments`.
    // Sending both keeps the provider-specific recurrent contract explicit
    // without making PersAI product truth depend on that casing ambiguity.
    CloudPayments: {
      recurrent: {
        interval: input.recurringPlan.interval,
        period: input.recurringPlan.period,
        ...(input.recurringPlan.maxPeriods !== null
          ? { maxPeriods: input.recurringPlan.maxPeriods }
          : {}),
        ...(input.recurringPlan.amountMinor !== null
          ? { amount: toMajorCurrencyUnits(input.recurringPlan.amountMinor) }
          : {}),
        ...(input.recurringPlan.startDate !== null
          ? { startDate: input.recurringPlan.startDate }
          : {})
      }
    }
  };
}

function isSupportedRecurringInterval(value: unknown): value is "Day" | "Week" | "Month" {
  return value === "Day" || value === "Week" || value === "Month";
}

@Injectable()
export class CloudpaymentsConstructorBillingProviderAdapter implements BillingProviderPort {
  constructor(
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService
  ) {}

  async createCheckoutSession(
    input: BillingProviderCheckoutSessionRequest
  ): Promise<BillingProviderCheckoutSession> {
    const { publicTerminalId } = await this.resolveCloudpaymentsCredentials();

    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const amount = toMajorCurrencyUnits(input.amountMinor);
    const recurrentData = buildCloudpaymentsRecurringData(input);
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
        ...(recurrentData !== null ? { data: recurrentData } : {}),
        ...(input.providerCustomerRef !== null ? { accountId: input.providerCustomerRef } : {}),
        metadata: {
          paymentIntentId: input.paymentIntentId,
          workspaceId: input.workspaceId,
          userId: input.userId,
          planCode: input.planCode,
          action: input.action,
          billingPeriod: input.billingPeriod,
          paymentMethodClass: input.paymentMethodClass,
          checkoutKind: input.checkoutKind,
          recurringReady: input.checkoutKind === "recurring_start",
          recurringPolicy:
            input.checkoutKind === "recurring_start"
              ? "provider_recurrent_start"
              : "one_time_only_for_selected_method",
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

  async getManagedSubscription(input: {
    providerSubscriptionRef: string;
  }): Promise<BillingProviderManagedSubscription | null> {
    const response = await this.callCloudpaymentsApi<CloudpaymentsSubscriptionModel>(
      "subscriptions/get",
      {
        Id: input.providerSubscriptionRef
      }
    );
    if (response.Model === undefined || response.Model === null) {
      return null;
    }
    const model = response.Model;
    const intervalCandidate = model.Interval ?? null;
    const interval = isSupportedRecurringInterval(intervalCandidate) ? intervalCandidate : null;
    return {
      providerKey: "cloudpayments",
      providerSubscriptionRef: String(model.Id ?? input.providerSubscriptionRef),
      status: typeof model.Status === "string" ? model.Status : "Unknown",
      nextChargeAt:
        typeof model.NextTransactionDateIso === "string" &&
        model.NextTransactionDateIso.trim().length > 0
          ? model.NextTransactionDateIso
          : null,
      amountMinor: typeof model.Amount === "number" ? toMinorCurrencyUnits(model.Amount) : null,
      currency: typeof model.Currency === "string" ? model.Currency : null,
      interval,
      period:
        typeof model.Period === "number" && Number.isInteger(model.Period) && model.Period > 0
          ? model.Period
          : null,
      customerPortalUrl: "https://my.cloudpayments.ru/",
      paymentMethodUpdateUrl: "https://my.cloudpayments.ru/",
      cancelUrl: "https://my.cloudpayments.ru/unsubscribe",
      raw: response.Model as Record<string, unknown>
    };
  }

  async cancelManagedSubscription(input: { providerSubscriptionRef: string }): Promise<{
    providerKey: string;
    providerSubscriptionRef: string;
    canceledAt: string;
  }> {
    await this.callCloudpaymentsApi<Record<string, never>>("subscriptions/cancel", {
      Id: input.providerSubscriptionRef
    });
    return {
      providerKey: "cloudpayments",
      providerSubscriptionRef: input.providerSubscriptionRef,
      canceledAt: new Date().toISOString()
    };
  }

  private async resolveCloudpaymentsCredentials(): Promise<{
    apiSecret: string;
    publicTerminalId: string;
  }> {
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
    return {
      apiSecret: apiSecret.trim(),
      publicTerminalId: publicTerminalId.trim()
    };
  }

  private async callCloudpaymentsApi<TModel>(
    path: string,
    body: Record<string, unknown>
  ): Promise<CloudpaymentsApiEnvelope<TModel>> {
    const { apiSecret, publicTerminalId } = await this.resolveCloudpaymentsCredentials();
    const response = await fetch(`https://api.cloudpayments.ru/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${publicTerminalId}:${apiSecret}`, "utf8").toString("base64")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const payload = (await response
      .json()
      .catch(() => null)) as CloudpaymentsApiEnvelope<TModel> | null;
    if (!response.ok || payload?.Success === false) {
      throw new ServiceUnavailableException(
        payload?.Message?.trim() || `CloudPayments ${path} request failed.`
      );
    }
    return payload ?? { Success: true };
  }
}
