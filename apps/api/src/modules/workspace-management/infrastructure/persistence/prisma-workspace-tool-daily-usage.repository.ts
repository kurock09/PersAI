import { Injectable } from "@nestjs/common";
import type { WorkspaceToolDailyUsageRepository } from "../../domain/workspace-tool-daily-usage.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

function todayDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

@Injectable()
export class PrismaWorkspaceToolDailyUsageRepository implements WorkspaceToolDailyUsageRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async incrementAndGet(workspaceId: string, toolCode: string): Promise<number> {
    const date = todayDate();
    const record = await this.prisma.workspaceToolUsageDailyCounter.upsert({
      where: {
        workspaceId_toolCode_date: { workspaceId, toolCode, date }
      },
      update: { callCount: { increment: 1 } },
      create: { workspaceId, toolCode, date, callCount: 1 }
    });
    return record.callCount;
  }

  async getUsageForDate(workspaceId: string, toolCode: string, date: Date): Promise<number> {
    const record = await this.prisma.workspaceToolUsageDailyCounter.findUnique({
      where: {
        workspaceId_toolCode_date: { workspaceId, toolCode, date }
      }
    });
    return record?.callCount ?? 0;
  }
}
