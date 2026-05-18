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
      { forUserInWorkspace: async () => "en" as const } as never,
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
          async upsert() {
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

  {
    const service = new ManageNotificationPlatformService(
      {
        notificationChannelRegistry: {
          async findMany() {
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
            hasGlobalPlatformAdminScope: true
          };
        }
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { forUserInWorkspace: async () => "en" as const } as never,
      []
    );

    const channels = await service.listChannels("admin-1");
    assert.equal(channels.length, 7);
    assert.equal(channels[0]?.channelType, "telegram_thread");
    assert.equal(channels[3]?.channelType, "email");
    assert.equal(channels[3]?.enabled, true);
    assert.equal(channels[3]?.healthStatus, "unconfigured");
    assert.equal(channels[4]?.channelType, "admin_webhook");
    assert.equal(channels[4]?.enabled, false);
    console.log("✓ listChannels exposes global defaults when registry rows are missing");
  }

  {
    const upsertCalls: Array<Record<string, unknown>> = [];
    const updatedRows: Array<Record<string, unknown>> = [];
    const service = new ManageNotificationPlatformService(
      {
        notificationChannelRegistry: {
          async upsert(args: { create: Record<string, unknown> }) {
            upsertCalls.push(args.create);
            return {
              id: "channel-email",
              channelType: "email" as const,
              enabled: args.create.enabled,
              config: args.create.config,
              healthStatus: args.create.healthStatus,
              consecutiveFailures: 0,
              lastDeliveryAt: null,
              lastFailureAt: null,
              createdAt: new Date("2026-05-01T00:00:00.000Z"),
              updatedAt: new Date("2026-05-01T00:00:00.000Z")
            };
          },
          async update(args: { data: Record<string, unknown> }) {
            updatedRows.push(args.data);
            return {
              id: "channel-email",
              channelType: "email",
              enabled: args.data.enabled ?? true,
              config: args.data.config ?? { sendingDomain: "notifications.persai.dev" },
              healthStatus: args.data.healthStatus ?? "healthy",
              consecutiveFailures: 0,
              lastDeliveryAt: null,
              lastFailureAt: null,
              createdAt: new Date("2026-05-01T00:00:00.000Z"),
              updatedAt: new Date("2026-05-01T00:00:00.000Z")
            };
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
      {} as never,
      {} as never,
      {} as never,
      { forUserInWorkspace: async () => "en" as const } as never,
      []
    );

    const result = await service.patchChannel("admin-1", "email", {
      enabled: false
    });
    assert.equal(upsertCalls[0]?.channelType, "email");
    assert.deepEqual(upsertCalls[0]?.config, { sendingDomain: "notifications.persai.dev" });
    assert.equal(upsertCalls[0]?.healthStatus, "unconfigured");
    assert.equal(updatedRows[0]?.enabled, false);
    assert.equal(result.enabled, false);
    console.log(
      "✓ patchChannel materializes a missing global row from defaults with race-safe upsert"
    );
  }

  {
    const service = new ManageNotificationPlatformService(
      {
        notificationQuietHours: {
          async findFirst() {
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
      {} as never,
      {} as never,
      {} as never,
      { forUserInWorkspace: async () => "en" as const } as never,
      []
    );

    const quietHours = await service.getQuietHours("admin-1");
    assert.equal(quietHours?.enabled, false);
    assert.equal(quietHours?.startLocal, "22:00");
    assert.equal(quietHours?.endLocal, "08:00");
    console.log("✓ getQuietHours falls back to global defaults when DB row is missing");
  }
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
