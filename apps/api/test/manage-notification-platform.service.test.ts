import assert from "node:assert/strict";
import { ManageNotificationPlatformService } from "../src/modules/workspace-management/application/notifications/manage-notification-platform.service";

async function run(): Promise<void> {
  const deliveryWhereCalls: Array<Record<string, unknown>> = [];
  const deadLetterWhereCalls: Array<Record<string, unknown>> = [];

  const makeService = (hasGlobalPlatformAdminScope: boolean) =>
    new ManageNotificationPlatformService(
      {
        notificationIntent: {
          async count(args: { where: Record<string, unknown> }) {
            deliveryWhereCalls.push(args.where);
            return 0;
          },
          async findMany(args: { where: Record<string, unknown> }) {
            deliveryWhereCalls.push(args.where);
            return [];
          }
        },
        notificationDeadLetter: {
          async count(args: { where: Record<string, unknown> }) {
            deadLetterWhereCalls.push(args.where);
            return 0;
          },
          async findMany(args: { where: Record<string, unknown> }) {
            deadLetterWhereCalls.push(args.where);
            return [];
          }
        }
      } as never,
      {
        async assertCanManageAdminSystemNotifications() {
          return {
            userId: "admin-1",
            workspaceId: "ws-admin",
            roles: ["ops_admin"],
            hasLegacyOwnerFallback: false,
            hasGlobalPlatformAdminScope
          };
        }
      } as never,
      {} as never,
      {} as never,
      {} as never,
      []
    );

  {
    const service = makeService(false);
    await service.listDeliveries("admin-1", {});
    await service.listDeadLetters("admin-1", {});
    assert.equal(deliveryWhereCalls[0]?.workspaceId, "ws-admin");
    assert.equal(deadLetterWhereCalls[0]?.workspaceId, "ws-admin");
    console.log("✓ scoped admins only see notification history for their workspace");
  }

  deliveryWhereCalls.length = 0;
  deadLetterWhereCalls.length = 0;

  {
    const service = makeService(true);
    await service.listDeliveries("admin-1", {});
    await service.listDeadLetters("admin-1", {});
    assert.ok(!("workspaceId" in deliveryWhereCalls[0]!));
    assert.ok(!("workspaceId" in deadLetterWhereCalls[0]!));
    console.log("✓ global platform admins can query notification history across workspaces");
  }

  {
    const deliveredTemplates: Array<string | null> = [];
    const service = new ManageNotificationPlatformService(
      {
        notificationIntent: {
          async count() {
            return 0;
          },
          async findMany() {
            return [];
          }
        },
        notificationDeadLetter: {
          async count() {
            return 0;
          },
          async findMany() {
            return [];
          }
        },
        notificationPolicy: {
          async findUnique() {
            return {
              source: "billing_lifecycle",
              channels: ["email"],
              config: {},
              escalationChannel: null
            };
          }
        },
        assistant: {
          async findUnique() {
            return { id: "assistant-1", preferredNotificationChannel: "web" };
          }
        },
        appUser: {
          async findUnique() {
            return { email: "admin@persai.dev" };
          }
        },
        notificationChannelRegistry: {
          async findUnique() {
            return {
              id: "channel-email",
              channelType: "email",
              enabled: true,
              config: {},
              healthStatus: "healthy",
              consecutiveFailures: 0,
              lastDeliveryAt: null,
              lastFailureAt: null,
              createdAt: new Date("2026-05-01T00:00:00.000Z"),
              updatedAt: new Date("2026-05-01T00:00:00.000Z")
            };
          },
          async update() {
            return null;
          }
        }
      } as never,
      {
        async assertCanManageAdminSystemNotifications() {
          return {
            userId: "admin-1",
            workspaceId: "ws-admin",
            roles: ["ops_admin"],
            hasLegacyOwnerFallback: false,
            hasGlobalPlatformAdminScope: true
          };
        }
      } as never,
      {
        async render(intent: { templateId: string | null }) {
          deliveredTemplates.push(intent.templateId);
          return {
            subject: "test",
            body: "test",
            html: "<p>test</p>",
            plainText: "test"
          };
        }
      } as never,
      {} as never,
      {} as never,
      [
        {
          channelType: "email",
          async deliver() {
            return { status: "delivered" };
          }
        }
      ] as never
    );

    const paymentActivated = await service.testSendForSource("admin-1", "billing_lifecycle", {
      eventCode: "payment_activated"
    });
    const renewalSucceeded = await service.testSendForSource("admin-1", "billing_lifecycle", {
      eventCode: "renewal_succeeded"
    });

    assert.equal(paymentActivated.status, "delivered");
    assert.equal(renewalSucceeded.status, "delivered");
    assert.deepEqual(deliveredTemplates, [
      "billing.payment_activated",
      "billing.renewal_succeeded"
    ]);
    console.log("✓ billing lifecycle admin test-send supports payment success templates");
  }
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
