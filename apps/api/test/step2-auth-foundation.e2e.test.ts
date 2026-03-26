import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { AuthVerifyController } from "../src/modules/identity-access/interface/http/auth-verify.controller";
import { MeController } from "../src/modules/identity-access/interface/http/me.controller";
import { GetCurrentUserStateService } from "../src/modules/identity-access/application/get-current-user-state.service";
import { ResolveAppUserService } from "../src/modules/identity-access/application/resolve-app-user.service";
import { UpsertOnboardingService } from "../src/modules/identity-access/application/upsert-onboarding.service";
import { AppModule } from "../src/app.module";
import { RequestContextStore } from "../src/modules/platform-core/infrastructure/request-context/request-context.store";
import { RequestWithPlatformContext } from "../src/modules/platform-core/interface/http/request-http.types";
import { ResolvedAuthUser } from "../src/modules/identity-access/application/resolved-auth-user.types";
import { ClerkAuthService } from "../src/modules/identity-access/infrastructure/identity/clerk-auth.service";
import { ClerkAuthMiddleware } from "../src/modules/identity-access/interface/http/clerk-auth.middleware";
import { PrismaService } from "../src/modules/identity-access/infrastructure/persistence/prisma.service";

type WorkspaceStatus = "active" | "inactive";
type WorkspaceRole = "owner" | "member";

interface AppUserRecord {
  id: string;
  clerkUserId: string | null;
  email: string;
  displayName: string | null;
  termsOfServiceAcceptedAt: Date | null;
  termsOfServiceVersion: string | null;
  privacyPolicyAcceptedAt: Date | null;
  privacyPolicyVersion: string | null;
}

interface WorkspaceRecord {
  id: string;
  name: string;
  locale: string;
  timezone: string;
  status: WorkspaceStatus;
}

interface WorkspaceMemberRecord {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: Date;
}

class InMemoryPrisma {
  private appUsers: AppUserRecord[] = [];
  private workspaces: WorkspaceRecord[] = [];
  private workspaceMembers: WorkspaceMemberRecord[] = [];
  private idCounter = 0;

  readonly appUser = {
    findUnique: async ({ where }: { where: Record<string, string> }) => {
      if (where.id) {
        return this.appUsers.find((item) => item.id === where.id) ?? null;
      }

      if (where.clerkUserId) {
        return this.appUsers.find((item) => item.clerkUserId === where.clerkUserId) ?? null;
      }

      if (where.email) {
        return this.appUsers.find((item) => item.email === where.email) ?? null;
      }

      return null;
    },
    create: async ({ data }: { data: Omit<AppUserRecord, "id"> }) => {
      const created: AppUserRecord = {
        id: this.nextId("user"),
        ...data
      };
      this.appUsers.push(created);
      return created;
    },
    update: async ({
      where,
      data
    }: {
      where: { id: string };
      data: Partial<
        Pick<
          AppUserRecord,
          | "clerkUserId"
          | "displayName"
          | "termsOfServiceAcceptedAt"
          | "termsOfServiceVersion"
          | "privacyPolicyAcceptedAt"
          | "privacyPolicyVersion"
        >
      >;
    }) => {
      const target = this.appUsers.find((item) => item.id === where.id);
      if (!target) {
        throw new Error("app user not found");
      }

      if (data.clerkUserId !== undefined) {
        target.clerkUserId = data.clerkUserId;
      }
      if (data.displayName !== undefined) {
        target.displayName = data.displayName;
      }
      if (data.termsOfServiceAcceptedAt !== undefined) {
        target.termsOfServiceAcceptedAt = data.termsOfServiceAcceptedAt;
      }
      if (data.termsOfServiceVersion !== undefined) {
        target.termsOfServiceVersion = data.termsOfServiceVersion;
      }
      if (data.privacyPolicyAcceptedAt !== undefined) {
        target.privacyPolicyAcceptedAt = data.privacyPolicyAcceptedAt;
      }
      if (data.privacyPolicyVersion !== undefined) {
        target.privacyPolicyVersion = data.privacyPolicyVersion;
      }

      return target;
    }
  };

  readonly workspace = {
    create: async ({ data }: { data: Omit<WorkspaceRecord, "id"> }) => {
      const created: WorkspaceRecord = {
        id: this.nextId("ws"),
        ...data
      };
      this.workspaces.push(created);
      return created;
    },
    update: async ({
      where,
      data
    }: {
      where: { id: string };
      data: Partial<Omit<WorkspaceRecord, "id">>;
    }) => {
      const target = this.workspaces.find((item) => item.id === where.id);
      if (!target) {
        throw new Error("workspace not found");
      }

      Object.assign(target, data);
      return target;
    }
  };

  readonly workspaceMember = {
    findFirst: async ({
      where,
      include
    }: {
      where: {
        userId: string;
        workspace?: {
          status: WorkspaceStatus;
        };
      };
      include?: { workspace: boolean };
      orderBy?: { createdAt: "asc" | "desc" };
    }) => {
      const userMatches = this.workspaceMembers.filter((item) => item.userId === where.userId);
      const statusFiltered = where.workspace?.status
        ? userMatches.filter((item) => {
            const workspace = this.workspaces.find((ws) => ws.id === item.workspaceId);
            return workspace?.status === where.workspace?.status;
          })
        : userMatches;

      const latest = [...statusFiltered].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      )[0];
      if (!latest) {
        return null;
      }

      if (!include?.workspace) {
        return latest;
      }

      const workspace = this.workspaces.find((item) => item.id === latest.workspaceId);
      if (!workspace) {
        return null;
      }

      return {
        ...latest,
        workspace
      };
    },
    create: async ({
      data
    }: {
      data: {
        workspaceId: string;
        userId: string;
        role: WorkspaceRole;
      };
    }) => {
      const created: WorkspaceMemberRecord = {
        id: this.nextId("member"),
        ...data,
        createdAt: new Date()
      };
      this.workspaceMembers.push(created);
      return created;
    },
    update: async ({
      where,
      data
    }: {
      where: { id: string };
      data: Partial<Pick<WorkspaceMemberRecord, "role">>;
    }) => {
      const target = this.workspaceMembers.find((item) => item.id === where.id);
      if (!target) {
        throw new Error("workspace member not found");
      }

      Object.assign(target, data);
      return target;
    }
  };

  readonly assistant = {
    updateMany: async () => ({ count: 0 })
  };

  async $transaction<T>(callback: (tx: this) => Promise<T>): Promise<T> {
    return callback(this);
  }

  snapshot() {
    return {
      appUsers: [...this.appUsers],
      workspaces: [...this.workspaces],
      workspaceMembers: [...this.workspaceMembers]
    };
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter}`;
  }
}

class StubClerkAuthService {
  async resolveAuthenticatedUser(token: string): Promise<ResolvedAuthUser> {
    if (token === "token-user-1") {
      return {
        clerkUserId: "clerk-user-1",
        email: "user1@example.com",
        displayName: "User One"
      };
    }

    throw new UnauthorizedException("Invalid Clerk token.");
  }
}

async function runStep2AuthFoundationSmoke(): Promise<void> {
  void AppModule;
  void ClerkAuthService;
  void PrismaService;

  const prisma = new InMemoryPrisma();
  const requestContextStore = new RequestContextStore();
  const resolveAppUserService = new ResolveAppUserService(prisma as never);
  const clerkAuthMiddleware = new ClerkAuthMiddleware(
    new StubClerkAuthService() as never,
    resolveAppUserService,
    requestContextStore
  );
  const getCurrentUserStateService = new GetCurrentUserStateService(prisma as never);
  const upsertOnboardingService = new UpsertOnboardingService(
    prisma as never,
    getCurrentUserStateService
  );
  const meController = new MeController(getCurrentUserStateService, upsertOnboardingService);
  const authVerifyController = new AuthVerifyController();

  const unauthorizedReq: RequestWithPlatformContext = {
    headers: {}
  };
  await assert.rejects(
    () =>
      clerkAuthMiddleware.use(unauthorizedReq, {} as never, () => {
        return;
      }),
    UnauthorizedException
  );

  async function authorizeRequest(requestId: string): Promise<RequestWithPlatformContext> {
    const req: RequestWithPlatformContext = {
      headers: {
        authorization: "Bearer token-user-1"
      },
      requestId
    };

    await requestContextStore.run({ requestId, userId: null, workspaceId: null }, async () => {
      await clerkAuthMiddleware.use(req, {} as never, () => {
        return;
      });
    });

    return req;
  }

  const verifyReq = await authorizeRequest("req-verify");
  const initialMeReq = await authorizeRequest("req-me-initial");
  const verify = authVerifyController.getVerification(verifyReq);
  assert.equal(verify.authenticated, true);
  assert.equal(verify.appUser.email, "user1@example.com");

  const initialMe = await meController.getCurrentUser(initialMeReq);
  assert.equal(initialMe.me.onboarding.status, "pending");
  assert.equal(initialMe.me.workspace, null);

  const afterFirstAuth = prisma.snapshot();
  assert.equal(afterFirstAuth.appUsers.length, 1);
  assert.equal(afterFirstAuth.appUsers[0]?.clerkUserId, "clerk-user-1");

  const onboardingPayload = {
    displayName: "User One Updated",
    workspaceName: "Workspace A",
    locale: "en-US",
    timezone: "UTC",
    acceptTermsOfService: true,
    acceptPrivacyPolicy: true
  };

  const onboardingReq1 = await authorizeRequest("req-onboarding-1");
  const onboarding1 = await meController.upsertOnboarding(onboardingReq1, onboardingPayload);
  assert.equal(onboarding1.me.onboarding.status, "completed");
  assert.equal(onboarding1.me.workspace?.name, "Workspace A");
  assert.equal(onboarding1.me.workspace?.role, "owner");
  assert.equal(onboarding1.me.compliance.termsOfService.accepted, true);
  assert.equal(onboarding1.me.compliance.privacyPolicy.accepted, true);

  const onboardingReq2 = await authorizeRequest("req-onboarding-2");
  const onboarding2 = await meController.upsertOnboarding(onboardingReq2, onboardingPayload);
  assert.equal(onboarding2.me.workspace?.name, "Workspace A");
  assert.equal(onboarding2.me.workspace?.role, "owner");

  const finalMeReq = await authorizeRequest("req-me-final");
  const finalMe = await meController.getCurrentUser(finalMeReq);
  assert.equal(finalMe.me.onboarding.status, "completed");
  assert.equal(finalMe.me.appUser.displayName, "User One Updated");

  const snapshot = prisma.snapshot();
  assert.equal(snapshot.appUsers.length, 1);
  assert.equal(snapshot.workspaces.length, 1);
  assert.equal(snapshot.workspaceMembers.length, 1);
}

void runStep2AuthFoundationSmoke().catch((error: unknown) => {
  console.error("Step 2 API smoke/e2e failed.", error);
  process.exitCode = 1;
});
