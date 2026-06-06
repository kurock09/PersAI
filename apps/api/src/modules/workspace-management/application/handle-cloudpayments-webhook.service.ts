import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  ApplyWorkspaceSubscriptionBillingEventService,
  type WorkspaceSubscriptionBillingEventCode
} from "./apply-workspace-subscription-billing-event.service";
import { CLOUDPAYMENTS_API_SECRET_STORAGE_KEY } from "./billing-provider-credential-settings";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { ManageMediaPackagePurchaseService } from "./manage-media-package-purchase.service";

export type CloudpaymentsNotificationType =
  | "check"
  | "pay"
  | "fail"
  | "confirm"
  | "refund"
  | "cancel"
  | "recurrent";

type CloudpaymentsWebhookHeaders = Record<string, string | string[] | undefined>;

type CloudpaymentsWebhookInput = {
  notificationType: CloudpaymentsNotificationType;
  body: unknown;
  rawBody: Buffer | null;
  headers: CloudpaymentsWebhookHeaders;
};

type CloudpaymentsPayload = {
  transactionId: string | null;
  originalTransactionId: string | null;
  invoiceId: string | null;
  externalId: string | null;
  accountId: string | null;
  subscriptionId: string | null;
  amountMinor: number | null;
  currency: string | null;
  status: string | null;
  reason: string | null;
  reasonCode: string | null;
  paymentMethod: string | null;
  cardType: string | null;
  cardLastFour: string | null;
  eventTimeIso: string;
  data: Record<string, unknown> | null;
  raw: Record<string, unknown>;
};

type PaymentIntentRecord = {
  id: string;
  workspaceId: string;
  userId: string | null;
  targetPlanCode: string;
  action: "new_purchase" | "upgrade" | "renewal" | "manual_admin";
  status:
    | "created"
    | "checkout_ready"
    | "pending_confirmation"
    | "succeeded"
    | "failed"
    | "canceled"
    | "reversed"
    | "expired";
  paymentMethodClass: "card" | "sbp_qr";
  amountMinor: number;
  currency: string;
  billingPeriod: "month" | "year";
  billingProvider: string | null;
  providerCustomerRef: string | null;
  providerSessionRef: string | null;
  providerPaymentRef: string | null;
  metadata: Prisma.JsonValue;
};

type SubscriptionRecord = {
  id: string;
  workspaceId: string;
  planCode: string;
  status:
    | "trialing"
    | "active"
    | "grace_period"
    | "past_due"
    | "paused"
    | "canceled"
    | "expired"
    | "expired_fallback";
  providerCustomerRef: string | null;
  providerSubscriptionRef: string | null;
  metadata: Prisma.JsonValue | null;
};

type ResolvedSubscription = {
  subscription: SubscriptionRecord | null;
  blockedAccountFallback: boolean;
};

const paymentIntentSelect = {
  id: true,
  workspaceId: true,
  userId: true,
  targetPlanCode: true,
  action: true,
  status: true,
  paymentMethodClass: true,
  amountMinor: true,
  currency: true,
  billingPeriod: true,
  billingProvider: true,
  providerCustomerRef: true,
  providerSessionRef: true,
  providerPaymentRef: true,
  metadata: true
} satisfies Prisma.WorkspacePaymentIntentSelect;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function asMinorAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim().replace(",", "."));
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
  }
  return null;
}

function readReceiptUrlCandidate(value: unknown): string | null {
  if (!isObject(value)) {
    return null;
  }
  const directCandidates = [
    value.ReceiptUrl,
    value.receiptUrl,
    value.receipt_url,
    value.ReceiptLink,
    value.receiptLink,
    value.receipt_link
  ];
  for (const candidate of directCandidates) {
    const parsed = asTrimmedString(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  const nestedReceipt = value.Receipt ?? value.receipt ?? null;
  if (isObject(nestedReceipt)) {
    const nestedUrl = asTrimmedString(
      nestedReceipt.Url ?? nestedReceipt.url ?? nestedReceipt.Link ?? nestedReceipt.link
    );
    if (nestedUrl !== null) {
      return nestedUrl;
    }
  }
  return null;
}

function parseCloudpaymentsDate(value: unknown): string | null {
  const raw = asTrimmedString(value);
  if (raw === null) {
    return null;
  }
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const iso = normalized.endsWith("Z") ? normalized : `${normalized}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (isObject(value)) {
    return value;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function addBillingPeriod(startIso: string, billingPeriod: "month" | "year"): string {
  const next = new Date(startIso);
  if (billingPeriod === "year") {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  } else {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next.toISOString();
}

function mergeMetadata(
  current: Prisma.JsonValue,
  patch: Record<string, unknown>
): Prisma.InputJsonValue {
  const base = isObject(current) ? current : {};
  return {
    ...base,
    ...patch
  } as Prisma.InputJsonValue;
}

function readPaymentIntentPurpose(value: Prisma.JsonValue): string {
  const row = isObject(value) ? value : null;
  return asTrimmedString(row?.purpose) ?? "plan_purchase";
}

function readPendingPlanChange(
  value: Prisma.JsonValue | null
): { targetPlanCode: string; changeKind: "free" | "downgrade" } | null {
  const row = isObject(value) ? value : null;
  const pending = isObject(row?.pendingPlanChange) ? row.pendingPlanChange : null;
  const targetPlanCode = asTrimmedString(pending?.targetPlanCode);
  const changeKind =
    pending?.changeKind === "free" || pending?.changeKind === "downgrade"
      ? pending.changeKind
      : null;
  if (targetPlanCode === null || changeKind === null) {
    return null;
  }
  return {
    targetPlanCode,
    changeKind
  };
}

function scheduledDowngradeMatchesProviderCharge(
  pendingPlanChange: { changeKind: "free" | "downgrade"; targetPlanCode: string } | null,
  payload: CloudpaymentsPayload,
  subscription: SubscriptionRecord | null
): boolean {
  if (pendingPlanChange?.changeKind !== "downgrade" || subscription === null) {
    return false;
  }
  const metadata = isObject(subscription.metadata) ? subscription.metadata : null;
  const pending = isObject(metadata?.pendingPlanChange) ? metadata.pendingPlanChange : null;
  const amountMinor =
    typeof pending?.amountMinor === "number" && Number.isFinite(pending.amountMinor)
      ? pending.amountMinor
      : null;
  const currency = asTrimmedString(pending?.currency);
  if (amountMinor === null || currency === null) {
    return false;
  }
  return (
    payload.amountMinor === amountMinor && (payload.currency?.toUpperCase() ?? null) === currency
  );
}

@Injectable()
export class HandleCloudpaymentsWebhookService {
  private readonly logger = new Logger(HandleCloudpaymentsWebhookService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly applyWorkspaceSubscriptionBillingEventService: ApplyWorkspaceSubscriptionBillingEventService,
    private readonly manageMediaPackagePurchaseService: ManageMediaPackagePurchaseService
  ) {}

  async handle(input: CloudpaymentsWebhookInput): Promise<{
    status: "processed" | "ignored" | "duplicate";
  }> {
    const apiSecret =
      await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        CLOUDPAYMENTS_API_SECRET_STORAGE_KEY
      );
    if (apiSecret === null) {
      throw new BadRequestException("CloudPayments API Secret is not configured.");
    }
    if (input.rawBody === null) {
      throw new BadRequestException("CloudPayments webhook raw body is unavailable.");
    }

    this.assertValidSignature(apiSecret, input.rawBody, input.headers);
    const payload = this.parsePayload(input.body);

    if (input.notificationType === "check") {
      await this.handleCheck(payload);
      return { status: "processed" };
    }

    const paymentIntent = await this.resolvePaymentIntent(payload);
    const subscriptionResolution = await this.resolveSubscription(payload, paymentIntent);
    const subscription = subscriptionResolution.subscription;

    if (paymentIntent === null && subscription === null) {
      if (subscriptionResolution.blockedAccountFallback) {
        this.logger.warn(
          "Ignoring CloudPayments webhook because SubscriptionId did not match any current PersAI subscription."
        );
        return { status: "ignored" };
      }
      throw new NotFoundException("CloudPayments webhook does not match a PersAI billing subject.");
    }

    if (paymentIntent !== null) {
      await this.updatePaymentIntent(paymentIntent, input.notificationType, payload);
    }

    // Media package purchase fulfillment — does NOT touch subscription lifecycle
    if (
      paymentIntent !== null &&
      readPaymentIntentPurpose(paymentIntent.metadata) === "media_package_purchase" &&
      (input.notificationType === "pay" || input.notificationType === "confirm") &&
      payload.status !== "Authorized"
    ) {
      const alreadyFulfilled = await this.prisma.workspaceMediaPackageGrant.count({
        where: { paymentIntentId: paymentIntent.id }
      });
      if (alreadyFulfilled > 0) {
        return { status: "duplicate" };
      }
      if (paymentIntent.userId === null) {
        throw new Error(
          `Cannot fulfill media package intent "${paymentIntent.id}": paymentIntent.userId is null.`
        );
      }
      await this.manageMediaPackagePurchaseService.fulfillPackagePaymentIntent(
        paymentIntent.id,
        paymentIntent.workspaceId,
        paymentIntent.userId
      );
      return { status: "processed" };
    }

    // ADR-108 Slice 4 — media package refund handler.
    // For video_generate items the VC wallet is debited. Non-video items are NOT
    // touched (image/audio refund-not-reversing-grant bug is a known residual).
    // The payment_reversed subscription lifecycle event is NOT suppressed — it
    // continues to flow through deriveLifecycleEvent as before.
    if (
      paymentIntent !== null &&
      readPaymentIntentPurpose(paymentIntent.metadata) === "media_package_purchase" &&
      input.notificationType === "refund"
    ) {
      await this.manageMediaPackagePurchaseService.reversePackagePaymentIntent({
        paymentIntentId: paymentIntent.id,
        workspaceId: paymentIntent.workspaceId
      });
    }

    const lifecycleEvent = await this.deriveLifecycleEvent(
      input.notificationType,
      payload,
      input.rawBody,
      paymentIntent,
      subscription
    );
    if (lifecycleEvent === null) {
      return { status: "ignored" };
    }

    const result = await this.applyWorkspaceSubscriptionBillingEventService.apply(lifecycleEvent);
    if (result.status === "applied") {
      await this.syncSubscriptionBillingInstrumentsAfterLifecycleApply({
        workspaceId: lifecycleEvent.workspaceId,
        notificationType: input.notificationType,
        paymentIntent,
        payload,
        eventCode: lifecycleEvent.eventCode
      });
    }
    return {
      status:
        result.status === "applied"
          ? "processed"
          : result.status === "duplicate"
            ? "duplicate"
            : "ignored"
    };
  }

  private assertValidSignature(
    apiSecret: string,
    rawBody: Buffer,
    headers: CloudpaymentsWebhookHeaders
  ): void {
    const provided =
      this.resolveHeader(headers, "content-hmac") ?? this.resolveHeader(headers, "x-content-hmac");
    if (provided === null) {
      throw new ForbiddenException("CloudPayments webhook signature is missing.");
    }
    const expected = createHmac("sha256", apiSecret).update(rawBody).digest("base64");
    const providedBuffer = Buffer.from(provided, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      throw new ForbiddenException("CloudPayments webhook signature verification failed.");
    }
  }

  private resolveHeader(headers: CloudpaymentsWebhookHeaders, key: string): string | null {
    const value = headers[key];
    if (Array.isArray(value)) {
      return value[0]?.trim() ?? null;
    }
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private parsePayload(body: unknown): CloudpaymentsPayload {
    if (!isObject(body)) {
      throw new BadRequestException("CloudPayments webhook body must be an object.");
    }

    return {
      transactionId: asTrimmedString(body.TransactionId),
      originalTransactionId: asTrimmedString(body.PaymentTransactionId),
      invoiceId: asTrimmedString(body.InvoiceId),
      externalId: asTrimmedString(body.ExternalId ?? body.externalId),
      accountId: asTrimmedString(body.AccountId),
      subscriptionId: asTrimmedString(body.SubscriptionId ?? body.Id),
      amountMinor: asMinorAmount(body.Amount ?? body.PaymentAmount),
      currency: asTrimmedString(body.Currency ?? body.PaymentCurrency)?.toUpperCase() ?? null,
      status: asTrimmedString(body.Status),
      reason: asTrimmedString(body.Reason),
      reasonCode: asTrimmedString(body.ReasonCode),
      paymentMethod: asTrimmedString(body.PaymentMethod),
      cardType: asTrimmedString(body.CardType),
      cardLastFour: asTrimmedString(body.CardLastFour),
      eventTimeIso:
        parseCloudpaymentsDate(body.DateTime ?? body.LastTransactionDate ?? body.StartDate) ??
        new Date().toISOString(),
      data: parseJsonObject(body.Data ?? body.JsonData ?? body.Metadata ?? body.metadata),
      raw: body
    };
  }

  private async handleCheck(payload: CloudpaymentsPayload): Promise<void> {
    const paymentIntent = await this.resolvePaymentIntent(payload);
    if (paymentIntent === null) {
      const subscriptionResolution = await this.resolveSubscription(payload, null);
      if (subscriptionResolution.subscription !== null) {
        return;
      }
      if (subscriptionResolution.blockedAccountFallback) {
        this.logger.warn(
          "Ignoring CloudPayments Check webhook because SubscriptionId did not match any current PersAI subscription."
        );
        return;
      }
      throw new NotFoundException("CloudPayments Check webhook billing subject was not found.");
    }
    if (payload.amountMinor !== null && payload.amountMinor !== paymentIntent.amountMinor) {
      throw new BadRequestException(
        "CloudPayments Check amount does not match the payment intent."
      );
    }
    if (payload.currency !== null && payload.currency !== paymentIntent.currency.toUpperCase()) {
      throw new BadRequestException(
        "CloudPayments Check currency does not match the payment intent."
      );
    }
    if (
      paymentIntent.status === "failed" ||
      paymentIntent.status === "canceled" ||
      paymentIntent.status === "reversed" ||
      paymentIntent.status === "expired"
    ) {
      throw new BadRequestException(
        "CloudPayments Check cannot continue for a terminal payment intent."
      );
    }
  }

  private async resolvePaymentIntent(
    payload: CloudpaymentsPayload
  ): Promise<PaymentIntentRecord | null> {
    const paymentIntentIdFromData = asTrimmedString(payload.data?.paymentIntentId);
    const candidates = [
      paymentIntentIdFromData,
      payload.externalId,
      payload.invoiceId,
      payload.transactionId,
      payload.originalTransactionId
    ].filter((value): value is string => value !== null);
    if (candidates.length === 0) {
      return null;
    }
    const uniqueCandidates = [...new Set(candidates)];
    const uuidCandidates = uniqueCandidates.filter(isUuidLike);
    const refCandidates = uniqueCandidates;
    const orClauses: Prisma.WorkspacePaymentIntentWhereInput[] = [
      { providerPaymentRef: { in: refCandidates } },
      { providerSessionRef: { in: refCandidates } }
    ];
    if (uuidCandidates.length > 0) {
      orClauses.unshift({ id: { in: uuidCandidates } });
    }
    const matches = (await this.prisma.workspacePaymentIntent.findMany({
      where: {
        OR: orClauses
      },
      select: paymentIntentSelect
    })) as PaymentIntentRecord[];
    return this.selectPaymentIntentMatch(matches, {
      paymentIntentIdFromData,
      externalId: payload.externalId,
      invoiceId: payload.invoiceId,
      transactionId: payload.transactionId,
      originalTransactionId: payload.originalTransactionId
    });
  }

  private async resolveSubscription(
    payload: CloudpaymentsPayload,
    paymentIntent: PaymentIntentRecord | null
  ): Promise<ResolvedSubscription> {
    if (paymentIntent !== null) {
      return {
        subscription: (await this.prisma.workspaceSubscription.findUnique({
          where: { workspaceId: paymentIntent.workspaceId },
          select: {
            id: true,
            workspaceId: true,
            planCode: true,
            status: true,
            providerCustomerRef: true,
            providerSubscriptionRef: true,
            metadata: true
          }
        })) as SubscriptionRecord | null,
        blockedAccountFallback: false
      };
    }
    if (payload.subscriptionId !== null) {
      const bySubscriptionRef = await this.prisma.workspaceSubscription.findFirst({
        where: { providerSubscriptionRef: payload.subscriptionId },
        select: {
          id: true,
          workspaceId: true,
          planCode: true,
          status: true,
          providerCustomerRef: true,
          providerSubscriptionRef: true,
          metadata: true
        }
      });
      if (bySubscriptionRef !== null) {
        return {
          subscription: bySubscriptionRef as SubscriptionRecord,
          blockedAccountFallback: false
        };
      }
      return {
        subscription: null,
        blockedAccountFallback: payload.accountId !== null
      };
    }
    if (payload.accountId !== null) {
      return {
        subscription: (await this.prisma.workspaceSubscription.findFirst({
          where: { providerCustomerRef: payload.accountId },
          select: {
            id: true,
            workspaceId: true,
            planCode: true,
            status: true,
            providerCustomerRef: true,
            providerSubscriptionRef: true,
            metadata: true
          }
        })) as SubscriptionRecord | null,
        blockedAccountFallback: false
      };
    }
    return {
      subscription: null,
      blockedAccountFallback: false
    };
  }

  private async updatePaymentIntent(
    paymentIntent: PaymentIntentRecord,
    notificationType: CloudpaymentsNotificationType,
    payload: CloudpaymentsPayload
  ): Promise<void> {
    const providerReceiptUrl =
      readReceiptUrlCandidate(payload.raw) ?? readReceiptUrlCandidate(payload.data);
    const nextStatus = this.resolveNextPaymentIntentStatus(
      paymentIntent,
      notificationType,
      payload
    );
    if (nextStatus === null) {
      return;
    }
    const inferredProviderMethodClass = this.inferPaymentMethodClassFromProviderPayload(payload);

    await this.prisma.workspacePaymentIntent.update({
      where: { id: paymentIntent.id },
      data: {
        status: nextStatus,
        billingProvider: "cloudpayments",
        providerCustomerRef: paymentIntent.providerCustomerRef,
        providerPaymentRef:
          notificationType === "refund"
            ? (paymentIntent.providerPaymentRef ??
              payload.originalTransactionId ??
              payload.transactionId)
            : (paymentIntent.providerPaymentRef ?? payload.transactionId),
        ...(inferredProviderMethodClass !== null
          ? { paymentMethodClass: inferredProviderMethodClass }
          : {}),
        lastErrorCode: notificationType === "fail" ? payload.reasonCode : null,
        lastErrorMessage: notificationType === "fail" ? payload.reason : null,
        metadata: mergeMetadata(paymentIntent.metadata, {
          cloudpayments: {
            lastNotificationType: notificationType,
            lastTransactionId: payload.transactionId,
            lastOriginalTransactionId: payload.originalTransactionId,
            lastStatus: payload.status,
            lastReason: payload.reason,
            lastReasonCode: payload.reasonCode,
            lastPaymentMethod: payload.paymentMethod,
            lastReceiptUrl: providerReceiptUrl,
            lastSubscriptionId: payload.subscriptionId,
            lastEventTimeIso: payload.eventTimeIso
          }
        })
      }
    });
  }

  private resolveNextPaymentIntentStatus(
    paymentIntent: PaymentIntentRecord,
    notificationType: CloudpaymentsNotificationType,
    payload: CloudpaymentsPayload
  ): PaymentIntentRecord["status"] | null {
    if (notificationType === "refund") {
      return "reversed";
    }
    if (notificationType === "cancel") {
      return paymentIntent.status === "succeeded" ? null : "canceled";
    }
    if (notificationType === "fail") {
      return "failed";
    }
    if (notificationType === "confirm") {
      return "succeeded";
    }
    if (notificationType === "pay") {
      return payload.status === "Authorized" ? "pending_confirmation" : "succeeded";
    }
    return null;
  }

  private async deriveLifecycleEvent(
    notificationType: CloudpaymentsNotificationType,
    payload: CloudpaymentsPayload,
    rawBody: Buffer,
    paymentIntent: PaymentIntentRecord | null,
    subscription: SubscriptionRecord | null
  ): Promise<Parameters<ApplyWorkspaceSubscriptionBillingEventService["apply"]>[0] | null> {
    if (notificationType === "cancel") {
      if (subscription === null) {
        this.logger.log("Ignoring CloudPayments cancel webhook without a matched subscription.");
        return null;
      }
      return {
        workspaceId: subscription.workspaceId,
        userId: paymentIntent?.userId ?? null,
        source: "provider",
        eventCode: "subscription_cancel_scheduled",
        eventRef: this.buildEventRef(notificationType, rawBody),
        paymentIntentRef: paymentIntent?.id ?? null,
        billingProvider: "cloudpayments",
        providerCustomerRef: subscription.providerCustomerRef ?? payload.accountId,
        providerSubscriptionRef: payload.subscriptionId ?? subscription.providerSubscriptionRef,
        paidPlanCode: subscription.planCode,
        metadata: this.buildLifecycleMetadata(notificationType, payload)
      };
    }

    if (notificationType === "fail") {
      const renewalTarget =
        paymentIntent?.action === "renewal" || (paymentIntent === null && subscription !== null);
      if (!renewalTarget || subscription === null) {
        return null;
      }
      const scheduledPlanChange = readPendingPlanChange(subscription.metadata);
      const scheduledPaidPlanCode = scheduledDowngradeMatchesProviderCharge(
        scheduledPlanChange,
        payload,
        subscription
      )
        ? (scheduledPlanChange?.targetPlanCode ?? null)
        : null;
      return {
        workspaceId: subscription.workspaceId,
        userId: paymentIntent?.userId ?? null,
        source: "provider",
        eventCode: "renewal_failed",
        eventRef: this.buildEventRef(notificationType, rawBody),
        paymentIntentRef: paymentIntent?.id ?? null,
        billingProvider: "cloudpayments",
        providerCustomerRef: subscription.providerCustomerRef,
        providerSubscriptionRef: payload.subscriptionId ?? subscription.providerSubscriptionRef,
        paidPlanCode: subscription.planCode,
        metadata: {
          ...this.buildLifecycleMetadata(notificationType, payload),
          ...(scheduledPaidPlanCode !== null ? { scheduledPaidPlanCode } : {})
        }
      };
    }

    if (notificationType === "refund") {
      const workspaceId = paymentIntent?.workspaceId ?? subscription?.workspaceId ?? null;
      if (workspaceId === null) {
        return null;
      }
      return {
        workspaceId,
        userId: paymentIntent?.userId ?? null,
        source: "provider",
        eventCode: "payment_reversed",
        eventRef: this.buildEventRef(notificationType, rawBody),
        paymentIntentRef: paymentIntent?.id ?? null,
        billingProvider: "cloudpayments",
        providerCustomerRef: subscription?.providerCustomerRef ?? null,
        providerSubscriptionRef:
          payload.subscriptionId ?? subscription?.providerSubscriptionRef ?? null,
        paidPlanCode: paymentIntent?.targetPlanCode ?? subscription?.planCode ?? null,
        metadata: this.buildLifecycleMetadata(notificationType, payload)
      };
    }

    if (notificationType === "pay" && payload.status === "Authorized") {
      return null;
    }

    if (
      notificationType !== "pay" &&
      notificationType !== "confirm" &&
      notificationType !== "recurrent"
    ) {
      return null;
    }

    const workspaceId = paymentIntent?.workspaceId ?? subscription?.workspaceId ?? null;
    if (workspaceId === null) {
      return null;
    }

    const paymentIntentPurpose =
      paymentIntent === null ? "plan_purchase" : readPaymentIntentPurpose(paymentIntent.metadata);
    if (paymentIntentPurpose === "autopay_enable_bind") {
      if (subscription === null) {
        return null;
      }
      return {
        workspaceId,
        userId: paymentIntent?.userId ?? null,
        source: "provider",
        eventCode: "auto_renew_enabled",
        eventRef: this.buildEventRef(notificationType, rawBody),
        paymentIntentRef: paymentIntent?.id ?? null,
        billingProvider: "cloudpayments",
        providerCustomerRef:
          payload.accountId ??
          subscription.providerCustomerRef ??
          paymentIntent?.providerCustomerRef ??
          null,
        providerSubscriptionRef:
          payload.subscriptionId ?? subscription.providerSubscriptionRef ?? null,
        paidPlanCode: subscription.planCode,
        metadata: this.buildLifecycleMetadata(notificationType, payload)
      };
    }

    const currentStatus = subscription?.status ?? null;
    const eventCode =
      notificationType === "recurrent" ||
      paymentIntent?.action === "renewal" ||
      (paymentIntent === null && subscription !== null)
        ? currentStatus === "grace_period" || currentStatus === "past_due"
          ? "payment_recovered"
          : "renewal_succeeded"
        : "payment_activated";

    const scheduledPlanChange = readPendingPlanChange(subscription?.metadata ?? null);
    const scheduledDowngradeApplied = scheduledDowngradeMatchesProviderCharge(
      scheduledPlanChange,
      payload,
      subscription
    );
    const paidPlanCode =
      paymentIntent?.targetPlanCode ??
      (scheduledDowngradeApplied
        ? (scheduledPlanChange?.targetPlanCode ?? subscription?.planCode ?? null)
        : (subscription?.planCode ?? null));
    const billingPeriod = await this.resolveBillingPeriod(paymentIntent, subscription);
    const currentPeriodStartedAt = payload.eventTimeIso;
    const currentPeriodEndsAt = addBillingPeriod(currentPeriodStartedAt, billingPeriod);
    const providerSubscriptionRef = await this.resolveProviderSubscriptionRef({
      payload,
      paymentIntent,
      subscription,
      paymentIntentPurpose
    });

    return {
      workspaceId,
      userId: paymentIntent?.userId ?? null,
      source: "provider",
      eventCode,
      eventRef: this.buildEventRef(notificationType, rawBody),
      paymentIntentRef: paymentIntent?.id ?? null,
      billingProvider: "cloudpayments",
      providerCustomerRef:
        subscription?.providerCustomerRef ??
        payload.accountId ??
        paymentIntent?.providerCustomerRef ??
        null,
      providerSubscriptionRef,
      paidPlanCode,
      currentPeriodStartedAt,
      currentPeriodEndsAt,
      metadata: {
        ...this.buildLifecycleMetadata(notificationType, payload),
        ...(paymentIntentPurpose === "managed_recurring_upgrade"
          ? {
              managedRecurringSubscriptionUpdate: {
                providerSubscriptionRef: this.requireProviderSubscriptionRef(
                  providerSubscriptionRef,
                  "Managed recurring upgrade webhook is missing the provider subscription reference."
                ),
                amountMinor: paymentIntent?.amountMinor ?? null,
                currency: paymentIntent?.currency ?? null,
                startDate: currentPeriodEndsAt,
                interval: "Month",
                period: paymentIntent?.billingPeriod === "year" ? 12 : 1,
                maxPeriods: null
              }
            }
          : {})
      }
    };
  }

  private async resolveProviderSubscriptionRef(input: {
    payload: CloudpaymentsPayload;
    paymentIntent: PaymentIntentRecord | null;
    subscription: SubscriptionRecord | null;
    paymentIntentPurpose: string;
  }): Promise<string | null> {
    if (input.paymentIntentPurpose !== "managed_recurring_upgrade") {
      return input.payload.subscriptionId ?? input.subscription?.providerSubscriptionRef ?? null;
    }
    return (
      input.payload.subscriptionId ??
      asTrimmedString(
        isObject(input.paymentIntent?.metadata)
          ? input.paymentIntent.metadata.existingProviderSubscriptionRef
          : null
      ) ??
      input.subscription?.providerSubscriptionRef ??
      null
    );
  }

  private requireProviderSubscriptionRef(value: string | null, message: string): string {
    if (value === null || value.trim().length === 0) {
      throw new BadRequestException(message);
    }
    return value;
  }

  private async resolveBillingPeriod(
    paymentIntent: PaymentIntentRecord | null,
    subscription: SubscriptionRecord | null
  ): Promise<"month" | "year"> {
    if (paymentIntent !== null) {
      return paymentIntent.billingPeriod;
    }
    if (subscription === null) {
      throw new BadRequestException("CloudPayments webhook billing period could not be resolved.");
    }
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: subscription.planCode },
      select: { billingProviderHints: true }
    });
    const hints =
      plan !== null && isObject(plan.billingProviderHints) ? plan.billingProviderHints : null;
    const presentation = hints !== null && isObject(hints.presentation) ? hints.presentation : null;
    const price = presentation !== null && isObject(presentation.price) ? presentation.price : null;
    if (price?.billingPeriod === "month" || price?.billingPeriod === "year") {
      return price.billingPeriod;
    }
    throw new BadRequestException("Billing period could not be derived from the active paid plan.");
  }

  private buildEventRef(notificationType: CloudpaymentsNotificationType, rawBody: Buffer): string {
    const digest = createHash("sha256").update(rawBody).digest("hex");
    return `cloudpayments:${notificationType}:${digest}`;
  }

  private selectPaymentIntentMatch(
    matches: PaymentIntentRecord[],
    candidates: {
      paymentIntentIdFromData: string | null;
      externalId: string | null;
      invoiceId: string | null;
      transactionId: string | null;
      originalTransactionId: string | null;
    }
  ): PaymentIntentRecord | null {
    if (matches.length === 0) {
      return null;
    }
    const ranked = matches
      .map((match) => ({
        match,
        rank: this.rankPaymentIntentMatch(match, candidates)
      }))
      .filter(
        (
          entry
        ): entry is {
          match: PaymentIntentRecord;
          rank: [number, number];
        } => entry.rank !== null
      )
      .sort((left, right) =>
        left.rank[0] !== right.rank[0] ? left.rank[0] - right.rank[0] : left.rank[1] - right.rank[1]
      );
    if (ranked.length === 0) {
      return null;
    }
    const best = ranked[0];
    if (best === undefined) {
      return null;
    }
    const ambiguous = ranked.some(
      (entry) =>
        entry.match.id !== best.match.id &&
        entry.rank[0] === best.rank[0] &&
        entry.rank[1] === best.rank[1]
    );
    if (ambiguous) {
      throw new BadRequestException(
        "CloudPayments webhook matched multiple PersAI payment intents."
      );
    }
    return best.match;
  }

  private rankPaymentIntentMatch(
    paymentIntent: PaymentIntentRecord,
    candidates: {
      paymentIntentIdFromData: string | null;
      externalId: string | null;
      invoiceId: string | null;
      transactionId: string | null;
      originalTransactionId: string | null;
    }
  ): [number, number] | null {
    const byId = [candidates.paymentIntentIdFromData].filter(
      (value): value is string => value !== null
    );
    const bySessionRef = [candidates.externalId, candidates.invoiceId].filter(
      (value): value is string => value !== null
    );
    const byPaymentRef = [candidates.transactionId, candidates.originalTransactionId].filter(
      (value): value is string => value !== null
    );
    const idIndex = byId.findIndex((candidate) => paymentIntent.id === candidate);
    if (idIndex >= 0) {
      return [0, idIndex];
    }
    const sessionIndex = bySessionRef.findIndex(
      (candidate) => paymentIntent.providerSessionRef === candidate
    );
    if (sessionIndex >= 0) {
      return [1, sessionIndex];
    }
    const paymentIndex = byPaymentRef.findIndex(
      (candidate) => paymentIntent.providerPaymentRef === candidate
    );
    if (paymentIndex >= 0) {
      return [2, paymentIndex];
    }
    return null;
  }

  private inferPaymentMethodClassFromProviderPayload(
    payload: CloudpaymentsPayload
  ): "card" | "sbp_qr" | null {
    const pm = (payload.paymentMethod ?? "").trim().toLowerCase();
    if (pm.includes("sbp") || pm.includes("fastpayment") || pm === "fps" || pm.includes("сбп")) {
      return "sbp_qr";
    }
    if (
      pm.length > 0 ||
      (payload.cardType ?? "").trim().length > 0 ||
      (payload.cardLastFour ?? "").trim().length > 0
    ) {
      return "card";
    }
    return null;
  }

  private async syncSubscriptionBillingInstrumentsAfterLifecycleApply(input: {
    workspaceId: string;
    notificationType: CloudpaymentsNotificationType;
    paymentIntent: PaymentIntentRecord | null;
    payload: CloudpaymentsPayload;
    eventCode: WorkspaceSubscriptionBillingEventCode;
  }): Promise<void> {
    try {
      const sub = await this.prisma.workspaceSubscription.findUnique({
        where: { workspaceId: input.workspaceId },
        select: {
          billingProvider: true,
          providerSubscriptionRef: true,
          status: true,
          cancelAtPeriodEnd: true
        }
      });
      if (sub === null) {
        return;
      }

      const isManagedRecurring =
        sub.billingProvider === "cloudpayments" &&
        sub.providerSubscriptionRef !== null &&
        ["active", "grace_period", "past_due"].includes(sub.status);

      const autoRenewExpected = isManagedRecurring && !sub.cancelAtPeriodEnd;

      const data: Prisma.WorkspaceSubscriptionUpdateInput = {};
      const inferredProviderMethodClass = this.inferPaymentMethodClassFromProviderPayload(
        input.payload
      );

      if (input.paymentIntent !== null) {
        const appliesToLastPayment =
          input.eventCode === "payment_activated" ||
          input.eventCode === "renewal_succeeded" ||
          input.eventCode === "payment_recovered" ||
          input.eventCode === "auto_renew_enabled" ||
          input.eventCode === "subscription_resumed";
        if (appliesToLastPayment) {
          data.lastPaymentMethodClass =
            inferredProviderMethodClass ?? input.paymentIntent.paymentMethodClass;
        }
      } else if (
        inferredProviderMethodClass !== null &&
        (input.eventCode === "renewal_succeeded" || input.eventCode === "payment_recovered")
      ) {
        data.lastPaymentMethodClass = inferredProviderMethodClass;
      }

      if (autoRenewExpected) {
        if (input.notificationType === "recurrent") {
          if (inferredProviderMethodClass !== null) {
            data.autoRenewMethodClass = inferredProviderMethodClass;
          }
        } else if (input.paymentIntent !== null) {
          const purpose = readPaymentIntentPurpose(input.paymentIntent.metadata);
          if (
            purpose === "managed_recurring_upgrade" &&
            input.paymentIntent.paymentMethodClass === "sbp_qr"
          ) {
            data.recurringMigrationUpdatedAt = new Date();
            data.recurringMigrationTargetMethodClass = "sbp_qr";
            if (input.payload.subscriptionId !== null && inferredProviderMethodClass === "sbp_qr") {
              data.autoRenewMethodClass = "sbp_qr";
              data.recurringMigrationStatus = "succeeded";
              data.recurringMigrationFailureReason = null;
            } else {
              data.recurringMigrationStatus = "failed";
              data.recurringMigrationFailureReason = "provider_sbp_recurring_not_confirmed";
            }
          } else if (
            input.eventCode === "auto_renew_enabled" ||
            input.paymentIntent.paymentMethodClass === "card"
          ) {
            data.autoRenewMethodClass = "card";
          }
        } else if (
          input.eventCode === "renewal_succeeded" ||
          input.eventCode === "payment_recovered"
        ) {
          if (inferredProviderMethodClass !== null) {
            data.autoRenewMethodClass = inferredProviderMethodClass;
          }
        }
      }

      if (Object.keys(data).length === 0) {
        return;
      }

      await this.prisma.workspaceSubscription.update({
        where: { workspaceId: input.workspaceId },
        data
      });
    } catch (error) {
      this.logger.warn({
        event: "adr092_subscription_billing_instrument_sync_failed",
        workspaceId: input.workspaceId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private buildLifecycleMetadata(
    notificationType: CloudpaymentsNotificationType,
    payload: CloudpaymentsPayload
  ): Record<string, unknown> {
    const providerReceiptUrl =
      readReceiptUrlCandidate(payload.raw) ?? readReceiptUrlCandidate(payload.data);
    return {
      providerEventType: notificationType,
      providerTransactionId: payload.transactionId,
      providerOriginalTransactionId: payload.originalTransactionId,
      providerInvoiceId: payload.invoiceId,
      providerSubscriptionId: payload.subscriptionId,
      providerAccountId: payload.accountId,
      providerPaymentStatus: payload.status,
      providerPaymentMethod: payload.paymentMethod,
      providerCardType: payload.cardType,
      providerCardLastFour: payload.cardLastFour,
      providerReason: payload.reason,
      providerReasonCode: payload.reasonCode,
      providerReceiptUrl,
      eventTimeIso: payload.eventTimeIso
    };
  }
}
