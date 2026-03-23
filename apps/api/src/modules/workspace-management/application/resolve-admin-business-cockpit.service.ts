import { Injectable } from "@nestjs/common";
import { AssistantApplyStatus } from "@prisma/client";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { ResolvePlanVisibilityService } from "./resolve-plan-visibility.service";
import type { AdminBusinessCockpitState, BusinessCockpitChannel } from "./business-cockpit.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const BUSINESS_WINDOW_DAYS = 7;

function toPercent(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

@Injectable()
export class ResolveAdminBusinessCockpitService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly resolvePlanVisibilityService: ResolvePlanVisibilityService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async execute(userId: string): Promise<AdminBusinessCockpitState> {
    const context = await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const workspaceId = context.workspaceId;
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - BUSINESS_WINDOW_DAYS);

    const assistants = await this.prisma.assistant.findMany({
      where: { workspaceId },
      select: {
        id: true,
        applyStatus: true,
        applyAppliedVersionId: true
      }
    });
    const totalAssistants = assistants.length;
    const activeAssistants = assistants.filter(
      (assistant) =>
        (assistant.applyStatus === AssistantApplyStatus.succeeded ||
          assistant.applyStatus === AssistantApplyStatus.degraded) &&
        assistant.applyAppliedVersionId !== null
    ).length;
    const publishedAssistants = await this.prisma.assistantPublishedVersion.groupBy({
      by: ["assistantId"],
      where: {
        assistant: { workspaceId }
      }
    });

    const activeWebChats = await this.prisma.assistantChat.count({
      where: {
        workspaceId,
        surface: "web",
        archivedAt: null
      }
    });
    const totalWebChats = await this.prisma.assistantChat.count({
      where: {
        workspaceId,
        surface: "web"
      }
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
    const channelValues: Record<BusinessCockpitChannel, number> = {
      web_chat: activeWebChats,
      telegram: telegramBindings,
      whatsapp: whatsappBindings,
      max: maxBindings
    };
    const channelTotal = Object.values(channelValues).reduce((sum, value) => sum + value, 0);

    const publishedVersionEvents = await this.prisma.assistantAuditEvent.count({
      where: {
        workspaceId,
        createdAt: { gte: windowStart },
        eventCode: {
          in: ["assistant.published", "assistant.rollback_published", "assistant.reset_published"]
        }
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
    const applyTerminalTotal = applySucceeded + applyDegraded + applyFailed;

    const adminVisibility = await this.resolvePlanVisibilityService.getAdminVisibility(userId);

    return {
      activeAssistants: {
        totalAssistants,
        activeAssistants,
        publishedAssistants: publishedAssistants.length
      },
      activeChats: {
        activeWebChats,
        totalWebChats
      },
      channelSplit: {
        channels: [
          {
            channel: "web_chat",
            value: channelValues.web_chat,
            percent: toPercent(channelValues.web_chat, channelTotal)
          },
          {
            channel: "telegram",
            value: channelValues.telegram,
            percent: toPercent(channelValues.telegram, channelTotal)
          },
          {
            channel: "whatsapp",
            value: channelValues.whatsapp,
            percent: toPercent(channelValues.whatsapp, channelTotal)
          },
          {
            channel: "max",
            value: channelValues.max,
            percent: toPercent(channelValues.max, channelTotal)
          }
        ]
      },
      publishApplySuccess: {
        window: "last_7_days",
        publishedVersionEvents,
        applySucceeded,
        applyDegraded,
        applyFailed,
        applySuccessPercent: toPercent(applySucceeded, applyTerminalTotal)
      },
      quotaPressure: {
        tokenBudgetPercent: adminVisibility.usagePressure.tokenBudgetPercent,
        costDrivingToolsPercent: adminVisibility.usagePressure.costDrivingToolsPercent,
        activeWebChatsPercent: adminVisibility.usagePressure.activeWebChatsPercent,
        pressureLevel: adminVisibility.usagePressure.pressureLevel
      },
      planUsageSnapshot: {
        effectivePlanCode: adminVisibility.planState.effectivePlanCode,
        effectivePlanDisplayName: adminVisibility.planState.effectivePlanDisplayName,
        effectivePlanStatus: adminVisibility.planState.effectivePlanStatus,
        defaultRegistrationPlanCode: adminVisibility.planState.defaultRegistrationPlanCode,
        totalPlans: adminVisibility.planState.totalPlans,
        activePlans: adminVisibility.planState.activePlans,
        inactivePlans: adminVisibility.planState.inactivePlans
      },
      updatedAt: now.toISOString()
    };
  }
}
