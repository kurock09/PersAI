import assert from "node:assert/strict";
import { ManageAdminAssistantOwnershipService } from "../src/modules/workspace-management/application/manage-admin-assistant-ownership.service";

async function run(): Promise<void> {
  const auditEvents: unknown[] = [];
  const service = new ManageAdminAssistantOwnershipService(
    {
      assertCanPerformDangerousAdminAction: async () => ({
        userId: "admin-1",
        workspaceId: "ws-1",
        roles: ["ops_admin"],
        hasLegacyOwnerFallback: false
      })
    } as never,
    {
      execute: async (event: unknown) => {
        auditEvents.push(event);
      }
    } as never,
    {
      assistant: {
        findUnique: async ({ where }: { where: { id?: string; userId?: string } }) => {
          if (where.id === "assistant-1") {
            return {
              id: "assistant-1",
              userId: "user-old",
              workspaceId: "ws-1"
            };
          }
          if (where.userId === "user-new") {
            return null;
          }
          return null;
        },
        update: async () => ({
          id: "assistant-1",
          userId: "user-new",
          workspaceId: "ws-1"
        })
      },
      workspaceMember: {
        findUnique: async () => ({
          id: "wm-1"
        })
      }
    } as never
  );

  const transferInput = service.parseTransferInput({
    assistantId: "assistant-1",
    currentOwnerUserId: "user-old",
    targetOwnerUserId: "user-new",
    reason: "support assisted migration"
  });
  const transfer = await service.transferOwnership("admin-1", transferInput, "step-up-token");
  assert.equal(transfer.mode, "transfer");
  assert.equal(transfer.previousOwnerUserId, "user-old");
  assert.equal(transfer.newOwnerUserId, "user-new");
  assert.equal(transfer.consequences.resetTriggered, false);
  assert.equal(transfer.consequences.deletionTriggered, false);

  const recoveryInput = service.parseRecoveryInput({
    assistantId: "assistant-1",
    recoveredOwnerUserId: "user-new",
    supportTicketRef: "SUP-123",
    reason: "account recovery"
  });
  const recovery = await service.recoverOwnership("admin-1", recoveryInput, "step-up-token");
  assert.equal(recovery.mode, "recovery");
  assert.equal(recovery.supportTicketRef, "SUP-123");
  assert.equal(auditEvents.length, 2);
}

void run();
