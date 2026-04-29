import assert from "node:assert/strict";
import { WorkspaceNotificationPolicySource } from "@prisma/client";
import { ManageAdminNotificationChannelsService } from "../src/modules/workspace-management/application/manage-admin-notification-channels.service";

class FakePrisma {
  policy: {
    enabled: boolean;
    idleHours: number;
    cooldownHours: number;
    llmInstruction: string;
    updatedAt: Date;
    updatedByUserId: string | null;
  } | null = null;

  workspaceNotificationPolicy = {
    findUnique: async () => this.policy,
    upsert: async ({
      create,
      update
    }: {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const source = (create.source ?? update.source) as WorkspaceNotificationPolicySource;
      assert.equal(source, WorkspaceNotificationPolicySource.idle_reengagement);
      this.policy = {
        enabled: Boolean(update.enabled ?? create.enabled),
        idleHours: Number(update.idleHours ?? create.idleHours),
        cooldownHours: Number(update.cooldownHours ?? create.cooldownHours),
        llmInstruction: String(update.llmInstruction ?? create.llmInstruction),
        updatedAt: new Date("2026-04-29T00:00:00.000Z"),
        updatedByUserId: String(update.updatedByUserId ?? create.updatedByUserId)
      };
      return this.policy;
    }
  };

  workspaceAdminNotificationChannel = {
    findMany: async () => [],
    upsert: async () => ({})
  };

  adminNotificationDelivery = {
    findFirst: async () => null
  };
}

function createService(prisma: FakePrisma): ManageAdminNotificationChannelsService {
  return new ManageAdminNotificationChannelsService(
    prisma as never,
    {
      assertCanReadAdminSurface: async () => ({
        workspaceId: "ws-1",
        roles: ["ops_admin"],
        hasLegacyOwnerFallback: false
      }),
      assertCanManageAdminSystemNotifications: async () => ({
        workspaceId: "ws-1",
        roles: ["ops_admin"],
        hasLegacyOwnerFallback: false
      })
    } as never,
    { execute: async () => undefined } as never
  );
}

async function runDefaultPolicyTest(): Promise<void> {
  const service = createService(new FakePrisma());
  const policy = await service.getIdleReengagementPolicy("user-1");

  assert.equal(policy.source, "idle_reengagement");
  assert.equal(policy.enabled, false);
  assert.equal(policy.idleHours, 24);
  assert.equal(policy.cooldownHours, 72);
  assert.ok(policy.llmInstruction.includes("short, warm"));
}

async function runUpdatePolicyTest(): Promise<void> {
  const prisma = new FakePrisma();
  const service = createService(prisma);
  const input = service.parseIdleReengagementPolicyUpdateInput({
    enabled: true,
    idleHours: 24,
    cooldownHours: 72,
    llmInstruction: "Use context and decide push/no_push."
  });

  const policy = await service.updateIdleReengagementPolicy("user-1", input);

  assert.equal(policy.enabled, true);
  assert.equal(policy.idleHours, 24);
  assert.equal(policy.cooldownHours, 72);
  assert.equal(policy.llmInstruction, "Use context and decide push/no_push.");
  assert.equal(policy.updatedByUserId, "user-1");
}

function runValidationTest(): void {
  const service = createService(new FakePrisma());
  assert.throws(
    () =>
      service.parseIdleReengagementPolicyUpdateInput({
        enabled: true,
        idleHours: 0,
        cooldownHours: 72,
        llmInstruction: "x"
      }),
    /idleHours/
  );
  assert.throws(
    () =>
      service.parseIdleReengagementPolicyUpdateInput({
        enabled: true,
        idleHours: 24,
        cooldownHours: 72,
        llmInstruction: ""
      }),
    /llmInstruction/
  );
}

async function run(): Promise<void> {
  await runDefaultPolicyTest();
  await runUpdatePolicyTest();
  runValidationTest();
  console.log("manage admin notification channels tests passed");
}

void run();
