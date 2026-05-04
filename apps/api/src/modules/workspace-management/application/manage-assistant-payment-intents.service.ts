import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ASSISTANT_GOVERNANCE_REPOSITORY } from "../domain/assistant-governance.repository";
import type { AssistantGovernanceRepository } from "../domain/assistant-governance.repository";
import { ASSISTANT_PLAN_CATALOG_REPOSITORY } from "../domain/assistant-plan-catalog.repository";
import type { AssistantPlanCatalogRepository } from "../domain/assistant-plan-catalog.repository";
import { ASSISTANT_REPOSITORY } from "../domain/assistant.repository";
import type { AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { BILLING_PROVIDER_PORT, type BillingProviderPort } from "./billing-provider.port";
import { ManageAdminPlansService } from "./manage-admin-plans.service";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";

export type AssistantPaymentMethodClass = "card" | "sbp_qr";
export type AssistantPaymentIntentAction = "new_purchase" | "upgrade" | "renewal" | "manual_admin";
export type AssistantPaymentIntentStatus =
  | "created"
  | "checkout_ready"
  | "pending_confirmation"
  | "succeeded"
  | "failed"
  | "canceled"
  | "expired";
export type AssistantPaymentIntentBillingPeriod = "month" | "year";
export type AssistantPaymentCheckoutMode =
  | "widget"
  | "redirect"
  | "payment_link"
  | "qr_code"
  | "manual_test";

export type CreateAssistantPaymentIntentInput = {
  planCode: string;
  paymentMethodClass: AssistantPaymentMethodClass;
  idempotencyKey: string;
  returnUrl: string;
};

export type AssistantPaymentIntentState = {
  id: string;
  targetPlanCode: string;
  action: AssistantPaymentIntentAction;
  status: AssistantPaymentIntentStatus;
  paymentMethodClass: AssistantPaymentMethodClass;
  amountMinor: number;
  currency: string;
  billingPeriod: AssistantPaymentIntentBillingPeriod;
  returnUrl: string;
  billingProvider: string | null;
  providerSessionRef: string | null;
  providerPaymentRef: string | null;
  checkout: {
    mode: AssistantPaymentCheckoutMode | null;
    expiresAt: string | null;
    payload: Record<string, unknown> | null;
  };
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type PaymentIntentRecord = {
  id: string;
  workspaceId: string;
  userId: string | null;
  targetPlanCode: string;
  action: AssistantPaymentIntentAction;
  status: AssistantPaymentIntentStatus;
  paymentMethodClass: AssistantPaymentMethodClass;
  amountMinor: number;
  currency: string;
  billingPeriod: AssistantPaymentIntentBillingPeriod;
  returnUrl: string;
  billingProvider: string | null;
  providerCustomerRef: string | null;
  providerSessionRef: string | null;
  providerPaymentRef: string | null;
  checkoutMode: AssistantPaymentCheckoutMode | null;
  checkoutPayload: Prisma.JsonValue | null;
  expiresAt: Date | null;
  idempotencyKey: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

type StoredPlanPrice = {
  amountMinor: number;
  currency: string;
  billingPeriod: AssistantPaymentIntentBillingPeriod;
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
  returnUrl: true,
  billingProvider: true,
  providerCustomerRef: true,
  providerSessionRef: true,
  providerPaymentRef: true,
  checkoutMode: true,
  checkoutPayload: true,
  expiresAt: true,
  idempotencyKey: true,
  lastErrorCode: true,
  lastErrorMessage: true,
  metadata: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.WorkspacePaymentIntentSelect;

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePlanCode(value: unknown): string {
  const normalized = toNullableString(value)?.toLowerCase() ?? null;
  if (normalized === null) {
    throw new BadRequestException("planCode must be a non-empty string.");
  }
  return normalized;
}

function normalizeIdempotencyKey(value: unknown): string {
  const normalized = toNullableString(value);
  if (normalized === null || normalized.length > 128) {
    throw new BadRequestException(
      "idempotencyKey must be a non-empty string up to 128 characters."
    );
  }
  return normalized;
}

function parsePaymentMethodClass(value: unknown): AssistantPaymentMethodClass {
  if (value === "card" || value === "sbp_qr") {
    return value;
  }
  throw new BadRequestException("paymentMethodClass must be 'card' or 'sbp_qr'.");
}

function parseReturnUrl(value: unknown): string {
  const normalized = toNullableString(value);
  if (normalized === null) {
    throw new BadRequestException("returnUrl must be a non-empty string.");
  }
  if (normalized.startsWith("/")) {
    return normalized;
  }
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new BadRequestException(
      "returnUrl must be an absolute http(s) URL or an application-relative path."
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BadRequestException(
      "returnUrl must be an absolute http(s) URL or an application-relative path."
    );
  }
  return normalized;
}

function parseStoredPlanPrice(billingProviderHints: unknown): StoredPlanPrice | null {
  const hints = asObject(billingProviderHints);
  const presentation = asObject(hints?.presentation);
  const price = asObject(presentation?.price);
  const amountMinor =
    typeof price?.amount === "number" && Number.isInteger(price.amount) && price.amount > 0
      ? price.amount
      : null;
  const currency = toNullableString(price?.currency)?.toUpperCase() ?? null;
  const billingPeriod =
    price?.billingPeriod === "month" || price?.billingPeriod === "year"
      ? price.billingPeriod
      : null;
  if (amountMinor === null || currency === null || billingPeriod === null) {
    return null;
  }
  return {
    amountMinor,
    currency,
    billingPeriod
  };
}

@Injectable()
export class ManageAssistantPaymentIntentsService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly assistantPlanCatalogRepository: AssistantPlanCatalogRepository,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService,
    private readonly manageAdminPlansService: ManageAdminPlansService,
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(BILLING_PROVIDER_PORT)
    private readonly billingProviderPort: BillingProviderPort
  ) {}

  parseCreateInput(body: unknown): CreateAssistantPaymentIntentInput {
    const parsed = asObject(body);
    if (parsed === null) {
      throw new BadRequestException("request body must be an object.");
    }
    return {
      planCode: normalizePlanCode(parsed.planCode),
      paymentMethodClass: parsePaymentMethodClass(parsed.paymentMethodClass),
      idempotencyKey: normalizeIdempotencyKey(parsed.idempotencyKey),
      returnUrl: parseReturnUrl(parsed.returnUrl)
    };
  }

  async createPaymentIntent(
    userId: string,
    input: CreateAssistantPaymentIntentInput
  ): Promise<AssistantPaymentIntentState> {
    const context = await this.resolveBillingContext(userId);
    const publicPlans = await this.manageAdminPlansService.listPublicPricingPlans();
    const targetPlan = publicPlans.find((plan) => plan.code === input.planCode) ?? null;
    if (targetPlan === null) {
      throw new NotFoundException("Visible purchasable plan was not found.");
    }
    const targetPrice = targetPlan.presentation.price;
    if (
      typeof targetPrice.amount !== "number" ||
      targetPrice.amount <= 0 ||
      targetPrice.currency === null ||
      (targetPrice.billingPeriod !== "month" && targetPrice.billingPeriod !== "year")
    ) {
      throw new BadRequestException("Selected plan is not purchasable in the billing flow.");
    }
    if (context.subscription.planCode === targetPlan.code) {
      throw new BadRequestException("Selected plan is already active for this workspace.");
    }
    const action = this.resolveAction(context.currentPlanPrice, context.subscription.status, {
      amountMinor: targetPrice.amount,
      currency: targetPrice.currency,
      billingPeriod: targetPrice.billingPeriod
    });

    const existing = await this.prisma.workspacePaymentIntent.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: context.assistant.workspaceId,
          idempotencyKey: input.idempotencyKey
        }
      },
      select: paymentIntentSelect
    });
    if (existing !== null) {
      this.assertExistingIntentMatches(existing as PaymentIntentRecord, input, targetPlan.code);
      return this.toState(existing as PaymentIntentRecord);
    }

    const created = (await this.prisma.workspacePaymentIntent.create({
      data: {
        workspace: { connect: { id: context.assistant.workspaceId } },
        user: { connect: { id: userId } },
        targetPlanCode: targetPlan.code,
        action,
        paymentMethodClass: input.paymentMethodClass,
        amountMinor: targetPrice.amount,
        currency: targetPrice.currency,
        billingPeriod: targetPrice.billingPeriod,
        idempotencyKey: input.idempotencyKey,
        returnUrl: input.returnUrl,
        providerCustomerRef: context.providerCustomerRef,
        metadata: {
          schema: "persai.paymentIntent.v1",
          effectivePlanCode: context.subscription.planCode,
          effectiveSubscriptionStatus: context.subscription.status,
          sourceSurface: "assistant_billing_api"
        }
      },
      select: paymentIntentSelect
    })) as PaymentIntentRecord;

    try {
      const session = await this.billingProviderPort.createCheckoutSession({
        paymentIntentId: created.id,
        workspaceId: context.assistant.workspaceId,
        userId,
        planCode: targetPlan.code,
        action,
        amountMinor: targetPrice.amount,
        currency: targetPrice.currency,
        billingPeriod: targetPrice.billingPeriod,
        paymentMethodClass: input.paymentMethodClass,
        returnUrl: input.returnUrl,
        providerCustomerRef: context.providerCustomerRef,
        metadata: {
          currentPlanCode: context.subscription.planCode,
          currentSubscriptionStatus: context.subscription.status
        }
      });
      const updated = (await this.prisma.workspacePaymentIntent.update({
        where: { id: created.id },
        data: {
          status: "checkout_ready",
          billingProvider: session.providerKey,
          providerSessionRef: session.providerSessionRef,
          providerPaymentRef: session.providerPaymentRef,
          checkoutMode: session.mode,
          checkoutPayload: session.payload as Prisma.InputJsonValue,
          expiresAt: session.expiresAt === null ? null : new Date(session.expiresAt),
          lastErrorCode: null,
          lastErrorMessage: null
        },
        select: paymentIntentSelect
      })) as PaymentIntentRecord;
      return this.toState(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown checkout session failure.";
      const failed = (await this.prisma.workspacePaymentIntent.update({
        where: { id: created.id },
        data: {
          status: "failed",
          lastErrorCode: "checkout_session_create_failed",
          lastErrorMessage: message
        },
        select: paymentIntentSelect
      })) as PaymentIntentRecord;
      return this.toState(failed);
    }
  }

  async getPaymentIntent(
    userId: string,
    paymentIntentId: string
  ): Promise<AssistantPaymentIntentState> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }
    const paymentIntent = (await this.prisma.workspacePaymentIntent.findFirst({
      where: {
        id: paymentIntentId,
        workspaceId: assistant.workspaceId,
        userId
      },
      select: paymentIntentSelect
    })) as PaymentIntentRecord | null;
    if (paymentIntent === null) {
      throw new NotFoundException("Payment intent was not found.");
    }
    return this.toState(paymentIntent);
  }

  private async resolveBillingContext(userId: string): Promise<{
    assistant: { id: string; workspaceId: string };
    subscription: { planCode: string | null; status: string };
    currentPlanPrice: StoredPlanPrice | null;
    providerCustomerRef: string | null;
  }> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }
    const governance = await this.assistantGovernanceRepository.findByAssistantId(assistant.id);
    if (governance === null) {
      throw new NotFoundException("Assistant governance does not exist for this assistant.");
    }
    const subscription = await this.resolveEffectiveSubscriptionStateService.execute({
      userId,
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      assistantPlanOverrideCode: governance.assistantPlanOverrideCode,
      assistantQuotaPlanCode: governance.quotaPlanCode
    });
    const currentPlan =
      subscription.planCode === null
        ? null
        : await this.assistantPlanCatalogRepository.findByCode(subscription.planCode);
    const currentSnapshot = await this.prisma.workspaceSubscription.findUnique({
      where: { workspaceId: assistant.workspaceId },
      select: {
        providerCustomerRef: true
      }
    });
    return {
      assistant: {
        id: assistant.id,
        workspaceId: assistant.workspaceId
      },
      subscription: {
        planCode: subscription.planCode,
        status: subscription.status
      },
      currentPlanPrice: parseStoredPlanPrice(currentPlan?.billingProviderHints ?? null),
      providerCustomerRef: currentSnapshot?.providerCustomerRef ?? null
    };
  }

  private resolveAction(
    currentPlanPrice: StoredPlanPrice | null,
    currentSubscriptionStatus: string,
    targetPrice: StoredPlanPrice
  ): AssistantPaymentIntentAction {
    if (
      currentPlanPrice === null ||
      !["trialing", "active", "grace_period", "past_due"].includes(currentSubscriptionStatus)
    ) {
      return "new_purchase";
    }
    if (
      currentPlanPrice.currency !== targetPrice.currency ||
      currentPlanPrice.billingPeriod !== targetPrice.billingPeriod
    ) {
      throw new BadRequestException(
        "Cross-period or cross-currency paid plan changes are not supported in this slice."
      );
    }
    if (targetPrice.amountMinor > currentPlanPrice.amountMinor) {
      return "upgrade";
    }
    throw new BadRequestException(
      "Downgrade or lateral paid plan changes are not supported in this slice yet."
    );
  }

  private assertExistingIntentMatches(
    existing: PaymentIntentRecord,
    input: CreateAssistantPaymentIntentInput,
    targetPlanCode: string
  ): void {
    if (
      existing.targetPlanCode !== targetPlanCode ||
      existing.paymentMethodClass !== input.paymentMethodClass ||
      existing.returnUrl !== input.returnUrl
    ) {
      throw new ConflictException(
        "This idempotencyKey already belongs to a different billing payment-intent request."
      );
    }
  }

  private toState(record: PaymentIntentRecord): AssistantPaymentIntentState {
    return {
      id: record.id,
      targetPlanCode: record.targetPlanCode,
      action: record.action,
      status: record.status,
      paymentMethodClass: record.paymentMethodClass,
      amountMinor: record.amountMinor,
      currency: record.currency,
      billingPeriod: record.billingPeriod,
      returnUrl: record.returnUrl,
      billingProvider: record.billingProvider,
      providerSessionRef: record.providerSessionRef,
      providerPaymentRef: record.providerPaymentRef,
      checkout: {
        mode: record.checkoutMode,
        expiresAt: record.expiresAt?.toISOString() ?? null,
        payload: asObject(record.checkoutPayload)
      },
      lastErrorCode: record.lastErrorCode,
      lastErrorMessage: record.lastErrorMessage,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString()
    };
  }
}
