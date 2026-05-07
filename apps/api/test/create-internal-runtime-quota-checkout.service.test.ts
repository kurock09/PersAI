import assert from "node:assert/strict";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { CreateInternalRuntimeQuotaCheckoutService } from "../src/modules/workspace-management/application/create-internal-runtime-quota-checkout.service";

async function run(): Promise<void> {
  const previousWebBaseUrl = process.env.PERSAI_WEB_BASE_URL;
  process.env.PERSAI_WEB_BASE_URL = "https://persai.dev";
  const changePlanCalls: Array<Record<string, unknown>> = [];
  try {
    const service = new CreateInternalRuntimeQuotaCheckoutService(
      {
        async resolveByAssistantId(assistantId: string) {
          return {
            assistantId,
            userId: "user-1"
          };
        }
      } as never,
      {
        async changePlan(userId: string, input: Record<string, unknown>) {
          changePlanCalls.push({ userId, ...input });
          return {
            mode: "checkout" as const,
            paymentIntent: {
              id: "pi-1",
              targetPlanCode: input.planCode,
              paymentMethodClass: input.paymentMethodClass,
              status: "checkout_ready",
              lastErrorMessage: null,
              recurring: {
                checkoutKind: "one_time" as const,
                supportedBySelectedMethod: false,
                unsupportedReason: "Selected payment method does not support recurring billing."
              },
              checkout: {
                mode: "embedded" as const
              }
            }
          };
        }
      } as never
    );

    const parsed = service.parseInput({
      assistantId: "assistant-1",
      requestId: "request-1",
      targetPlanCode: " PRO ",
      paymentMethodClass: "card",
      confirmed: true
    });
    assert.equal(parsed.targetPlanCode, "pro");

    const result = await service.execute({
      assistantId: "assistant-1",
      requestId: "request-1",
      targetPlanCode: "pro",
      paymentMethodClass: "sbp_qr",
      confirmed: true
    });
    assert.deepEqual(result, {
      ok: true,
      action: "checkout_created",
      checkout: {
        paymentIntentId: "pi-1",
        targetPlanCode: "pro",
        paymentMethodClass: "sbp_qr",
        checkoutMode: "embedded",
        recurringCheckoutKind: "one_time",
        recurringSupportedBySelectedMethod: false,
        recurringUnsupportedReason: "Selected payment method does not support recurring billing.",
        checkoutPagePath: "/app/billing/checkout/pi-1",
        checkoutPageUrl: "https://persai.dev/app/billing/checkout/pi-1",
        checkoutSignInUrl:
          "https://persai.dev/sign-in?redirect_url=%2Fapp%2Fbilling%2Fcheckout%2Fpi-1"
      },
      subscriptionUpdate: null
    });
    assert.deepEqual(changePlanCalls[0], {
      userId: "user-1",
      planCode: "pro",
      paymentMethodClass: "sbp_qr",
      idempotencyKey: "quota_status_checkout:request-1:pro:sbp_qr",
      returnUrl: "/app/chat"
    });

    const scheduledChangeService = new CreateInternalRuntimeQuotaCheckoutService(
      {
        async resolveByAssistantId(assistantId: string) {
          return {
            assistantId,
            userId: "user-1"
          };
        }
      } as never,
      {
        async changePlan() {
          return {
            mode: "subscription_updated" as const,
            subscription: {
              scheduledPlanChange: {
                targetPlanCode: "basic",
                targetPlanDisplayName: "Basic",
                effectiveAt: "2026-06-01T00:00:00.000Z",
                nextChargeAt: null,
                changeKind: "downgrade" as const
              }
            }
          };
        }
      } as never
    );

    const scheduledResult = await scheduledChangeService.execute({
      assistantId: "assistant-1",
      requestId: "request-1b",
      targetPlanCode: "basic",
      paymentMethodClass: "card",
      confirmed: true
    });
    assert.deepEqual(scheduledResult, {
      ok: true,
      action: "subscription_updated",
      checkout: null,
      subscriptionUpdate: {
        targetPlanCode: "basic",
        targetPlanDisplayName: "Basic",
        effectiveAt: "2026-06-01T00:00:00.000Z",
        nextChargeAt: null,
        changeKind: "downgrade"
      }
    });

    await assert.rejects(
      () =>
        service.execute({
          assistantId: "assistant-1",
          requestId: "request-2",
          targetPlanCode: "pro",
          paymentMethodClass: "card",
          confirmed: false
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message === "Checkout link creation must be requested on this quota action."
    );

    const failingService = new CreateInternalRuntimeQuotaCheckoutService(
      {
        async resolveByAssistantId(assistantId: string) {
          return {
            assistantId,
            userId: "user-1"
          };
        }
      } as never,
      {
        async changePlan() {
          return {
            mode: "checkout" as const,
            paymentIntent: {
              id: "pi-2",
              targetPlanCode: "pro",
              paymentMethodClass: "card",
              status: "failed",
              lastErrorMessage: "CloudPayments Public Terminal ID is not configured.",
              recurring: {
                checkoutKind: "recurring_start" as const,
                supportedBySelectedMethod: true,
                unsupportedReason: null
              },
              checkout: {
                mode: null
              }
            }
          };
        }
      } as never
    );

    await assert.rejects(
      () =>
        failingService.execute({
          assistantId: "assistant-1",
          requestId: "request-3",
          targetPlanCode: "pro",
          paymentMethodClass: "card",
          confirmed: true
        }),
      (error: unknown) =>
        error instanceof ServiceUnavailableException &&
        error.message === "CloudPayments Public Terminal ID is not configured."
    );
  } finally {
    if (previousWebBaseUrl === undefined) {
      delete process.env.PERSAI_WEB_BASE_URL;
    } else {
      process.env.PERSAI_WEB_BASE_URL = previousWebBaseUrl;
    }
  }
}

void run();
