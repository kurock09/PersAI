import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type {
  RuntimeFailedEvent,
  RuntimeInterruptedEvent,
  RuntimeSessionSummary,
  RuntimeTurnResult,
  RuntimeUsageSnapshot
} from "@persai/runtime-contract";
import { SessionLeaseService } from "../sessions/session-lease.service";
import { SessionStoreService } from "../sessions/session-store.service";
import { RuntimeStatePostgresService } from "../runtime-state/infrastructure/persistence/runtime-state-postgres.service";
import type { AcceptedRuntimeTurn } from "./turn-acceptance.service";
import { resolveSessionContextPressureTokens } from "./session-context-pressure-tokens";
import { resolveMicroClearNextArmAfterClear } from "./tool-observation-policy";

export interface FinalizedRuntimeTurn {
  receiptStatus: "completed" | "interrupted" | "failed";
  session: RuntimeSessionSummary;
  leaseReleased: boolean;
}

export interface InterruptAcceptedTurnInput {
  acceptedTurn: AcceptedRuntimeTurn;
  event: RuntimeInterruptedEvent;
  usage?: RuntimeUsageSnapshot | null;
}

export interface CompleteAcceptedTurnOptions {
  compactionTriggerThreshold?: number;
}

@Injectable()
export class TurnFinalizationService {
  private readonly logger = new Logger(TurnFinalizationService.name);

  constructor(
    private readonly runtimeStatePostgresService: RuntimeStatePostgresService,
    private readonly sessionStoreService: SessionStoreService,
    private readonly sessionLeaseService: SessionLeaseService
  ) {}

  async completeAcceptedTurn(
    acceptedTurn: AcceptedRuntimeTurn,
    result: RuntimeTurnResult,
    options?: CompleteAcceptedTurnOptions
  ): Promise<FinalizedRuntimeTurn> {
    this.assertMatchingTurnIdentity({
      expectedRequestId: acceptedTurn.receipt.requestId,
      expectedSessionId: acceptedTurn.session.sessionId,
      actualRequestId: result.requestId,
      actualSessionId: result.sessionId
    });

    const completedAt = this.parseRequiredIsoTimestamp(result.respondedAt, "result.respondedAt");
    let leaseReleased = false;
    let terminalReceiptPersisted = false;
    let session = acceptedTurn.session;

    try {
      await this.runtimeStatePostgresService.markTurnReceiptCompleted({
        requestId: acceptedTurn.receipt.requestId,
        resultPayload: result,
        completedAt
      });
      terminalReceiptPersisted = true;
      const contextPressureTokens = resolveSessionContextPressureTokens({
        usage: result.usage,
        textUsageAccounting: result.textUsageAccounting ?? null
      });
      const microClearPatch = await this.resolveMicroClearArmPatch({
        sessionId: acceptedTurn.session.sessionId,
        contextPressureTokens,
        compactionTriggerThreshold: options?.compactionTriggerThreshold
      });
      session = await this.sessionStoreService.updateSessionSummary({
        sessionId: acceptedTurn.session.sessionId,
        ...(result.usage !== null
          ? {
              providerKey: result.usage.providerKey,
              modelKey: result.usage.modelKey,
              currentTokens: contextPressureTokens,
              totalTokensFresh: contextPressureTokens !== null
            }
          : { totalTokensFresh: false }),
        ...microClearPatch,
        lastTurnAt: completedAt
      });
    } finally {
      if (terminalReceiptPersisted) {
        leaseReleased = await this.releaseLeaseQuietly(acceptedTurn);
      }
    }

    return {
      receiptStatus: "completed",
      session,
      leaseReleased
    };
  }

  /**
   * Resolve next arm after a completed clear, or drop a stuck pendingEval when
   * threshold is unavailable. Never leaves pendingEval sticky across terminals.
   */
  private async resolveMicroClearArmPatch(input: {
    sessionId: string;
    contextPressureTokens: number | null;
    compactionTriggerThreshold: number | undefined;
  }): Promise<{
    priorToolMicroClearPendingEval?: boolean;
    priorToolMicroClearNextArmPercent?: number;
  }> {
    const persisted = await this.runtimeStatePostgresService.findSessionById(input.sessionId);
    if (persisted === null || persisted.priorToolMicroClearPendingEval !== true) {
      return {};
    }
    if (
      typeof input.compactionTriggerThreshold !== "number" ||
      !Number.isFinite(input.compactionTriggerThreshold)
    ) {
      // Keep current nextArm; only clear the pending flag so the next arm cross
      // can queue a fresh eval.
      return { priorToolMicroClearPendingEval: false };
    }
    const nextArm = resolveMicroClearNextArmAfterClear({
      lastArmPercent: persisted.priorToolMicroClearLastArmPercent,
      currentTokens: input.contextPressureTokens,
      totalTokensFresh: input.contextPressureTokens !== null,
      compactionTriggerThreshold: input.compactionTriggerThreshold
    });
    return {
      priorToolMicroClearPendingEval: false,
      priorToolMicroClearNextArmPercent: nextArm
    };
  }

  /** Drop pendingEval without changing nextArm (interrupt / fail paths). */
  private async clearPendingMicroClearEval(sessionId: string): Promise<{
    priorToolMicroClearPendingEval?: boolean;
  }> {
    const persisted = await this.runtimeStatePostgresService.findSessionById(sessionId);
    if (persisted === null || persisted.priorToolMicroClearPendingEval !== true) {
      return {};
    }
    return { priorToolMicroClearPendingEval: false };
  }

  async interruptAcceptedTurn(input: InterruptAcceptedTurnInput): Promise<FinalizedRuntimeTurn> {
    this.assertMatchingTurnIdentity({
      expectedRequestId: input.acceptedTurn.receipt.requestId,
      expectedSessionId: input.acceptedTurn.session.sessionId,
      actualRequestId: input.event.requestId,
      actualSessionId: input.event.sessionId
    });

    const completedAt =
      input.event.respondedAt === null
        ? null
        : this.parseRequiredIsoTimestamp(input.event.respondedAt, "event.respondedAt");
    let leaseReleased = false;
    let terminalReceiptPersisted = false;
    let session = input.acceptedTurn.session;

    try {
      await this.runtimeStatePostgresService.markTurnReceiptInterrupted({
        requestId: input.acceptedTurn.receipt.requestId,
        resultPayload: input.event,
        completedAt
      });
      terminalReceiptPersisted = true;
      const interruptPressureTokens =
        input.usage === undefined || input.usage === null
          ? null
          : resolveSessionContextPressureTokens({ usage: input.usage });
      const microClearPatch = await this.clearPendingMicroClearEval(
        input.acceptedTurn.session.sessionId
      );
      session = await this.sessionStoreService.updateSessionSummary({
        sessionId: input.acceptedTurn.session.sessionId,
        ...(input.usage === undefined
          ? {}
          : input.usage === null
            ? { totalTokensFresh: false }
            : {
                providerKey: input.usage.providerKey,
                modelKey: input.usage.modelKey,
                currentTokens: interruptPressureTokens,
                totalTokensFresh: interruptPressureTokens !== null
              }),
        ...microClearPatch,
        ...(completedAt === null ? {} : { lastTurnAt: completedAt })
      });
    } finally {
      if (terminalReceiptPersisted) {
        leaseReleased = await this.releaseLeaseQuietly(input.acceptedTurn);
      }
    }
    if (!leaseReleased) {
      this.logger.warn(
        `runtime_turn_interrupted_lease_not_released requestId=${input.acceptedTurn.receipt.requestId} sessionId=${input.acceptedTurn.session.sessionId}`
      );
    }

    return {
      receiptStatus: "interrupted",
      session,
      leaseReleased
    };
  }

  async failAcceptedTurn(
    acceptedTurn: AcceptedRuntimeTurn,
    event: RuntimeFailedEvent,
    completedAtIso: string = new Date().toISOString()
  ): Promise<FinalizedRuntimeTurn> {
    this.assertMatchingFailedTurnIdentity(acceptedTurn, event);

    const completedAt = this.parseRequiredIsoTimestamp(completedAtIso, "completedAtIso");
    let leaseReleased = false;
    let terminalReceiptPersisted = false;
    let session = acceptedTurn.session;

    try {
      await this.runtimeStatePostgresService.markTurnReceiptFailed({
        requestId: acceptedTurn.receipt.requestId,
        resultPayload: event,
        errorCode: event.code,
        errorMessage: event.message,
        completedAt
      });
      terminalReceiptPersisted = true;
      const microClearPatch = await this.clearPendingMicroClearEval(acceptedTurn.session.sessionId);
      if (Object.keys(microClearPatch).length > 0) {
        session = await this.sessionStoreService.updateSessionSummary({
          sessionId: acceptedTurn.session.sessionId,
          ...microClearPatch
        });
      }
    } finally {
      if (terminalReceiptPersisted) {
        leaseReleased = await this.releaseLeaseQuietly(acceptedTurn);
      }
    }
    if (!leaseReleased) {
      this.logger.warn(
        `runtime_turn_failed_lease_not_released requestId=${acceptedTurn.receipt.requestId} sessionId=${acceptedTurn.session.sessionId} code=${event.code}`
      );
    }

    return {
      receiptStatus: "failed",
      session,
      leaseReleased
    };
  }

  async failAcceptedTurnMinimal(
    acceptedTurn: AcceptedRuntimeTurn,
    event: RuntimeFailedEvent,
    completedAtIso: string = new Date().toISOString()
  ): Promise<FinalizedRuntimeTurn> {
    this.assertMatchingFailedTurnIdentity(acceptedTurn, event);

    const completedAt = this.parseRequiredIsoTimestamp(completedAtIso, "completedAtIso");
    let leaseReleased = false;
    let terminalReceiptPersisted = false;
    let session = acceptedTurn.session;

    try {
      await this.runtimeStatePostgresService.markTurnReceiptFailed({
        requestId: acceptedTurn.receipt.requestId,
        errorCode: event.code,
        errorMessage: event.message,
        completedAt
      });
      terminalReceiptPersisted = true;
      const microClearPatch = await this.clearPendingMicroClearEval(acceptedTurn.session.sessionId);
      if (Object.keys(microClearPatch).length > 0) {
        session = await this.sessionStoreService.updateSessionSummary({
          sessionId: acceptedTurn.session.sessionId,
          ...microClearPatch
        });
      }
    } finally {
      if (terminalReceiptPersisted) {
        leaseReleased = await this.releaseLeaseQuietly(acceptedTurn);
      }
    }
    if (!leaseReleased) {
      this.logger.warn(
        `runtime_turn_failed_minimal_lease_not_released requestId=${acceptedTurn.receipt.requestId} sessionId=${acceptedTurn.session.sessionId} code=${event.code}`
      );
    }

    return {
      receiptStatus: "failed",
      session,
      leaseReleased
    };
  }

  private assertMatchingTurnIdentity(input: {
    expectedRequestId: string;
    expectedSessionId: string;
    actualRequestId: string;
    actualSessionId: string;
  }): void {
    if (input.expectedRequestId !== input.actualRequestId) {
      throw new BadRequestException(
        "Turn finalization requestId does not match the accepted receipt"
      );
    }
    if (input.expectedSessionId !== input.actualSessionId) {
      throw new BadRequestException(
        "Turn finalization sessionId does not match the accepted session"
      );
    }
  }

  private assertMatchingFailedTurnIdentity(
    acceptedTurn: AcceptedRuntimeTurn,
    event: RuntimeFailedEvent
  ): void {
    if (acceptedTurn.receipt.requestId !== event.requestId) {
      throw new BadRequestException("Turn failure requestId does not match the accepted receipt");
    }
    if (event.sessionId !== null && acceptedTurn.session.sessionId !== event.sessionId) {
      throw new BadRequestException("Turn failure sessionId does not match the accepted session");
    }
  }

  private parseRequiredIsoTimestamp(value: string, field: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO timestamp`);
    }
    return parsed;
  }

  private async releaseLeaseQuietly(acceptedTurn: AcceptedRuntimeTurn): Promise<boolean> {
    try {
      return await this.sessionLeaseService.releaseLease(acceptedTurn.lease);
    } catch {
      return false;
    }
  }
}
