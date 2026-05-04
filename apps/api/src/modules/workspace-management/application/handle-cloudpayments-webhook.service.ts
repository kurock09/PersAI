import { createHmac, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ApplyWorkspaceSubscriptionBillingEventService } from "./apply-workspace-subscription-billing-event.service";
import { CLOUDPAYMENTS_API_SECRET_STORAGE_KEY } from "./billing-provider-credential-settings";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";

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

@Injectable()
export class HandleCloudpaymentsWebhookService {
  private readonly logger = new Logger(HandleCloudpaymentsWebhookService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly applyWorkspaceSubscriptionBillingEventService: ApplyWorkspaceSubscriptionBillingEventService
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
    const subscription = await this.resolveSubscription(payload, paymentIntent);

    if (paymentIntent === null && subscription === null) {
      throw new NotFoundException("CloudPayments webhook does not match a PersAI billing subject.");
    }

    if (paymentIntent !== null) {
      await this.updatePaymentIntent(paymentIntent, input.notificationType, payload);
    }

    const lifecycleEvent = await this.deriveLifecycleEvent(
      input.notificationType,
      payload,
      paymentIntent,
      subscription
    );
    if (lifecycleEvent === null) {
      return { status: "ignored" };
    }

    const result = await this.applyWorkspaceSubscriptionBillingEventService.apply(lifecycleEvent);
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
      this.resolveHeader(headers, "x-content-hmac") ?? this.resolveHeader(headers, "content-hmac");
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
      throw new NotFoundException("CloudPayments Check webhook payment intent was not found.");
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
    return (await this.prisma.workspacePaymentIntent.findFirst({
      where: {
        OR: [
          { id: { in: uniqueCandidates } },
          { providerPaymentRef: { in: uniqueCandidates } },
          { providerSessionRef: { in: uniqueCandidates } }
        ]
      },
      select: paymentIntentSelect
    })) as PaymentIntentRecord | null;
  }

  private async resolveSubscription(
    payload: CloudpaymentsPayload,
    paymentIntent: PaymentIntentRecord | null
  ): Promise<SubscriptionRecord | null> {
    if (paymentIntent !== null) {
      return (await this.prisma.workspaceSubscription.findUnique({
        where: { workspaceId: paymentIntent.workspaceId },
        select: {
          id: true,
          workspaceId: true,
          planCode: true,
          status: true,
          providerCustomerRef: true,
          providerSubscriptionRef: true
        }
      })) as SubscriptionRecord | null;
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
          providerSubscriptionRef: true
        }
      });
      if (bySubscriptionRef !== null) {
        return bySubscriptionRef as SubscriptionRecord;
      }
    }
    if (payload.accountId !== null) {
      return (await this.prisma.workspaceSubscription.findFirst({
        where: { providerCustomerRef: payload.accountId },
        select: {
          id: true,
          workspaceId: true,
          planCode: true,
          status: true,
          providerCustomerRef: true,
          providerSubscriptionRef: true
        }
      })) as SubscriptionRecord | null;
    }
    return null;
  }

  private async updatePaymentIntent(
    paymentIntent: PaymentIntentRecord,
    notificationType: CloudpaymentsNotificationType,
    payload: CloudpaymentsPayload
  ): Promise<void> {
    const nextStatus = this.resolveNextPaymentIntentStatus(
      paymentIntent,
      notificationType,
      payload
    );
    if (nextStatus === null) {
      return;
    }

    await this.prisma.workspacePaymentIntent.update({
      where: { id: paymentIntent.id },
      data: {
        status: nextStatus,
        billingProvider: "cloudpayments",
        providerCustomerRef: payload.accountId ?? paymentIntent.providerCustomerRef,
        providerPaymentRef:
          notificationType === "refund"
            ? (paymentIntent.providerPaymentRef ??
              payload.originalTransactionId ??
              payload.transactionId)
            : (paymentIntent.providerPaymentRef ?? payload.transactionId),
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
    paymentIntent: PaymentIntentRecord | null,
    subscription: SubscriptionRecord | null
  ): Promise<Parameters<ApplyWorkspaceSubscriptionBillingEventService["apply"]>[0] | null> {
    if (notificationType === "recurrent" || notificationType === "cancel") {
      this.logger.log(`Ignoring CloudPayments ${notificationType} webhook for lifecycle mutation.`);
      return null;
    }

    if (notificationType === "fail") {
      const renewalTarget =
        paymentIntent?.action === "renewal" || (paymentIntent === null && subscription !== null);
      if (!renewalTarget || subscription === null) {
        return null;
      }
      return {
        workspaceId: subscription.workspaceId,
        userId: paymentIntent?.userId ?? null,
        source: "provider",
        eventCode: "renewal_failed",
        eventRef: this.buildEventRef(notificationType, payload),
        paymentIntentRef: paymentIntent?.id ?? null,
        billingProvider: "cloudpayments",
        providerCustomerRef: payload.accountId ?? subscription.providerCustomerRef,
        providerSubscriptionRef: payload.subscriptionId ?? subscription.providerSubscriptionRef,
        paidPlanCode: subscription.planCode,
        metadata: this.buildLifecycleMetadata(notificationType, payload)
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
        eventRef: this.buildEventRef(notificationType, payload),
        paymentIntentRef: paymentIntent?.id ?? null,
        billingProvider: "cloudpayments",
        providerCustomerRef: payload.accountId ?? subscription?.providerCustomerRef ?? null,
        providerSubscriptionRef:
          payload.subscriptionId ?? subscription?.providerSubscriptionRef ?? null,
        paidPlanCode: paymentIntent?.targetPlanCode ?? subscription?.planCode ?? null,
        metadata: this.buildLifecycleMetadata(notificationType, payload)
      };
    }

    if (notificationType === "pay" && payload.status === "Authorized") {
      return null;
    }

    if (notificationType !== "pay" && notificationType !== "confirm") {
      return null;
    }

    const workspaceId = paymentIntent?.workspaceId ?? subscription?.workspaceId ?? null;
    if (workspaceId === null) {
      return null;
    }

    const currentStatus = subscription?.status ?? null;
    const eventCode =
      paymentIntent?.action === "renewal" || (paymentIntent === null && subscription !== null)
        ? currentStatus === "grace_period" || currentStatus === "past_due"
          ? "payment_recovered"
          : "renewal_succeeded"
        : "payment_activated";

    const paidPlanCode = paymentIntent?.targetPlanCode ?? subscription?.planCode ?? null;
    const billingPeriod = await this.resolveBillingPeriod(paymentIntent, subscription);
    const currentPeriodStartedAt = payload.eventTimeIso;
    const currentPeriodEndsAt = addBillingPeriod(currentPeriodStartedAt, billingPeriod);

    return {
      workspaceId,
      userId: paymentIntent?.userId ?? null,
      source: "provider",
      eventCode,
      eventRef: this.buildEventRef(notificationType, payload),
      paymentIntentRef: paymentIntent?.id ?? null,
      billingProvider: "cloudpayments",
      providerCustomerRef: payload.accountId ?? subscription?.providerCustomerRef ?? null,
      providerSubscriptionRef:
        payload.subscriptionId ?? subscription?.providerSubscriptionRef ?? null,
      paidPlanCode,
      currentPeriodStartedAt,
      currentPeriodEndsAt,
      metadata: this.buildLifecycleMetadata(notificationType, payload)
    };
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

  private buildEventRef(
    notificationType: CloudpaymentsNotificationType,
    payload: CloudpaymentsPayload
  ): string {
    return [
      "cloudpayments",
      notificationType,
      payload.transactionId ?? "no-transaction",
      payload.originalTransactionId ?? "no-original-transaction",
      payload.subscriptionId ?? "no-subscription"
    ].join(":");
  }

  private buildLifecycleMetadata(
    notificationType: CloudpaymentsNotificationType,
    payload: CloudpaymentsPayload
  ): Record<string, unknown> {
    return {
      providerEventType: notificationType,
      providerTransactionId: payload.transactionId,
      providerOriginalTransactionId: payload.originalTransactionId,
      providerInvoiceId: payload.invoiceId,
      providerSubscriptionId: payload.subscriptionId,
      providerAccountId: payload.accountId,
      providerPaymentStatus: payload.status,
      providerPaymentMethod: payload.paymentMethod,
      providerReason: payload.reason,
      providerReasonCode: payload.reasonCode,
      eventTimeIso: payload.eventTimeIso
    };
  }
}
