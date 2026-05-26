import assert from "node:assert/strict";
import { ManageMediaPackagePurchaseService } from "../src/modules/workspace-management/application/manage-media-package-purchase.service";
import type { BillingProviderPort } from "../src/modules/workspace-management/application/billing-provider.port";
import type { ManageMediaPackageCatalogService } from "../src/modules/workspace-management/application/manage-media-package-catalog.service";
import type { ResolveEffectiveSubscriptionStateService } from "../src/modules/workspace-management/application/resolve-effective-subscription-state.service";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

async function run(): Promise<void> {
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
    } as Pick<BillingProviderPort, "createCheckoutSession"> as BillingProviderPort
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

void run();
