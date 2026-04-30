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
    result: RuntimeTurnResult
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
      session = await this.sessionStoreService.updateSessionSummary({
        sessionId: acceptedTurn.session.sessionId,
        ...(result.usage !== null
          ? {
              providerKey: result.usage.providerKey,
              modelKey: result.usage.modelKey,
              currentTokens: result.usage.totalTokens,
              totalTokensFresh: result.usage.totalTokens !== null
            }
          : { totalTokensFresh: false }),
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
      session = await this.sessionStoreService.updateSessionSummary({
        sessionId: input.acceptedTurn.session.sessionId,
        ...(input.usage === undefined
          ? {}
          : input.usage === null
            ? { totalTokensFresh: false }
            : {
                providerKey: input.usage.providerKey,
                modelKey: input.usage.modelKey,
                currentTokens: input.usage.totalTokens,
                totalTokensFresh: input.usage.totalTokens !== null
              }),
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

    try {
      await this.runtimeStatePostgresService.markTurnReceiptFailed({
        requestId: acceptedTurn.receipt.requestId,
        resultPayload: event,
        errorCode: event.code,
        errorMessage: event.message,
        completedAt
      });
      terminalReceiptPersisted = true;
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
      session: acceptedTurn.session,
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
