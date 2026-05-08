/**
 * ADR-088 Slice 2.5 closeout — admin-notifications controller authz integration.
 *
 * Verifies that EVERY endpoint on `/api/v1/admin/notifications/*` is gated by
 * `AdminAuthorizationService.assertCanManageAdminSystemNotifications` —
 * including the `POST /channels/:channelType/test-send` dry-run endpoint
 * (the Slice 2.5 audit found this one bypassed the gate).
 *
 * The test wires the real `AdminAuthorizationService` and the real
 * `ManageNotificationPlatformService` with stub Prisma surfaces. The non-admin
 * user has zero workspace memberships, so `assertCanManageAdminSystemNotifications`
 * throws `ForbiddenException` via "Admin access requires workspace membership."
 * before any controller path can mutate state.
 */
import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { AdminAuthorizationService } from "../src/modules/workspace-management/application/admin-authorization.service";
import { ManageNotificationPlatformService } from "../src/modules/workspace-management/application/notifications/manage-notification-platform.service";
import { AdminNotificationsController } from "../src/modules/workspace-management/interface/http/admin-notifications.controller";

const ORIGINAL_ENV = { ...process.env };

function applyBaseEnv(): void {
  process.env = {
    ...ORIGINAL_ENV,
    APP_ENV: "local",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public",
    CLERK_SECRET_KEY: "clerk-secret",
    PERSAI_INTERNAL_API_TOKEN: "internal-api-token"
  };
}

function buildAuthService(opts: {
  hasMembership: boolean;
  hasAdminRole: boolean;
}): AdminAuthorizationService {
  applyBaseEnv();
  return new AdminAuthorizationService({
    workspaceMember: {
      findMany: async () =>
        opts.hasMembership
          ? [
              {
                workspaceId: "ws-1",
                role: "owner" as const,
                createdAt: new Date("2026-03-20T10:00:00.000Z")
              }
            ]
          : []
    },
    appUserAdminRole: {
      findMany: async () =>
        opts.hasAdminRole ? [{ roleCode: "ops_admin" as const, workspaceId: null }] : []
    },
    appUser: {
      findUnique: async () => ({ email: "user@local.test" })
    }
  } as never);
}

function buildController(authService: AdminAuthorizationService): AdminNotificationsController {
  // Prisma surface — none of these should be reached for a non-admin user.
  const failingPrismaProxy = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "then") {
          return undefined;
        }
        return new Proxy(
          {},
          {
            get(_inner, op) {
              return async () => {
                throw new Error(
                  `Prisma method invoked without admin gate: ${String(key)}.${String(op)}`
                );
              };
            }
          }
        );
      }
    }
  );

  // Renderers — the dry-run preview endpoint normally calls these, but the
  // admin gate must reject before they are invoked.
  const failingRenderer = new Proxy(
    {},
    {
      get() {
        return async () => {
          throw new Error("Renderer invoked without admin gate.");
        };
      }
    }
  );

  const manageService = new ManageNotificationPlatformService(
    failingPrismaProxy as never,
    authService,
    failingRenderer as never,
    failingRenderer as never
  );
  return new AdminNotificationsController(manageService);
}

function fakeReq(userId: string | null): {
  requestId: string | null;
  resolvedAppUser: { id: string } | undefined;
} {
  return {
    requestId: "req-test",
    resolvedAppUser: userId === null ? undefined : { id: userId }
  };
}

async function expectForbidden(label: string, fn: () => Promise<unknown>): Promise<void> {
  await assert.rejects(
    fn,
    (err: unknown) => {
      assert.ok(err instanceof ForbiddenException, `${label} did not throw ForbiddenException`);
      return true;
    },
    `${label} must reject non-admin user with ForbiddenException`
  );
}

async function run(): Promise<void> {
  const nonAdminAuth = buildAuthService({ hasMembership: false, hasAdminRole: false });
  const controller = buildController(nonAdminAuth);
  const req = fakeReq("non-admin-user") as never;

  await expectForbidden("GET /channels", () => controller.listUnifiedChannels(req));
  await expectForbidden("PATCH /channels/:channelType", () =>
    controller.patchChannel(req, "email", { enabled: false })
  );
  // The Slice 2.5 audit gap: dry-run test-send had no admin gate.
  await expectForbidden("POST /channels/:channelType/test-send", () =>
    controller.testSendChannel(req, "email")
  );
  await expectForbidden("GET /policies", () => controller.listPolicies(req));
  await expectForbidden("PATCH /policies/:source", () =>
    controller.patchPolicy(req, "billing_lifecycle", { enabled: false })
  );
  await expectForbidden("GET /quiet-hours", () => controller.getQuietHours(req));
  await expectForbidden("PATCH /quiet-hours", () =>
    controller.patchQuietHours(req, { enabled: false })
  );
  await expectForbidden("GET /deliveries", () => controller.listDeliveries(req, {}));
  await expectForbidden("GET /deliveries/:intentId", () => controller.getDelivery(req, "intent-1"));
  await expectForbidden("GET /dead-letters", () => controller.listDeadLetters(req, {}));
  await expectForbidden("POST /dead-letters/:id/replay", () =>
    controller.replayDeadLetter(req, "dl-1")
  );
  await expectForbidden("POST /dead-letters/:id/discard", () =>
    controller.discardDeadLetter(req, "dl-1")
  );
  await expectForbidden("POST /preview", () =>
    controller.preview(req, { renderStrategy: "static_fallback", factPayload: {} })
  );

  // Sanity: when the request has no resolved app user, every endpoint must
  // throw `UnauthorizedException` (not silently 200).
  const noAuthReq = fakeReq(null) as never;
  await assert.rejects(
    () => controller.testSendChannel(noAuthReq, "email"),
    /Authenticated user context is missing/,
    "test-send must surface 401 when no resolved user"
  );

  console.log("✅ admin-notifications.controller.authz tests passed");
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
