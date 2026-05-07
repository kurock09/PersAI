import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type {
  BillingProviderCheckoutSession,
  BillingProviderCheckoutSessionRequest,
  BillingProviderManagedSubscription,
  BillingProviderManagedSubscriptionUpdateInput,
  BillingProviderPort
} from "../../application/billing-provider.port";
import {
  CLOUDPAYMENTS_API_SECRET_STORAGE_KEY,
  CLOUDPAYMENTS_PUBLIC_TERMINAL_ID_STORAGE_KEY
} from "../../application/billing-provider-credential-settings";
import { PlatformRuntimeProviderSecretStoreService } from "../../application/platform-runtime-provider-secret-store.service";

type CloudpaymentsRecurrentParams = {
  interval: "Day" | "Week" | "Month";
  period: number;
  maxPeriods?: number;
  amount?: number;
  startDate?: string;
};

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
    culture?: "ru-RU";
    tokenize?: boolean;
    recurrent?: CloudpaymentsRecurrentParams;
    userInfo?: {
      accountId: string;
    };
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
  Description?: string;
  Interval?: "Day" | "Week" | "Month" | string;
  Period?: number;
  MaxPeriods?: number | null;
  StartDateIso?: string | null;
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
): CloudpaymentsRecurrentParams | null {
  if (input.checkoutKind !== "recurring_start" || input.recurringPlan === null) {
    return null;
  }
  return {
    interval: input.recurringPlan.interval,
    period: input.recurringPlan.period,
    ...(input.recurringPlan.maxPeriods !== null
      ? { maxPeriods: input.recurringPlan.maxPeriods }
      : {}),
    ...(input.recurringPlan.amountMinor !== null
      ? { amount: toMajorCurrencyUnits(input.recurringPlan.amountMinor) }
      : {}),
    ...(input.recurringPlan.startDate !== null ? { startDate: input.recurringPlan.startDate } : {})
  };
}

function resolveCloudpaymentsAccountId(
  input: BillingProviderCheckoutSessionRequest
): string | null {
  if (input.providerCustomerRef !== null) {
    return input.providerCustomerRef;
  }
  return input.checkoutKind === "recurring_start" ? input.workspaceId : null;
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
    const accountId = resolveCloudpaymentsAccountId(input);
    const recurrentParams: { recurrent: CloudpaymentsRecurrentParams } | Record<string, never> =
      recurrentData !== null ? { recurrent: recurrentData } : {};
    const userInfoParams:
      | Pick<CloudpaymentsConstructorPayload["initializationParams"], "userInfo">
      | Record<string, never> = accountId !== null ? { userInfo: { accountId } } : {};
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
        culture: "ru-RU",
        tokenize: input.paymentMethodClass === "card",
        ...recurrentParams,
        ...(accountId !== null ? { accountId } : {}),
        ...userInfoParams,
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
    return this.toManagedSubscription(response.Model, input.providerSubscriptionRef);
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

  async resumeManagedSubscription(
    input: BillingProviderManagedSubscriptionUpdateInput
  ): Promise<BillingProviderManagedSubscription> {
    return this.updateManagedSubscription(input);
  }

  async updateManagedSubscription(
    input: BillingProviderManagedSubscriptionUpdateInput
  ): Promise<BillingProviderManagedSubscription> {
    const response = await this.callCloudpaymentsApi<CloudpaymentsSubscriptionModel>(
      "subscriptions/update",
      {
        Id: input.providerSubscriptionRef,
        ...(typeof input.description === "string" && input.description.trim().length > 0
          ? { Description: input.description.trim() }
          : {}),
        ...(typeof input.amountMinor === "number"
          ? { Amount: toMajorCurrencyUnits(input.amountMinor) }
          : {}),
        ...(typeof input.currency === "string" && input.currency.trim().length > 0
          ? { Currency: input.currency.trim().toUpperCase() }
          : {}),
        ...(typeof input.startDate === "string" && input.startDate.trim().length > 0
          ? { StartDate: input.startDate.trim() }
          : {}),
        ...(input.interval !== undefined && input.interval !== null
          ? { Interval: input.interval }
          : {}),
        ...(typeof input.period === "number" && Number.isInteger(input.period) && input.period > 0
          ? { Period: input.period }
          : {}),
        ...(typeof input.maxPeriods === "number" &&
        Number.isInteger(input.maxPeriods) &&
        input.maxPeriods > 0
          ? { MaxPeriods: input.maxPeriods }
          : {})
      }
    );
    if (response.Model === undefined || response.Model === null) {
      throw new ServiceUnavailableException(
        "CloudPayments subscriptions/update returned no subscription snapshot."
      );
    }
    return this.toManagedSubscription(response.Model, input.providerSubscriptionRef);
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

  private toManagedSubscription(
    model: CloudpaymentsSubscriptionModel,
    fallbackSubscriptionRef: string
  ): BillingProviderManagedSubscription {
    const intervalCandidate = model.Interval ?? null;
    const interval = isSupportedRecurringInterval(intervalCandidate) ? intervalCandidate : null;
    return {
      providerKey: "cloudpayments",
      providerSubscriptionRef: String(model.Id ?? fallbackSubscriptionRef),
      status: typeof model.Status === "string" ? model.Status : "Unknown",
      nextChargeAt:
        typeof model.NextTransactionDateIso === "string" &&
        model.NextTransactionDateIso.trim().length > 0
          ? model.NextTransactionDateIso
          : typeof model.StartDateIso === "string" && model.StartDateIso.trim().length > 0
            ? model.StartDateIso
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
      raw: model as Record<string, unknown>
    };
  }
}
