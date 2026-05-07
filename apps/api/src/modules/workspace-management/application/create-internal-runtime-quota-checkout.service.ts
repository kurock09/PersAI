import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ManageAssistantBillingSubscriptionService } from "./manage-assistant-billing-subscription.service";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";

export type CreateInternalRuntimeQuotaCheckoutRequest = {
  assistantId: string;
  requestId: string;
  targetPlanCode: string;
  paymentMethodClass: "card" | "sbp_qr";
  confirmed: boolean;
};

function normalizeNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizePlanCode(value: unknown): string {
  return normalizeNonEmptyString(value, "targetPlanCode").toLowerCase();
}

function parsePaymentMethodClass(value: unknown): "card" | "sbp_qr" {
  if (value === "card" || value === "sbp_qr") {
    return value;
  }
  throw new BadRequestException("paymentMethodClass must be 'card' or 'sbp_qr'.");
}

function resolvePublicWebBaseUrl(): string | null {
  const raw = process.env.PERSAI_WEB_BASE_URL?.trim();
  if (!raw) {
    return null;
  }
  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

@Injectable()
export class CreateInternalRuntimeQuotaCheckoutService {
  constructor(
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly manageAssistantBillingSubscriptionService: ManageAssistantBillingSubscriptionService
  ) {}

  parseInput(payload: unknown): CreateInternalRuntimeQuotaCheckoutRequest {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("Quota checkout payload must be an object.");
    }
    const row = payload as Record<string, unknown>;
    return {
      assistantId: normalizeNonEmptyString(row.assistantId, "assistantId"),
      requestId: normalizeNonEmptyString(row.requestId, "requestId"),
      targetPlanCode: normalizePlanCode(row.targetPlanCode),
      paymentMethodClass: parsePaymentMethodClass(row.paymentMethodClass),
      confirmed: row.confirmed === true
    };
  }

  async execute(input: CreateInternalRuntimeQuotaCheckoutRequest): Promise<{
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
    this.assertCheckoutRequested(input.confirmed);
    const resolved = await this.resolveAssistantInboundRuntimeContextService.resolveByAssistantId(
      input.assistantId
    );
    const idempotencyKey =
      `quota_status_checkout:${input.requestId}:${input.targetPlanCode}:${input.paymentMethodClass}`.slice(
        0,
        128
      );
    const result = await this.manageAssistantBillingSubscriptionService.changePlan(
      resolved.userId,
      {
        planCode: input.targetPlanCode,
        paymentMethodClass: input.paymentMethodClass,
        idempotencyKey,
        returnUrl: "/app/chat"
      }
    );
    if (result.mode === "subscription_updated") {
      const scheduledPlanChange = result.subscription.scheduledPlanChange;
      if (scheduledPlanChange === null) {
        throw new ServiceUnavailableException(
          "Billing plan change completed without a checkout link, but no follow-up billing state was returned."
        );
      }
      return {
        ok: true,
        action: "subscription_updated",
        checkout: null,
        subscriptionUpdate: {
          targetPlanCode: scheduledPlanChange.targetPlanCode,
          targetPlanDisplayName: scheduledPlanChange.targetPlanDisplayName,
          effectiveAt: scheduledPlanChange.effectiveAt,
          nextChargeAt: scheduledPlanChange.nextChargeAt,
          changeKind: scheduledPlanChange.changeKind
        }
      };
    }
    const paymentIntent = result.paymentIntent;
    if (paymentIntent.status !== "checkout_ready" || paymentIntent.checkout.mode === null) {
      throw new ServiceUnavailableException(
        paymentIntent.lastErrorMessage?.trim().length
          ? paymentIntent.lastErrorMessage
          : "Provider checkout session is unavailable right now."
      );
    }
    const checkoutPagePath = `/app/billing/checkout/${paymentIntent.id}`;
    const publicWebBaseUrl = resolvePublicWebBaseUrl();
    const checkoutPageUrl =
      publicWebBaseUrl !== null
        ? new URL(checkoutPagePath, `${publicWebBaseUrl}/`).toString()
        : null;
    const checkoutSignInUrl =
      publicWebBaseUrl !== null
        ? new URL(
            `/sign-in?${new URLSearchParams({ redirect_url: checkoutPagePath }).toString()}`,
            `${publicWebBaseUrl}/`
          ).toString()
        : null;
    return {
      ok: true,
      action: "checkout_created",
      checkout: {
        paymentIntentId: paymentIntent.id,
        targetPlanCode: paymentIntent.targetPlanCode,
        paymentMethodClass: paymentIntent.paymentMethodClass,
        checkoutMode: paymentIntent.checkout.mode,
        recurringCheckoutKind: paymentIntent.recurring.checkoutKind,
        recurringSupportedBySelectedMethod: paymentIntent.recurring.supportedBySelectedMethod,
        recurringUnsupportedReason: paymentIntent.recurring.unsupportedReason,
        checkoutPagePath,
        checkoutPageUrl,
        checkoutSignInUrl
      },
      subscriptionUpdate: null
    };
  }

  private assertCheckoutRequested(confirmed: boolean): void {
    if (confirmed) {
      return;
    }
    throw new BadRequestException("Checkout link creation must be requested on this quota action.");
  }
}
