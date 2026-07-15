import assert from "node:assert/strict";
import type { RuntimeSessionLease } from "../src/modules/sessions/session-lease.service";
import type { SessionLeaseService } from "../src/modules/sessions/session-lease.service";
import type { AcceptedRuntimeTurn } from "../src/modules/turns/turn-acceptance.service";
import { TurnLeaseHeartbeatService } from "../src/modules/turns/turn-lease-heartbeat.service";

function createAcceptedTurn(lease: RuntimeSessionLease): AcceptedRuntimeTurn {
  return {
    outcome: "accepted",
    conversationKey: "conversation-key-1",
    session: {
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
    },
    receipt: {
      requestId: "request-1",
      sessionId: "session-1",
      publishedVersionId: "version-1",
      status: "accepted",
      bundleHash: "1111111111111111111111111111111111111111111111111111111111111111",
      resultPayload: null,
      errorCode: null,
      errorMessage: null,
      completedAt: null
    },
    lease
  };
}

class FakeSessionLeaseService {
  renewResult = true;
  renewedLeases: RuntimeSessionLease[] = [];

  async renewLease(lease: RuntimeSessionLease): Promise<boolean> {
    this.renewedLeases.push(lease);
    return this.renewResult;
  }
}

export async function runTurnLeaseHeartbeatServiceTest(): Promise<void> {
  const sessionLeaseService = new FakeSessionLeaseService();
  const service = new TurnLeaseHeartbeatService(
    sessionLeaseService as unknown as SessionLeaseService
  );

  const acceptedTurn = createAcceptedTurn({
    sessionId: "session-1",
    ownerToken: "owner-1"
  });

  const renewed = await service.heartbeatAcceptedTurn(acceptedTurn);
  assert.deepEqual(renewed, {
    outcome: "renewed"
  });
  assert.deepEqual(sessionLeaseService.renewedLeases[0], acceptedTurn.lease);

  sessionLeaseService.renewResult = false;
  const lost = await service.heartbeatAcceptedTurn(acceptedTurn);
  assert.deepEqual(lost, {
    outcome: "lost"
  });
  assert.equal(sessionLeaseService.renewedLeases.length, 2);
}
