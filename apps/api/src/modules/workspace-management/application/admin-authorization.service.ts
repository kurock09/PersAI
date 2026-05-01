import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { ApiConfig, loadApiConfig } from "@persai/config";
import { AppUserAdminRoleCode, WorkspaceRole } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export type SupportedAdminRole = "ops_admin" | "business_admin" | "security_admin" | "super_admin";
export type DangerousAdminActionCode =
  | "admin.plan.create"
  | "admin.plan.update"
  | "admin.plan.delete"
  | "admin.runtime_provider_settings.update"
  | "admin.document_processing_settings.update"
  | "admin.tool_credentials.update"
  | "admin.rollout.apply"
  | "admin.rollout.rollback"
  | "admin.assistant.transfer_ownership"
  | "admin.assistant.recover_ownership"
  | "admin.force_reapply_all";

export interface AdminAccessContext {
  userId: string;
  workspaceId: string;
  roles: SupportedAdminRole[];
  hasLegacyOwnerFallback: boolean;
  /**
   * At least one ops/security/super row in `app_user_admin_roles` with `workspace_id` null
   * (platform-wide scope), not tied to a single tenant workspace.
   */
  hasGlobalPlatformAdminScope: boolean;
}

export interface AdminStepUpChallenge {
  token: string;
  expiresAt: string;
}

interface StepUpTokenPayload {
  v: 1;
  uid: string;
  ws: string;
  action: DangerousAdminActionCode;
  nonce: string;
  iat: number;
  exp: number;
}

const STEP_UP_TTL_SECONDS = 10 * 60;

function requiredRolesForDangerousAction(action: DangerousAdminActionCode): SupportedAdminRole[] {
  if (
    action === "admin.assistant.transfer_ownership" ||
    action === "admin.assistant.recover_ownership"
  ) {
    return ["ops_admin", "super_admin"];
  }
  if (action === "admin.rollout.apply" || action === "admin.rollout.rollback") {
    return ["ops_admin", "super_admin"];
  }
  if (
    action === "admin.runtime_provider_settings.update" ||
    action === "admin.document_processing_settings.update"
  ) {
    return ["ops_admin", "super_admin"];
  }
  if (action === "admin.tool_credentials.update") {
    return ["ops_admin", "super_admin"];
  }
  return ["business_admin", "super_admin"];
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf-8");
}

@Injectable()
export class AdminAuthorizationService {
  private readonly apiConfig: ApiConfig;
  private readonly adminEmailAllowlist: Set<string> | null;

  constructor(private readonly prisma: WorkspaceManagementPrismaService) {
    this.apiConfig = loadApiConfig(process.env);
    const raw = this.apiConfig.PERSAI_ADMIN_ALLOWLIST_EMAILS?.trim();
    this.adminEmailAllowlist =
      raw !== undefined && raw.length > 0
        ? new Set(
            raw
              .split(",")
              .map((e) => e.trim().toLowerCase())
              .filter((e) => e.length > 0)
          )
        : null;
  }

  private async requireAdminEmailAllowlist(userId: string): Promise<void> {
    if (this.adminEmailAllowlist === null || this.adminEmailAllowlist.size === 0) {
      return;
    }
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { email: true }
    });
    if (user === null) {
      throw new ForbiddenException("Admin access denied.");
    }
    const email = user.email.toLowerCase();
    if (!this.adminEmailAllowlist.has(email)) {
      throw new ForbiddenException("Admin access is restricted to approved accounts.");
    }
  }

  async assertCanReadAdminSurface(userId: string): Promise<AdminAccessContext> {
    await this.requireAdminEmailAllowlist(userId);
    const context = await this.resolveAdminAccessContext(userId);
    if (
      !this.hasAnyRole(context, ["ops_admin", "business_admin", "security_admin", "super_admin"])
    ) {
      throw new ForbiddenException(
        "Admin read surface requires ops/business/security/super-admin role or legacy owner fallback."
      );
    }
    return context;
  }

  async assertCanWriteGlobalKnowledge(userId: string): Promise<AdminAccessContext> {
    await this.requireAdminEmailAllowlist(userId);
    const context = await this.resolveAdminAccessContext(userId);
    if (
      !this.hasAnyRole(context, ["ops_admin", "business_admin", "security_admin", "super_admin"])
    ) {
      throw new ForbiddenException(
        "Global knowledge write access requires ops/business/security/super-admin role or legacy owner fallback."
      );
    }
    return context;
  }

  async assertCanManageAdminSystemNotifications(userId: string): Promise<AdminAccessContext> {
    await this.requireAdminEmailAllowlist(userId);
    const context = await this.resolveAdminAccessContext(userId);
    if (!this.hasAnyRole(context, ["ops_admin", "security_admin", "super_admin"])) {
      throw new ForbiddenException(
        "Admin system-notification channel management requires ops/security/super-admin role or legacy owner fallback."
      );
    }
    return context;
  }

  async assertCanManageAbuseControls(userId: string): Promise<AdminAccessContext> {
    await this.requireAdminEmailAllowlist(userId);
    const context = await this.resolveAdminAccessContext(userId);
    if (!this.hasAnyRole(context, ["ops_admin", "security_admin", "super_admin"])) {
      throw new ForbiddenException(
        "Abuse/rate-limit admin controls require ops/security/super-admin role or legacy owner fallback."
      );
    }
    return context;
  }

  async assertCanPerformDangerousAdminAction(
    userId: string,
    action: DangerousAdminActionCode,
    stepUpToken: string | null
  ): Promise<AdminAccessContext> {
    await this.requireAdminEmailAllowlist(userId);
    const context = await this.resolveAdminAccessContext(userId);
    const requiredRoles = requiredRolesForDangerousAction(action);
    if (!this.hasAnyRole(context, requiredRoles)) {
      throw new ForbiddenException(
        "Dangerous admin actions require action-scoped admin role with step-up confirmation (legacy owner fallback allowed)."
      );
    }
    this.verifyStepUpToken(context, action, stepUpToken);
    return context;
  }

  async issueStepUpChallenge(
    userId: string,
    action: DangerousAdminActionCode
  ): Promise<{ context: AdminAccessContext; challenge: AdminStepUpChallenge }> {
    await this.requireAdminEmailAllowlist(userId);
    const context = await this.resolveAdminAccessContext(userId);
    const requiredRoles = requiredRolesForDangerousAction(action);
    if (!this.hasAnyRole(context, requiredRoles)) {
      throw new ForbiddenException(
        "Step-up challenge for dangerous admin actions requires action-scoped admin role."
      );
    }
    const now = Math.floor(Date.now() / 1000);
    const payload: StepUpTokenPayload = {
      v: 1,
      uid: userId,
      ws: context.workspaceId,
      action,
      nonce: randomUUID(),
      iat: now,
      exp: now + STEP_UP_TTL_SECONDS
    };
    const payloadEncoded = toBase64Url(JSON.stringify(payload));
    const signature = this.sign(payloadEncoded);
    return {
      context,
      challenge: {
        token: `${payloadEncoded}.${signature}`,
        expiresAt: new Date(payload.exp * 1000).toISOString()
      }
    };
  }

  private async resolveAdminAccessContext(userId: string): Promise<AdminAccessContext> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      orderBy: [{ role: "asc" }, { createdAt: "desc" }],
      select: {
        workspaceId: true,
        role: true,
        createdAt: true
      }
    });
    if (memberships.length === 0) {
      throw new ForbiddenException("Admin access requires workspace membership.");
    }

    const adminRoles = await this.prisma.appUserAdminRole.findMany({
      where: {
        userId,
        OR: [
          { workspaceId: { in: memberships.map((membership) => membership.workspaceId) } },
          { workspaceId: null }
        ]
      },
      select: {
        roleCode: true,
        workspaceId: true
      }
    });

    const membershipsByScopedRole = new Set(
      adminRoles.flatMap((row) => (row.workspaceId === null ? [] : [row.workspaceId]))
    );
    const membership =
      memberships.find((item) => membershipsByScopedRole.has(item.workspaceId)) ?? memberships[0];
    if (membership === undefined) {
      throw new ForbiddenException("Admin access requires workspace membership.");
    }

    const roleSet = new Set<SupportedAdminRole>();
    for (const row of adminRoles) {
      if (row.workspaceId !== null && row.workspaceId !== membership.workspaceId) {
        continue;
      }
      roleSet.add(row.roleCode);
    }
    const hasLegacyOwnerFallback = membership.role === WorkspaceRole.owner;
    if (hasLegacyOwnerFallback) {
      roleSet.add("business_admin");
    }
    const globalAbuseAdminRoles = new Set<AppUserAdminRoleCode>([
      AppUserAdminRoleCode.ops_admin,
      AppUserAdminRoleCode.security_admin,
      AppUserAdminRoleCode.super_admin
    ]);
    const hasGlobalPlatformAdminScope = adminRoles.some(
      (row) => row.workspaceId === null && globalAbuseAdminRoles.has(row.roleCode)
    );
    return {
      userId,
      workspaceId: membership.workspaceId,
      roles: Array.from(roleSet),
      hasLegacyOwnerFallback,
      hasGlobalPlatformAdminScope
    };
  }

  private hasAnyRole(context: AdminAccessContext, required: SupportedAdminRole[]): boolean {
    return required.some((role) => context.roles.includes(role));
  }

  private verifyStepUpToken(
    context: AdminAccessContext,
    action: DangerousAdminActionCode,
    stepUpToken: string | null
  ): void {
    if (stepUpToken === null || stepUpToken.trim().length === 0) {
      throw new BadRequestException(
        "Dangerous admin actions require step-up token in x-persai-step-up-token header."
      );
    }
    const [payloadEncoded, signature] = stepUpToken.trim().split(".");
    if (
      payloadEncoded === undefined ||
      payloadEncoded.length === 0 ||
      signature === undefined ||
      signature.length === 0
    ) {
      throw new BadRequestException("Invalid step-up token format.");
    }
    const expectedSignature = this.sign(payloadEncoded);
    const provided = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new ForbiddenException("Step-up token signature is invalid.");
    }
    let payload: StepUpTokenPayload;
    try {
      payload = JSON.parse(fromBase64Url(payloadEncoded)) as StepUpTokenPayload;
    } catch {
      throw new BadRequestException("Step-up token payload is invalid.");
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload.v !== 1 || payload.uid !== context.userId || payload.ws !== context.workspaceId) {
      throw new ForbiddenException("Step-up token does not match current actor context.");
    }
    if (payload.action !== action) {
      throw new ForbiddenException("Step-up token action scope mismatch.");
    }
    if (payload.exp <= now) {
      throw new ForbiddenException("Step-up token has expired.");
    }
  }

  private sign(payloadEncoded: string): string {
    return createHmac("sha256", this.getStepUpSigningSecret())
      .update(`persai-admin-stepup-v1:${payloadEncoded}`)
      .digest("base64url");
  }

  private getStepUpSigningSecret(): string {
    const configuredSecret = this.apiConfig.ADMIN_STEP_UP_HMAC_SECRET?.trim();
    if (configuredSecret && configuredSecret.length > 0) {
      return configuredSecret;
    }
    return createHmac("sha256", this.apiConfig.CLERK_SECRET_KEY)
      .update("persai-admin-stepup-v1:key-derivation")
      .digest("base64url");
  }
}
