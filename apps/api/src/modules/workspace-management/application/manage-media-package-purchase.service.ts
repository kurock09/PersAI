import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
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
import {
  WORKSPACE_VCOIN_LEDGER_EVENT_REPOSITORY,
  type WorkspaceVcoinLedgerEventRepository
} from "../domain/workspace-vcoin-ledger-event.repository";
import {
  WORKSPACE_VCOIN_BALANCE_REPOSITORY,
  type WorkspaceVcoinBalanceRepository
} from "../domain/workspace-vcoin-balance.repository";

const PACKAGE_INTENT_PLAN_SENTINEL = "__media_package__";

/** Shape of a package item snapshot stored in WorkspacePaymentIntent.metadata.packageItems. */
type PackageItemSnapshot = {
  catalogItemId: string;
  packageType: string;
  units: number;
  amountMinor: number;
};

@Injectable()
export class ManageMediaPackagePurchaseService {
  private readonly logger = new Logger(ManageMediaPackagePurchaseService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly catalogService: ManageMediaPackageCatalogService,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    @Inject(BILLING_PROVIDER_PORT)
    private readonly billingProviderPort: BillingProviderPort,
    @Inject(WORKSPACE_VCOIN_LEDGER_EVENT_REPOSITORY)
    private readonly workspaceVcoinLedgerEventRepository: WorkspaceVcoinLedgerEventRepository,
    @Inject(WORKSPACE_VCOIN_BALANCE_REPOSITORY)
    private readonly workspaceVcoinBalanceRepository: WorkspaceVcoinBalanceRepository
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
   * ADR-108 Slice 4 — Fulfills a confirmed media_package_purchase payment intent.
   *
   * For `video_generate` items: credits `item.units` VC into the workspace wallet
   * via a single `(workspaceId, "package_purchase", paymentIntentId)` ledger event
   * and a single `WorkspaceVcoinBalanceRepository.credit` call. No
   * `WorkspaceMediaPackageGrant` row is written for video items — the flip is
   * unconditional (no feature flag).
   *
   * For all other package types (image_generate, image_edit, document): the existing
   * `workspaceMediaPackageGrant` upsert runs byte-identically to before this slice.
   *
   * Both paths share a single `prisma.$transaction` (interactive form) so a failure
   * in either path rolls back the entire fulfillment atomically.
   *
   * Idempotent: a second call for the same `paymentIntentId` is a no-op for the video
   * path (proven by `recordEvent → recorded: false`) and for the non-video path (the
   * upsert `update: {}` is a no-op on conflict).
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
    const packageItems = metadata.packageItems as PackageItemSnapshot[];

    if (!Array.isArray(packageItems) || packageItems.length === 0) {
      throw new BadRequestException("Payment intent has no package items in metadata.");
    }

    // Partition items into video and non-video upfront.
    const videoItems = packageItems.filter((item) => item.packageType === "video_generate");
    const nonVideoItems = packageItems.filter((item) => item.packageType !== "video_generate");

    // Pre-compute the total VC to credit across all video_generate items.
    // A single (workspaceId, "package_purchase", paymentIntentId) ledger row covers
    // the entire intent — accumulating across all video items before calling
    // recordEvent keeps idempotency airtight even when an intent contains multiple
    // video catalog items.
    const videoVcCreditTotal = videoItems.reduce((sum, item) => sum + item.units, 0);

    // Only resolve the billing period if there are non-video items that need a grant row.
    let period: RecurringQuotaPeriod | null = null;
    if (nonVideoItems.length > 0) {
      const effectiveSubscription = await this.resolveEffectiveSubscriptionStateService.execute({
        userId,
        workspaceId,
        assistantId: "package-fulfillment",
        assistantPlanOverrideCode: null,
        assistantQuotaPlanCode: null
      });
      period = resolveRecurringQuotaPeriod(effectiveSubscription);
    }

    await this.prisma.$transaction(async (tx) => {
      // ── Video path: credit VC wallet (no grant row) ──────────────────────────
      //
      // One recordEvent + one credit per intent (not per item). If recorded===false
      // the ledger row already exists — this is an idempotent retry; skip silently.
      if (videoVcCreditTotal > 0) {
        const { recorded } = await this.workspaceVcoinLedgerEventRepository.recordEvent({
          workspaceId,
          kind: "package_purchase",
          amountVc: videoVcCreditTotal,
          referenceKey: paymentIntentId,
          planCode: null,
          tx
        });

        if (recorded) {
          const creditResult = await this.workspaceVcoinBalanceRepository.credit({
            workspaceId,
            amountVc: videoVcCreditTotal,
            kind: "package_purchase",
            tx
          });
          const videoCatalogItemIds = videoItems.map((i) => i.catalogItemId).join(",");
          this.logger.log(
            `adr108_vcoin_package_purchase_credited workspaceId=${workspaceId}` +
              ` paymentIntentId=${paymentIntentId} catalogItemId=${videoCatalogItemIds}` +
              ` vcCredited=${videoVcCreditTotal} previousBalanceVc=${creditResult.previousBalanceVc}` +
              ` balanceVc=${creditResult.balanceVc}`
          );
        }
        // recorded === false → quiet idempotent retry; do not log.
      }

      // ── Non-video path: grant upsert (byte-identical to prior behavior) ──────
      for (const item of nonVideoItems) {
        // period is guaranteed non-null here (set above when nonVideoItems.length > 0).
        await tx.workspaceMediaPackageGrant.upsert({
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
            periodStartedAt: period!.periodStartedAt,
            periodEndsAt: period!.periodEndsAt,
            status: "active"
          },
          update: {}
        });
      }
    });
  }

  /**
   * ADR-108 Slice 4 — Reverses a confirmed media_package_purchase payment intent
   * by debiting the VC wallet for all `video_generate` items in the intent.
   *
   * Reading source of truth: `WorkspacePaymentIntent.metadata.packageItems` is used
   * to determine which items and how many VC to debit. The catalog row is NOT
   * re-read — the snapshot in metadata is the source of truth (the catalog row may
   * have been edited or deactivated since the purchase).
   *
   * Idempotent: a second call with the same `paymentIntentId` is a no-op
   * (proven by `recordEvent → recorded: false` on the `package_refund` event).
   *
   * Non-video items (image_generate, image_edit, document): the pre-existing bug
   * where image/audio refunds do not reverse the `WorkspaceMediaPackageGrant` row
   * is intentionally preserved as a known residual. This method does NOT touch
   * grant rows for any item type.
   *
   * @throws NotFoundException when the payment intent is not found.
   * @throws BadRequestException when metadata.packageItems is missing or malformed.
   */
  async reversePackagePaymentIntent(input: {
    paymentIntentId: string;
    workspaceId: string;
  }): Promise<void> {
    const { paymentIntentId, workspaceId } = input;

    const intent = await this.prisma.workspacePaymentIntent.findUnique({
      where: { id: paymentIntentId }
    });
    if (intent === null) {
      throw new NotFoundException(`Payment intent "${paymentIntentId}" not found.`);
    }

    const metadata = intent.metadata as Record<string, unknown>;
    const packageItems = metadata.packageItems;
    if (!Array.isArray(packageItems) || packageItems.length === 0) {
      throw new BadRequestException("Payment intent has no package items in metadata.");
    }

    const items = packageItems as PackageItemSnapshot[];
    const videoVcDebitTotal = items
      .filter((item) => item.packageType === "video_generate")
      .reduce((sum, item) => sum + item.units, 0);

    if (videoVcDebitTotal === 0) {
      // No video items in this intent — nothing to do for the VC path.
      // Non-video refund behavior (image/audio grant not reversed) is a known residual.
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      // Negative amountVc is the correct ledger entry for a debit event:
      // the schema accepts signed amounts; the wallet repo debit always takes
      // the absolute value.
      const { recorded } = await this.workspaceVcoinLedgerEventRepository.recordEvent({
        workspaceId,
        kind: "package_refund",
        amountVc: -videoVcDebitTotal,
        referenceKey: paymentIntentId,
        planCode: null,
        tx
      });

      if (!recorded) {
        // Idempotent retry — already reversed; do not log.
        return;
      }

      const debitResult = await this.workspaceVcoinBalanceRepository.debit({
        workspaceId,
        amountVc: videoVcDebitTotal,
        tx
      });

      this.logger.log(
        `adr108_vcoin_package_refund_debited workspaceId=${workspaceId}` +
          ` paymentIntentId=${paymentIntentId} vcDebited=${videoVcDebitTotal}` +
          ` previousBalanceVc=${debitResult.previousBalanceVc} balanceVc=${debitResult.balanceVc}`
      );
    });
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
