import { Injectable } from "@nestjs/common";
import { WorkspaceStatus } from "@prisma/client";
import { PrismaService } from "../infrastructure/persistence/prisma.service";
import { CurrentUserState, CurrentWorkspaceSummary } from "./current-user-state.types";
import { ResolvedAppUser } from "./resolved-auth-user.types";

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
    const onboardingComplete = workspaceSummary !== null;

    return {
      appUser: resolvedAppUser,
      onboarding: {
        isComplete: onboardingComplete,
        status: onboardingComplete ? "completed" : "pending"
      },
      workspace: workspaceSummary
    };
  }
}
