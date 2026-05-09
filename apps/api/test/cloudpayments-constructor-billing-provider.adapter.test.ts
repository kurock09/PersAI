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
    checkoutKind: "one_time",
    recurringPlan: null,
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
  assert.equal((session.payload.initializationParams as Record<string, unknown>).culture, "ru-RU");
  assert.equal(
    (session.payload.initializationParams as Record<string, unknown>).accountId,
    "cust-1"
  );
  assert.deepEqual((session.payload.initializationParams as Record<string, unknown>).userInfo, {
    accountId: "cust-1"
  });
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
  assert.equal(
    (
      (session.payload.initializationParams as Record<string, unknown>).metadata as Record<
        string,
        unknown
      >
    ).checkoutKind,
    "one_time"
  );

  const recurringSession = await adapter.createCheckoutSession({
    paymentIntentId: "pi-3",
    workspaceId: "ws-1",
    userId: "user-1",
    planCode: "pro",
    action: "new_purchase",
    amountMinor: 98000,
    currency: "RUB",
    billingPeriod: "month",
    paymentMethodClass: "card",
    returnUrl: "/app/chat",
    providerCustomerRef: "cust-1",
    checkoutKind: "recurring_start",
    recurringPlan: {
      interval: "Month",
      period: 1,
      maxPeriods: null,
      amountMinor: 98000,
      startDate: "2026-05-05T12:00:00.000Z"
    },
    metadata: {}
  });
  const recurringData = (recurringSession.payload.initializationParams as Record<string, unknown>)
    .recurrent as Record<string, unknown>;
  assert.deepEqual(recurringData, {
    interval: "Month",
    period: 1,
    amount: 980,
    startDate: "2026-05-05T12:00:00.000Z"
  });
  assert.equal(
    (recurringSession.payload.initializationParams as Record<string, unknown>).data,
    undefined
  );

  const recurringSessionWithoutKnownCustomer = await adapter.createCheckoutSession({
    paymentIntentId: "pi-4",
    workspaceId: "ws-new",
    userId: "user-1",
    planCode: "basic",
    action: "new_purchase",
    amountMinor: 56000,
    currency: "RUB",
    billingPeriod: "month",
    paymentMethodClass: "card",
    returnUrl: "/app/chat",
    providerCustomerRef: null,
    checkoutKind: "recurring_start",
    recurringPlan: {
      interval: "Month",
      period: 1,
      maxPeriods: null,
      amountMinor: 56000,
      startDate: null
    },
    metadata: {}
  });
  assert.equal(
    (recurringSessionWithoutKnownCustomer.payload.initializationParams as Record<string, unknown>)
      .accountId,
    "ws-new"
  );
  assert.deepEqual(
    (recurringSessionWithoutKnownCustomer.payload.initializationParams as Record<string, unknown>)
      .userInfo,
    { accountId: "ws-new" }
  );

  const mediaPackageSession = await adapter.createCheckoutSession({
    paymentIntentId: "pi-package",
    workspaceId: "ws-1",
    userId: "user-1",
    planCode: "__media_package__",
    action: "new_purchase",
    amountMinor: 520000,
    currency: "RUB",
    billingPeriod: "month",
    paymentMethodClass: "card",
    returnUrl: "/app/chat",
    providerCustomerRef: null,
    checkoutKind: "one_time",
    recurringPlan: null,
    metadata: {
      purpose: "media_package_purchase",
      packageItems: [
        { catalogItemId: "ci-1", packageType: "image_generate", units: 100, amountMinor: 300000 },
        { catalogItemId: "ci-2", packageType: "image_edit", units: 0, amountMinor: 0 },
        { catalogItemId: "ci-3", packageType: "video_generate", units: 10, amountMinor: 220000 }
      ]
    }
  });
  const mediaInit = mediaPackageSession.payload.initializationParams as Record<string, unknown>;
  assert.equal(mediaInit.description, "PersAI Пакет медиа 100/0/10 (фото/ред/видео)");
  const mediaButton = (
    (mediaPackageSession.payload.customizationParams as Record<string, unknown>)
      .components as Record<string, unknown>
  ).paymentButton as Record<string, unknown>;
  assert.equal(mediaButton.text, "Оплатить пакет");

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
        checkoutKind: "one_time",
        recurringPlan: null,
        metadata: {}
      }),
    (error: unknown) =>
      error instanceof ServiceUnavailableException &&
      error.message === "CloudPayments Public Terminal ID is not configured."
  );
}

void run();
