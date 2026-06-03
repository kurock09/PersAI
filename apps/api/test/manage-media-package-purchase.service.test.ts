import assert from "node:assert/strict";
import { ManageMediaPackagePurchaseService } from "../src/modules/workspace-management/application/manage-media-package-purchase.service";
import type { BillingProviderPort } from "../src/modules/workspace-management/application/billing-provider.port";
import type { ManageMediaPackageCatalogService } from "../src/modules/workspace-management/application/manage-media-package-catalog.service";
import type { ResolveEffectiveSubscriptionStateService } from "../src/modules/workspace-management/application/resolve-effective-subscription-state.service";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";
import type { WorkspaceVcoinLedgerEventRepository } from "../src/modules/workspace-management/domain/workspace-vcoin-ledger-event.repository";
import type { WorkspaceVcoinBalanceRepository } from "../src/modules/workspace-management/domain/workspace-vcoin-balance.repository";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeIntent(
  paymentIntentId: string,
  workspaceId: string,
  packageItems: Array<{
    catalogItemId: string;
    packageType: string;
    units: number;
    amountMinor: number;
  }>
) {
  return {
    id: paymentIntentId,
    workspaceId,
    userId: "user-1",
    targetPlanCode: "__media_package__",
    currency: "RUB",
    metadata: {
      purpose: "media_package_purchase",
      packageItems
    }
  };
}

function makeSubscriptionState() {
  return {
    subscription: {
      status: "active",
      planCode: "starter",
      currentPeriodStartedAt: new Date("2026-06-01T00:00:00.000Z"),
      currentPeriodEndsAt: new Date("2026-07-01T00:00:00.000Z")
    }
  };
}

// ── createPackagePaymentIntent ────────────────────────────────────────────────

async function runCreatePackagePaymentIntent(): Promise<void> {
  const createdIntentWorkspaces: string[] = [];
  let providerWorkspaceId: string | null = null;
  const now = new Date("2026-05-26T20:00:00.000Z");

  const service = new ManageMediaPackagePurchaseService(
    {
      workspacePaymentIntent: {
        async findUnique() {
          return null;
        },
        async create(args: { data: Record<string, unknown> }) {
          createdIntentWorkspaces.push(args.data.workspaceId as string);
          return {
            id: "intent-1",
            workspaceId: args.data.workspaceId as string,
            userId: args.data.userId as string,
            targetPlanCode: args.data.targetPlanCode as string,
            action: args.data.action as string,
            status: "created",
            paymentMethodClass: args.data.paymentMethodClass as string,
            amountMinor: args.data.amountMinor as number,
            currency: args.data.currency as string,
            billingPeriod: args.data.billingPeriod as string,
            idempotencyKey: args.data.idempotencyKey as string,
            returnUrl: args.data.returnUrl as string,
            metadata: args.data.metadata,
            billingProvider: null,
            providerSessionRef: null,
            providerPaymentRef: null,
            checkoutMode: null,
            checkoutPayload: null,
            expiresAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            createdAt: now,
            updatedAt: now
          };
        },
        async update(args: { data: Record<string, unknown> }) {
          return {
            id: "intent-1",
            targetPlanCode: "__media_package__",
            action: "new_purchase",
            status: args.data.status as string,
            paymentMethodClass: "card",
            amountMinor: 9900,
            currency: "RUB",
            billingPeriod: "month",
            returnUrl: "/app/packages",
            billingProvider: args.data.billingProvider as string,
            providerSessionRef: args.data.providerSessionRef as string,
            providerPaymentRef: args.data.providerPaymentRef as string,
            checkoutMode: args.data.checkoutMode as string,
            checkoutPayload: args.data.checkoutPayload,
            expiresAt: args.data.expiresAt as Date,
            lastErrorCode: null,
            lastErrorMessage: null,
            metadata: { purpose: "media_package_purchase" },
            createdAt: now,
            updatedAt: now
          };
        }
      }
    } as Pick<
      WorkspaceManagementPrismaService,
      "workspacePaymentIntent"
    > as WorkspaceManagementPrismaService,
    {
      async getById(id: string) {
        assert.equal(id, "pkg-image-1");
        return {
          id,
          packageType: "image_generate",
          units: 10,
          amountMinor: 9900,
          currency: "RUB",
          isActive: true,
          displayOrder: 0,
          highlighted: false,
          title: { ru: "10 изображений", en: "10 images" },
          subtitle: { ru: null, en: null },
          ctaLabel: { ru: "Купить", en: "Buy" },
          createdAt: now.toISOString(),
          updatedAt: now.toISOString()
        };
      }
    } as Pick<ManageMediaPackageCatalogService, "getById"> as ManageMediaPackageCatalogService,
    {} as ResolveEffectiveSubscriptionStateService,
    {
      async execute(input: { userId: string }) {
        assert.equal(input.userId, "user-1");
        return {
          assistant: {
            id: "assistant-active",
            userId: input.userId,
            workspaceId: "ws-active"
          }
        };
      }
    } as never,
    {
      async createCheckoutSession(input) {
        providerWorkspaceId = input.workspaceId;
        return {
          providerKey: "cloudpayments",
          providerSessionRef: "session-1",
          providerPaymentRef: "payment-1",
          mode: "embedded",
          payload: { publicId: "pk_test" },
          expiresAt: "2026-05-26T21:00:00.000Z"
        };
      }
    } as Pick<BillingProviderPort, "createCheckoutSession"> as BillingProviderPort,
    {} as WorkspaceVcoinLedgerEventRepository,
    {} as WorkspaceVcoinBalanceRepository
  );

  const state = await service.createPackagePaymentIntent("user-1", {
    packageItemIds: ["pkg-image-1"],
    paymentMethodClass: "card",
    idempotencyKey: "pkg-1",
    returnUrl: "/app/packages"
  });

  assert.deepEqual(createdIntentWorkspaces, ["ws-active"]);
  assert.equal(providerWorkspaceId, "ws-active");
  assert.equal(state.purpose, "media_package_purchase");
  assert.equal(state.status, "checkout_ready");
}

// ── fulfillPackagePaymentIntent — video package credits VC ────────────────────

async function runFulfillVideoPackageCreditedVC(): Promise<void> {
  const paymentIntentId = "pi-video-1111-1111-1111-111111111111";
  const workspaceId = "ws-video-1";

  const recordEventCalls: Array<Record<string, unknown>> = [];
  const creditCalls: Array<Record<string, unknown>> = [];
  const grantUpserts: unknown[] = [];
  const logLines: string[] = [];

  const mockTx = {
    workspaceMediaPackageGrant: {
      async upsert(args: unknown) {
        grantUpserts.push(args);
        return {};
      }
    }
  };

  const service = new ManageMediaPackagePurchaseService(
    {
      workspacePaymentIntent: {
        async findUnique() {
          return makeIntent(paymentIntentId, workspaceId, [
            {
              catalogItemId: "cat-video-1",
              packageType: "video_generate",
              units: 1000,
              amountMinor: 99900
            }
          ]);
        }
      },
      async $transaction(callback: (tx: unknown) => Promise<void>) {
        await callback(mockTx);
      }
    } as unknown as WorkspaceManagementPrismaService,
    {} as ManageMediaPackageCatalogService,
    {} as ResolveEffectiveSubscriptionStateService,
    {} as never,
    {} as BillingProviderPort,
    {
      async recordEvent(input: Record<string, unknown>) {
        recordEventCalls.push(input);
        return { recorded: true };
      }
    } as unknown as WorkspaceVcoinLedgerEventRepository,
    {
      async credit(input: Record<string, unknown>) {
        creditCalls.push(input);
        return { balanceVc: 1000, previousBalanceVc: 0, creditedAt: new Date() };
      },
      async debit() {
        throw new Error("debit must not be called during purchase");
      }
    } as unknown as WorkspaceVcoinBalanceRepository
  );

  // Capture log lines
  (service as unknown as { logger: { log: (msg: string) => void } }).logger = {
    log: (msg: string) => logLines.push(msg)
  };

  await service.fulfillPackagePaymentIntent(paymentIntentId, workspaceId, "user-1");

  // recordEvent called once with correct params
  assert.equal(recordEventCalls.length, 1, "recordEvent called exactly once");
  assert.equal(recordEventCalls[0]!.kind, "package_purchase");
  assert.equal(recordEventCalls[0]!.amountVc, 1000);
  assert.equal(recordEventCalls[0]!.referenceKey, paymentIntentId);
  assert.equal(recordEventCalls[0]!.tx, mockTx, "recordEvent must use the transaction");

  // credit called once with correct params
  assert.equal(creditCalls.length, 1, "credit called exactly once");
  assert.equal(creditCalls[0]!.amountVc, 1000);
  assert.equal(creditCalls[0]!.kind, "package_purchase");
  assert.equal(creditCalls[0]!.tx, mockTx, "credit must use the same transaction");

  // No grant rows written for video packages
  assert.equal(grantUpserts.length, 0, "no WorkspaceMediaPackageGrant upsert for video items");

  // Audit log line emitted
  assert.equal(logLines.length, 1, "exactly one log line emitted");
  assert.ok(
    logLines[0]!.includes("adr108_vcoin_package_purchase_credited"),
    "log line has correct key"
  );
  assert.ok(logLines[0]!.includes(`workspaceId=${workspaceId}`), "log line has workspaceId");
  assert.ok(
    logLines[0]!.includes(`paymentIntentId=${paymentIntentId}`),
    "log line has paymentIntentId"
  );
  assert.ok(logLines[0]!.includes("vcCredited=1000"), "log line has vcCredited");
  assert.ok(logLines[0]!.includes("previousBalanceVc=0"), "log line has previousBalanceVc");
  assert.ok(logLines[0]!.includes("balanceVc=1000"), "log line has balanceVc");
}

// ── fulfillPackagePaymentIntent — image package writes grant exactly as today ──

async function runFulfillImagePackageWritesGrant(): Promise<void> {
  const paymentIntentId = "pi-image-2222-2222-2222-222222222222";
  const workspaceId = "ws-image-1";

  const recordEventCalls: unknown[] = [];
  const creditCalls: unknown[] = [];
  const grantUpserts: Array<Record<string, unknown>> = [];

  const mockTx = {
    workspaceMediaPackageGrant: {
      async upsert(args: Record<string, unknown>) {
        grantUpserts.push(args);
        return {};
      }
    }
  };

  const service = new ManageMediaPackagePurchaseService(
    {
      workspacePaymentIntent: {
        async findUnique() {
          return makeIntent(paymentIntentId, workspaceId, [
            {
              catalogItemId: "cat-image-1",
              packageType: "image_generate",
              units: 10,
              amountMinor: 9900
            }
          ]);
        }
      },
      async $transaction(callback: (tx: unknown) => Promise<void>) {
        await callback(mockTx);
      }
    } as unknown as WorkspaceManagementPrismaService,
    {} as ManageMediaPackageCatalogService,
    {
      async execute() {
        return makeSubscriptionState();
      }
    } as unknown as ResolveEffectiveSubscriptionStateService,
    {} as never,
    {} as BillingProviderPort,
    {
      async recordEvent() {
        recordEventCalls.push({});
        return { recorded: true };
      }
    } as unknown as WorkspaceVcoinLedgerEventRepository,
    {
      async credit() {
        creditCalls.push({});
        return { balanceVc: 0, previousBalanceVc: 0, creditedAt: new Date() };
      }
    } as unknown as WorkspaceVcoinBalanceRepository
  );

  await service.fulfillPackagePaymentIntent(paymentIntentId, workspaceId, "user-1");

  // No VC ledger or wallet calls for image items
  assert.equal(recordEventCalls.length, 0, "recordEvent must NOT be called for image packages");
  assert.equal(creditCalls.length, 0, "credit must NOT be called for image packages");

  // Grant upsert was called with correct payload
  assert.equal(grantUpserts.length, 1, "one grant upsert for image package");
  const upsertArgs = grantUpserts[0]! as {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  };
  assert.deepEqual(upsertArgs.where, {
    uniq_grant_intent_item: {
      paymentIntentId,
      packageCatalogItemId: "cat-image-1"
    }
  });
  assert.equal(upsertArgs.create.workspaceId, workspaceId);
  assert.equal(upsertArgs.create.packageCatalogItemId, "cat-image-1");
  assert.equal(upsertArgs.create.toolCode, "image_generate");
  assert.equal(upsertArgs.create.grantedUnits, 10);
  assert.equal(upsertArgs.create.amountMinorSnapshot, 9900);
  assert.equal(upsertArgs.create.paymentIntentId, paymentIntentId);
  assert.equal(upsertArgs.create.status, "active");
  assert.deepEqual(upsertArgs.update, {}, "upsert update must be empty (idempotent no-op)");
}

// ── fulfillPackagePaymentIntent — mixed intent: image + video ─────────────────

async function runFulfillMixedIntentVideoAndImage(): Promise<void> {
  const paymentIntentId = "pi-mixed-3333-3333-3333-333333333333";
  const workspaceId = "ws-mixed-1";

  const recordEventCalls: Array<Record<string, unknown>> = [];
  const creditCalls: Array<Record<string, unknown>> = [];
  const grantUpserts: Array<Record<string, unknown>> = [];

  const mockTx = {
    workspaceMediaPackageGrant: {
      async upsert(args: Record<string, unknown>) {
        grantUpserts.push(args);
        return {};
      }
    }
  };

  const service = new ManageMediaPackagePurchaseService(
    {
      workspacePaymentIntent: {
        async findUnique() {
          return makeIntent(paymentIntentId, workspaceId, [
            {
              catalogItemId: "cat-image-2",
              packageType: "image_generate",
              units: 10,
              amountMinor: 9900
            },
            {
              catalogItemId: "cat-video-2",
              packageType: "video_generate",
              units: 500,
              amountMinor: 49900
            }
          ]);
        }
      },
      async $transaction(callback: (tx: unknown) => Promise<void>) {
        await callback(mockTx);
      }
    } as unknown as WorkspaceManagementPrismaService,
    {} as ManageMediaPackageCatalogService,
    {
      async execute() {
        return makeSubscriptionState();
      }
    } as unknown as ResolveEffectiveSubscriptionStateService,
    {} as never,
    {} as BillingProviderPort,
    {
      async recordEvent(input: Record<string, unknown>) {
        recordEventCalls.push(input);
        return { recorded: true };
      }
    } as unknown as WorkspaceVcoinLedgerEventRepository,
    {
      async credit(input: Record<string, unknown>) {
        creditCalls.push(input);
        return { balanceVc: 500, previousBalanceVc: 0, creditedAt: new Date() };
      }
    } as unknown as WorkspaceVcoinBalanceRepository
  );

  await service.fulfillPackagePaymentIntent(paymentIntentId, workspaceId, "user-1");

  // Exactly ONE recordEvent for the combined video VC total
  assert.equal(recordEventCalls.length, 1, "single recordEvent for all video items combined");
  assert.equal(recordEventCalls[0]!.kind, "package_purchase");
  assert.equal(recordEventCalls[0]!.amountVc, 500, "video VC total is 500");
  assert.equal(recordEventCalls[0]!.referenceKey, paymentIntentId);

  // Exactly ONE credit call for the same total
  assert.equal(creditCalls.length, 1, "single credit for video VC total");
  assert.equal(creditCalls[0]!.amountVc, 500);

  // Exactly ONE grant upsert for the image item
  assert.equal(grantUpserts.length, 1, "one grant upsert for image item only");
  const upsertArgs = grantUpserts[0]! as { create: Record<string, unknown> };
  assert.equal(upsertArgs.create.toolCode, "image_generate");
  assert.equal(upsertArgs.create.packageCatalogItemId, "cat-image-2");
}

// ── fulfillPackagePaymentIntent — idempotent purchase ─────────────────────────

async function runFulfillIdempotentPurchase(): Promise<void> {
  const paymentIntentId = "pi-idem-4444-4444-4444-444444444444";
  const workspaceId = "ws-idem-1";

  let creditCallCount = 0;
  let recordEventCallCount = 0;
  const logLines: string[] = [];

  const mockTx = {
    workspaceMediaPackageGrant: {
      async upsert() {
        return {};
      }
    }
  };

  const service = new ManageMediaPackagePurchaseService(
    {
      workspacePaymentIntent: {
        async findUnique() {
          return makeIntent(paymentIntentId, workspaceId, [
            {
              catalogItemId: "cat-video-3",
              packageType: "video_generate",
              units: 1000,
              amountMinor: 99900
            }
          ]);
        }
      },
      async $transaction(callback: (tx: unknown) => Promise<void>) {
        await callback(mockTx);
      }
    } as unknown as WorkspaceManagementPrismaService,
    {} as ManageMediaPackageCatalogService,
    {} as ResolveEffectiveSubscriptionStateService,
    {} as never,
    {} as BillingProviderPort,
    {
      async recordEvent() {
        recordEventCallCount += 1;
        // Second call simulates already-recorded (idempotency gate)
        return { recorded: recordEventCallCount === 1 };
      }
    } as unknown as WorkspaceVcoinLedgerEventRepository,
    {
      async credit() {
        creditCallCount += 1;
        return { balanceVc: 1000, previousBalanceVc: 0, creditedAt: new Date() };
      }
    } as unknown as WorkspaceVcoinBalanceRepository
  );

  (service as unknown as { logger: { log: (msg: string) => void } }).logger = {
    log: (msg: string) => logLines.push(msg)
  };

  // First call — should credit
  await service.fulfillPackagePaymentIntent(paymentIntentId, workspaceId, "user-1");
  assert.equal(creditCallCount, 1, "first call credits");
  assert.equal(logLines.length, 1, "first call emits log");

  // Second call — recorded=false → should NOT re-credit
  await service.fulfillPackagePaymentIntent(paymentIntentId, workspaceId, "user-1");
  assert.equal(creditCallCount, 1, "second call must not re-credit (idempotent)");
  assert.equal(logLines.length, 1, "second call must not emit additional log");
}

// ── fulfillPackagePaymentIntent — zero video units → no VC movement ───────────

async function runFulfillZeroVideoUnitsNoVCMovement(): Promise<void> {
  const paymentIntentId = "pi-zero-5555-5555-5555-555555555555";
  const workspaceId = "ws-zero-1";

  let recordEventCallCount = 0;
  let creditCallCount = 0;

  const mockTx = {
    workspaceMediaPackageGrant: {
      async upsert() {
        return {};
      }
    }
  };

  const service = new ManageMediaPackagePurchaseService(
    {
      workspacePaymentIntent: {
        async findUnique() {
          return makeIntent(paymentIntentId, workspaceId, [
            {
              catalogItemId: "cat-video-zero",
              packageType: "video_generate",
              units: 0,
              amountMinor: 0
            }
          ]);
        }
      },
      async $transaction(callback: (tx: unknown) => Promise<void>) {
        await callback(mockTx);
      }
    } as unknown as WorkspaceManagementPrismaService,
    {} as ManageMediaPackageCatalogService,
    {} as ResolveEffectiveSubscriptionStateService,
    {} as never,
    {} as BillingProviderPort,
    {
      async recordEvent() {
        recordEventCallCount += 1;
        return { recorded: true };
      }
    } as unknown as WorkspaceVcoinLedgerEventRepository,
    {
      async credit() {
        creditCallCount += 1;
        return { balanceVc: 0, previousBalanceVc: 0, creditedAt: new Date() };
      }
    } as unknown as WorkspaceVcoinBalanceRepository
  );

  await service.fulfillPackagePaymentIntent(paymentIntentId, workspaceId, "user-1");

  assert.equal(recordEventCallCount, 0, "recordEvent must NOT be called when videoVcCreditTotal=0");
  assert.equal(creditCallCount, 0, "credit must NOT be called when videoVcCreditTotal=0");
}

// ── reversePackagePaymentIntent — video package debits VC ─────────────────────

async function runReverseVideoPackageDebitsVC(): Promise<void> {
  const paymentIntentId = "pi-rev-6666-6666-6666-666666666666";
  const workspaceId = "ws-rev-1";

  const recordEventCalls: Array<Record<string, unknown>> = [];
  const debitCalls: Array<Record<string, unknown>> = [];
  const logLines: string[] = [];

  const mockTx = {};

  const service = new ManageMediaPackagePurchaseService(
    {
      workspacePaymentIntent: {
        async findUnique() {
          return makeIntent(paymentIntentId, workspaceId, [
            {
              catalogItemId: "cat-video-rev-1",
              packageType: "video_generate",
              units: 1000,
              amountMinor: 99900
            }
          ]);
        }
      },
      async $transaction(callback: (tx: unknown) => Promise<void>) {
        await callback(mockTx);
      }
    } as unknown as WorkspaceManagementPrismaService,
    {} as ManageMediaPackageCatalogService,
    {} as ResolveEffectiveSubscriptionStateService,
    {} as never,
    {} as BillingProviderPort,
    {
      async recordEvent(input: Record<string, unknown>) {
        recordEventCalls.push(input);
        return { recorded: true };
      }
    } as unknown as WorkspaceVcoinLedgerEventRepository,
    {
      async debit(input: Record<string, unknown>) {
        debitCalls.push(input);
        return { balanceVc: 0, previousBalanceVc: 1000, debitedAt: new Date() };
      },
      async credit() {
        throw new Error("credit must not be called during refund");
      }
    } as unknown as WorkspaceVcoinBalanceRepository
  );

  (service as unknown as { logger: { log: (msg: string) => void } }).logger = {
    log: (msg: string) => logLines.push(msg)
  };

  await service.reversePackagePaymentIntent({ paymentIntentId, workspaceId });

  // recordEvent with negative amountVc
  assert.equal(recordEventCalls.length, 1, "recordEvent called once for refund");
  assert.equal(recordEventCalls[0]!.kind, "package_refund");
  assert.equal(recordEventCalls[0]!.amountVc, -1000, "ledger amountVc must be negative");
  assert.equal(recordEventCalls[0]!.referenceKey, paymentIntentId);
  assert.equal(recordEventCalls[0]!.tx, mockTx, "recordEvent must use the tx");

  // debit with absolute value
  assert.equal(debitCalls.length, 1, "debit called once for refund");
  assert.equal(debitCalls[0]!.amountVc, 1000, "debit amountVc must be positive absolute value");
  assert.equal(debitCalls[0]!.tx, mockTx, "debit must use the same tx");

  // Audit log line emitted
  assert.equal(logLines.length, 1, "exactly one log line emitted");
  assert.ok(logLines[0]!.includes("adr108_vcoin_package_refund_debited"), "log has correct key");
  assert.ok(logLines[0]!.includes(`workspaceId=${workspaceId}`), "log has workspaceId");
  assert.ok(logLines[0]!.includes(`paymentIntentId=${paymentIntentId}`), "log has paymentIntentId");
  assert.ok(logLines[0]!.includes("vcDebited=1000"), "log has vcDebited");
  assert.ok(logLines[0]!.includes("previousBalanceVc=1000"), "log has previousBalanceVc");
  assert.ok(logLines[0]!.includes("balanceVc=0"), "log has balanceVc");
}

// ── reversePackagePaymentIntent — image package: VC path is no-op ─────────────

async function runReverseImagePackageNoOp(): Promise<void> {
  const paymentIntentId = "pi-img-rev-7777-7777-7777-777777777777";
  const workspaceId = "ws-img-rev-1";

  let recordEventCallCount = 0;
  let debitCallCount = 0;

  const service = new ManageMediaPackagePurchaseService(
    {
      workspacePaymentIntent: {
        async findUnique() {
          return makeIntent(paymentIntentId, workspaceId, [
            {
              catalogItemId: "cat-image-rev-1",
              packageType: "image_generate",
              units: 10,
              amountMinor: 9900
            }
          ]);
        }
      },
      async $transaction() {
        throw new Error("$transaction must not be called for image-only refund");
      }
    } as unknown as WorkspaceManagementPrismaService,
    {} as ManageMediaPackageCatalogService,
    {} as ResolveEffectiveSubscriptionStateService,
    {} as never,
    {} as BillingProviderPort,
    {
      async recordEvent() {
        recordEventCallCount += 1;
        return { recorded: true };
      }
    } as unknown as WorkspaceVcoinLedgerEventRepository,
    {
      async debit() {
        debitCallCount += 1;
        return { balanceVc: 0, previousBalanceVc: 0, debitedAt: new Date() };
      }
    } as unknown as WorkspaceVcoinBalanceRepository
  );

  await service.reversePackagePaymentIntent({ paymentIntentId, workspaceId });

  assert.equal(recordEventCallCount, 0, "recordEvent must NOT be called for image-only refund");
  assert.equal(debitCallCount, 0, "debit must NOT be called for image-only refund");
}

// ── reversePackagePaymentIntent — idempotent refund ───────────────────────────

async function runReverseIdempotentRefund(): Promise<void> {
  const paymentIntentId = "pi-idem-rev-8888-8888-8888-888888888888";
  const workspaceId = "ws-idem-rev-1";

  let debitCallCount = 0;
  let recordEventCallCount = 0;
  const logLines: string[] = [];

  const mockTx = {};

  const service = new ManageMediaPackagePurchaseService(
    {
      workspacePaymentIntent: {
        async findUnique() {
          return makeIntent(paymentIntentId, workspaceId, [
            {
              catalogItemId: "cat-video-idem-rev",
              packageType: "video_generate",
              units: 500,
              amountMinor: 49900
            }
          ]);
        }
      },
      async $transaction(callback: (tx: unknown) => Promise<void>) {
        await callback(mockTx);
      }
    } as unknown as WorkspaceManagementPrismaService,
    {} as ManageMediaPackageCatalogService,
    {} as ResolveEffectiveSubscriptionStateService,
    {} as never,
    {} as BillingProviderPort,
    {
      async recordEvent() {
        recordEventCallCount += 1;
        // Second call simulates already-recorded
        return { recorded: recordEventCallCount === 1 };
      }
    } as unknown as WorkspaceVcoinLedgerEventRepository,
    {
      async debit() {
        debitCallCount += 1;
        return { balanceVc: 0, previousBalanceVc: 500, debitedAt: new Date() };
      }
    } as unknown as WorkspaceVcoinBalanceRepository
  );

  (service as unknown as { logger: { log: (msg: string) => void } }).logger = {
    log: (msg: string) => logLines.push(msg)
  };

  // First call — should debit
  await service.reversePackagePaymentIntent({ paymentIntentId, workspaceId });
  assert.equal(debitCallCount, 1, "first call debits");
  assert.equal(logLines.length, 1, "first call emits log");

  // Second call — recorded=false → should NOT re-debit
  await service.reversePackagePaymentIntent({ paymentIntentId, workspaceId });
  assert.equal(debitCallCount, 1, "second call must not re-debit (idempotent)");
  assert.equal(logLines.length, 1, "second call must not emit additional log");
}

// ── reversePackagePaymentIntent — payment intent not found ────────────────────

async function runReverseIntentNotFound(): Promise<void> {
  const paymentIntentId = "pi-missing-9999-9999-9999-999999999999";
  const workspaceId = "ws-missing-1";

  const service = new ManageMediaPackagePurchaseService(
    {
      workspacePaymentIntent: {
        async findUnique() {
          return null;
        }
      }
    } as unknown as WorkspaceManagementPrismaService,
    {} as ManageMediaPackageCatalogService,
    {} as ResolveEffectiveSubscriptionStateService,
    {} as never,
    {} as BillingProviderPort,
    {} as WorkspaceVcoinLedgerEventRepository,
    {} as WorkspaceVcoinBalanceRepository
  );

  await assert.rejects(
    () => service.reversePackagePaymentIntent({ paymentIntentId, workspaceId }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes(paymentIntentId),
        "error message must include the payment intent id"
      );
      return true;
    }
  );
}

// ── reversePackagePaymentIntent — mixed intent: only video VC is debited ──────

async function runReverseMixedIntentOnlyVideoDebited(): Promise<void> {
  const paymentIntentId = "pi-mixed-rev-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const workspaceId = "ws-mixed-rev-1";

  const recordEventCalls: Array<Record<string, unknown>> = [];
  const debitCalls: Array<Record<string, unknown>> = [];

  const mockTx = {};

  const service = new ManageMediaPackagePurchaseService(
    {
      workspacePaymentIntent: {
        async findUnique() {
          return makeIntent(paymentIntentId, workspaceId, [
            {
              catalogItemId: "cat-image-mixed-rev",
              packageType: "image_generate",
              units: 10,
              amountMinor: 9900
            },
            {
              catalogItemId: "cat-video-mixed-rev",
              packageType: "video_generate",
              units: 800,
              amountMinor: 79900
            }
          ]);
        }
      },
      async $transaction(callback: (tx: unknown) => Promise<void>) {
        await callback(mockTx);
      }
    } as unknown as WorkspaceManagementPrismaService,
    {} as ManageMediaPackageCatalogService,
    {} as ResolveEffectiveSubscriptionStateService,
    {} as never,
    {} as BillingProviderPort,
    {
      async recordEvent(input: Record<string, unknown>) {
        recordEventCalls.push(input);
        return { recorded: true };
      }
    } as unknown as WorkspaceVcoinLedgerEventRepository,
    {
      async debit(input: Record<string, unknown>) {
        debitCalls.push(input);
        return { balanceVc: 0, previousBalanceVc: 800, debitedAt: new Date() };
      }
    } as unknown as WorkspaceVcoinBalanceRepository
  );

  await service.reversePackagePaymentIntent({ paymentIntentId, workspaceId });

  // Only video VC debited
  assert.equal(recordEventCalls.length, 1, "exactly one recordEvent for video total");
  assert.equal(recordEventCalls[0]!.amountVc, -800, "debit ledger entry for video total only");
  assert.equal(debitCalls.length, 1, "exactly one debit call");
  assert.equal(debitCalls[0]!.amountVc, 800);
  // image grant rows are NOT touched (no $transaction call for grant operations)
}

// ── Runner ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  await runCreatePackagePaymentIntent();
  await runFulfillVideoPackageCreditedVC();
  await runFulfillImagePackageWritesGrant();
  await runFulfillMixedIntentVideoAndImage();
  await runFulfillIdempotentPurchase();
  await runFulfillZeroVideoUnitsNoVCMovement();
  await runReverseVideoPackageDebitsVC();
  await runReverseImagePackageNoOp();
  await runReverseIdempotentRefund();
  await runReverseIntentNotFound();
  await runReverseMixedIntentOnlyVideoDebited();
  console.log("manage-media-package-purchase.service: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
