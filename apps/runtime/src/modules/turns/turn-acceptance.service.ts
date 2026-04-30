import { Injectable, Logger } from "@nestjs/common";
import type { RuntimeTurnRequest, RuntimeSessionSummary } from "@persai/runtime-contract";
import { type RuntimeSessionLease, SessionLeaseService } from "../sessions/session-lease.service";
import { SessionStoreService } from "../sessions/session-store.service";
import { IdempotencyService, type RuntimeTurnReceiptSummary } from "./idempotency.service";

export interface AcceptedRuntimeTurn {
  outcome: "accepted";
  conversationKey: string;
  session: RuntimeSessionSummary;
  receipt: RuntimeTurnReceiptSummary;
  lease: RuntimeSessionLease;
}

export interface ReplayedRuntimeTurn {
  outcome: "replayed";
  conversationKey: string;
  session: RuntimeSessionSummary;
  receipt: RuntimeTurnReceiptSummary;
}

export interface BusyRuntimeTurn {
  outcome: "busy";
  conversationKey: string;
  session: RuntimeSessionSummary;
}

export interface InFlightRuntimeTurn {
  outcome: "in_flight";
  conversationKey: string;
  session: RuntimeSessionSummary;
  requestId: string | null;
}

export type TurnAcceptanceResult =
  | AcceptedRuntimeTurn
  | ReplayedRuntimeTurn
  | BusyRuntimeTurn
  | InFlightRuntimeTurn;

@Injectable()
export class TurnAcceptanceService {
  private readonly logger = new Logger(TurnAcceptanceService.name);

  constructor(
    private readonly sessionStoreService: SessionStoreService,
    private readonly sessionLeaseService: SessionLeaseService,
    private readonly idempotencyService: IdempotencyService
  ) {}

  async acceptTurn(input: RuntimeTurnRequest): Promise<TurnAcceptanceResult> {
    const ensuredSession = await this.sessionStoreService.ensureSession({
      runtimeTier: input.runtimeTier,
      conversation: input.conversation,
      currentPublishedVersionId: input.bundle.publishedVersionId,
      currentBundleHash: input.bundle.bundleHash
    });

    const replay = await this.idempotencyService.findReplayAcceptedTurn({
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      runtimeTier: input.runtimeTier,
      conversation: input.conversation,
      bundle: input.bundle,
      sessionId: ensuredSession.session.sessionId
    });
    if (replay !== null) {
      return {
        outcome: "replayed",
        conversationKey: ensuredSession.conversationKey,
        session: ensuredSession.session,
        receipt: replay.receipt
      };
    }

    const leaseClaim = await this.sessionLeaseService.claimLeaseForAcceptedTurn({
      sessionId: ensuredSession.session.sessionId,
      conversation: input.conversation,
      idempotencyKey: input.idempotencyKey,
      requestId: input.requestId
    });
    if (leaseClaim.outcome === "busy") {
      this.logger.warn(
        `runtime_turn_busy sessionId=${ensuredSession.session.sessionId} conversationKey=${ensuredSession.conversationKey} requestId=${input.requestId} idempotencyKey=${input.idempotencyKey}`
      );
      return {
        outcome: "busy",
        conversationKey: ensuredSession.conversationKey,
        session: ensuredSession.session
      };
    }

    if (leaseClaim.outcome === "in_flight") {
      this.logger.warn(
        `runtime_turn_in_flight sessionId=${ensuredSession.session.sessionId} conversationKey=${ensuredSession.conversationKey} requestId=${input.requestId} idempotencyKey=${input.idempotencyKey} inFlightRequestId=${leaseClaim.requestId ?? "unknown"}`
      );
      return {
        outcome: "in_flight",
        conversationKey: ensuredSession.conversationKey,
        session: ensuredSession.session,
        requestId: leaseClaim.requestId
      };
    }

    const lease = leaseClaim.lease;

    let claimedTurn: Awaited<ReturnType<IdempotencyService["createAcceptedTurn"]>>;
    try {
      claimedTurn = await this.idempotencyService.createAcceptedTurn({
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        runtimeTier: input.runtimeTier,
        conversation: input.conversation,
        bundle: input.bundle,
        sessionId: ensuredSession.session.sessionId
      });
    } catch (error) {
      await Promise.allSettled([
        this.sessionLeaseService.clearAcceptedTurnInFlight({
          conversation: input.conversation,
          idempotencyKey: input.idempotencyKey
        }),
        this.sessionLeaseService.releaseLease(lease)
      ]);
      throw error;
    }

    await this.clearAcceptedTurnInFlightQuietly(input);
    if (claimedTurn.replayed) {
      await this.releaseLeaseQuietly(lease);
      return {
        outcome: "replayed",
        conversationKey: ensuredSession.conversationKey,
        session: ensuredSession.session,
        receipt: claimedTurn.receipt
      };
    }

    return {
      outcome: "accepted",
      conversationKey: ensuredSession.conversationKey,
      session: ensuredSession.session,
      receipt: claimedTurn.receipt,
      lease
    };
  }

  releaseTurnLease(lease: RuntimeSessionLease): Promise<boolean> {
    return this.sessionLeaseService.releaseLease(lease);
  }

  private async releaseLeaseQuietly(lease: RuntimeSessionLease): Promise<void> {
    try {
      await this.sessionLeaseService.releaseLease(lease);
    } catch {
      // The caller still sees the replayed turn; a leaked lease ages out via Redis TTL.
    }
  }

  private async clearAcceptedTurnInFlightQuietly(input: RuntimeTurnRequest): Promise<void> {
    try {
      await this.sessionLeaseService.clearAcceptedTurnInFlight({
        conversation: input.conversation,
        idempotencyKey: input.idempotencyKey
      });
    } catch {
      // Durable accepted receipts remain the replay truth if the ephemeral marker cleanup fails.
    }
  }
}
