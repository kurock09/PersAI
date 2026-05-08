import { Inject, Injectable, Logger } from "@nestjs/common";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { EnsureAssistantMaterializedSpecCurrentService } from "./ensure-assistant-materialized-spec-current.service";
import { ReadInternalRuntimeQuotaStatusService } from "./read-internal-runtime-quota-status.service";
import { InternalRuntimeBackgroundTaskClientService } from "./internal-runtime-background-task.client.service";
import { readRuntimeAssignmentStateFromMaterializedLayers } from "./runtime-assignment";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { NotificationIntentService } from "./notifications/notification-intent.service";

const QUOTA_ADVISORY_TIMEOUT_MS = 8_000;
const RECENT_MESSAGE_LIMIT = 8;

const DEFAULT_QUOTA_ADVISORY_LLM_INSTRUCTION = [
  "Write one short, calm follow-up assistant message when a grounded quota advisory should be sent.",
  "Base the message only on the provided quota facts and limit candidates. Do not invent limits, reset times, package links, or plan availability.",
  "Sound helpful and concise. Mention upgrade or purchase options only when the facts explicitly say they are available.",
  "If the active plan is free or zero-price, do not imply paid light mode. If paid token light mode is active, explain it plainly without sounding alarming."
].join("\n");

type SupportedQuotaAdvisorySurface = "web" | "telegram";

export type QuotaAdvisoryFollowUpResult = {
  intentId: string;
};

@Injectable()
export class QuotaAdvisoryFollowUpService {
  private readonly logger = new Logger(QuotaAdvisoryFollowUpService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly ensureAssistantMaterializedSpecCurrentService: EnsureAssistantMaterializedSpecCurrentService,
    private readonly readInternalRuntimeQuotaStatusService: ReadInternalRuntimeQuotaStatusService,
    private readonly internalRuntimeBackgroundTaskClientService: InternalRuntimeBackgroundTaskClientService,
    private readonly notificationIntentService: NotificationIntentService
  ) {}

  async maybeCreateFollowUp(input: {
    assistantId: string;
    workspaceId: string;
    userId: string;
    chatId: string;
    surface: SupportedQuotaAdvisorySurface;
    surfaceThreadKey: string;
    mainAssistantMessage: string;
    traceId?: string | null;
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

    const policyRow = await this.prisma.notificationPolicy.findUnique({
      where: {
        workspaceId_source: { workspaceId: input.workspaceId, source: "quota_advisory" }
      },
      select: { enabled: true, config: true }
    });
    const policyEnabled = policyRow === null ? true : policyRow.enabled;
    if (!policyEnabled) {
      return null;
    }
    const policyConfig =
      policyRow !== null &&
      typeof policyRow.config === "object" &&
      policyRow.config !== null &&
      !Array.isArray(policyRow.config)
        ? (policyRow.config as Record<string, unknown>)
        : {};
    const llmInstruction =
      typeof policyConfig["llmInstruction"] === "string" && policyConfig["llmInstruction"].trim()
        ? policyConfig["llmInstruction"].trim()
        : DEFAULT_QUOTA_ADVISORY_LLM_INSTRUCTION;

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
      adminInstruction: llmInstruction
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
            llmInstruction,
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

    const intent = await this.notificationIntentService.createIntent({
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      userId: input.userId,
      source: "quota_advisory",
      class: "conversational",
      priority: "immediate",
      renderStrategy: "grounded_llm",
      factPayload: {
        pushText: followUpText,
        candidates: eligibleCandidates
      },
      allowedChannels: input.surface === "telegram" ? ["telegram_thread"] : ["web_thread"],
      dedupeKey,
      surface: input.surface,
      surfaceThreadKey: input.surfaceThreadKey,
      chatId: input.chatId,
      respectQuietHours: false,
      traceId: input.traceId ?? null
    });

    this.logger.log({
      event: "notification.intent.created",
      source: "quota_advisory",
      class: "conversational",
      priority: "immediate",
      intentId: intent.id,
      assistantId: input.assistantId
    });

    return { intentId: intent.id };
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
