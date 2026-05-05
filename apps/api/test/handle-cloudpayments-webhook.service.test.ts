import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { HandleCloudpaymentsWebhookService } from "../src/modules/workspace-management/application/handle-cloudpayments-webhook.service";

async function run(): Promise<void> {
  const appliedBillingEvents: Array<Record<string, unknown>> = [];
  const paymentIntentUpdates: Array<Record<string, unknown>> = [];

  const paymentIntent = {
    id: "intent-1",
    workspaceId: "ws-1",
    userId: "user-1",
    targetPlanCode: "pro",
    action: "upgrade",
    status: "checkout_ready",
    paymentMethodClass: "card",
    amountMinor: 9900,
    currency: "RUB",
    billingPeriod: "month",
    billingProvider: null,
    providerCustomerRef: null,
    providerSessionRef: null,
    providerPaymentRef: null,
    metadata: {}
  };

  const service = new HandleCloudpaymentsWebhookService(
    {
      workspacePaymentIntent: {
        findFirst: async () => paymentIntent,
        update: async (args: { data: Record<string, unknown> }) => {
          paymentIntentUpdates.push(args.data);
          return { ...paymentIntent, ...args.data };
        }
      },
      workspaceSubscription: {
        findUnique: async () => ({
          id: "sub-1",
          workspaceId: "ws-1",
          planCode: "starter",
          status: "trialing",
          providerCustomerRef: null,
          providerSubscriptionRef: null
        }),
        findFirst: async () => null
      },
      planCatalogPlan: {
        findUnique: async () => null
      }
    } as never,
    {
      resolveSecretValueByProviderKey: async (providerKey: string) => {
        assert.equal(providerKey, "billing_cloudpayments__api_secret");
        return "cloudpayments-api-secret";
      }
    } as never,
    {
      apply: async (input: Record<string, unknown>) => {
        appliedBillingEvents.push(input);
        return { status: "applied", billingEventId: "billing-event-1" };
      }
    } as never
  );

  const completedPayBody = {
    TransactionId: 123456,
    Amount: 99,
    Currency: "RUB",
    InvoiceId: "intent-1",
    Status: "Completed",
    DateTime: "2026-05-04 19:05:00"
  };
  const completedPayRawBody = Buffer.from(JSON.stringify(completedPayBody), "utf8");
  const completedPayHmac = createHmac("sha256", "cloudpayments-api-secret")
    .update(completedPayRawBody)
    .digest("base64");

  const completedResult = await service.handle({
    notificationType: "pay",
    body: completedPayBody,
    rawBody: completedPayRawBody,
    headers: {
      "x-content-hmac": completedPayHmac
    }
  });

  assert.deepEqual(completedResult, { status: "processed" });
  assert.equal(paymentIntentUpdates[0]?.status, "succeeded");
  assert.equal(appliedBillingEvents[0]?.eventCode, "payment_activated");
  assert.equal(appliedBillingEvents[0]?.workspaceId, "ws-1");
  assert.equal(appliedBillingEvents[0]?.paidPlanCode, "pro");
  assert.equal(appliedBillingEvents[0]?.currentPeriodStartedAt, "2026-05-04T19:05:00.000Z");
  assert.equal(appliedBillingEvents[0]?.currentPeriodEndsAt, "2026-06-04T19:05:00.000Z");

  const authorizedPayBody = {
    TransactionId: 123457,
    Amount: 99,
    Currency: "RUB",
    InvoiceId: "intent-1",
    Status: "Authorized",
    DateTime: "2026-05-04 19:06:00"
  };
  const authorizedPayRawBody = Buffer.from(JSON.stringify(authorizedPayBody), "utf8");
  const authorizedPayHmac = createHmac("sha256", "cloudpayments-api-secret")
    .update(authorizedPayRawBody)
    .digest("base64");

  const authorizedResult = await service.handle({
    notificationType: "pay",
    body: authorizedPayBody,
    rawBody: authorizedPayRawBody,
    headers: {
      "x-content-hmac": authorizedPayHmac
    }
  });

  assert.deepEqual(authorizedResult, { status: "ignored" });
  assert.equal(paymentIntentUpdates[1]?.status, "pending_confirmation");

  const metadataPayBody = {
    TransactionId: 123458,
    Amount: 99,
    Currency: "RUB",
    ExternalId: "intent-1",
    Status: "Completed",
    Metadata: JSON.stringify({
      paymentIntentId: "intent-1"
    }),
    DateTime: "2026-05-04 19:07:00"
  };
  const metadataPayRawBody = Buffer.from(JSON.stringify(metadataPayBody), "utf8");
  const metadataPayHmac = createHmac("sha256", "cloudpayments-api-secret")
    .update(metadataPayRawBody)
    .digest("base64");

  const metadataResult = await service.handle({
    notificationType: "pay",
    body: metadataPayBody,
    rawBody: metadataPayRawBody,
    headers: {
      "x-content-hmac": metadataPayHmac
    }
  });

  assert.deepEqual(metadataResult, { status: "processed" });
  assert.equal(paymentIntentUpdates[2]?.providerPaymentRef, "123458");

  const encodedCheckBody = {
    TransactionId: 123459,
    Amount: 99,
    Currency: "RUB",
    InvoiceId: "intent-1",
    DateTime: "2026-05-04 19:08:00"
  };
  const encodedCheckRawBody = Buffer.from(
    new URLSearchParams({
      TransactionId: "123459",
      Amount: "99",
      Currency: "RUB",
      InvoiceId: "intent-1",
      DateTime: "2026-05-04 19:08:00"
    }).toString(),
    "utf8"
  );
  const encodedCheckContentHmac = createHmac("sha256", "cloudpayments-api-secret")
    .update(encodedCheckRawBody)
    .digest("base64");

  const encodedCheckResult = await service.handle({
    notificationType: "check",
    body: encodedCheckBody,
    rawBody: encodedCheckRawBody,
    headers: {
      "x-content-hmac": "invalid-signature",
      "content-hmac": encodedCheckContentHmac
    }
  });

  assert.deepEqual(encodedCheckResult, { status: "processed" });

  await assert.rejects(
    service.handle({
      notificationType: "pay",
      body: completedPayBody,
      rawBody: completedPayRawBody,
      headers: {
        "x-content-hmac": "invalid-signature"
      }
    })
  );
}

void run();
