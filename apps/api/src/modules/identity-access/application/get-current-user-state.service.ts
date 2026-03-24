import { Injectable } from "@nestjs/common";
import { WorkspaceStatus } from "@prisma/client";
import { PrismaService } from "../infrastructure/persistence/prisma.service";
import { CurrentUserState, CurrentWorkspaceSummary } from "./current-user-state.types";
import { ResolvedAppUser } from "./resolved-auth-user.types";
import {
  buildComplianceRetentionDeleteBaseline,
  MVP_PRIVACY_POLICY_VERSION,
  MVP_TERMS_OF_SERVICE_VERSION
} from "./compliance-baseline";

function toWorkspaceSummary(workspaceMember: {
  role: "owner" | "member";
  workspace: {
    id: string;
    name: string;
    locale: string;
    timezone: string;
    status: "active" | "inactive";
  };
}): CurrentWorkspaceSummary {
  return {
    id: workspaceMember.workspace.id,
    name: workspaceMember.workspace.name,
    locale: workspaceMember.workspace.locale,
    timezone: workspaceMember.workspace.timezone,
    status: workspaceMember.workspace.status,
    role: workspaceMember.role
  };
}

@Injectable()
export class GetCurrentUserStateService {
  constructor(private readonly prismaService: PrismaService) {}

  async getCurrentUserState(resolvedAppUser: ResolvedAppUser): Promise<CurrentUserState> {
    const appUser = await this.prismaService.appUser.findUnique({
      where: { id: resolvedAppUser.id }
    });
    if (appUser === null || appUser.clerkUserId === null) {
      throw new Error("Resolved app user disappeared while building current user state.");
    }

    const activeWorkspaceLink = await this.prismaService.workspaceMember.findFirst({
      where: {
        userId: resolvedAppUser.id,
        workspace: { status: WorkspaceStatus.active }
      },
      include: {
        workspace: true
      },
      orderBy: { createdAt: "desc" }
    });

    const fallbackWorkspaceLink =
      activeWorkspaceLink ??
      (await this.prismaService.workspaceMember.findFirst({
        where: { userId: resolvedAppUser.id },
        include: { workspace: true },
        orderBy: { createdAt: "desc" }
      }));

    const workspaceSummary = fallbackWorkspaceLink
      ? toWorkspaceSummary(fallbackWorkspaceLink)
      : null;
    const termsAccepted =
      appUser.termsOfServiceAcceptedAt !== null &&
      appUser.termsOfServiceVersion === MVP_TERMS_OF_SERVICE_VERSION;
    const privacyAccepted =
      appUser.privacyPolicyAcceptedAt !== null &&
      appUser.privacyPolicyVersion === MVP_PRIVACY_POLICY_VERSION;
    const onboardingComplete = workspaceSummary !== null && termsAccepted && privacyAccepted;

    return {
      appUser: resolvedAppUser,
      onboarding: {
        isComplete: onboardingComplete,
        status: onboardingComplete ? "completed" : "pending"
      },
      compliance: {
        termsOfService: {
          requiredVersion: MVP_TERMS_OF_SERVICE_VERSION,
          acceptedVersion: appUser.termsOfServiceVersion,
          acceptedAt: appUser.termsOfServiceAcceptedAt?.toISOString() ?? null,
          accepted: termsAccepted
        },
        privacyPolicy: {
          requiredVersion: MVP_PRIVACY_POLICY_VERSION,
          acceptedVersion: appUser.privacyPolicyVersion,
          acceptedAt: appUser.privacyPolicyAcceptedAt?.toISOString() ?? null,
          accepted: privacyAccepted
        },
        retentionAndDeleteBaseline: buildComplianceRetentionDeleteBaseline()
      },
      workspace: workspaceSummary
    };
  }
}
