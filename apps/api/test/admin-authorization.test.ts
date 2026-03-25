import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { AdminAuthorizationService } from "../src/modules/workspace-management/application/admin-authorization.service";

const ORIGINAL_ENV = { ...process.env };

function applyBaseEnv(overrides: NodeJS.ProcessEnv = {}): void {
  process.env = {
    ...ORIGINAL_ENV,
    APP_ENV: "local",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public",
    CLERK_SECRET_KEY: "clerk-secret",
    OPENCLAW_ADAPTER_ENABLED: "false",
    ...overrides
  };
}

function createService(params: {
  memberships: Array<{ workspaceId: string; role: "owner" | "member"; createdAt: Date }>;
  adminRoles: Array<{
    roleCode: "ops_admin" | "business_admin" | "security_admin" | "super_admin";
    workspaceId: string | null;
  }>;
  env?: NodeJS.ProcessEnv;
}): AdminAuthorizationService {
  applyBaseEnv(params.env);
  return new AdminAuthorizationService({
    workspaceMember: {
      findMany: async () => params.memberships
    },
    appUserAdminRole: {
      findMany: async () => params.adminRoles
    }
  } as never);
}

async function run(): Promise<void> {
  const scopedRoleService = createService({
    memberships: [
      {
        workspaceId: "ws-member",
        role: "member",
        createdAt: new Date("2026-03-25T10:00:00.000Z")
      },
      {
        workspaceId: "ws-owner",
        role: "owner",
        createdAt: new Date("2026-03-20T10:00:00.000Z")
      }
    ],
    adminRoles: [{ roleCode: "security_admin", workspaceId: "ws-owner" }]
  });

  const scopedContext = await scopedRoleService.assertCanManageAdminSystemNotifications("user-1");
  assert.equal(scopedContext.workspaceId, "ws-owner");
  assert.equal(scopedContext.hasLegacyOwnerFallback, true);
  assert.equal(scopedContext.roles.includes("security_admin"), true);

  const issuer = createService({
    memberships: [
      {
        workspaceId: "ws-1",
        role: "member",
        createdAt: new Date("2026-03-25T12:00:00.000Z")
      }
    ],
    adminRoles: [{ roleCode: "super_admin", workspaceId: null }],
    env: {
      ADMIN_STEP_UP_HMAC_SECRET: "step-up-secret-a"
    }
  });
  const verifier = createService({
    memberships: [
      {
        workspaceId: "ws-1",
        role: "member",
        createdAt: new Date("2026-03-25T12:00:00.000Z")
      }
    ],
    adminRoles: [{ roleCode: "super_admin", workspaceId: null }],
    env: {
      ADMIN_STEP_UP_HMAC_SECRET: "step-up-secret-b"
    }
  });

  const { challenge } = await issuer.issueStepUpChallenge("user-1", "admin.rollout.apply");
  await assert.rejects(
    () =>
      verifier.assertCanPerformDangerousAdminAction(
        "user-1",
        "admin.rollout.apply",
        challenge.token
      ),
    ForbiddenException
  );

  const { challenge: runtimeSettingsChallenge } = await issuer.issueStepUpChallenge(
    "user-1",
    "admin.runtime_provider_settings.update"
  );
  await assert.rejects(
    () =>
      verifier.assertCanPerformDangerousAdminAction(
        "user-1",
        "admin.runtime_provider_settings.update",
        runtimeSettingsChallenge.token
      ),
    ForbiddenException
  );
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.env = { ...ORIGINAL_ENV };
  });
