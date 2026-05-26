import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { BILLING_PROVIDER_PORT, type BillingProviderPort } from "./billing-provider.port";
import type { RecurringQuotaPeriod } from "./recurring-quota-period";
import type {
  ActivePackageBonusForTool,
  CreatePackagePaymentIntentInput
} from "./media-package.types";
import { MEDIA_PACKAGE_TYPES, type MediaPackageType } from "./media-package.types";
import { ManageMediaPackageCatalogService } from "./manage-media-package-catalog.service";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";
import { resolveRecurringQuotaPeriod } from "./recurring-quota-period";
import type { AssistantPaymentIntentState } from "./manage-assistant-payment-intents.service";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";

const PACKAGE_INTENT_PLAN_SENTINEL = "__media_package__";

@Injectable()
export class ManageMediaPackagePurchaseService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly catalogService: ManageMediaPackageCatalogService,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    @Inject(BILLING_PROVIDER_PORT)
    private readonly billingProviderPort: BillingProviderPort
  ) {}

  /**
   * Returns active bonus units for a single tool in the current subscription period.
   * Used by the quota accounting path to compute effectiveLimitUnits.
   */
  async resolveActiveBonus(
    workspaceId: string,
    toolCode: string,
    period: RecurringQuotaPeriod
  ): Promise<ActivePackageBonusForTool> {
    const now = new Date();
    const grants = await this.prisma.workspaceMediaPackageGrant.findMany({
      where: {
        workspaceId,
        toolCode,
        status: "active",
        periodEndsAt: { gt: now },
        periodStartedAt: { lte: period.periodStartedAt }
      },
      select: {
        id: true,
        grantedUnits: true,
        periodEndsAt: true
      }
    });

    const bonusUnits = grants.reduce((sum, g) => sum + g.grantedUnits, 0);
    const latestPeriodEndsAt =
      grants.length > 0
        ? grants.reduce((latest, g) => {
            const gStr = g.periodEndsAt.toISOString();
            return gStr > latest ? gStr : latest;
          }, grants[0]!.periodEndsAt.toISOString())
        : null;

    return {
      toolCode,
      bonusUnits,
      latestPeriodEndsAt,
      grantIds: grants.map((g) => g.id)
    };
  }

  /**
   * Resolves active bonus for all three media tools at once.
   */
  async resolveAllActiveBonuses(
    workspaceId: string,
    period: RecurringQuotaPeriod
  ): Promise<Record<string, ActivePackageBonusForTool>> {
    const results: Record<string, ActivePackageBonusForTool> = {};
    await Promise.all(
      MEDIA_PACKAGE_TYPES.map(async (toolCode) => {
        results[toolCode] = await this.resolveActiveBonus(workspaceId, toolCode, period);
      })
    );
    return results;
  }

  /**
   * Creates a one-time payment intent for one or more package catalog items.
   * All items must share the same currency. Multi-type selection is allowed.
   */
  async createPackagePaymentIntent(
    userId: string,
    input: CreatePackagePaymentIntentInput
  ): Promise<AssistantPaymentIntentState> {
    const { assistant } = await this.resolveActiveAssistantService.execute({ userId });
    const workspaceId = assistant.workspaceId;

    if (!input.packageItemIds || input.packageItemIds.length === 0) {
      throw new BadRequestException("At least one package item must be selected.");
    }
    if (input.packageItemIds.length > 10) {
      throw new BadRequestException("Cannot purchase more than 10 package items at once.");
    }

    const items = await Promise.all(
      input.packageItemIds.map((id) => this.catalogService.getById(id))
    );

    const inactiveItems = items.filter((item) => !item.isActive);
    if (inactiveItems.length > 0) {
      throw new BadRequestException(
        `Package items not available: ${inactiveItems.map((i) => i.id).join(", ")}`
      );
    }

    const currencies = [...new Set(items.map((item) => item.currency))];
    if (currencies.length > 1) {
      throw new BadRequestException("All selected package items must share the same currency.");
    }

    const currency = currencies[0] as string;
    const totalAmountMinor = items.reduce((sum, item) => sum + item.amountMinor, 0);
    const idempotencyKey = input.idempotencyKey;

    const existing = await this.prisma.workspacePaymentIntent.findUnique({
      where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey } }
    });
    if (existing !== null) {
      return this.toIntentState(existing);
    }

    const packageItemsMeta: Prisma.InputJsonValue = items.map((item) => ({
      catalogItemId: item.id,
      packageType: item.packageType,
      units: item.units,
      amountMinor: item.amountMinor
    }));

    const intentRow = await this.prisma.workspacePaymentIntent.create({
      data: {
        workspaceId,
        userId,
        targetPlanCode: PACKAGE_INTENT_PLAN_SENTINEL,
        action: "new_purchase",
        status: "created",
        paymentMethodClass: input.paymentMethodClass,
        amountMinor: totalAmountMinor,
        currency,
        billingPeriod: "month",
        idempotencyKey,
        returnUrl: input.returnUrl,
        metadata: {
          purpose: "media_package_purchase",
          packageItems: packageItemsMeta
        }
      }
    });

    const description = items.map((item) => `${item.packageType} ×${item.units}`).join(", ");

    let checkoutSession;
    try {
      checkoutSession = await this.billingProviderPort.createCheckoutSession({
        paymentIntentId: intentRow.id,
        workspaceId,
        userId,
        planCode: PACKAGE_INTENT_PLAN_SENTINEL,
        action: "new_purchase",
        amountMinor: totalAmountMinor,
        currency,
        billingPeriod: "month",
        paymentMethodClass: input.paymentMethodClass,
        returnUrl: input.returnUrl,
        providerCustomerRef: null,
        checkoutKind: "one_time",
        recurringPlan: null,
        metadata: {
          purpose: "media_package_purchase",
          description,
          packageItems: packageItemsMeta
        }
      });
    } catch (err) {
      await this.prisma.workspacePaymentIntent.update({
        where: { id: intentRow.id },
        data: {
          status: "failed",
          lastErrorCode: "provider_checkout_failed",
          lastErrorMessage: err instanceof Error ? err.message : "Unknown provider error"
        }
      });
      throw err;
    }

    const updatedRow = await this.prisma.workspacePaymentIntent.update({
      where: { id: intentRow.id },
      data: {
        status: "checkout_ready",
        billingProvider: checkoutSession.providerKey,
        providerSessionRef: checkoutSession.providerSessionRef ?? null,
        providerPaymentRef: checkoutSession.providerPaymentRef ?? null,
        checkoutMode: checkoutSession.mode,
        checkoutPayload: checkoutSession.payload as Prisma.InputJsonValue,
        expiresAt: checkoutSession.expiresAt ? new Date(checkoutSession.expiresAt) : null
      }
    });

    return this.toIntentState(updatedRow);
  }

  /**
   * Fulfills a confirmed media_package_purchase payment intent by writing grant rows.
   * Called from HandleCloudpaymentsWebhookService after confirming payment.
   */
  async fulfillPackagePaymentIntent(
    paymentIntentId: string,
    workspaceId: string,
    userId: string
  ): Promise<void> {
    const intent = await this.prisma.workspacePaymentIntent.findUnique({
      where: { id: paymentIntentId }
    });
    if (intent === null) {
      throw new NotFoundException(`Payment intent "${paymentIntentId}" not found.`);
    }
    if (intent.targetPlanCode !== PACKAGE_INTENT_PLAN_SENTINEL) {
      throw new BadRequestException("This payment intent is not a media package purchase.");
    }

    const metadata = intent.metadata as Record<string, unknown>;
    const packageItems = metadata.packageItems as Array<{
      catalogItemId: string;
      packageType: string;
      units: number;
      amountMinor: number;
    }>;

    if (!Array.isArray(packageItems) || packageItems.length === 0) {
      throw new BadRequestException("Payment intent has no package items in metadata.");
    }

    const effectiveSubscription = await this.resolveEffectiveSubscriptionStateService.execute({
      userId,
      workspaceId,
      assistantId: "package-fulfillment",
      assistantPlanOverrideCode: null,
      assistantQuotaPlanCode: null
    });
    const period = resolveRecurringQuotaPeriod(effectiveSubscription);

    await this.prisma.$transaction(
      packageItems.map((item) =>
        this.prisma.workspaceMediaPackageGrant.upsert({
          where: {
            uniq_grant_intent_item: {
              paymentIntentId,
              packageCatalogItemId: item.catalogItemId
            }
          },
          create: {
            workspaceId,
            packageCatalogItemId: item.catalogItemId,
            toolCode: item.packageType as MediaPackageType,
            grantedUnits: item.units,
            amountMinorSnapshot: item.amountMinor,
            currencySnapshot: intent.currency,
            paymentIntentId,
            periodStartedAt: period.periodStartedAt,
            periodEndsAt: period.periodEndsAt,
            status: "active"
          },
          update: {}
        })
      )
    );
  }

  private toIntentState(row: {
    id: string;
    targetPlanCode: string;
    action: string;
    status: string;
    paymentMethodClass: string;
    amountMinor: number;
    currency: string;
    billingPeriod: string;
    returnUrl: string;
    billingProvider: string | null;
    providerSessionRef: string | null;
    providerPaymentRef: string | null;
    checkoutMode: string | null;
    checkoutPayload: unknown;
    expiresAt: Date | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): AssistantPaymentIntentState {
    return {
      id: row.id,
      targetPlanCode: row.targetPlanCode,
      action: row.action as AssistantPaymentIntentState["action"],
      purpose: "media_package_purchase" as AssistantPaymentIntentState["purpose"],
      status: row.status as AssistantPaymentIntentState["status"],
      paymentMethodClass:
        row.paymentMethodClass as AssistantPaymentIntentState["paymentMethodClass"],
      amountMinor: row.amountMinor,
      currency: row.currency,
      billingPeriod: row.billingPeriod as AssistantPaymentIntentState["billingPeriod"],
      returnUrl: row.returnUrl,
      billingProvider: row.billingProvider,
      providerSessionRef: row.providerSessionRef,
      providerPaymentRef: row.providerPaymentRef ?? null,
      recurring: {
        checkoutKind: "one_time",
        supportedBySelectedMethod: true,
        unsupportedReason: null
      },
      checkout: {
        mode: (row.checkoutMode ?? null) as AssistantPaymentIntentState["checkout"]["mode"],
        expiresAt: row.expiresAt?.toISOString() ?? null,
        payload: (row.checkoutPayload ?? null) as Record<string, unknown> | null
      },
      lastErrorCode: row.lastErrorCode,
      lastErrorMessage: row.lastErrorMessage,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }
}
