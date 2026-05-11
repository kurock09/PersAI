import { Inject, Injectable } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { EnsureAssistantMaterializedSpecCurrentService } from "./ensure-assistant-materialized-spec-current.service";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  countRecentAutoCompactionStreak,
  isCompactionExhaustedAtPlanLimit,
  isLatestAutoCompactionWeak
} from "./compaction-advisory-state";

const DEFAULT_COMPACTION_WAIT_TIMEOUT_MS = 20_000;
const DEFAULT_COMPACTION_WAIT_POLL_MS = 500;

export type BackgroundCompactionQueueNoticeKind = "compacted" | "exhausted";

export type BackgroundCompactionQueueResult = {
  waited: boolean;
  readyForRetry: boolean;
  noticeKind: BackgroundCompactionQueueNoticeKind | null;
};

@Injectable()
export class BackgroundCompactionQueueService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly ensureAssistantMaterializedSpecCurrentService: EnsureAssistantMaterializedSpecCurrentService
  ) {}

  async waitForActiveThreadCompaction(input: {
    assistantId: string;
    channel: "web" | "telegram";
    externalThreadKey: string;
    maxWaitMs?: number;
    pollMs?: number;
  }): Promise<BackgroundCompactionQueueResult> {
    const activeJob = await this.prisma.assistantBackgroundCompactionJob.findFirst({
      where: {
        assistantId: input.assistantId,
        channel: input.channel,
        externalThreadKey: input.externalThreadKey,
        trigger: "post_turn",
        status: "in_progress"
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true }
    });

    if (activeJob === null) {
      return { waited: false, readyForRetry: false, noticeKind: null };
    }

    const deadline = Date.now() + (input.maxWaitMs ?? DEFAULT_COMPACTION_WAIT_TIMEOUT_MS);
    const pollMs = Math.max(50, input.pollMs ?? DEFAULT_COMPACTION_WAIT_POLL_MS);

    while (Date.now() < deadline) {
      const job = await this.prisma.assistantBackgroundCompactionJob.findUnique({
        where: { id: activeJob.id },
        select: { status: true }
      });

      if (job === null || job.status !== "in_progress") {
        return {
          waited: true,
          readyForRetry: true,
          noticeKind:
            job?.status === "completed"
              ? await this.resolveCompletionNoticeKind({
                  assistantId: input.assistantId,
                  channel: input.channel,
                  externalThreadKey: input.externalThreadKey
                })
              : null
        };
      }

      await delay(pollMs);
    }

    return { waited: true, readyForRetry: false, noticeKind: null };
  }

  private async resolveCompletionNoticeKind(input: {
    assistantId: string;
    channel: "web" | "telegram";
    externalThreadKey: string;
  }): Promise<BackgroundCompactionQueueNoticeKind> {
    const session = await this.prisma.runtimeSession.findFirst({
      where: {
        assistantId: input.assistantId,
        channel: input.channel,
        externalThreadKey: input.externalThreadKey
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        currentTokens: true,
        compactionHintTokens: true,
        totalTokensFresh: true
      }
    });

    if (session === null) {
      return "compacted";
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
    const latestAutoCompactionWeak = isLatestAutoCompactionWeak({
      latestCompactionBaselineTokens: session.compactionHintTokens,
      currentTokens: session.currentTokens,
      totalTokensFresh: session.totalTokensFresh
    });

    let config: { reserveTokens: number; autoCompactionEnabled: boolean } | null = null;
    try {
      const assistant = await this.assistantRepository.findById(input.assistantId);
      if (assistant === null) {
        return "compacted";
      }
      const materializedSpec =
        await this.ensureAssistantMaterializedSpecCurrentService.resolveCurrent(assistant);
      config = this.readCompactionConfig(
        materializedSpec?.runtimeBundle ?? materializedSpec?.runtimeBundleDocument,
        input.channel
      );
    } catch {
      config = null;
    }
    if (config === null || !config.autoCompactionEnabled) {
      return "compacted";
    }

    return isCompactionExhaustedAtPlanLimit({
      currentTokens: session.currentTokens,
      totalTokensFresh: session.totalTokensFresh,
      reserveTokens: config.reserveTokens,
      autoCompactionEnabled: config.autoCompactionEnabled,
      recentAutoCompactionStreak,
      latestAutoCompactionWeak
    })
      ? "exhausted"
      : "compacted";
  }

  private readCompactionConfig(
    runtimeBundle: unknown,
    surface: "web" | "telegram"
  ): { reserveTokens: number; autoCompactionEnabled: boolean } | null {
    const bundle = this.readRuntimeBundle(runtimeBundle);
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

  private readRuntimeBundle(value: unknown): Record<string, unknown> | null {
    const direct = this.asObject(value);
    if (direct !== null) {
      return direct;
    }

    if (typeof value !== "string") {
      return null;
    }

    try {
      return this.asObject(JSON.parse(value));
    } catch {
      return null;
    }
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private asInteger(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
