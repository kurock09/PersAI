import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ManageAssistantPaymentIntentsService } from "./manage-assistant-payment-intents.service";
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
    private readonly manageAssistantPaymentIntentsService: ManageAssistantPaymentIntentsService
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
    paymentIntentId: string;
    targetPlanCode: string;
    paymentMethodClass: "card" | "sbp_qr";
    checkoutMode: "embedded" | "redirect" | "payment_link" | "qr_code" | "manual_test" | null;
    checkoutPagePath: string;
    checkoutPageUrl: string | null;
    checkoutSignInUrl: string | null;
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
    const paymentIntent = await this.manageAssistantPaymentIntentsService.createPaymentIntent(
      resolved.userId,
      {
        planCode: input.targetPlanCode,
        paymentMethodClass: input.paymentMethodClass,
        idempotencyKey,
        returnUrl: "/app/chat"
      }
    );
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
      paymentIntentId: paymentIntent.id,
      targetPlanCode: paymentIntent.targetPlanCode,
      paymentMethodClass: paymentIntent.paymentMethodClass,
      checkoutMode: paymentIntent.checkout.mode,
      checkoutPagePath,
      checkoutPageUrl,
      checkoutSignInUrl
    };
  }

  private assertCheckoutRequested(confirmed: boolean): void {
    if (confirmed) {
      return;
    }
    throw new BadRequestException("Checkout link creation must be requested on this quota action.");
  }
}
