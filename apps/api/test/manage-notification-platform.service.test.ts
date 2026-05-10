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
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
