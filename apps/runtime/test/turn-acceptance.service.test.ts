import assert from "node:assert/strict";
import type { RuntimeTurnRequest, RuntimeSessionSummary } from "@persai/runtime-contract";
import {
  type AcceptedTurnLeaseClaimResult,
  type RuntimeSessionLease,
  SessionLeaseService
} from "../src/modules/sessions/session-lease.service";
import type { EnsuredRuntimeSession, SessionStoreService } from "../src/modules/sessions/session-store.service";
import {
  IdempotencyService,
  type ClaimRuntimeTurnInput,
  type ClaimRuntimeTurnResult
} from "../src/modules/turns/idempotency.service";
import { TurnAcceptanceService } from "../src/modules/turns/turn-acceptance.service";

function createRuntimeTurnRequest(idempotencyKey: string, requestId: string): RuntimeTurnRequest {
  return {
    requestId,
    idempotencyKey,
    runtimeTier: "paid_shared_restricted",
    bundle: {
      bundleId: "bundle-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "version-1",
      bundleHash: "1111111111111111111111111111111111111111111111111111111111111111",
      compiledAt: "2026-04-11T12:00:00.000Z"
    },
    conversation: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-1",
      externalUserKey: "user-1",
      mode: "direct"
    },
    message: {
      text: "hello",
      attachments: [],
      locale: "en",
      timezone: "UTC",
      receivedAt: "2026-04-11T12:00:00.000Z"
    }
  };
}

function createEnsuredSession(): EnsuredRuntimeSession {
  const session: RuntimeSessionSummary = {
    sessionId: "session-1",
    conversation: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-1",
      externalUserKey: "user-1",
      mode: "direct"
    },
    currentTokens: null,
    totalTokensFresh: true,
    compactionCount: 0,
    compactionHintTokens: null,
    providerKey: null,
    modelKey: null,
    updatedAt: "2026-04-11T12:00:00.000Z"
  };

  return {
    conversationKey: "conversation-key-1",
    created: true,
    session
  };
}

function createClaimResult(replayed: boolean, requestId: string): ClaimRuntimeTurnResult {
  return {
    conversationKey: "conversation-key-1",
    replayed,
    receipt: {
      requestId,
      sessionId: "session-1",
      publishedVersionId: "version-1",
      status: "accepted",
      bundleHash: "1111111111111111111111111111111111111111111111111111111111111111",
      resultPayload: null,
      errorCode: null,
      errorMessage: null,
      completedAt: null
    }
  };
}

class FakeSessionStoreService {
  ensuredSession = createEnsuredSession();
  calls: ClaimRuntimeTurnInput[] = [];

  async ensureSession(): Promise<EnsuredRuntimeSession> {
    return this.ensuredSession;
  }
}

class FakeSessionLeaseService {
  claimResult: AcceptedTurnLeaseClaimResult = {
    outcome: "acquired",
    lease: {
      sessionId: "session-1",
      ownerToken: "lease-owner-1"
    }
  };
  claimCount = 0;
  releasedLeases: RuntimeSessionLease[] = [];
  clearedInFlight: Array<{
    conversation: RuntimeTurnRequest["conversation"];
    idempotencyKey: string;
  }> = [];

  async claimLeaseForAcceptedTurn(): Promise<AcceptedTurnLeaseClaimResult> {
    this.claimCount += 1;
    return this.claimResult;
  }

  async releaseLease(lease: RuntimeSessionLease): Promise<boolean> {
    this.releasedLeases.push(lease);
    return true;
  }

  async clearAcceptedTurnInFlight(input: {
    conversation: RuntimeTurnRequest["conversation"];
    idempotencyKey: string;
  }): Promise<void> {
    this.clearedInFlight.push(input);
  }
}

class FakeIdempotencyService {
  replayResult: ClaimRuntimeTurnResult | null = null;
  createResult: ClaimRuntimeTurnResult = createClaimResult(false, "request-1");
  createError: Error | null = null;
  findCalls: ClaimRuntimeTurnInput[] = [];
  createCalls: ClaimRuntimeTurnInput[] = [];

  async findReplayAcceptedTurn(input: ClaimRuntimeTurnInput): Promise<ClaimRuntimeTurnResult | null> {
    this.findCalls.push(input);
    return this.replayResult;
  }

  async createAcceptedTurn(input: ClaimRuntimeTurnInput): Promise<ClaimRuntimeTurnResult> {
    this.createCalls.push(input);
    if (this.createError !== null) {
      throw this.createError;
    }
    return this.createResult;
  }
}

export async function runTurnAcceptanceServiceTest(): Promise<void> {
  const sessionStore = new FakeSessionStoreService();
  const leaseService = new FakeSessionLeaseService();
  const idempotencyService = new FakeIdempotencyService();
  const service = new TurnAcceptanceService(
    sessionStore as unknown as SessionStoreService,
    leaseService as unknown as SessionLeaseService,
    idempotencyService as unknown as IdempotencyService
  );

  const input = createRuntimeTurnRequest("turn-1", "request-1");

  idempotencyService.replayResult = createClaimResult(true, "request-existing");
  const replayed = await service.acceptTurn(input);
  assert.equal(replayed.outcome, "replayed");
  assert.equal(replayed.receipt.requestId, "request-existing");
  assert.equal(leaseService.claimCount, 0);
  assert.equal(idempotencyService.createCalls.length, 0);

  idempotencyService.replayResult = null;
  leaseService.claimResult = {
    outcome: "in_flight",
    requestId: "request-in-flight"
  };
  const inFlight = await service.acceptTurn(input);
  assert.equal(inFlight.outcome, "in_flight");
  assert.equal(inFlight.requestId, "request-in-flight");
  assert.equal(leaseService.claimCount, 1);
  assert.equal(idempotencyService.createCalls.length, 0);

  leaseService.claimResult = {
    outcome: "busy"
  };
  const busy = await service.acceptTurn(input);
  assert.equal(busy.outcome, "busy");
  assert.equal(leaseService.claimCount, 2);
  assert.equal(idempotencyService.createCalls.length, 0);

  leaseService.claimResult = {
    outcome: "acquired",
    lease: {
      sessionId: "session-1",
      ownerToken: "lease-owner-2"
    }
  };
  idempotencyService.createResult = createClaimResult(false, "request-1");
  const accepted = await service.acceptTurn(input);
  assert.equal(accepted.outcome, "accepted");
  assert.equal(accepted.receipt.requestId, "request-1");
  assert.equal(accepted.lease.ownerToken, "lease-owner-2");
  assert.equal(idempotencyService.createCalls.length, 1);
  assert.deepEqual(leaseService.clearedInFlight.at(-1), {
    conversation: input.conversation,
    idempotencyKey: "turn-1"
  });

  leaseService.claimResult = {
    outcome: "acquired",
    lease: {
      sessionId: "session-1",
      ownerToken: "lease-owner-3"
    }
  };
  idempotencyService.createResult = createClaimResult(true, "request-race");
  const replayedAfterLease = await service.acceptTurn(input);
  assert.equal(replayedAfterLease.outcome, "replayed");
  assert.equal(replayedAfterLease.receipt.requestId, "request-race");
  assert.deepEqual(leaseService.releasedLeases.at(-1), {
    sessionId: "session-1",
    ownerToken: "lease-owner-3"
  });

  leaseService.claimResult = {
    outcome: "acquired",
    lease: {
      sessionId: "session-1",
      ownerToken: "lease-owner-4"
    }
  };
  idempotencyService.createError = new Error("persist failed");
  await assert.rejects(() => service.acceptTurn(input), /persist failed/);
  idempotencyService.createError = null;
  assert.deepEqual(leaseService.clearedInFlight.at(-1), {
    conversation: input.conversation,
    idempotencyKey: "turn-1"
  });
  assert.deepEqual(leaseService.releasedLeases.at(-1), {
    sessionId: "session-1",
    ownerToken: "lease-owner-4"
  });
}
