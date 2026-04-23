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

  async incrementAndGet(workspaceId: string, toolCode: string, units = 1): Promise<number> {
    const safeUnits = normalizeUnits(units);
    const date = todayDate();
    const record = await this.prisma.workspaceToolUsageDailyCounter.upsert({
      where: {
        workspaceId_toolCode_date: { workspaceId, toolCode, date }
      },
      update: { callCount: { increment: safeUnits } },
      create: { workspaceId, toolCode, date, callCount: safeUnits }
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
    dailyCallLimit: number,
    units = 1
  ): Promise<{ allowed: boolean; currentCount: number }> {
    const safeUnits = normalizeUnits(units);
    const date = todayDate();
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) =>
            this.consumeWithinLimitTx(tx, workspaceId, toolCode, date, dailyCallLimit, safeUnits),
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
    dailyCallLimit: number,
    units: number
  ): Promise<{ allowed: boolean; currentCount: number }> {
    const existing = await tx.workspaceToolUsageDailyCounter.findUnique({
      where: {
        workspaceId_toolCode_date: { workspaceId, toolCode, date }
      }
    });
    const currentCount = existing?.callCount ?? 0;
    // ADR-074 L1.1: reject the *whole* batch if any of the requested
    // units would push the counter past the cap. Partial commits
    // ("you asked for 4 images but you only had 2 budget left, here are
    // 2") would surprise both billing and the founder dashboard, and the
    // smoke harness would over-count `tool_budget_exhausted` substitutes.
    if (currentCount + units > dailyCallLimit) {
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
              increment: units
            }
          }
        })
      : await tx.workspaceToolUsageDailyCounter.create({
          data: {
            workspaceId,
            toolCode,
            date,
            callCount: units
          }
        });

    return {
      allowed: true,
      currentCount: record.callCount
    };
  }
}

/**
 * ADR-074 L1.1 — defensively floor the requested units to a positive
 * integer so a misbehaving caller cannot zero or reverse the counter.
 * `units = 0` and negatives are silently treated as 1 (the historical
 * default), and fractional values are floored.
 */
function normalizeUnits(units: number): number {
  if (!Number.isFinite(units)) {
    return 1;
  }
  const floored = Math.floor(units);
  return floored >= 1 ? floored : 1;
}
