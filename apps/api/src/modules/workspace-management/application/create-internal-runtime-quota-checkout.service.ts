import { BadRequestException, Injectable } from "@nestjs/common";
import { ManageAssistantPaymentIntentsService } from "./manage-assistant-payment-intents.service";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";

export type CreateInternalRuntimeQuotaCheckoutRequest = {
  assistantId: string;
  requestId: string;
  targetPlanCode: string;
  paymentMethodClass: "card" | "sbp_qr";
  confirmed: boolean;
  userConfirmationText: string;
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
      confirmed: row.confirmed === true,
      userConfirmationText: normalizeNonEmptyString(
        row.userConfirmationText,
        "userConfirmationText"
      )
    };
  }

  async execute(input: CreateInternalRuntimeQuotaCheckoutRequest): Promise<{
    ok: true;
    paymentIntentId: string;
    targetPlanCode: string;
    paymentMethodClass: "card" | "sbp_qr";
    checkoutMode: "widget" | "redirect" | "payment_link" | "qr_code" | "manual_test" | null;
    checkoutPagePath: string;
  }> {
    this.assertExplicitConfirmation(input.userConfirmationText, input.confirmed);
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
    return {
      ok: true,
      paymentIntentId: paymentIntent.id,
      targetPlanCode: paymentIntent.targetPlanCode,
      paymentMethodClass: paymentIntent.paymentMethodClass,
      checkoutMode: paymentIntent.checkout.mode,
      checkoutPagePath: `/app/billing/checkout/${paymentIntent.id}`
    };
  }

  private assertExplicitConfirmation(userText: string, confirmed: boolean): void {
    const text = userText.trim().toLowerCase();
    const strongConfirmation =
      /(?:подтверждаю|созда(?:й|йте)\s+(?:оплату|плат[её]ж|ссылку|qr|qr-код)|оформл(?:яй|яйте)\s+(?:оплату|плат[её]ж)|давай\s+(?:оформим|оплату)|confirm|confirmed|create (?:payment|checkout|payment link|qr)|send (?:payment link|qr)|go ahead with (?:payment|checkout)|proceed with (?:payment|checkout)|buy it)/i.test(
        text
      );
    const weakAffirmationPrefixes = [
      "да",
      "yes",
      "ok",
      "okay",
      "ага",
      "угу",
      "go ahead",
      "proceed"
    ];
    const weakAffirmation = weakAffirmationPrefixes.some(
      (prefix) => text === prefix || text.startsWith(`${prefix} `)
    );
    if (strongConfirmation || (confirmed && weakAffirmation)) {
      return;
    }
    throw new BadRequestException(
      "Explicit user confirmation is required before creating payment checkout."
    );
  }
}
