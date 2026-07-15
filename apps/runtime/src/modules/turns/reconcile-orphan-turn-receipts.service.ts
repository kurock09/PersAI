import { Inject, Injectable, Logger } from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import type { RuntimeConversationAddress } from "@persai/runtime-contract";
import { RUNTIME_CONFIG } from "../../runtime-config";
import { RuntimeStatePostgresService } from "../runtime-state/infrastructure/persistence/runtime-state-postgres.service";
import { RuntimeStateRedisService } from "../runtime-state/infrastructure/coordination/runtime-state-redis.service";

export const ORPHAN_RECEIPT_RECONCILE_ERROR_CODE = "orphan_reconciled";
export const ORPHAN_RECEIPT_RECONCILE_MESSAGE =
  "Runtime turn receipt was reconciled after losing its active execution owner.";

export type ReconcileOrphanTurnReceiptsResult = {
  candidates: number;
  applied: number;
  skippedFresh: number;
  skippedInFlight: number;
  skippedSessionLease: number;
};

@Injectable()
export class ReconcileOrphanTurnReceiptsService {
  private readonly logger = new Logger(ReconcileOrphanTurnReceiptsService.name);

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    private readonly runtimeStatePostgresService: RuntimeStatePostgresService,
    private readonly runtimeStateRedisService: RuntimeStateRedisService
  ) {}

  resolveGraceMs(): number {
    return this.config.ORPHAN_RECEIPT_GRACE_MS;
  }

  async executeBatch(
    limit: number,
    options?: { now?: Date; graceMs?: number }
  ): Promise<ReconcileOrphanTurnReceiptsResult> {
    const now = options?.now ?? new Date();
    const graceMs = options?.graceMs ?? this.resolveGraceMs();
    const staleBefore = new Date(now.getTime() - graceMs);
    const candidates =
      await this.runtimeStatePostgresService.findStaleAcceptedTurnReceiptCandidates({
        staleBefore,
        limit
      });
    const result: ReconcileOrphanTurnReceiptsResult = {
      candidates: candidates.length,
      applied: 0,
      skippedFresh: 0,
      skippedInFlight: 0,
      skippedSessionLease: 0
    };

    this.logger.log(`orphan_reconcile_candidates count=${String(candidates.length)}`);

    for (const candidate of candidates) {
      if (candidate.updatedAt.getTime() >= staleBefore.getTime()) {
        result.skippedFresh += 1;
        continue;
      }

      const conversation = this.toConversationAddress(candidate);
      const inFlightRequestId = await this.runtimeStateRedisService.readTurnInFlightMarker({
        conversation,
        idempotencyKey: candidate.idempotencyKey
      });
      if (inFlightRequestId !== null) {
        result.skippedInFlight += 1;
        continue;
      }

      if (
        candidate.runtimeSessionId !== null &&
        (await this.runtimeStateRedisService.hasSessionLease(candidate.runtimeSessionId))
      ) {
        result.skippedSessionLease += 1;
        continue;
      }

      const updated = await this.runtimeStatePostgresService.reconcileOrphanAcceptedTurnReceipt({
        requestId: candidate.requestId,
        reconciledAt: now,
        errorCode: ORPHAN_RECEIPT_RECONCILE_ERROR_CODE,
        errorMessage: ORPHAN_RECEIPT_RECONCILE_MESSAGE
      });
      if (updated.count === 0) {
        continue;
      }

      await this.runtimeStateRedisService.clearTurnInFlightMarker({
        conversation,
        idempotencyKey: candidate.idempotencyKey
      });

      result.applied += 1;
      this.logger.log(
        `orphan_reconcile_applied requestId=${candidate.requestId} conversationKey=${candidate.conversationKey}`
      );
    }

    if (result.applied > 0) {
      this.logger.log(`orphan_reconcile_applied count=${String(result.applied)}`);
    }

    return result;
  }

  private toConversationAddress(candidate: {
    assistantId: string;
    workspaceId: string;
    channel: RuntimeConversationAddress["channel"];
    externalThreadKey: string;
    externalUserKey: string | null;
    mode: RuntimeConversationAddress["mode"];
  }): RuntimeConversationAddress {
    return {
      assistantId: candidate.assistantId,
      workspaceId: candidate.workspaceId,
      channel: candidate.channel,
      externalThreadKey: candidate.externalThreadKey,
      externalUserKey: candidate.externalUserKey,
      mode: candidate.mode
    };
  }
}
