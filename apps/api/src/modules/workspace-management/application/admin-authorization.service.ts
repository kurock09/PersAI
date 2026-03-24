import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { ApiConfig, loadApiConfig } from "@persai/config";
import { WorkspaceRole } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export type SupportedAdminRole = "ops_admin" | "business_admin" | "security_admin" | "super_admin";
export type DangerousAdminActionCode =
  | "admin.plan.create"
  | "admin.plan.update"
  | "admin.rollout.apply"
  | "admin.rollout.rollback";

export interface AdminAccessContext {
  userId: string;
  workspaceId: string;
  roles: SupportedAdminRole[];
  hasLegacyOwnerFallback: boolean;
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
  if (action === "admin.rollout.apply" || action === "admin.rollout.rollback") {
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

  constructor(private readonly prisma: WorkspaceManagementPrismaService) {
    this.apiConfig = loadApiConfig(process.env);
  }

  async assertCanReadAdminSurface(userId: string): Promise<AdminAccessContext> {
    const context = await this.resolveAdminAccessContext(userId);
    if (!this.hasAnyRole(context, ["ops_admin", "business_admin", "security_admin", "super_admin"])) {
      throw new ForbiddenException(
        "Admin read surface requires ops/business/security/super-admin role or legacy owner fallback."
      );
    }
    return context;
  }

  async assertCanManageAdminSystemNotifications(userId: string): Promise<AdminAccessContext> {
    const context = await this.resolveAdminAccessContext(userId);
    if (!this.hasAnyRole(context, ["ops_admin", "security_admin", "super_admin"])) {
      throw new ForbiddenException(
        "Admin system-notification channel management requires ops/security/super-admin role or legacy owner fallback."
      );
    }
    return context;
  }

  async assertCanManageAbuseControls(userId: string): Promise<AdminAccessContext> {
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
    const membership = await this.prisma.workspaceMember.findFirst({
      where: { userId },
      orderBy: [{ role: "asc" }, { createdAt: "desc" }]
    });
    if (membership === null) {
      throw new ForbiddenException("Admin access requires workspace membership.");
    }
    const adminRoles = await this.prisma.appUserAdminRole.findMany({
      where: {
        userId,
        OR: [{ workspaceId: membership.workspaceId }, { workspaceId: null }]
      },
      select: { roleCode: true }
    });
    const roleSet = new Set<SupportedAdminRole>();
    for (const row of adminRoles) {
      roleSet.add(row.roleCode);
    }
    const hasLegacyOwnerFallback = membership.role === WorkspaceRole.owner;
    if (hasLegacyOwnerFallback) {
      roleSet.add("business_admin");
    }
    return {
      userId,
      workspaceId: membership.workspaceId,
      roles: Array.from(roleSet),
      hasLegacyOwnerFallback
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
    return createHmac("sha256", this.apiConfig.CLERK_SECRET_KEY)
      .update(`persai-admin-stepup-v1:${payloadEncoded}`)
      .digest("base64url");
  }
}
