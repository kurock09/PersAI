import type { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export async function countRecentSafetyWarnCases(
  prisma: WorkspaceManagementPrismaService,
  input: { userId: string; reasonCode: string; windowDays: number }
): Promise<number> {
  const since = new Date(Date.now() - input.windowDays * 24 * 60 * 60 * 1000);
  return prisma.moderationCase.count({
    where: {
      userId: input.userId,
      reasonCode: input.reasonCode,
      decision: "warn",
      createdAt: { gte: since }
    }
  });
}
