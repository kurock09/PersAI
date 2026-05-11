import { Inject, Injectable, Logger } from "@nestjs/common";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { EnsureAssistantMaterializedSpecCurrentService } from "./ensure-assistant-materialized-spec-current.service";
import { ReadInternalRuntimeQuotaStatusService } from "./read-internal-runtime-quota-status.service";
import { InternalRuntimeBackgroundTaskClientService } from "./internal-runtime-background-task.client.service";
import { readRuntimeAssignmentStateFromMaterializedLayers } from "./runtime-assignment";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { NotificationIntentService } from "./notifications/notification-intent.service";
import {
  buildCompactionAdvisoryDedupeKey,
  countRecentAutoCompactionStreak,
  isCompactionExhaustedAdvisoryPayload,
  isCompactionExhaustedAtPlanLimit,
  resolveCompactionAdvisorySuppressionMinutes
} from "./compaction-advisory-state";

const COMPACTION_ADVISORY_TIMEOUT_MS = 8_000;
const RECENT_MESSAGE_LIMIT = 8;

const DEFAULT_COMPACTION_ADVISORY_LLM_INSTRUCTION = [
  "Write one short, calm follow-up assistant message when automatic context compaction no longer gives meaningful relief at the current plan limit.",
  "Base the message only on the provided compaction and plan facts. Do not invent limits, prices, reset times, or upgrade availability.",
  "Explain that the conversation can continue, but context continuity is now constrained for this plan.",
  "Mention starting a new chat and upgrading only when the provided facts support those options.",
  "Do not sound alarming, technical, or repetitive."
].join("\n");

type SupportedCompactionAdvisorySurface = "web" | "telegram";

type CompactionAdvisoryState = {
  sessionId: string;
  currentTokens: number;
  reserveTokens: number;
  autoCompactionEnabled: boolean;
  recentAutoCompactionStreak: number;
};

export type CompactionAdvisoryFollowUpResult = {
  intentId: string;
};

@Injectable()
export class CompactionAdvisoryFollowUpService {
  private readonly logger = new Logger(CompactionAdvisoryFollowUpService.name);

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
    surface: SupportedCompactionAdvisorySurface;
    surfaceThreadKey: string;
    externalUserKey: string | null;
    mainAssistantMessage: string;
    traceId?: string | null;
  }): Promise<CompactionAdvisoryFollowUpResult | null> {
    const assistant = await this.assistantRepository.findById(input.assistantId);
    if (assistant === null) {
      return null;
    }
    const spec = await this.ensureAssistantMaterializedSpecCurrentService.resolveCurrent(assistant);
    if (
      spec?.runtimeBundle === null ||
      spec?.runtimeBundle === undefined ||
      spec.runtimeBundleDocument === null ||
      spec.runtimeBundleDocument === undefined
    ) {
      return null;
    }
    const compaction = await this.readCompactionState({
      assistantId: input.assistantId,
      surface: input.surface,
      surfaceThreadKey: input.surfaceThreadKey,
      externalUserKey: input.externalUserKey,
      runtimeBundle: spec.runtimeBundle
    });
    if (compaction === null) {
      return null;
    }

    const policyRow = await this.prisma.notificationPolicy.findUnique({
      where: {
        source: "quota_advisory"
      },
      select: { enabled: true, cooldownMinutes: true, config: true }
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
      typeof policyConfig["compactionLlmInstruction"] === "string" &&
      policyConfig["compactionLlmInstruction"].trim()
        ? policyConfig["compactionLlmInstruction"].trim()
        : DEFAULT_COMPACTION_ADVISORY_LLM_INSTRUCTION;
    const suppressionMinutes = resolveCompactionAdvisorySuppressionMinutes({
      policyCooldownMinutes: policyRow?.cooldownMinutes ?? null,
      config: policyConfig
    });
    const dedupeKey = buildCompactionAdvisoryDedupeKey({
      assistantId: input.assistantId,
      surface: input.surface,
      surfaceThreadKey: input.surfaceThreadKey,
      suppressionMinutes
    });
    const suppressed = await this.readRecentSuppressedIntent({
      assistantId: input.assistantId,
      surface: input.surface,
      surfaceThreadKey: input.surfaceThreadKey,
      suppressionMinutes
    });
    if (suppressed !== null) {
      this.logger.log({
        event: "compaction.advisory.suppressed",
        assistantId: input.assistantId,
        surface: input.surface,
        surfaceThreadKey: input.surfaceThreadKey,
        intentId: suppressed.id,
        suppressionMinutes
      });
      return null;
    }

    const quotaStatus = await this.readInternalRuntimeQuotaStatusService.execute({
      assistantId: input.assistantId,
      channel: input.surface,
      externalThreadKey: input.surfaceThreadKey
    });
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
      compaction,
      adminInstruction: llmInstruction
    });
    const outcome = await this.internalRuntimeBackgroundTaskClientService.evaluate(
      {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        runtimeTier,
        runtimeBundleDocument: spec.runtimeBundleDocument,
        task: {
          id: dedupeKey,
          title: "Compaction advisory follow-up",
          brief: [
            "Decide whether PersAI should send one short follow-up now because automatic context compaction has stopped giving enough relief at the current plan limit.",
            "This message is a second assistant message after the main reply in the same active thread.",
            "Use only the compaction and plan facts provided in the context packet. Do not invent prices, plan names, package availability, links, or reset times.",
            "If you mention upgrade or package options, they must already exist in the provided facts.",
            "Recommend starting a new chat when that helps preserve answer quality.",
            "Return no_push if the message would be repetitive or not grounded enough.",
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
              pushText: "one short user-facing compaction follow-up only when decision=push"
            }
          },
          scheduledRunAt: new Date().toISOString(),
          runCount: 0,
          lastRunStatus: null,
          lastRunAt: null
        }
      },
      { timeoutMs: COMPACTION_ADVISORY_TIMEOUT_MS }
    );

    if (!outcome.ok) {
      this.logger.warn(
        `Compaction advisory follow-up generation skipped for assistant ${input.assistantId}: ${outcome.message}`
      );
      return null;
    }

    const followUpText = outcome.result.pushText?.trim();
    if (outcome.result.decision !== "push" || !followUpText) {
      this.logger.log({
        event: "compaction.advisory.no_push",
        assistantId: input.assistantId,
        surface: input.surface,
        surfaceThreadKey: input.surfaceThreadKey,
        decision: outcome.result.decision
      });
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
        advisoryKind: "compaction_exhausted",
        reserveTokens: compaction.reserveTokens,
        currentTokens: compaction.currentTokens,
        recentAutoCompactionStreak: compaction.recentAutoCompactionStreak
      },
      dedupeKey,
      surface: input.surface,
      surfaceThreadKey: input.surfaceThreadKey,
      chatId: input.chatId,
      respectQuietHours: false,
      traceId: input.traceId ?? null
    });

    this.logger.log({
      event: "compaction.advisory.sent",
      source: "quota_advisory",
      advisoryKind: "compaction_exhausted",
      class: "conversational",
      priority: "immediate",
      intentId: intent.id,
      assistantId: input.assistantId,
      surface: input.surface,
      surfaceThreadKey: input.surfaceThreadKey,
      suppressionMinutes
    });

    return { intentId: intent.id };
  }

  private async readCompactionState(input: {
    assistantId: string;
    surface: SupportedCompactionAdvisorySurface;
    surfaceThreadKey: string;
    externalUserKey: string | null;
    runtimeBundle: unknown;
  }): Promise<CompactionAdvisoryState | null> {
    const config = this.readCompactionConfig(input.runtimeBundle, input.surface);
    if (config === null || !config.autoCompactionEnabled) {
      return null;
    }
    const session = await this.prisma.runtimeSession.findFirst({
      where: {
        assistantId: input.assistantId,
        channel: input.surface,
        externalThreadKey: input.surfaceThreadKey,
        externalUserKey: input.externalUserKey,
        closedAt: null
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        currentTokens: true,
        totalTokensFresh: true,
        compactionCount: true,
        updatedAt: true
      }
    });
    if (
      session === null ||
      session.totalTokensFresh !== true ||
      typeof session.currentTokens !== "number"
    ) {
      return null;
    }
    const recentCompactions = await this.prisma.runtimeSessionCompaction.findMany({
      where: {
        runtimeSessionId: session.id
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 3,
      select: { reason: true }
    });
    const recentAutoCompactionStreak = countRecentAutoCompactionStreak(recentCompactions);
    if (recentAutoCompactionStreak >= 2) {
      this.logger.log({
        event: "compaction.repeated_auto_detected",
        assistantId: input.assistantId,
        surface: input.surface,
        surfaceThreadKey: input.surfaceThreadKey,
        sessionId: session.id,
        currentTokens: session.currentTokens,
        reserveTokens: config.reserveTokens,
        recentAutoCompactionStreak
      });
    }
    if (session.currentTokens >= config.reserveTokens && recentAutoCompactionStreak > 0) {
      this.logger.log({
        event: "compaction.pressure_after_auto_compaction",
        assistantId: input.assistantId,
        surface: input.surface,
        surfaceThreadKey: input.surfaceThreadKey,
        sessionId: session.id,
        currentTokens: session.currentTokens,
        reserveTokens: config.reserveTokens,
        recentAutoCompactionStreak
      });
    }
    if (
      !isCompactionExhaustedAtPlanLimit({
        currentTokens: session.currentTokens,
        totalTokensFresh: session.totalTokensFresh,
        reserveTokens: config.reserveTokens,
        autoCompactionEnabled: config.autoCompactionEnabled,
        recentAutoCompactionStreak
      })
    ) {
      return null;
    }
    this.logger.log({
      event: "compaction.exhausted_detected",
      assistantId: input.assistantId,
      surface: input.surface,
      surfaceThreadKey: input.surfaceThreadKey,
      sessionId: session.id,
      currentTokens: session.currentTokens,
      reserveTokens: config.reserveTokens,
      recentAutoCompactionStreak
    });
    return {
      sessionId: session.id,
      currentTokens: session.currentTokens,
      reserveTokens: config.reserveTokens,
      autoCompactionEnabled: config.autoCompactionEnabled,
      recentAutoCompactionStreak
    };
  }

  private async buildContextPacket(input: {
    assistantId: string;
    chatId: string;
    surface: SupportedCompactionAdvisorySurface;
    surfaceThreadKey: string;
    mainAssistantMessage: string;
    quotaStatus: Awaited<ReturnType<ReadInternalRuntimeQuotaStatusService["execute"]>>;
    compaction: CompactionAdvisoryState;
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
        displayName: assistant?.user?.displayName ?? null,
        locale: assistant?.workspace?.locale ?? null,
        timezone: assistant?.workspace?.timezone ?? null
      },
      targetThread: {
        chatId: input.chatId,
        surface: input.surface,
        surfaceThreadKey: input.surfaceThreadKey,
        newChatAction: input.surface === "telegram" ? "/new" : "new chat"
      },
      mainReply: {
        preview: input.mainAssistantMessage.slice(0, 600)
      },
      compaction: {
        exhaustedAtPlanLimit: true,
        currentTokens: input.compaction.currentTokens,
        reserveTokens: input.compaction.reserveTokens,
        recentAutoCompactionStreak: input.compaction.recentAutoCompactionStreak
      },
      quota: {
        currentPlan: input.quotaStatus.currentPlan,
        advisories: input.quotaStatus.advisories,
        advisoryCandidates: input.quotaStatus.advisoryCandidates,
        visiblePlans: input.quotaStatus.visiblePlans,
        packageOffers: input.quotaStatus.packageOffers,
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

  private readCompactionConfig(
    runtimeBundle: unknown,
    surface: SupportedCompactionAdvisorySurface
  ): { reserveTokens: number; autoCompactionEnabled: boolean } | null {
    const bundle = this.asObject(runtimeBundle);
    const runtime = this.asObject(bundle?.runtime);
    const sharedCompaction = this.asObject(runtime?.sharedCompaction);
    const contextHydration = this.asObject(runtime?.contextHydration);
    const reserveTokens = this.asInteger(sharedCompaction?.reserveTokens);
    const autoCompactionEnabled =
      surface === "telegram"
        ? contextHydration?.autoCompactionTelegram
        : contextHydration?.autoCompactionWeb;
    if (reserveTokens === null || typeof autoCompactionEnabled !== "boolean") {
      return null;
    }
    return {
      reserveTokens,
      autoCompactionEnabled
    };
  }

  private async readRecentSuppressedIntent(input: {
    assistantId: string;
    surface: SupportedCompactionAdvisorySurface;
    surfaceThreadKey: string;
    suppressionMinutes: number;
  }): Promise<{ id: string } | null> {
    const since = new Date(Date.now() - Math.max(1, input.suppressionMinutes) * 60_000);
    const rows = await this.prisma.notificationIntent.findMany({
      where: {
        assistantId: input.assistantId,
        source: "quota_advisory",
        surface: input.surface,
        surfaceThreadKey: input.surfaceThreadKey,
        createdAt: { gte: since }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        factPayload: true
      }
    });
    for (const row of rows) {
      if (isCompactionExhaustedAdvisoryPayload(row.factPayload)) {
        return { id: row.id };
      }
    }
    return null;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private asInteger(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
  }
}
