import assert from "node:assert/strict";
import { SessionLeaseService } from "../src/modules/sessions/session-lease.service";
import type { RuntimeStateRedisService } from "../src/modules/runtime-state/infrastructure/coordination/runtime-state-redis.service";

class FakeRuntimeStateRedisService {
  readonly leases = new Map<string, string>();
  readonly inFlightClaims = new Map<string, string>();

  async tryAcquireSessionLease(sessionId: string, ownerToken: string): Promise<boolean> {
    if (this.leases.has(sessionId)) {
      return false;
    }
    this.leases.set(sessionId, ownerToken);
    return true;
  }

  async releaseSessionLease(sessionId: string, ownerToken: string): Promise<boolean> {
    if (this.leases.get(sessionId) !== ownerToken) {
      return false;
    }
    this.leases.delete(sessionId);
    return true;
  }

  async renewSessionLease(sessionId: string, ownerToken: string): Promise<boolean> {
    return this.leases.get(sessionId) === ownerToken;
  }

  async claimAcceptedTurnInFlight(input: {
    sessionId: string;
    ownerToken: string;
    conversation: {
      assistantId: string;
      workspaceId: string;
      channel: string;
      externalThreadKey: string;
      externalUserKey: string | null;
      mode: string;
    };
    idempotencyKey: string;
    requestId: string;
  }): Promise<"acquired" | "busy" | "in_flight"> {
    const inFlightKey = JSON.stringify({
      conversation: input.conversation,
      idempotencyKey: input.idempotencyKey
    });
    if (this.inFlightClaims.has(inFlightKey)) {
      return "in_flight";
    }
    if (this.leases.has(input.sessionId)) {
      return "busy";
    }
    this.leases.set(input.sessionId, input.ownerToken);
    this.inFlightClaims.set(inFlightKey, input.requestId);
    return "acquired";
  }

  async readTurnInFlightMarker(input: {
    conversation: {
      assistantId: string;
      workspaceId: string;
      channel: string;
      externalThreadKey: string;
      externalUserKey: string | null;
      mode: string;
    };
    idempotencyKey: string;
  }): Promise<string | null> {
    return (
      this.inFlightClaims.get(
        JSON.stringify({
          conversation: input.conversation,
          idempotencyKey: input.idempotencyKey
        })
      ) ?? null
    );
  }

  async clearTurnInFlightMarker(input: {
    conversation: {
      assistantId: string;
      workspaceId: string;
      channel: string;
      externalThreadKey: string;
      externalUserKey: string | null;
      mode: string;
    };
    idempotencyKey: string;
  }): Promise<void> {
    this.inFlightClaims.delete(
      JSON.stringify({
        conversation: input.conversation,
        idempotencyKey: input.idempotencyKey
      })
    );
  }
}

export async function runSessionLeaseServiceTest(): Promise<void> {
  const redis = new FakeRuntimeStateRedisService();
  const service = new SessionLeaseService(redis as unknown as RuntimeStateRedisService);

  const firstLease = await service.acquireLease("session-1", "owner-1");
  assert.deepEqual(firstLease, {
    sessionId: "session-1",
    ownerToken: "owner-1"
  });

  const secondLease = await service.acquireLease("session-1", "owner-2");
  assert.equal(secondLease, null);
  assert.equal(await service.renewLease({ sessionId: "session-1", ownerToken: "owner-1" }), true);
  assert.equal(await service.renewLease({ sessionId: "session-1", ownerToken: "owner-2" }), false);
  assert.equal(
    await service.releaseLease({ sessionId: "session-1", ownerToken: "owner-2" }),
    false
  );
  assert.equal(await service.releaseLease({ sessionId: "session-1", ownerToken: "owner-1" }), true);

  const conversation = {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    channel: "web",
    externalThreadKey: "thread-1",
    externalUserKey: "user-1",
    mode: "direct"
  } as const;
  const acquiredClaim = await service.claimLeaseForAcceptedTurn({
    sessionId: "session-claim",
    conversation,
    idempotencyKey: "turn-1",
    requestId: "request-1",
    ownerToken: "claim-owner-1"
  });
  assert.deepEqual(acquiredClaim, {
    outcome: "acquired",
    lease: {
      sessionId: "session-claim",
      ownerToken: "claim-owner-1"
    }
  });
  const inFlightClaim = await service.claimLeaseForAcceptedTurn({
    sessionId: "session-claim",
    conversation,
    idempotencyKey: "turn-1",
    requestId: "request-2",
    ownerToken: "claim-owner-2"
  });
  assert.deepEqual(inFlightClaim, {
    outcome: "in_flight",
    requestId: "request-1"
  });
  await service.clearAcceptedTurnInFlight({
    conversation,
    idempotencyKey: "turn-1"
  });
  const busyClaim = await service.claimLeaseForAcceptedTurn({
    sessionId: "session-claim",
    conversation,
    idempotencyKey: "turn-2",
    requestId: "request-3",
    ownerToken: "claim-owner-3"
  });
  assert.deepEqual(busyClaim, {
    outcome: "busy"
  });
  assert.equal(
    await service.releaseLease({ sessionId: "session-claim", ownerToken: "claim-owner-1" }),
    true
  );

  const generatedLease = await service.acquireLease("session-1");
  assert.equal(generatedLease?.sessionId, "session-1");
  assert.match(generatedLease?.ownerToken ?? "", /^[0-9a-f-]{36}$/);
}
