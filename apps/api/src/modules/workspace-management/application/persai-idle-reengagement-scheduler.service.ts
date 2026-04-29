import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { WorkspaceNotificationPolicySource } from "@prisma/client";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AssistantNotificationOutboxService } from "./assistant-notification-outbox.service";
import { EnsureAssistantMaterializedSpecCurrentService } from "./ensure-assistant-materialized-spec-current.service";
import {
  InternalRuntimeBackgroundTaskClientService,
  type InternalRuntimeBackgroundTaskEvaluationOutcome
} from "./internal-runtime-background-task.client.service";
import { readRuntimeAssignmentStateFromMaterializedLayers } from "./runtime-assignment";

const IDLE_REENGAGEMENT_POLL_INTERVAL_MS = 15 * 60_000;
const IDLE_REENGAGEMENT_BATCH_SIZE = 12;
const RECENT_MESSAGE_LIMIT = 10;

type IdleCandidate = {
  assistantId: string;
  userId: string;
  workspaceId: string;
  chatId: string;
  surface: "web" | "telegram";
  surfaceThreadKey: string;
  latestUserMessageAt: Date;
  idleHours: number;
  cooldownHours: number;
  llmInstruction: string;
};

@Injectable()
export class PersaiIdleReengagementSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PersaiIdleReengagementSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly ensureAssistantMaterializedSpecCurrentService: EnsureAssistantMaterializedSpecCurrentService,
    private readonly internalRuntimeBackgroundTaskClientService: InternalRuntimeBackgroundTaskClientService,
    private readonly assistantNotificationOutboxService: AssistantNotificationOutboxService
  ) {}

  onModuleInit(): void {
    this.scheduleNext(IDLE_REENGAGEMENT_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async processDueIdleReengagementBatch(limit = IDLE_REENGAGEMENT_BATCH_SIZE): Promise<number> {
    const candidates = await this.findDueCandidates(limit);
    for (const candidate of candidates) {
      await this.processCandidate(candidate);
    }
    return candidates.length;
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (this.running) {
      this.scheduleNext(IDLE_REENGAGEMENT_POLL_INTERVAL_MS);
      return;
    }
    this.running = true;
    try {
      const processed = await this.processDueIdleReengagementBatch();
      if (processed > 0) {
        this.logger.log(`Processed ${processed} idle reengagement candidate(s).`);
      }
    } catch (error) {
      this.logger.error(
        `Idle reengagement scheduler tick failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      this.running = false;
      this.scheduleNext(IDLE_REENGAGEMENT_POLL_INTERVAL_MS);
    }
  }

  private async findDueCandidates(limit: number): Promise<IdleCandidate[]> {
    const policies = await this.prisma.workspaceNotificationPolicy.findMany({
      where: {
        source: WorkspaceNotificationPolicySource.idle_reengagement,
        enabled: true
      },
      orderBy: { updatedAt: "asc" },
      take: Math.max(1, Math.floor(limit))
    });

    const candidates: IdleCandidate[] = [];
    const now = Date.now();
    for (const policy of policies) {
      const assistants = await this.prisma.assistant.findMany({
        where: { workspaceId: policy.workspaceId },
        select: { id: true, userId: true, workspaceId: true },
        orderBy: { updatedAt: "asc" },
        take: Math.max(1, Math.floor(limit))
      });
      for (const assistant of assistants) {
        if (candidates.length >= limit) {
          return candidates;
        }
        const latestUserMessage = await this.prisma.assistantChatMessage.findFirst({
          where: {
            assistantId: assistant.id,
            author: "user",
            chat: { archivedAt: null }
          },
          orderBy: { createdAt: "desc" },
          select: {
            createdAt: true,
            chat: {
              select: {
                id: true,
                surface: true,
                surfaceThreadKey: true
              }
            }
          }
        });
        if (latestUserMessage === null) {
          continue;
        }
        const idleMs = now - latestUserMessage.createdAt.getTime();
        if (idleMs < policy.idleHours * 60 * 60 * 1000) {
          continue;
        }
        const cooldownSince = new Date(now - policy.cooldownHours * 60 * 60 * 1000);
        const recentIdleOutbox = await this.prisma.assistantNotificationOutbox.findFirst({
          where: {
            assistantId: assistant.id,
            source: "idle_reengagement",
            createdAt: { gte: cooldownSince },
            status: { in: ["pending", "in_progress", "delivered", "skipped"] }
          },
          select: { id: true }
        });
        if (recentIdleOutbox !== null) {
          continue;
        }
        candidates.push({
          assistantId: assistant.id,
          userId: assistant.userId,
          workspaceId: assistant.workspaceId,
          chatId: latestUserMessage.chat.id,
          surface: latestUserMessage.chat.surface,
          surfaceThreadKey: latestUserMessage.chat.surfaceThreadKey,
          latestUserMessageAt: latestUserMessage.createdAt,
          idleHours: policy.idleHours,
          cooldownHours: policy.cooldownHours,
          llmInstruction: policy.llmInstruction
        });
      }
    }
    return candidates;
  }

  private async processCandidate(candidate: IdleCandidate): Promise<void> {
    const assistant = await this.assistantRepository.findById(candidate.assistantId);
    if (assistant === null) {
      return;
    }
    const spec = await this.ensureAssistantMaterializedSpecCurrentService.resolveCurrent(assistant);
    if (spec?.runtimeBundleDocument === null || spec?.runtimeBundleDocument === undefined) {
      return;
    }

    const contextPacket = await this.buildContextPacket(candidate);
    const dedupeKey = this.buildDedupeKey(candidate);
    const outcome = await this.internalRuntimeBackgroundTaskClientService.evaluate({
      assistantId: candidate.assistantId,
      workspaceId: candidate.workspaceId,
      runtimeTier:
        readRuntimeAssignmentStateFromMaterializedLayers(spec.layers)?.effectiveTier ??
        "free_shared_restricted",
      runtimeBundleDocument: spec.runtimeBundleDocument,
      task: {
        id: dedupeKey,
        title: "Idle reengagement",
        brief: [
          "Decide whether PersAI should send one proactive idle reengagement notification now.",
          "Use the compact context packet. Return push only when a short, warm message would be genuinely helpful.",
          "Never mention the exact idle duration, never guilt the user, and avoid needy or sales-like language.",
          "Admin instruction:",
          candidate.llmInstruction,
          "Context packet:",
          JSON.stringify(contextPacket, null, 2)
        ].join("\n"),
        scheduleJson: null,
        pushPolicyJson: {
          source: "idle_reengagement",
          requiredOutput: {
            decision: "push | no_push | complete",
            pushText: "short warm user-facing text only when decision=push"
          }
        },
        scheduledRunAt: new Date().toISOString(),
        runCount: 0,
        lastRunStatus: null,
        lastRunAt: null
      }
    });

    await this.recordEvaluation(candidate, dedupeKey, contextPacket, outcome);
  }

  private async buildContextPacket(candidate: IdleCandidate): Promise<Record<string, unknown>> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: candidate.assistantId },
      select: {
        draftDisplayName: true,
        draftTraits: true,
        user: { select: { displayName: true } },
        workspace: { select: { locale: true, timezone: true } }
      }
    });
    const recentMessages = await this.prisma.assistantChatMessage.findMany({
      where: { chatId: candidate.chatId },
      orderBy: { createdAt: "desc" },
      take: RECENT_MESSAGE_LIMIT,
      select: { author: true, content: true, createdAt: true }
    });
    const openLoops = await this.prisma.assistantMemoryRegistryItem.findMany({
      where: {
        assistantId: candidate.assistantId,
        kind: "open_loop",
        resolvedAt: null,
        forgottenAt: null
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { summary: true, createdAt: true }
    });

    return {
      assistant: {
        id: candidate.assistantId,
        displayName: assistant?.draftDisplayName ?? null,
        voiceTraits: assistant?.draftTraits ?? null
      },
      user: {
        id: candidate.userId,
        displayName: assistant?.user.displayName ?? null,
        locale: assistant?.workspace.locale ?? null,
        timezone: assistant?.workspace.timezone ?? null
      },
      idle: {
        bucket: this.toIdleBucket(candidate.latestUserMessageAt),
        latestUserMessageAt: candidate.latestUserMessageAt.toISOString(),
        cooldownHours: candidate.cooldownHours
      },
      targetThread: {
        chatId: candidate.chatId,
        surface: candidate.surface,
        surfaceThreadKey: candidate.surfaceThreadKey
      },
      recentMessages: recentMessages.reverse().map((message) => ({
        author: message.author,
        content: message.content.slice(0, 1_000),
        createdAt: message.createdAt.toISOString()
      })),
      activeOpenLoops: openLoops.map((item) => ({
        summary: item.summary,
        createdAt: item.createdAt.toISOString()
      })),
      adminInstruction: candidate.llmInstruction,
      outputSchema: {
        decision: "push | no_push",
        reason: "short internal reason",
        pushText: "required only for push"
      }
    };
  }

  private async recordEvaluation(
    candidate: IdleCandidate,
    dedupeKey: string,
    contextPacket: Record<string, unknown>,
    outcome: InternalRuntimeBackgroundTaskEvaluationOutcome
  ): Promise<void> {
    if (!outcome.ok) {
      this.logger.warn(
        `Idle reengagement evaluation failed for assistant ${candidate.assistantId}: ${outcome.message}`
      );
      return;
    }

    const result = outcome.result;
    await this.assistantNotificationOutboxService.enqueue({
      assistantId: candidate.assistantId,
      source: "idle_reengagement",
      sourceId: candidate.chatId,
      status: result.decision === "push" ? "ok" : "skipped",
      ...(result.decision === "push" && result.pushText ? { text: result.pushText } : {}),
      dedupeKey,
      metadata: {
        decision: result.decision,
        rationale: result.rationale,
        confidence: result.confidence,
        contextPacket
      }
    });
  }

  private buildDedupeKey(candidate: IdleCandidate): string {
    return [
      "idle_reengagement",
      candidate.assistantId,
      candidate.chatId,
      candidate.latestUserMessageAt.toISOString()
    ].join(":");
  }

  private toIdleBucket(latestUserMessageAt: Date): string {
    const idleHours = Math.max(
      1,
      Math.floor((Date.now() - latestUserMessageAt.getTime()) / 3_600_000)
    );
    if (idleHours < 48) {
      return "24h_plus";
    }
    if (idleHours < 168) {
      return "48h_plus";
    }
    return "7d_plus";
  }
}
