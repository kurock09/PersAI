import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
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

  async consumeWithinLimit(
    workspaceId: string,
    toolCode: string,
    dailyCallLimit: number
  ): Promise<{ allowed: boolean; currentCount: number }> {
    const date = todayDate();
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => this.consumeWithinLimitTx(tx, workspaceId, toolCode, date, dailyCallLimit),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable
          }
        );
      } catch (error) {
        const prismaCode =
          error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
        if (prismaCode === "P2034" && attempt < maxRetries) {
          continue;
        }
        throw error;
      }
    }

    return { allowed: false, currentCount: dailyCallLimit };
  }

  private async consumeWithinLimitTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    toolCode: string,
    date: Date,
    dailyCallLimit: number
  ): Promise<{ allowed: boolean; currentCount: number }> {
    const existing = await tx.workspaceToolUsageDailyCounter.findUnique({
      where: {
        workspaceId_toolCode_date: { workspaceId, toolCode, date }
      }
    });
    const currentCount = existing?.callCount ?? 0;
    if (currentCount >= dailyCallLimit) {
      return {
        allowed: false,
        currentCount
      };
    }

    const record = existing
      ? await tx.workspaceToolUsageDailyCounter.update({
          where: {
            workspaceId_toolCode_date: { workspaceId, toolCode, date }
          },
          data: {
            callCount: {
              increment: 1
            }
          }
        })
      : await tx.workspaceToolUsageDailyCounter.create({
          data: {
            workspaceId,
            toolCode,
            date,
            callCount: 1
          }
        });

    return {
      allowed: true,
      currentCount: record.callCount
    };
  }
}
