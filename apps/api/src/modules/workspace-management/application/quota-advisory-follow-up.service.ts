import { Inject, Injectable, Logger } from "@nestjs/common";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import type { AssistantWebChatMessageState } from "./web-chat.types";
import { EnsureAssistantMaterializedSpecCurrentService } from "./ensure-assistant-materialized-spec-current.service";
import { ManageAdminNotificationChannelsService } from "./manage-admin-notification-channels.service";
import { QuotaAdvisoryStateService } from "./quota-advisory-state.service";
import { ReadInternalRuntimeQuotaStatusService } from "./read-internal-runtime-quota-status.service";
import { InternalRuntimeBackgroundTaskClientService } from "./internal-runtime-background-task.client.service";
import { readRuntimeAssignmentStateFromMaterializedLayers } from "./runtime-assignment";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const QUOTA_ADVISORY_TIMEOUT_MS = 8_000;
const RECENT_MESSAGE_LIMIT = 8;

type SupportedQuotaAdvisorySurface = "web" | "telegram";

export type QuotaAdvisoryFollowUpResult = {
  assistantMessage: AssistantWebChatMessageState;
};

@Injectable()
export class QuotaAdvisoryFollowUpService {
  private readonly logger = new Logger(QuotaAdvisoryFollowUpService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly ensureAssistantMaterializedSpecCurrentService: EnsureAssistantMaterializedSpecCurrentService,
    private readonly readInternalRuntimeQuotaStatusService: ReadInternalRuntimeQuotaStatusService,
    private readonly manageAdminNotificationChannelsService: ManageAdminNotificationChannelsService,
    private readonly internalRuntimeBackgroundTaskClientService: InternalRuntimeBackgroundTaskClientService,
    private readonly quotaAdvisoryStateService: QuotaAdvisoryStateService
  ) {}

  async maybeCreateFollowUp(input: {
    assistantId: string;
    workspaceId: string;
    chatId: string;
    surface: SupportedQuotaAdvisorySurface;
    surfaceThreadKey: string;
    mainAssistantMessage: string;
  }): Promise<QuotaAdvisoryFollowUpResult | null> {
    const quotaStatus = await this.readInternalRuntimeQuotaStatusService.execute({
      assistantId: input.assistantId,
      channel: input.surface,
      externalThreadKey: input.surfaceThreadKey
    });
    const eligibleCandidates = quotaStatus.advisoryCandidates.filter(
      (candidate) => candidate.deliveryState === "eligible"
    );
    if (eligibleCandidates.length === 0) {
      return null;
    }

    const policy =
      await this.manageAdminNotificationChannelsService.getQuotaAdvisoryPolicyForWorkspace(
        input.workspaceId
      );
    if (!policy.enabled) {
      return null;
    }

    const assistant = await this.assistantRepository.findById(input.assistantId);
    if (assistant === null) {
      return null;
    }
    const spec = await this.ensureAssistantMaterializedSpecCurrentService.resolveCurrent(assistant);
    if (spec?.runtimeBundleDocument === null || spec?.runtimeBundleDocument === undefined) {
      return null;
    }

    const runtimeTier =
      readRuntimeAssignmentStateFromMaterializedLayers(spec.layers)?.effectiveTier ??
      "free_shared_restricted";
    const contextPacket = await this.buildContextPacket({
      assistantId: input.assistantId,
      chatId: input.chatId,
      surface: input.surface,
      surfaceThreadKey: input.surfaceThreadKey,
      mainAssistantMessage: input.mainAssistantMessage,
      quotaStatus,
      adminInstruction: policy.llmInstruction
    });

    const dedupeKey = [
      "quota_advisory",
      input.assistantId,
      input.surface,
      input.surfaceThreadKey,
      eligibleCandidates.map((candidate) => candidate.dedupeKey).join("|")
    ].join(":");
    const outcome = await this.internalRuntimeBackgroundTaskClientService.evaluate(
      {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        runtimeTier,
        runtimeBundleDocument: spec.runtimeBundleDocument,
        task: {
          id: dedupeKey,
          title: "Quota advisory follow-up",
          brief: [
            "Decide whether PersAI should send one short quota advisory follow-up now.",
            "This message is a second assistant message after the main reply in the same active thread.",
            "Use only the quota facts provided in the context packet. Do not invent reset times, plan features, prices, links, or package purchases.",
            "If you mention an upgrade or purchase option, it must already be present in the provided facts.",
            "Return no_push if the message would be repetitive, vague, or not grounded enough.",
            "Admin instruction:",
            policy.llmInstruction,
            "Context packet:",
            JSON.stringify(contextPacket, null, 2)
          ].join("\n"),
          scheduleJson: null,
          pushPolicyJson: {
            source: "quota_advisory",
            requiredOutput: {
              decision: "push | no_push | complete",
              pushText: "one short user-facing quota follow-up only when decision=push"
            }
          },
          scheduledRunAt: new Date().toISOString(),
          runCount: 0,
          lastRunStatus: null,
          lastRunAt: null
        }
      },
      { timeoutMs: QUOTA_ADVISORY_TIMEOUT_MS }
    );

    if (!outcome.ok) {
      this.logger.warn(
        `Quota advisory follow-up generation skipped for assistant ${input.assistantId}: ${outcome.message}`
      );
      return null;
    }

    const followUpText = outcome.result.pushText?.trim();
    if (outcome.result.decision !== "push" || !followUpText) {
      return null;
    }

    const assistantMessage = await this.assistantChatRepository.createMessage({
      chatId: input.chatId,
      assistantId: input.assistantId,
      author: "assistant",
      content: followUpText
    });
    await this.quotaAdvisoryStateService.recordDeliveredCandidates({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      threadContext: {
        channel: input.surface,
        externalThreadKey: input.surfaceThreadKey
      },
      candidates: eligibleCandidates
    });
    return {
      assistantMessage: {
        id: assistantMessage.id,
        chatId: assistantMessage.chatId,
        assistantId: assistantMessage.assistantId,
        author: assistantMessage.author,
        content: assistantMessage.content,
        attachments: [],
        createdAt: assistantMessage.createdAt.toISOString()
      }
    };
  }

  private async buildContextPacket(input: {
    assistantId: string;
    chatId: string;
    surface: SupportedQuotaAdvisorySurface;
    surfaceThreadKey: string;
    mainAssistantMessage: string;
    quotaStatus: Awaited<ReturnType<ReadInternalRuntimeQuotaStatusService["execute"]>>;
    adminInstruction: string;
  }): Promise<Record<string, unknown>> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: input.assistantId },
      select: {
        draftDisplayName: true,
        user: { select: { displayName: true } },
        workspace: { select: { locale: true, timezone: true } }
      }
    });
    const recentMessages = await this.prisma.assistantChatMessage.findMany({
      where: { chatId: input.chatId },
      orderBy: { createdAt: "desc" },
      take: RECENT_MESSAGE_LIMIT,
      select: { author: true, content: true, createdAt: true }
    });
    return {
      assistant: {
        id: input.assistantId,
        displayName: assistant?.draftDisplayName ?? null
      },
      user: {
        displayName: assistant?.user.displayName ?? null,
        locale: assistant?.workspace.locale ?? null,
        timezone: assistant?.workspace.timezone ?? null
      },
      targetThread: {
        chatId: input.chatId,
        surface: input.surface,
        surfaceThreadKey: input.surfaceThreadKey
      },
      mainReply: {
        preview: input.mainAssistantMessage.slice(0, 600)
      },
      quota: {
        currentPlan: input.quotaStatus.currentPlan,
        advisories: input.quotaStatus.advisories,
        advisoryCandidates: input.quotaStatus.advisoryCandidates,
        visiblePlans: input.quotaStatus.visiblePlans,
        monthlyMediaQuotas: input.quotaStatus.monthlyMediaQuotas,
        tools: input.quotaStatus.tools,
        buckets: input.quotaStatus.buckets
      },
      recentMessages: recentMessages.reverse().map((message) => ({
        author: message.author,
        content: message.content.slice(0, 800),
        createdAt: message.createdAt.toISOString()
      })),
      adminInstruction: input.adminInstruction,
      outputSchema: {
        decision: "push | no_push",
        reason: "short internal reason",
        pushText: "required only for push"
      }
    };
  }
}
