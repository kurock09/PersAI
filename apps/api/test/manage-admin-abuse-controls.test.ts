import assert from "node:assert/strict";
import { ManageAdminAbuseControlsService } from "../src/modules/workspace-management/application/manage-admin-abuse-controls.service";

function ensureApiConfigEnv(): void {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://local:test@localhost:5432/test";
  process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "clerk_test_secret";
  process.env.ABUSE_ADMIN_OVERRIDE_MINUTES_DEFAULT = "15";
}

async function run(): Promise<void> {
  ensureApiConfigEnv();
  const auditEvents: unknown[] = [];
  const service = new ManageAdminAbuseControlsService(
    {
      assertCanManageAbuseControls: async () => ({
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
        findUnique: async () => ({
          id: "assistant-1",
          userId: "user-1",
          workspaceId: "ws-1"
        })
      }
    } as never,
    {
      applyAdminUnblock: async () => ({ userRows: 1, assistantRows: 1 })
    } as never
  );

  const parsed = service.parseUnblockInput({
    assistantId: "assistant-1",
    userId: "user-1",
    surface: "web_chat",
    overrideMinutes: 10
  });
  assert.equal(parsed.assistantId, "assistant-1");
  assert.equal(parsed.userId, "user-1");
  assert.equal(parsed.surface, "web_chat");

  const result = await service.unblock("admin-1", parsed);
  assert.equal(result.assistantId, "assistant-1");
  assert.equal(result.userId, "user-1");
  assert.equal(result.surface, "web_chat");
  assert.equal(result.affectedUserRows, 1);
  assert.equal(result.affectedAssistantRows, 1);
  assert.equal(auditEvents.length, 1);
}

void run();
