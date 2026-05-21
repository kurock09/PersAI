import { Inject, Injectable } from "@nestjs/common";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  readWorkspacePeriodEconomics,
  type AdminOpsPeriodEconomicsSnapshot
} from "./admin-ops-period-economics";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";

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
  periodEconomics: AdminOpsPeriodEconomicsSnapshot | null;
}

export interface AdminOpsUserDirectoryResult {
  users: AdminOpsUserRow[];
  total: number;
}

@Injectable()
export class AdminOpsUserDirectoryService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService
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

    const periodEconomicsByUserId = await this.resolvePeriodEconomicsForUsers(users);

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
          },
          periodEconomics: periodEconomicsByUserId.get(u.id) ?? null
        };
      })
    };
  }

  private async resolvePeriodEconomicsForUsers(
    users: Array<{
      id: string;
      assistant: { id: string } | null;
      workspaceLinks: Array<{ workspaceId: string }>;
    }>
  ): Promise<Map<string, AdminOpsPeriodEconomicsSnapshot>> {
    const result = new Map<string, AdminOpsPeriodEconomicsSnapshot>();
    await Promise.all(
      users.map(async (user) => {
        const workspaceId = user.workspaceLinks[0]?.workspaceId ?? null;
        if (workspaceId === null || user.assistant === null) {
          return;
        }
        const assistant = await this.assistantRepository.findById(user.assistant.id);
        if (assistant === null) {
          return;
        }
        const tokenBudget =
          await this.trackWorkspaceQuotaUsageService.resolveAssistantTokenBudgetQuotaSnapshot(
            assistant
          );
        const economics = await readWorkspacePeriodEconomics(this.prisma, {
          workspaceId,
          periodStartedAt: tokenBudget.periodStartedAt,
          periodEndsAt: tokenBudget.periodEndsAt
        });
        result.set(user.id, economics);
      })
    );
    return result;
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
