import { Inject, Injectable } from "@nestjs/common";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";
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
    private readonly assistantPlanCatalogRepository: AssistantPlanCatalogRepository
  ) {}

  async execute(userId: string): Promise<AdminBusinessPlatformState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - BUSINESS_WINDOW_DAYS);

    const totalUsers = await this.prisma.appUser.count();

    const allPlans = await this.assistantPlanCatalogRepository.listAll();
    const defaultPlan = allPlans.find((p) => p.isDefaultFirstRegistrationPlan) ?? null;
    const activePlans = allPlans.filter((p) => p.status === "active");

    const assistants = await this.prisma.assistant.findMany({
      select: { id: true, userId: true, workspaceId: true, applyStatus: true }
    });
    const totalAssistants = assistants.length;
    const activeAssistants = assistants.filter(
      (a) => a.applyStatus === "succeeded" || a.applyStatus === "in_progress"
    ).length;
    const usersWithAssistant = new Set(assistants.map((a) => a.userId)).size;
    const usersWithoutAssistant = totalUsers - usersWithAssistant;

    const [totalConversations, totalMessages, activeWebChats] = await Promise.all([
      this.prisma.assistantChat.count(),
      this.prisma.assistantChatMessage.count(),
      this.prisma.assistantChat.count({
        where: { surface: "web", archivedAt: null }
      })
    ]);

    const governanceRows = await this.prisma.assistantGovernance.findMany({
      where: { assistantId: { in: assistants.map((a) => a.id) } },
      select: { assistantId: true, quotaPlanCode: true, assistantPlanOverrideCode: true }
    });
    const governanceByAssistant = new Map(governanceRows.map((g) => [g.assistantId, g]));

    const subscriptions = await this.prisma.workspaceSubscription.findMany({
      where: {
        workspaceId: {
          in: Array.from(new Set(assistants.map((assistant) => assistant.workspaceId)))
        }
      },
      select: { workspaceId: true, planCode: true }
    });
    const workspacePlanCodeByWorkspaceId = new Map(
      subscriptions.map((subscription) => [subscription.workspaceId, subscription.planCode])
    );

    const planCounts = new Map<string, number>();
    for (const assistant of assistants) {
      const gov = governanceByAssistant.get(assistant.id);
      const effectivePlan =
        gov?.assistantPlanOverrideCode ??
        workspacePlanCodeByWorkspaceId.get(assistant.workspaceId) ??
        gov?.quotaPlanCode ??
        defaultPlan?.code ??
        "unknown";
      planCounts.set(effectivePlan, (planCounts.get(effectivePlan) ?? 0) + 1);
    }
    if (usersWithoutAssistant > 0) {
      const fallbackPlan = defaultPlan?.code ?? "no_assistant";
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

    const quotaPressureDistribution = await this.computeQuotaPressure();

    const webChats = await this.prisma.assistantChat.count({
      where: { surface: "web", archivedAt: null }
    });
    const telegramBindings = await this.prisma.assistantChannelSurfaceBinding.count({
      where: {
        providerKey: "telegram",
        surfaceType: "telegram_bot",
        bindingState: "active"
      }
    });
    const whatsappBindings = await this.prisma.assistantChannelSurfaceBinding.count({
      where: {
        providerKey: "whatsapp",
        surfaceType: "whatsapp_business",
        bindingState: "active"
      }
    });
    const maxBindings = await this.prisma.assistantChannelSurfaceBinding.count({
      where: {
        providerKey: "max",
        surfaceType: { in: ["max_bot", "max_mini_app"] },
        bindingState: "active"
      }
    });

    const applySucceeded = await this.prisma.assistantAuditEvent.count({
      where: {
        createdAt: { gte: windowStart },
        eventCode: "assistant.runtime.apply_succeeded"
      }
    });
    const applyDegraded = await this.prisma.assistantAuditEvent.count({
      where: {
        createdAt: { gte: windowStart },
        eventCode: "assistant.runtime.apply_degraded"
      }
    });
    const applyFailed = await this.prisma.assistantAuditEvent.count({
      where: {
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

  private async computeQuotaPressure(): Promise<QuotaPressureDistribution> {
    const quotaStates = await this.prisma.workspaceQuotaAccountingState.findMany({
      select: {
        tokenBudgetUsed: true,
        tokenBudgetLimit: true
      }
    });

    const distribution: QuotaPressureDistribution = { low: 0, elevated: 0, high: 0 };
    for (const quotaState of quotaStates) {
      const tokenLimit = quotaState.tokenBudgetLimit;
      const tokenPercent =
        tokenLimit !== null && tokenLimit > BigInt(0)
          ? Number((quotaState.tokenBudgetUsed * BigInt(100)) / tokenLimit)
          : 0;

      if (tokenPercent >= 90) {
        distribution.high += 1;
      } else if (tokenPercent >= 60) {
        distribution.elevated += 1;
      } else {
        distribution.low += 1;
      }
    }

    return distribution;
  }
}
