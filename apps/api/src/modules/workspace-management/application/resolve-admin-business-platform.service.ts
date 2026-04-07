import { Inject, Injectable } from "@nestjs/common";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";
import {
  WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY,
  type WorkspaceQuotaAccountingRepository
} from "../domain/workspace-quota-accounting.repository";
import type {
  AdminBusinessPlatformState,
  PlanDistributionEntry,
  QuotaPressureDistribution
} from "./platform-business.types";

const BUSINESS_WINDOW_DAYS = 7;

function toPercent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

@Injectable()
export class ResolveAdminBusinessPlatformService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly assistantPlanCatalogRepository: AssistantPlanCatalogRepository,
    @Inject(WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY)
    private readonly workspaceQuotaAccountingRepository: WorkspaceQuotaAccountingRepository
  ) {}

  async execute(userId: string): Promise<AdminBusinessPlatformState> {
    const context = await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const workspaceId = context.workspaceId;
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - BUSINESS_WINDOW_DAYS);

    const totalUsers = await this.prisma.appUser.count();

    const allPlans = await this.assistantPlanCatalogRepository.listAll();
    const defaultPlan = allPlans.find((p) => p.isDefaultFirstRegistrationPlan) ?? null;
    const activePlans = allPlans.filter((p) => p.status === "active");

    const assistants = await this.prisma.assistant.findMany({
      where: { workspaceId },
      select: { id: true, userId: true, applyStatus: true }
    });
    const totalAssistants = assistants.length;
    const activeAssistants = assistants.filter(
      (a) => a.applyStatus === "succeeded" || a.applyStatus === "in_progress"
    ).length;
    const usersWithAssistant = new Set(assistants.map((a) => a.userId)).size;
    const usersWithoutAssistant = totalUsers - usersWithAssistant;

    const [totalConversations, totalMessages, activeWebChats] = await Promise.all([
      this.prisma.assistantChat.count({ where: { workspaceId } }),
      this.prisma.assistantChatMessage.count({
        where: { assistant: { workspaceId } }
      }),
      this.prisma.assistantChat.count({
        where: { workspaceId, surface: "web", archivedAt: null }
      })
    ]);

    const governanceRows = await this.prisma.assistantGovernance.findMany({
      where: { assistantId: { in: assistants.map((a) => a.id) } },
      select: { assistantId: true, quotaPlanCode: true, assistantPlanOverrideCode: true }
    });
    const governanceByAssistant = new Map(governanceRows.map((g) => [g.assistantId, g]));

    const subscriptions = await this.prisma.workspaceSubscription.findMany({
      where: { workspaceId },
      select: { planCode: true }
    });
    const workspacePlanCode = subscriptions.length > 0 ? subscriptions[0]!.planCode : null;

    const planCounts = new Map<string, number>();
    for (const assistant of assistants) {
      const gov = governanceByAssistant.get(assistant.id);
      const effectivePlan =
        gov?.assistantPlanOverrideCode ??
        workspacePlanCode ??
        gov?.quotaPlanCode ??
        defaultPlan?.code ??
        "unknown";
      planCounts.set(effectivePlan, (planCounts.get(effectivePlan) ?? 0) + 1);
    }
    if (usersWithoutAssistant > 0) {
      const fallbackPlan = workspacePlanCode ?? defaultPlan?.code ?? "no_assistant";
      planCounts.set(fallbackPlan, (planCounts.get(fallbackPlan) ?? 0) + usersWithoutAssistant);
    }

    const planDistribution: PlanDistributionEntry[] = Array.from(planCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => ({
        planCode: code,
        planDisplayName: allPlans.find((p) => p.code === code)?.displayName ?? null,
        userCount: count,
        percent: toPercent(count, totalUsers)
      }));

    const quotaPressureDistribution = await this.computeQuotaPressure(workspaceId);

    const webChats = await this.prisma.assistantChat.count({
      where: { workspaceId, surface: "web", archivedAt: null }
    });
    const telegramBindings = await this.prisma.assistantChannelSurfaceBinding.count({
      where: {
        assistant: { workspaceId },
        providerKey: "telegram",
        surfaceType: "telegram_bot",
        bindingState: "active"
      }
    });
    const whatsappBindings = await this.prisma.assistantChannelSurfaceBinding.count({
      where: {
        assistant: { workspaceId },
        providerKey: "whatsapp",
        surfaceType: "whatsapp_business",
        bindingState: "active"
      }
    });
    const maxBindings = await this.prisma.assistantChannelSurfaceBinding.count({
      where: {
        assistant: { workspaceId },
        providerKey: "max",
        surfaceType: { in: ["max_bot", "max_mini_app"] },
        bindingState: "active"
      }
    });

    const applySucceeded = await this.prisma.assistantAuditEvent.count({
      where: {
        workspaceId,
        createdAt: { gte: windowStart },
        eventCode: "assistant.runtime.apply_succeeded"
      }
    });
    const applyDegraded = await this.prisma.assistantAuditEvent.count({
      where: {
        workspaceId,
        createdAt: { gte: windowStart },
        eventCode: "assistant.runtime.apply_degraded"
      }
    });
    const applyFailed = await this.prisma.assistantAuditEvent.count({
      where: {
        workspaceId,
        createdAt: { gte: windowStart },
        eventCode: "assistant.runtime.apply_failed"
      }
    });
    const applyTotal = applySucceeded + applyDegraded + applyFailed;
    const channelTotal = webChats + telegramBindings + whatsappBindings + maxBindings;

    return {
      totalUsers,
      totalAssistants,
      activeAssistants,
      totalConversations,
      totalMessages,
      activeWebChats,
      planDistribution,
      quotaPressureDistribution,
      channelAdoption: {
        webChat: webChats,
        telegram: telegramBindings,
        whatsapp: whatsappBindings,
        max: maxBindings,
        total: channelTotal
      },
      publishApplyHealth: {
        window: "last_7_days",
        applySucceeded,
        applyDegraded,
        applyFailed,
        applySuccessPercent: toPercent(applySucceeded, applyTotal)
      },
      planCatalog: {
        totalPlans: allPlans.length,
        activePlans: activePlans.length,
        inactivePlans: allPlans.length - activePlans.length,
        defaultRegistrationPlanCode: defaultPlan?.code ?? null
      },
      updatedAt: now.toISOString()
    };
  }

  private async computeQuotaPressure(workspaceId: string): Promise<QuotaPressureDistribution> {
    const quotaState = await this.workspaceQuotaAccountingRepository.findByWorkspaceId(workspaceId);
    if (quotaState === null) return { low: 0, elevated: 0, high: 0 };

    const tokenLimit = quotaState.tokenBudgetLimit;
    const tokenPercent =
      tokenLimit !== null && tokenLimit > BigInt(0)
        ? Number((quotaState.tokenBudgetUsed * BigInt(100)) / tokenLimit)
        : 0;

    if (tokenPercent >= 90) return { low: 0, elevated: 0, high: 1 };
    if (tokenPercent >= 60) return { low: 0, elevated: 1, high: 0 };
    return { low: 1, elevated: 0, high: 0 };
  }
}
