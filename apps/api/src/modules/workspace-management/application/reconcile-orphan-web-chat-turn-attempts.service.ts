import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { loadApiConfig } from "@persai/config";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { WebChatTurnStopDispatchService } from "./web-chat-turn-stop-dispatch.service";
import { WebChatTurnStreamRegistry } from "./web-chat-turn-stream-registry.service";

const ORPHAN_RECONCILE_ERROR_CODE = "orphan_reconciled";
const ORPHAN_RECONCILE_MESSAGE =
  "Web chat turn attempt was reconciled after losing its active owner.";

type OrphanAttemptCandidate = {
  id: string;
  assistantId: string;
  userId: string;
  surfaceThreadKey: string;
  clientTurnId: string;
  userMessageId: string | null;
  acceptedAt: Date | null;
  runningAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ReconcileOrphanWebChatTurnAttemptsResult = {
  candidates: number;
  applied: number;
  skippedFresh: number;
  skippedActiveOwner: number;
  skippedLiveReceipt: number;
};

function resolveAttemptStaleAnchor(attempt: {
  acceptedAt: Date | null;
  runningAt: Date | null;
  createdAt: Date;
}): Date {
  return attempt.runningAt ?? attempt.acceptedAt ?? attempt.createdAt;
}

@Injectable()
export class ReconcileOrphanWebChatTurnAttemptsService {
  private readonly logger = new Logger(ReconcileOrphanWebChatTurnAttemptsService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly webChatTurnStopDispatchService: WebChatTurnStopDispatchService,
    private readonly webChatTurnStreamRegistry: WebChatTurnStreamRegistry
  ) {}

  resolveGraceMs(env: NodeJS.ProcessEnv = process.env): number {
    return loadApiConfig(env).ORPHAN_ATTEMPT_GRACE_MS;
  }

  async executeBatch(
    limit: number,
    options?: { now?: Date; graceMs?: number }
  ): Promise<ReconcileOrphanWebChatTurnAttemptsResult> {
    const now = options?.now ?? new Date();
    const graceMs = options?.graceMs ?? this.resolveGraceMs();
    const staleBefore = new Date(now.getTime() - graceMs);
    const candidates = await this.findCandidates(staleBefore, limit);
    const result: ReconcileOrphanWebChatTurnAttemptsResult = {
      candidates: candidates.length,
      applied: 0,
      skippedFresh: 0,
      skippedActiveOwner: 0,
      skippedLiveReceipt: 0
    };

    this.logger.log(`orphan_reconcile_candidates count=${String(candidates.length)}`);

    for (const candidate of candidates) {
      if (candidate.updatedAt.getTime() >= staleBefore.getTime()) {
        result.skippedFresh += 1;
        continue;
      }

      if (
        await this.webChatTurnStreamRegistry.hasActiveStream(
          candidate.assistantId,
          candidate.userId,
          candidate.clientTurnId
        )
      ) {
        result.skippedActiveOwner += 1;
        continue;
      }

      if (
        await this.webChatTurnStopDispatchService.hasActiveOwner(
          candidate.assistantId,
          candidate.clientTurnId
        )
      ) {
        result.skippedActiveOwner += 1;
        continue;
      }

      if (await this.hasLiveAcceptedReceipt(candidate, staleBefore)) {
        result.skippedLiveReceipt += 1;
        continue;
      }

      const updated = await this.prisma.assistantWebChatTurnAttempt.updateMany({
        where: {
          id: candidate.id,
          status: { in: ["accepted", "running"] }
        },
        data: {
          status: "interrupted",
          errorCode: ORPHAN_RECONCILE_ERROR_CODE,
          errorMessage: ORPHAN_RECONCILE_MESSAGE,
          interruptedAt: now,
          currentActivity: Prisma.DbNull
        }
      });
      if (updated.count > 0) {
        result.applied += 1;
        this.logger.log(
          `orphan_reconcile_applied assistantId=${candidate.assistantId} clientTurnId=${candidate.clientTurnId} attemptId=${candidate.id}`
        );
      }
    }

    if (result.applied > 0) {
      this.logger.log(`orphan_reconcile_applied count=${String(result.applied)}`);
    }

    return result;
  }

  private async findCandidates(
    staleBefore: Date,
    limit: number
  ): Promise<OrphanAttemptCandidate[]> {
    const rows = await this.prisma.assistantWebChatTurnAttempt.findMany({
      where: {
        status: { in: ["accepted", "running"] }
      },
      select: {
        id: true,
        assistantId: true,
        userId: true,
        surfaceThreadKey: true,
        clientTurnId: true,
        userMessageId: true,
        acceptedAt: true,
        runningAt: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { updatedAt: "asc" },
      take: Math.max(limit * 4, limit)
    });

    return rows
      .filter((row) => resolveAttemptStaleAnchor(row).getTime() < staleBefore.getTime())
      .slice(0, limit);
  }

  private async hasLiveAcceptedReceipt(
    candidate: OrphanAttemptCandidate,
    staleBefore: Date
  ): Promise<boolean> {
    if (candidate.userMessageId === null) {
      return false;
    }

    const receipt = await this.prisma.runtimeTurnReceipt.findFirst({
      where: {
        assistantId: candidate.assistantId,
        channel: "web",
        externalThreadKey: candidate.surfaceThreadKey,
        externalUserKey: candidate.userId,
        idempotencyKey: candidate.userMessageId,
        status: "accepted",
        updatedAt: { gte: staleBefore }
      },
      select: { requestId: true }
    });
    return receipt !== null;
  }
}
