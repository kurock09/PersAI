import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { HandleCloudpaymentsWebhookService } from "../src/modules/workspace-management/application/handle-cloudpayments-webhook.service";

async function run(): Promise<void> {
  const paymentIntentId = "11111111-1111-4111-8111-111111111111";
  const appliedBillingEvents: Array<Record<string, unknown>> = [];
  const paymentIntentUpdates: Array<Record<string, unknown>> = [];
  const subscriptionUpdates: Array<Record<string, unknown>> = [];
  const paymentIntentFindManyCalls: Array<Record<string, unknown>> = [];
  const subscriptionFindFirstCalls: Array<Record<string, unknown>> = [];
  let subscriptionStatus: "trialing" | "active" | "grace_period" = "trialing";
  let subscriptionPlanCode = "starter";
  let subscriptionProviderSubscriptionRef: string | null = "sub-provider-1";
  let subscriptionMetadata: Record<string, unknown> | null = null;
  let allowAccountIdSubscriptionFallback = true;
  let duplicateIntentMatches = false;

  const paymentIntent = {
    id: paymentIntentId,
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
    providerSessionRef: paymentIntentId,
    providerPaymentRef: null,
    metadata: {}
  };

  const service = new HandleCloudpaymentsWebhookService(
    {
      workspacePaymentIntent: {
        findMany: async (args: Record<string, unknown>) => {
          paymentIntentFindManyCalls.push(args);
          const where = args.where as { OR?: Array<Record<string, { in?: string[] }>> } | undefined;
          const candidates = (where?.OR ?? []).flatMap((clause) =>
            Object.values(clause).flatMap((value) => value.in ?? [])
          );
          if (duplicateIntentMatches && candidates.includes("intent-duplicate")) {
            return [
              {
                ...paymentIntent,
                id: "intent-duplicate-1",
                providerSessionRef: "intent-duplicate"
              },
              {
                ...paymentIntent,
                id: "intent-duplicate-2",
                providerSessionRef: "intent-duplicate"
              }
            ];
          }
          return candidates.some((candidate) =>
            [paymentIntentId, "123456", "123457", "123458", "123459"].includes(candidate)
          )
            ? [paymentIntent]
            : [];
        },
        update: async (args: { data: Record<string, unknown> }) => {
          paymentIntentUpdates.push(args.data);
          return { ...paymentIntent, ...args.data };
        }
      },
      workspaceSubscription: {
        findUnique: async () => ({
          id: "sub-1",
          workspaceId: "ws-1",
          planCode: subscriptionPlanCode,
          status: subscriptionStatus,
          billingProvider: "cloudpayments",
          cancelAtPeriodEnd: false,
          providerCustomerRef: null,
          providerSubscriptionRef: subscriptionProviderSubscriptionRef,
          metadata: subscriptionMetadata
        }),
        update: async (args: { data: Record<string, unknown> }) => {
          subscriptionUpdates.push(args.data);
          return args.data;
        },
        findFirst: async (args: { where: Record<string, unknown> }) => {
          subscriptionFindFirstCalls.push(args);
          const providerSubscriptionRef = args.where.providerSubscriptionRef;
          if (providerSubscriptionRef === subscriptionProviderSubscriptionRef) {
            return {
              id: "sub-1",
              workspaceId: "ws-1",
              planCode: subscriptionPlanCode,
              status: subscriptionStatus,
              providerCustomerRef: "acct-1",
              providerSubscriptionRef: subscriptionProviderSubscriptionRef,
              metadata: subscriptionMetadata
            };
          }
          if (allowAccountIdSubscriptionFallback && args.where.providerCustomerRef === "acct-1") {
            return {
              id: "sub-1",
              workspaceId: "ws-1",
              planCode: subscriptionPlanCode,
              status: subscriptionStatus,
              providerCustomerRef: "acct-1",
              providerSubscriptionRef: subscriptionProviderSubscriptionRef,
              metadata: subscriptionMetadata
            };
          }
          return null;
        }
      },
      planCatalogPlan: {
        findUnique: async () => ({
          billingProviderHints: {
            presentation: {
              price: {
                billingPeriod: "month"
              }
            }
          }
        })
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
    InvoiceId: paymentIntentId,
    Status: "Completed",
    ReceiptUrl: "https://checkout.cloudpayments.example/receipt/123",
    CardType: "Visa",
    CardLastFour: "4242",
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
  assert.equal(appliedBillingEvents[0]?.metadata?.providerCardType, "Visa");
  assert.equal(appliedBillingEvents[0]?.metadata?.providerCardLastFour, "4242");
  assert.equal(
    paymentIntentUpdates[0]?.metadata?.cloudpayments?.lastReceiptUrl,
    "https://checkout.cloudpayments.example/receipt/123"
  );
  assert.equal(
    appliedBillingEvents[0]?.metadata?.providerReceiptUrl,
    "https://checkout.cloudpayments.example/receipt/123"
  );

  subscriptionStatus = "active";
  paymentIntent.paymentMethodClass = "sbp_qr";
  paymentIntent.metadata = { purpose: "managed_recurring_upgrade" };
  const managedUpgradeResult = await service.handle({
    notificationType: "pay",
    body: {
      ...completedPayBody,
      TransactionId: 123457,
      DateTime: "2026-05-04 20:05:00"
    },
    rawBody: Buffer.from("{}"),
    headers: {
      "content-hmac": createHmac("sha256", "cloudpayments-api-secret").update("{}").digest("base64")
    }
  });
  assert.deepEqual(managedUpgradeResult, { status: "processed" });
  assert.equal(subscriptionUpdates.at(-1)?.recurringMigrationStatus, "failed");
  assert.equal(
    subscriptionUpdates.at(-1)?.recurringMigrationFailureReason,
    "provider_sbp_recurring_not_confirmed"
  );
  assert.equal(subscriptionUpdates.at(-1)?.autoRenewMethodClass, "card");

  const authorizedPayBody = {
    TransactionId: 123457,
    Amount: 99,
    Currency: "RUB",
    InvoiceId: paymentIntentId,
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
  assert.equal(paymentIntentUpdates[2]?.status, "pending_confirmation");

  const metadataPayBody = {
    TransactionId: 123458,
    Amount: 99,
    Currency: "RUB",
    ExternalId: "intent-1",
    Status: "Completed",
    Metadata: JSON.stringify({
      paymentIntentId
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
  assert.equal(paymentIntentUpdates[3]?.providerPaymentRef, "123458");

  paymentIntent.metadata = { purpose: "autopay_enable_bind" };
  subscriptionStatus = "active";
  subscriptionPlanCode = "starter";
  subscriptionProviderSubscriptionRef = null;
  const bindBody = {
    TransactionId: 1234581,
    Amount: 1,
    Currency: "RUB",
    InvoiceId: paymentIntentId,
    AccountId: "acct-1",
    SubscriptionId: "sub-bound-1",
    Status: "Completed",
    DateTime: "2026-05-04 19:07:30"
  };
  const bindRawBody = Buffer.from(JSON.stringify(bindBody), "utf8");
  const bindHmac = createHmac("sha256", "cloudpayments-api-secret")
    .update(bindRawBody)
    .digest("base64");
  const bindResult = await service.handle({
    notificationType: "pay",
    body: bindBody,
    rawBody: bindRawBody,
    headers: {
      "x-content-hmac": bindHmac
    }
  });
  assert.deepEqual(bindResult, { status: "processed" });
  assert.equal(appliedBillingEvents.at(-1)?.eventCode, "auto_renew_enabled");
  assert.equal(appliedBillingEvents.at(-1)?.providerSubscriptionRef, "sub-bound-1");
  paymentIntent.metadata = {};
  subscriptionProviderSubscriptionRef = "sub-provider-1";

  const encodedCheckBody = {
    TransactionId: 123459,
    Amount: 99,
    Currency: "RUB",
    InvoiceId: paymentIntentId,
    DateTime: "2026-05-04 19:08:00"
  };
  const encodedCheckRawBody = Buffer.from(
    new URLSearchParams({
      TransactionId: "123459",
      Amount: "99",
      Currency: "RUB",
      InvoiceId: paymentIntentId,
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
  assert.deepEqual(paymentIntentFindManyCalls.at(-1)?.where, {
    OR: [
      { id: { in: [paymentIntentId] } },
      { providerPaymentRef: { in: [paymentIntentId, "123459"] } },
      { providerSessionRef: { in: [paymentIntentId, "123459"] } }
    ]
  });

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

  subscriptionStatus = "grace_period";
  const recurrentBody = {
    TransactionId: 123460,
    Amount: 99,
    Currency: "RUB",
    AccountId: "acct-1",
    SubscriptionId: "sub-provider-1",
    DateTime: "2026-05-04 19:09:00"
  };
  const recurrentRawBody = Buffer.from(JSON.stringify(recurrentBody), "utf8");
  const recurrentHmac = createHmac("sha256", "cloudpayments-api-secret")
    .update(recurrentRawBody)
    .digest("base64");
  const recurrentResult = await service.handle({
    notificationType: "recurrent",
    body: recurrentBody,
    rawBody: recurrentRawBody,
    headers: {
      "x-content-hmac": recurrentHmac
    }
  });
  assert.deepEqual(recurrentResult, { status: "processed" });
  assert.equal(appliedBillingEvents.at(-1)?.eventCode, "payment_recovered");
  assert.equal(appliedBillingEvents.at(-1)?.providerSubscriptionRef, "sub-provider-1");
  assert.equal(appliedBillingEvents.at(-1)?.workspaceId, "ws-1");

  subscriptionStatus = "active";
  subscriptionPlanCode = "pro";
  subscriptionMetadata = {
    pendingPlanChange: {
      targetPlanCode: "starter",
      targetPlanDisplayName: "Starter",
      effectiveAt: "2026-06-04T19:09:00.000Z",
      nextChargeAt: "2026-06-04T19:09:00.000Z",
      amountMinor: 4900,
      currency: "RUB",
      billingPeriod: "month",
      changeKind: "downgrade"
    }
  };
  const scheduledDowngradeBody = {
    TransactionId: 1234601,
    Amount: 49,
    Currency: "RUB",
    AccountId: "acct-1",
    SubscriptionId: "sub-provider-1",
    DateTime: "2026-06-04 19:09:00"
  };
  const scheduledDowngradeRawBody = Buffer.from(JSON.stringify(scheduledDowngradeBody), "utf8");
  const scheduledDowngradeHmac = createHmac("sha256", "cloudpayments-api-secret")
    .update(scheduledDowngradeRawBody)
    .digest("base64");
  const scheduledDowngradeResult = await service.handle({
    notificationType: "recurrent",
    body: scheduledDowngradeBody,
    rawBody: scheduledDowngradeRawBody,
    headers: {
      "x-content-hmac": scheduledDowngradeHmac
    }
  });
  assert.deepEqual(scheduledDowngradeResult, { status: "processed" });
  assert.equal(appliedBillingEvents.at(-1)?.eventCode, "renewal_succeeded");
  assert.equal(appliedBillingEvents.at(-1)?.paidPlanCode, "starter");

  const staleScheduledDowngradeBody = {
    TransactionId: 1234602,
    Amount: 99,
    Currency: "RUB",
    AccountId: "acct-1",
    SubscriptionId: "sub-provider-1",
    DateTime: "2026-07-04 19:09:00"
  };
  const staleScheduledDowngradeRawBody = Buffer.from(
    JSON.stringify(staleScheduledDowngradeBody),
    "utf8"
  );
  const staleScheduledDowngradeHmac = createHmac("sha256", "cloudpayments-api-secret")
    .update(staleScheduledDowngradeRawBody)
    .digest("base64");
  const staleScheduledDowngradeResult = await service.handle({
    notificationType: "recurrent",
    body: staleScheduledDowngradeBody,
    rawBody: staleScheduledDowngradeRawBody,
    headers: {
      "x-content-hmac": staleScheduledDowngradeHmac
    }
  });
  assert.deepEqual(staleScheduledDowngradeResult, { status: "processed" });
  assert.equal(appliedBillingEvents.at(-1)?.eventCode, "renewal_succeeded");
  assert.equal(appliedBillingEvents.at(-1)?.paidPlanCode, "pro");
  subscriptionMetadata = null;
  subscriptionPlanCode = "starter";

  subscriptionStatus = "active";
  const cancelBody = {
    TransactionId: 123461,
    Amount: 99,
    Currency: "RUB",
    AccountId: "acct-1",
    SubscriptionId: "sub-provider-1",
    DateTime: "2026-05-04 19:10:00"
  };
  const cancelRawBody = Buffer.from(JSON.stringify(cancelBody), "utf8");
  const cancelHmac = createHmac("sha256", "cloudpayments-api-secret")
    .update(cancelRawBody)
    .digest("base64");
  const cancelResult = await service.handle({
    notificationType: "cancel",
    body: cancelBody,
    rawBody: cancelRawBody,
    headers: {
      "x-content-hmac": cancelHmac
    }
  });
  assert.deepEqual(cancelResult, { status: "processed" });
  assert.equal(appliedBillingEvents.at(-1)?.eventCode, "subscription_cancel_scheduled");
  assert.equal(appliedBillingEvents.at(-1)?.providerSubscriptionRef, "sub-provider-1");

  allowAccountIdSubscriptionFallback = false;
  const staleRenewalBody = {
    TransactionId: 123462,
    Amount: 99,
    Currency: "RUB",
    AccountId: "acct-1",
    SubscriptionId: "sub-provider-stale",
    DateTime: "2026-05-04 19:11:00"
  };
  const staleRenewalRawBody = Buffer.from(JSON.stringify(staleRenewalBody), "utf8");
  const staleRenewalHmac = createHmac("sha256", "cloudpayments-api-secret")
    .update(staleRenewalRawBody)
    .digest("base64");
  const staleRenewalEventsBefore = appliedBillingEvents.length;
  const staleRenewalResult = await service.handle({
    notificationType: "recurrent",
    body: staleRenewalBody,
    rawBody: staleRenewalRawBody,
    headers: {
      "x-content-hmac": staleRenewalHmac
    }
  });
  assert.deepEqual(staleRenewalResult, { status: "ignored" });
  assert.equal(appliedBillingEvents.length, staleRenewalEventsBefore);
  assert.deepEqual(subscriptionFindFirstCalls.at(-1)?.where, {
    providerSubscriptionRef: "sub-provider-stale"
  });

  duplicateIntentMatches = true;
  const ambiguousBody = {
    TransactionId: 123463,
    Amount: 99,
    Currency: "RUB",
    ExternalId: "intent-duplicate",
    DateTime: "2026-05-04 19:12:00"
  };
  const ambiguousRawBody = Buffer.from(JSON.stringify(ambiguousBody), "utf8");
  const ambiguousHmac = createHmac("sha256", "cloudpayments-api-secret")
    .update(ambiguousRawBody)
    .digest("base64");
  await assert.rejects(
    service.handle({
      notificationType: "pay",
      body: ambiguousBody,
      rawBody: ambiguousRawBody,
      headers: {
        "x-content-hmac": ambiguousHmac
      }
    }),
    /matched multiple PersAI payment intents/
  );
}

void run();
