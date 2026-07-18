import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import type { RuntimeConversationAddress } from "@persai/runtime-contract";
import { RuntimeStateRedisService } from "../runtime-state/infrastructure/coordination/runtime-state-redis.service";

export interface RuntimeSessionLease {
  sessionId: string;
  ownerToken: string;
}

export type AcceptedTurnLeaseClaimResult =
  | {
      outcome: "acquired";
      lease: RuntimeSessionLease;
    }
  | {
      outcome: "busy";
    }
  | {
      outcome: "in_flight";
      requestId: string | null;
    };

@Injectable()
export class SessionLeaseService {
  constructor(private readonly runtimeStateRedisService: RuntimeStateRedisService) {}

  async acquireLease(
    sessionId: string,
    ownerToken: string = randomUUID()
  ): Promise<RuntimeSessionLease | null> {
    this.assertNonEmpty(sessionId, "sessionId");
    this.assertNonEmpty(ownerToken, "ownerToken");

    const acquired = await this.runtimeStateRedisService.tryAcquireSessionLease(
      sessionId,
      ownerToken
    );
    if (!acquired) {
      return null;
    }

    return {
      sessionId,
      ownerToken
    };
  }

  async releaseLease(lease: RuntimeSessionLease): Promise<boolean> {
    this.assertNonEmpty(lease.sessionId, "sessionId");
    this.assertNonEmpty(lease.ownerToken, "ownerToken");
    return this.runtimeStateRedisService.releaseSessionLease(lease.sessionId, lease.ownerToken);
  }

  async renewLease(lease: RuntimeSessionLease): Promise<boolean> {
    this.assertNonEmpty(lease.sessionId, "sessionId");
    this.assertNonEmpty(lease.ownerToken, "ownerToken");
    return this.runtimeStateRedisService.renewSessionLease(lease.sessionId, lease.ownerToken);
  }

  async claimLeaseForAcceptedTurn(input: {
    sessionId: string;
    conversation: RuntimeConversationAddress;
    idempotencyKey: string;
    requestId: string;
    ownerToken?: string;
  }): Promise<AcceptedTurnLeaseClaimResult> {
    this.assertNonEmpty(input.sessionId, "sessionId");
    this.assertNonEmpty(input.idempotencyKey, "idempotencyKey");
    this.assertNonEmpty(input.requestId, "requestId");

    const ownerToken = input.ownerToken ?? randomUUID();
    this.assertNonEmpty(ownerToken, "ownerToken");

    const claimResult = await this.runtimeStateRedisService.claimAcceptedTurnInFlight({
      sessionId: input.sessionId,
      ownerToken,
      conversation: input.conversation,
      idempotencyKey: input.idempotencyKey,
      requestId: input.requestId
    });
    if (claimResult === "acquired") {
      return {
        outcome: "acquired",
        lease: {
          sessionId: input.sessionId,
          ownerToken
        }
      };
    }

    if (claimResult === "in_flight") {
      return {
        outcome: "in_flight",
        requestId: await this.runtimeStateRedisService.readTurnInFlightMarker({
          conversation: input.conversation,
          idempotencyKey: input.idempotencyKey
        })
      };
    }

    return {
      outcome: "busy"
    };
  }

  async clearAcceptedTurnInFlight(input: {
    conversation: RuntimeConversationAddress;
    idempotencyKey: string;
  }): Promise<void> {
    this.assertNonEmpty(input.idempotencyKey, "idempotencyKey");
    await this.runtimeStateRedisService.clearTurnInFlightMarker({
      conversation: input.conversation,
      idempotencyKey: input.idempotencyKey
    });
  }

  async readAcceptedTurnInFlight(input: {
    conversation: RuntimeConversationAddress;
    idempotencyKey: string;
  }): Promise<string | null> {
    this.assertNonEmpty(input.idempotencyKey, "idempotencyKey");
    return this.runtimeStateRedisService.readTurnInFlightMarker(input);
  }

  private assertNonEmpty(value: unknown, field: string): asserts value is string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${field} must be a non-empty string`);
    }
  }
}
