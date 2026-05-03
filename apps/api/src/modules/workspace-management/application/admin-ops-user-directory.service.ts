import { Injectable } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AdminAuthorizationService } from "./admin-authorization.service";

export interface AdminOpsUserRow {
  userId: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  assistant: {
    id: string;
    draftDisplayName: string | null;
    draftAssistantGender: string | null;
    applyStatus: string;
    latestPublishedVersion: number | null;
    lastPublishedAt: string | null;
  } | null;
  billing: {
    workspaceId: string | null;
    planCode: string | null;
    status: string | null;
    trialEndsAt: string | null;
    graceEndsAt: string | null;
    currentPeriodEndsAt: string | null;
    usageRisk: "unknown" | "ok" | "elevated" | "high";
  };
}

export interface AdminOpsUserDirectoryResult {
  users: AdminOpsUserRow[];
  total: number;
}

@Injectable()
export class AdminOpsUserDirectoryService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuthorizationService: AdminAuthorizationService
  ) {}

  async execute(
    callerUserId: string,
    query: {
      search?: string;
      offset: number;
      limit: number;
    }
  ): Promise<AdminOpsUserDirectoryResult> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(callerUserId);
    const where = query.search
      ? {
          OR: [
            { email: { contains: query.search, mode: "insensitive" as const } },
            { displayName: { contains: query.search, mode: "insensitive" as const } }
          ]
        }
      : {};

    const [users, total] = await Promise.all([
      this.prisma.appUser.findMany({
        where,
        select: {
          id: true,
          email: true,
          displayName: true,
          createdAt: true,
          assistant: {
            select: {
              id: true,
              draftDisplayName: true,
              draftAssistantGender: true,
              applyStatus: true,
              publishedVersions: {
                orderBy: { version: "desc" as const },
                take: 1,
                select: { version: true, createdAt: true }
              }
            }
          },
          workspaceLinks: {
            orderBy: { createdAt: "asc" as const },
            take: 1,
            select: {
              workspaceId: true,
              workspace: {
                select: {
                  subscription: {
                    select: {
                      planCode: true,
                      status: true,
                      trialEndsAt: true,
                      graceEndsAt: true,
                      currentPeriodEndsAt: true
                    }
                  },
                  quotaAccountingState: {
                    select: {
                      tokenBudgetUsed: true,
                      tokenBudgetLimit: true
                    }
                  }
                }
              }
            }
          }
        },
        orderBy: { createdAt: "desc" },
        skip: query.offset,
        take: query.limit
      }),
      this.prisma.appUser.count({ where })
    ]);

    return {
      total,
      users: users.map((u) => {
        const a = u.assistant;
        const workspaceLink = u.workspaceLinks[0] ?? null;
        const subscription = workspaceLink?.workspace.subscription ?? null;
        const quota = workspaceLink?.workspace.quotaAccountingState ?? null;
        return {
          userId: u.id,
          email: u.email,
          displayName: u.displayName,
          createdAt: u.createdAt.toISOString(),
          assistant: a
            ? {
                id: a.id,
                draftDisplayName: a.draftDisplayName,
                draftAssistantGender: a.draftAssistantGender,
                applyStatus: a.applyStatus,
                latestPublishedVersion: a.publishedVersions[0]?.version ?? null,
                lastPublishedAt: a.publishedVersions[0]?.createdAt?.toISOString() ?? null
              }
            : null,
          billing: {
            workspaceId: workspaceLink?.workspaceId ?? null,
            planCode: subscription?.planCode ?? null,
            status: subscription?.status ?? null,
            trialEndsAt: subscription?.trialEndsAt?.toISOString() ?? null,
            graceEndsAt: subscription?.graceEndsAt?.toISOString() ?? null,
            currentPeriodEndsAt: subscription?.currentPeriodEndsAt?.toISOString() ?? null,
            usageRisk: this.resolveUsageRisk(quota)
          }
        };
      })
    };
  }

  private resolveUsageRisk(
    quota: {
      tokenBudgetUsed: bigint;
      tokenBudgetLimit: bigint | null;
    } | null
  ): AdminOpsUserRow["billing"]["usageRisk"] {
    if (quota === null || quota.tokenBudgetLimit === null || quota.tokenBudgetLimit <= BigInt(0)) {
      return "unknown";
    }
    const percent = Number((quota.tokenBudgetUsed * BigInt(100)) / quota.tokenBudgetLimit);
    if (percent >= 95) {
      return "high";
    }
    if (percent >= 80) {
      return "elevated";
    }
    return "ok";
  }
}
