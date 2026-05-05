import assert from "node:assert/strict";
import { ServiceUnavailableException } from "@nestjs/common";
import { CloudpaymentsConstructorBillingProviderAdapter } from "../src/modules/workspace-management/infrastructure/billing/cloudpayments-constructor-billing-provider.adapter";

async function run(): Promise<void> {
  const requestedKeys: string[] = [];
  const adapter = new CloudpaymentsConstructorBillingProviderAdapter({
    async resolveSecretValueByProviderKey(providerKey: string) {
      requestedKeys.push(providerKey);
      if (providerKey === "billing_cloudpayments__api_secret") {
        return "cloudpayments-secret";
      }
      if (providerKey === "billing_cloudpayments__public_terminal_id") {
        return "test_api_00000000000000000000002";
      }
      return null;
    }
  } as never);

  const session = await adapter.createCheckoutSession({
    paymentIntentId: "pi-1",
    workspaceId: "ws-1",
    userId: "user-1",
    planCode: "pro",
    action: "upgrade",
    amountMinor: 98000,
    currency: "RUB",
    billingPeriod: "month",
    paymentMethodClass: "card",
    returnUrl: "/app/chat",
    providerCustomerRef: "cust-1",
    metadata: {
      currentPlanCode: "starter",
      currentSubscriptionStatus: "active"
    }
  });

  assert.deepEqual(requestedKeys, [
    "billing_cloudpayments__api_secret",
    "billing_cloudpayments__public_terminal_id"
  ]);
  assert.equal(session.providerKey, "cloudpayments");
  assert.equal(session.mode, "embedded");
  assert.equal(session.providerSessionRef, "pi-1");
  assert.equal(session.payload.schema, "persai.billing.cloudpaymentsConstructorCheckout.v1");
  assert.equal(
    (session.payload.initializationParams as Record<string, unknown>).publicTerminalId,
    "test_api_00000000000000000000002"
  );
  assert.equal((session.payload.initializationParams as Record<string, unknown>).amount, 980);
  assert.equal(
    (session.payload.initializationParams as Record<string, unknown>).externalId,
    "pi-1"
  );
  assert.equal(
    (session.payload.initializationParams as Record<string, unknown>).accountId,
    "cust-1"
  );
  assert.equal((session.payload.initializationParams as Record<string, unknown>).tokenize, true);
  assert.equal(
    (
      (session.payload.initializationParams as Record<string, unknown>).metadata as Record<
        string,
        unknown
      >
    ).paymentIntentId,
    "pi-1"
  );
  assert.equal(
    (
      (session.payload.initializationParams as Record<string, unknown>).metadata as Record<
        string,
        unknown
      >
    ).recurringReady,
    false
  );

  const missingConfigAdapter = new CloudpaymentsConstructorBillingProviderAdapter({
    async resolveSecretValueByProviderKey(providerKey: string) {
      return providerKey === "billing_cloudpayments__api_secret" ? "cloudpayments-secret" : null;
    }
  } as never);

  await assert.rejects(
    () =>
      missingConfigAdapter.createCheckoutSession({
        paymentIntentId: "pi-2",
        workspaceId: "ws-1",
        userId: "user-1",
        planCode: "pro",
        action: "upgrade",
        amountMinor: 199000,
        currency: "RUB",
        billingPeriod: "month",
        paymentMethodClass: "card",
        returnUrl: "/app/chat",
        providerCustomerRef: null,
        metadata: {}
      }),
    (error: unknown) =>
      error instanceof ServiceUnavailableException &&
      error.message === "CloudPayments Public Terminal ID is not configured."
  );
}

void run();
