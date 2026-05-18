import { Injectable } from "@nestjs/common";
import { resolvePreferredLocale, type SupportedLocale } from "@persai/types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

@Injectable()
export class ResolveUserLocaleService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async forUserInWorkspace(
    userId: string | null | undefined,
    workspaceId: string
  ): Promise<SupportedLocale> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { locale: true }
    });

    if (userId === null || userId === undefined) {
      return resolvePreferredLocale({ workspaceLocale: workspace?.locale ?? null });
    }

    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { preferredLocale: true }
    });

    return resolvePreferredLocale({
      preferredLocale: user?.preferredLocale ?? null,
      workspaceLocale: workspace?.locale ?? null
    });
  }
}
