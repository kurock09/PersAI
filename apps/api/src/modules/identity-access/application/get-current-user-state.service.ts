import { Injectable } from "@nestjs/common";
import { WorkspaceStatus } from "@prisma/client";
import { PrismaService } from "../infrastructure/persistence/prisma.service";
import { CurrentUserState, CurrentWorkspaceSummary } from "./current-user-state.types";
import { ResolvedAppUser } from "./resolved-auth-user.types";
import { buildComplianceRetentionDeleteBaseline } from "./compliance-baseline";
import { resolvePreferredLocale } from "./locale-resolution";
import { ResolveComplianceBaselineService } from "./resolve-compliance-baseline.service";

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
  constructor(
    private readonly prismaService: PrismaService,
    private readonly resolveComplianceBaselineService: ResolveComplianceBaselineService
  ) {}

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
    const complianceBaseline = await this.resolveComplianceBaselineService.resolve(
      appUser.countryCode
    );
    const termsAccepted =
      appUser.termsOfServiceAcceptedAt !== null &&
      appUser.termsOfServiceVersion === complianceBaseline.termsOfServiceVersion;
    const privacyAccepted =
      appUser.privacyPolicyAcceptedAt !== null &&
      appUser.privacyPolicyVersion === complianceBaseline.privacyPolicyVersion;
    const onboardingComplete = workspaceSummary !== null && termsAccepted && privacyAccepted;
    const resolvedLocale = resolvePreferredLocale({
      preferredLocale: appUser.preferredLocale,
      workspaceLocale: workspaceSummary?.locale ?? null
    });

    return {
      appUser: {
        id: appUser.id,
        clerkUserId: appUser.clerkUserId,
        email: appUser.email,
        displayName: appUser.displayName,
        birthday: appUser.birthday ? appUser.birthday.toISOString().split("T")[0]! : null,
        gender: appUser.gender,
        preferredLocale: appUser.preferredLocale,
        countryCode: appUser.countryCode,
        resolvedLocale
      },
      onboarding: {
        isComplete: onboardingComplete,
        status: onboardingComplete ? "completed" : "pending"
      },
      compliance: {
        termsOfService: {
          requiredVersion: complianceBaseline.termsOfServiceVersion,
          acceptedVersion: appUser.termsOfServiceVersion,
          acceptedAt: appUser.termsOfServiceAcceptedAt?.toISOString() ?? null,
          accepted: termsAccepted
        },
        privacyPolicy: {
          requiredVersion: complianceBaseline.privacyPolicyVersion,
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
