import assert from "node:assert/strict";
import { ManageAdminSafetyControlsService } from "../src/modules/workspace-management/application/manage-admin-safety-controls.service";

function ensureApiConfigEnv(): void {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://local:test@localhost:5432/test";
  process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "clerk_test_secret";
  process.env.PERSAI_INTERNAL_API_TOKEN =
    process.env.PERSAI_INTERNAL_API_TOKEN ?? "internal-api-token";
}

async function run(): Promise<void> {
  ensureApiConfigEnv();
  const auditEvents: unknown[] = [];
  const service = new ManageAdminSafetyControlsService(
    {
      assertCanManageSafetyControls: async () => ({
        userId: "admin-1",
        workspaceId: "ws-1",
        roles: ["security_admin"],
        hasGlobalPlatformAdminScope: true
      }),
      assertCanPerformDangerousAdminAction: async () => ({
        userId: "admin-1",
        workspaceId: "ws-1",
        roles: ["security_admin"],
        hasGlobalPlatformAdminScope: true
      })
    } as never,
    {
      execute: async (event: unknown) => {
        auditEvents.push(event);
      }
    } as never,
    {
      appUser: {
        findUnique: async () => ({
          email: "user@example.com",
          displayName: "User"
        })
      },
      workspaceMember: {
        findFirst: async () => ({ workspaceId: "ws-1" })
      },
      userRestriction: {
        findMany: async () => [],
        count: async () => 0
      },
      moderationCase: {
        findMany: async () => []
      },
      assistant: {
        findUnique: async () => null
      }
    } as never,
    {
      async findActiveSafetyRestriction() {
        return {
          id: "restriction-1",
          userId: "user-1",
          kind: "safety" as const,
          status: "active" as const,
          blockedUntil: null,
          reasonCode: "violence_extremism",
          source: "moderation_auto" as const,
          sourceAssistantId: "assistant-1",
          sourceModerationCaseId: "case-1",
          clearedAt: null,
          clearedByUserId: null,
          createdAt: new Date("2026-06-14T00:00:00.000Z"),
          updatedAt: new Date("2026-06-14T00:00:00.000Z")
        };
      },
      async findActiveSafetyRestrictionsForUserIds() {
        return new Map();
      },
      async clearActiveSafetyRestriction(userId: string, clearedByUserId: string) {
        assert.equal(userId, "user-1");
        assert.equal(clearedByUserId, "admin-1");
        return {
          id: "restriction-1",
          userId: "user-1",
          kind: "safety" as const,
          status: "cleared" as const,
          blockedUntil: null,
          reasonCode: "violence_extremism",
          source: "moderation_auto" as const,
          sourceAssistantId: "assistant-1",
          sourceModerationCaseId: "case-1",
          clearedAt: new Date("2026-06-14T01:00:00.000Z"),
          clearedByUserId,
          createdAt: new Date("2026-06-14T00:00:00.000Z"),
          updatedAt: new Date("2026-06-14T01:00:00.000Z")
        };
      },
      async upsertAdminSafetyRestriction() {
        return {
          id: "restriction-2",
          userId: "user-1",
          kind: "safety" as const,
          status: "active" as const,
          blockedUntil: null,
          reasonCode: "admin_manual",
          source: "admin" as const,
          sourceAssistantId: null,
          sourceModerationCaseId: null,
          clearedAt: null,
          clearedByUserId: null,
          createdAt: new Date("2026-06-14T02:00:00.000Z"),
          updatedAt: new Date("2026-06-14T02:00:00.000Z")
        };
      }
    } as never
  );

  const unblock = await service.unblock("admin-1", { userId: "user-1" });
  assert.deepEqual(unblock, { userId: "user-1", cleared: true });
  assert.equal(auditEvents.length, 1);
  assert.equal(
    (auditEvents[0] as { eventCode?: string }).eventCode,
    "admin.safety_user_unrestricted"
  );

  const parsed = service.parseRestrictInput({
    userId: "user-1",
    reasonCode: "admin_manual"
  });
  assert.deepEqual(parsed, {
    userId: "user-1",
    reasonCode: "admin_manual",
    sourceAssistantId: null,
    blockedUntil: null
  });

  auditEvents.length = 0;
  const restrict = await service.restrict(
    "admin-1",
    { userId: "user-1", reasonCode: "admin_manual", sourceAssistantId: null, blockedUntil: null },
    "step-up-token"
  );
  assert.deepEqual(restrict, { userId: "user-1", restricted: true, reasonCode: "admin_manual" });
  assert.equal(auditEvents.length, 1);
  assert.equal(
    (auditEvents[0] as { eventCode?: string }).eventCode,
    "admin.safety_user_restricted"
  );
  assert.equal(
    (auditEvents[0] as { details?: { userEmail?: string } }).details?.userEmail,
    "user@example.com"
  );
}

run()
  .then(() => {
    console.log("manage-admin-safety-controls.service.test.ts: ok");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
