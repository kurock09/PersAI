import assert from "node:assert/strict";
import { ManageAdminAssistantOwnershipService } from "../src/modules/workspace-management/application/manage-admin-assistant-ownership.service";

function buildService(options: {
  targetAssistantCount?: number;
  maxAssistantsFromPlan?: number | null;
  auditEvents?: unknown[];
}) {
  const auditEvents = options.auditEvents ?? [];

  const billingProviderHints =
    options.maxAssistantsFromPlan != null && options.maxAssistantsFromPlan > 1
      ? { assistantPolicy: { maxAssistants: options.maxAssistantsFromPlan } }
      : null;

  return new ManageAdminAssistantOwnershipService(
    {
      assertCanPerformDangerousAdminAction: async () => ({
        userId: "admin-1",
        workspaceId: "ws-1",
        roles: ["ops_admin"]
      })
    } as never,
    {
      execute: async (event: unknown) => {
        auditEvents.push(event);
      }
    } as never,
    {
      findByCode: async () => ({ billingProviderHints }) as never,
      findDefaultRegistrationPlan: async () => null
    } as never,
    {
      assistant: {
        findUnique: async ({ where }: { where: { id?: string } }) => {
          if (where.id === "assistant-1") {
            return {
              id: "assistant-1",
              userId: "user-old",
              workspaceId: "ws-1"
            };
          }
          return null;
        },
        count: async ({
          where
        }: {
          where: { userId?: string; workspaceId?: string; id?: unknown };
        }) => {
          if (where.userId === "user-new") {
            return options.targetAssistantCount ?? 0;
          }
          return 0;
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
      },
      workspaceSubscription: {
        findUnique: async () => ({
          planCode: "pro"
        })
      }
    } as never
  );
}

async function run(): Promise<void> {
  const auditEvents: unknown[] = [];
  const service = buildService({ targetAssistantCount: 0, auditEvents });

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

  // Target already at plan limit (maxAssistants=1, target has 1): transfer must be blocked.
  const atLimitService = buildService({ targetAssistantCount: 1, maxAssistantsFromPlan: null });
  const blockedInput = atLimitService.parseTransferInput({
    assistantId: "assistant-1",
    currentOwnerUserId: "user-old",
    targetOwnerUserId: "user-new",
    reason: "should be blocked"
  });
  await assert.rejects(
    () => atLimitService.transferOwnership("admin-1", blockedInput, "step-up-token"),
    (err: Error) => {
      assert.ok(err.message.includes("maximum number of assistants"), `unexpected: ${err.message}`);
      assert.ok(err.message.includes("1"), `expected limit 1 in: ${err.message}`);
      return true;
    }
  );

  // Target has 1 existing assistant but plan allows 3: transfer must be allowed.
  const multiPlanService = buildService({ targetAssistantCount: 1, maxAssistantsFromPlan: 3 });
  const multiInput = multiPlanService.parseTransferInput({
    assistantId: "assistant-1",
    currentOwnerUserId: "user-old",
    targetOwnerUserId: "user-new",
    reason: "multi-assistant workspace transfer"
  });
  const multiResult = await multiPlanService.transferOwnership(
    "admin-1",
    multiInput,
    "step-up-token"
  );
  assert.equal(multiResult.mode, "transfer");
  assert.equal(multiResult.newOwnerUserId, "user-new");
}

void run();
