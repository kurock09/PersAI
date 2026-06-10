import assert from "node:assert/strict";
import { AssistantLiveVoiceRelayTicketService } from "../src/modules/workspace-management/application/assistant-live-voice-relay-ticket.service";

class TestRelayTicketService extends AssistantLiveVoiceRelayTicketService {
  constructor(
    secret: string | null,
    private nowMs: number,
    private ttlMs: number
  ) {
    super({
      async resolveSecretValueByProviderKey(providerKey: string) {
        assert.equal(providerKey, "tool_live_voice_relay_ticket");
        return secret;
      }
    } as never);
  }

  protected override getNowMs(): number {
    return this.nowMs;
  }

  protected override getTtlMs(): number {
    return this.ttlMs;
  }

  setNowMs(value: number): void {
    this.nowMs = value;
  }
}

async function run(): Promise<void> {
  {
    const service = new TestRelayTicketService(
      "relay-secret",
      Date.UTC(2026, 5, 10, 10, 0, 0),
      5_000
    );
    const issued = await service.issue({ sessionId: "session-1", userId: "user-1" });
    assert.equal(issued.expiresAt, "2026-06-10T10:00:05.000Z");
    const verified = await service.verify(issued.ticket);
    assert.deepEqual(verified, { sessionId: "session-1", userId: "user-1" });
  }

  {
    const service = new TestRelayTicketService(
      "relay-secret",
      Date.UTC(2026, 5, 10, 10, 0, 0),
      5_000
    );
    const issued = await service.issue({ sessionId: "session-1", userId: "user-1" });
    const [payload, signature] = issued.ticket.split(".");
    const tamperedTicket = `${payload}.${signature.slice(0, -1)}A`;
    assert.equal(await service.verify(tamperedTicket), null);
  }

  {
    const service = new TestRelayTicketService(
      "relay-secret",
      Date.UTC(2026, 5, 10, 10, 0, 0),
      1_000
    );
    const issued = await service.issue({ sessionId: "session-1", userId: "user-1" });
    service.setNowMs(Date.UTC(2026, 5, 10, 10, 0, 2));
    assert.equal(await service.verify(issued.ticket), null);
  }

  {
    const service = new TestRelayTicketService(
      "relay-secret",
      Date.UTC(2026, 5, 10, 10, 0, 0),
      5_000
    );
    assert.equal(await service.verify("not-a-ticket"), null);
    assert.equal(await service.verify("abc.def.ghi"), null);
  }

  {
    const service = new TestRelayTicketService(null, Date.UTC(2026, 5, 10, 10, 0, 0), 5_000);
    await assert.rejects(
      () => service.issue({ sessionId: "session-1", userId: "user-1" }),
      /relay ticket secret is not configured/
    );
  }

  console.log("assistant-live-voice-relay-ticket.service: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
