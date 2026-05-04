import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { CreateInternalRuntimeQuotaCheckoutService } from "../src/modules/workspace-management/application/create-internal-runtime-quota-checkout.service";

async function run(): Promise<void> {
  const createCalls: Array<Record<string, unknown>> = [];
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
      async createPaymentIntent(userId: string, input: Record<string, unknown>) {
        createCalls.push({ userId, ...input });
        return {
          id: "pi-1",
          targetPlanCode: input.planCode,
          paymentMethodClass: input.paymentMethodClass,
          checkout: {
            mode: "manual_test" as const
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
    confirmed: true,
    userConfirmationText: "Да"
  });
  assert.equal(parsed.targetPlanCode, "pro");

  const result = await service.execute({
    assistantId: "assistant-1",
    requestId: "request-1",
    targetPlanCode: "pro",
    paymentMethodClass: "sbp_qr",
    confirmed: true,
    userConfirmationText: "Да"
  });
  assert.deepEqual(result, {
    ok: true,
    paymentIntentId: "pi-1",
    targetPlanCode: "pro",
    paymentMethodClass: "sbp_qr",
    checkoutMode: "manual_test",
    checkoutPagePath: "/app/billing/checkout/pi-1"
  });
  assert.deepEqual(createCalls[0], {
    userId: "user-1",
    planCode: "pro",
    paymentMethodClass: "sbp_qr",
    idempotencyKey: "quota_status_checkout:request-1:pro:sbp_qr",
    returnUrl: "/app/chat"
  });

  await assert.rejects(
    () =>
      service.execute({
        assistantId: "assistant-1",
        requestId: "request-2",
        targetPlanCode: "pro",
        paymentMethodClass: "card",
        confirmed: false,
        userConfirmationText: "Расскажи про планы"
      }),
    (error: unknown) =>
      error instanceof BadRequestException &&
      error.message === "Explicit user confirmation is required before creating payment checkout."
  );
}

void run();
